/**
 * Runs a Sheets script under Node, unchanged, and calls its functions.
 * @module apps-script-runner/run-apps-script
 *
 * What: `openAppsScript` loads one `.gs` file and returns its functions as
 * async calls. `await script.call('getCryptoPrice', 'xtm', ...)` returns
 * what the Sheets cell would show, worked out by the script's own code.
 *
 * How: a Sheets script expects `UrlFetchApp.fetch` to return the response
 * synchronously, where Node's fetch returns a promise. So the script runs
 * in a worker thread of its own (`script-worker.js`), which blocks while
 * each request is done here, on the caller's thread, with the caller's
 * fetch. The worker posts the request, numbered, on a request port and
 * waits on a shared counter; `answerRequest` does the request, and the
 * answer goes back on the port with the request's number before the
 * counter is moved on and the worker woken. The caller's thread never
 * blocks, so a program that uses this keeps serving whatever else it
 * serves while a script works.
 *
 * Calls are answered one at a time, in the order made, as one worker runs
 * one script. While a call is out, the worker and the request port keep
 * the process running; between calls they don't, so a program that never
 * closes the script still exits once its own work is done. `close` stops
 * the worker, and a call still out then fails.
 *
 * The request is done on the caller's thread, rather than with a package
 * such as synckit, so the caller can hand in a fetch of its own, as the
 * tests do: synckit runs the async work in a worker of its own, which a
 * function cannot be passed to.
 *
 * Fit: the Node versions of the Sheets scripts use this, in this repo and
 * in pulsechain-analytics, which installs it from this repo.
 */

import { fileURLToPath } from 'node:url';
import { MessageChannel, Worker } from 'node:worker_threads';

/** The worker thread's entry point. */
const SCRIPT_WORKER = new URL('./script-worker.js', import.meta.url);

/** How long a request may take before it counts as having no response, in milliseconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60000;

/**
 * The message of something thrown.
 *
 * @param {*} thrown - What was thrown
 * @returns {string} Its message
 */
function messageOf(thrown) {
  if (thrown !== null && typeof thrown === 'object' && typeof thrown.message === 'string') return thrown.message;
  return String(thrown);
}

/**
 * Does one request with the caller's fetch, and returns the answer the
 * script's `UrlFetchApp` takes.
 *
 * @param {{url: string, method: string, headers: Object<string, string>, body: (string|undefined), redirect: string}} request - The request (`toRequest`)
 * @param {function(string, Object): Promise<Response>} fetchFunction - The caller's fetch, shaped as Node's own
 * @param {number} timeoutMs - How long the request may take, in milliseconds
 * @returns {Promise<{status: number, headers: Object<string, string>, text: string}|{failure: string}>} The response, or why there was none
 */
export async function answerRequest(request, fetchFunction, timeoutMs) {
  try {
    const response = await fetchFunction(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: request.redirect,
      signal: AbortSignal.timeout(timeoutMs)
    });
    return { status: response.status, headers: Object.fromEntries(response.headers), text: await response.text() };
  } catch (thrown) {
    return { failure: messageOf(thrown) };
  }
}

/**
 * Checks `openAppsScript`'s options and fills in the defaults.
 *
 * @param {Object} options - The options given
 * @returns {{config: Object, fetchFunction: function, onLog: ?function, requestTimeoutMs: number}} The options to use
 * @throws {TypeError} When an option is of the wrong kind
 */
function readOptions(options) {
  const config = options.config ?? {};
  const fetchFunction = options.fetch ?? globalThis.fetch;
  const onLog = options.onLog ?? null;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (typeof config !== 'object' || Array.isArray(config)) throw new TypeError('config must be an object');
  if (typeof fetchFunction !== 'function') throw new TypeError('fetch must be a function');
  if (onLog !== null && typeof onLog !== 'function') throw new TypeError('onLog must be a function');
  if (typeof requestTimeoutMs !== 'number' || !Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new TypeError('requestTimeoutMs must be a number of milliseconds above zero');
  }
  return { config, fetchFunction, onLog, requestTimeoutMs };
}

/**
 * Answers a request the worker posted: does it, posts the answer with the
 * request's number, then moves the counter on and wakes the worker.
 *
 * @param {{number: number, request: Object}} posted - The numbered request
 * @param {{fetchFunction: function, requestTimeoutMs: number}} settings - The fetch and timeout to use
 * @param {MessagePort} requestPort - The port answers go back on
 * @param {Int32Array} answerCounter - The counter the worker waits on
 * @returns {Promise<void>} Settles once the answer is posted
 */
async function answerPostedRequest({ number, request }, settings, requestPort, answerCounter) {
  const answer = await answerRequest(request, settings.fetchFunction, settings.requestTimeoutMs);
  requestPort.postMessage({ number, answer });
  Atomics.add(answerCounter, 0, 1);
  Atomics.notify(answerCounter, 0);
}

/**
 * Settles one call from the worker's reply.
 *
 * @param {Object} session - The open script's state
 * @param {number} id - The call's id
 * @param {function({resolve: function, reject: function}): void} finish - Settles the call's promise
 * @returns {void}
 */
function settleCall(session, id, finish) {
  const outcome = session.pending.get(id);
  if (outcome === undefined) return;
  session.pending.delete(id);
  if (session.pending.size === 0) session.holdOpen(false);
  finish(outcome);
}

/**
 * Handles one message from the worker.
 *
 * @param {{type: string}} message - The message
 * @param {Object} session - The open script's state
 * @returns {void}
 */
function onWorkerMessage(message, session) {
  switch (message.type) {
    case 'ready':
      session.loaded.resolve();
      return;
    case 'failed':
      session.loaded.reject(new Error(message.message));
      return;
    case 'log':
      if (session.onLog !== null) session.onLog({ level: message.level, text: message.text });
      return;
    case 'returned':
      settleCall(session, message.id, (outcome) => outcome.resolve(message.value));
      return;
    case 'threw':
      settleCall(session, message.id, (outcome) => outcome.reject(new Error(message.message)));
      return;
    default:
      return;
  }
}

/**
 * Fails every call still out, and the load if it is still under way.
 *
 * @param {Object} session - The open script's state
 * @param {string} reason - Why
 * @returns {void}
 */
function endSession(session, reason) {
  session.loaded.reject(new Error(reason));
  for (const outcome of session.pending.values()) outcome.reject(new Error(reason));
  session.pending.clear();
}

/**
 * Starts a call: posts it to the worker and returns its promise.
 *
 * @param {Object} session - The open script's state
 * @param {string} name - The script function's name
 * @param {Array} args - Its arguments
 * @returns {Promise<*>} What the function returns
 */
function startCall(session, name, args) {
  session.lastId += 1;
  const id = session.lastId;
  const outcome = Promise.withResolvers();
  session.pending.set(id, outcome);
  session.holdOpen(true);
  try {
    session.worker.postMessage({ id, name, args });
  } catch (thrown) {
    settleCall(session, id, () =>
      outcome.reject(new Error(`The arguments to ${name} cannot be passed to the script: ${messageOf(thrown)}`))
    );
  }
  return outcome.promise;
}

/**
 * Loads a Sheets script under Node and returns its functions as async
 * calls.
 *
 * @param {string|URL} scriptPath - The `.gs` file
 * @param {Object} [options] - How to run it
 * @param {Object<string, Object>} [options.config={}] - Fields of the script's config objects to set, such as `{ CONFIG: { API_KEY: '...' } }` (`applyConfig`)
 * @param {function(string, Object): Promise<Response>} [options.fetch=globalThis.fetch] - Does the script's web requests; shaped as Node's own fetch
 * @param {?function({level: string, text: string}): void} [options.onLog=null] - Takes each line the script logs, or null to drop them
 * @param {number} [options.requestTimeoutMs=60000] - How long a request may take before it counts as having no response
 * @returns {Promise<{call: function(string, ...*): Promise<*>, close: function(): Promise<void>}>} The open script: `call(name, ...args)` calls a function, `close()` stops the script
 * @throws {Error} When the script cannot be read, does not compile, throws as it loads, or the config names an object or field the script lacks
 */
export async function openAppsScript(scriptPath, options = {}) {
  const settings = readOptions(options);
  const answerCounter = new Int32Array(new SharedArrayBuffer(4));
  const { port1: requestPort, port2: workerRequestPort } = new MessageChannel();
  requestPort.on('message', (posted) => answerPostedRequest(posted, settings, requestPort, answerCounter));
  const worker = new Worker(SCRIPT_WORKER, {
    /*- The worker takes none of the caller's Node flags: a flag meant for
     *  the caller's own entry point, such as --input-type, stops a worker
     *  from starting, and the worker needs none to run a script. */
    execArgv: [],
    workerData: {
      scriptPath: scriptPath instanceof URL ? fileURLToPath(scriptPath) : String(scriptPath),
      config: settings.config,
      requestTimeoutMs: settings.requestTimeoutMs,
      logging: settings.onLog !== null,
      answerCounter: answerCounter.buffer,
      requestPort: workerRequestPort
    },
    transferList: [workerRequestPort]
  });
  const session = {
    worker,
    pending: new Map(),
    lastId: 0,
    loaded: Promise.withResolvers(),
    onLog: settings.onLog,
    holdOpen(open) {
      if (open) {
        worker.ref();
        requestPort.ref();
      } else {
        worker.unref();
        requestPort.unref();
      }
    }
  };
  worker.on('message', (message) => onWorkerMessage(message, session));
  worker.on('error', (error) => endSession(session, `The script's worker failed: ${messageOf(error)}`));
  worker.on('exit', (code) => endSession(session, `The script's worker stopped, with exit code ${code}`));
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    endSession(session, 'The script was closed before the call returned');
    requestPort.close();
    await worker.terminate();
  };
  try {
    await session.loaded.promise;
  } catch (error) {
    await close();
    throw error;
  }
  session.holdOpen(false);
  return {
    call: (name, ...args) => (closed ? Promise.reject(new Error('The script is closed')) : startCall(session, name, args)),
    close
  };
}
