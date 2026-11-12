/**
 * The worker thread that runs one Sheets script for `run-apps-script.js`.
 * @module apps-script-runner/script-worker
 *
 * What: this file is the entry point of the worker thread that
 * `openAppsScript` starts. It loads the script named in `workerData`,
 * applies the config, and then answers each call the caller's thread posts.
 *
 * How: a Sheets script calls `UrlFetchApp.fetch` and expects the response
 * back, synchronously, where Node's fetch returns a promise. So this thread
 * runs the script and blocks while the caller's thread does each request:
 *
 * 1. `fetchThroughCaller` posts the request, numbered, on the request port.
 * 2. It blocks in `Atomics.wait` on the shared answer counter.
 * 3. The caller's thread does the request with its fetch, posts the answer
 *    with the request's number, adds one to the counter, and wakes this
 *    thread.
 * 4. `fetchThroughCaller` takes the answers waiting on the port with
 *    `receiveMessageOnPort`, which reads a port without the event loop
 *    this blocked thread is not running, and returns the one with its
 *    request's number. An answer to an earlier request, which came after
 *    that request gave up, is dropped.
 *
 * If no answer comes within the request timeout plus a grace period,
 * `fetchThroughCaller` throws, so the script sees a request that got no
 * response. The caller's fetch gives up at the request timeout itself, so
 * the grace period is only reached when the caller's thread is too busy to
 * answer.
 *
 * The script's log lines and each call's result or error go back to the
 * caller's thread as messages: `ready` or `failed` once the script has
 * loaded or failed to, `log` for each line when logging is on, and
 * `returned` or `threw` for each call, by its id.
 *
 * Fit: started by `openAppsScript` only; nothing imports this file.
 */

import fs from 'node:fs';
import { parentPort, receiveMessageOnPort, workerData } from 'node:worker_threads';
import { createAppsScriptServices } from './apps-script-services.js';
import { applyConfig, callScriptFunction, loadAppsScript } from './load-apps-script.js';

/** How long past the request timeout to wait for an answer before giving up, in milliseconds. */
const ANSWER_GRACE_MS = 5000;

/** The counter the caller's thread adds one to after each answer it posts. */
const answerCounter = new Int32Array(workerData.answerCounter);

/** The port requests go out on and answers come back on. */
const requestPort = workerData.requestPort;

/** The number of the latest request. */
let requestNumber = 0;

/**
 * The message of something thrown, from any realm.
 *
 * @param {*} thrown - What was thrown
 * @returns {string} Its message
 */
function messageOf(thrown) {
  if (thrown !== null && typeof thrown === 'object' && typeof thrown.message === 'string') return thrown.message;
  return String(thrown);
}

/**
 * Takes the answers waiting on the request port, and returns the one to
 * the given request, dropping any to earlier requests.
 *
 * @param {number} number - The request's number
 * @returns {Object|undefined} The answer, or undefined when it has not come
 */
function takeAnswer(number) {
  let received = receiveMessageOnPort(requestPort);
  while (received !== undefined) {
    if (received.message.number === number) return received.message.answer;
    received = receiveMessageOnPort(requestPort);
  }
  return undefined;
}

/**
 * Does a web request through the caller's thread, blocking until the
 * answer comes. This is the `fetchSync` of the script's `UrlFetchApp`.
 *
 * @param {Object} request - The request, built by `toRequest`
 * @returns {Object} `{status, headers, text}`, or `{failure}` when there was no response
 * @throws {Error} When no answer comes in time
 */
function fetchThroughCaller(request) {
  requestNumber += 1;
  const number = requestNumber;
  const deadline = Date.now() + workerData.requestTimeoutMs + ANSWER_GRACE_MS;
  let seen = Atomics.load(answerCounter, 0);
  requestPort.postMessage({ number, request });
  for (;;) {
    const answer = takeAnswer(number);
    if (answer !== undefined) return answer;
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`No answer in time to the request for ${request.url}`);
    Atomics.wait(answerCounter, 0, seen, left);
    seen = Atomics.load(answerCounter, 0);
  }
}

/**
 * Hands a line the script logged to the caller's thread.
 *
 * @param {{level: string, text: string}} line - The line and its level
 * @returns {void}
 */
function logToCaller(line) {
  parentPort.postMessage({ type: 'log', level: line.level, text: line.text });
}

/**
 * Answers one call: runs the script's function and posts what it returned,
 * or its error.
 *
 * @param {Object} context - The script's context
 * @param {{id: number, name: string, args: Array}} call - The call
 * @returns {void}
 */
function answerCall(context, { id, name, args }) {
  let reply;
  try {
    reply = { type: 'returned', id, value: callScriptFunction(context, name, args) };
  } catch (thrown) {
    reply = { type: 'threw', id, message: messageOf(thrown) };
  }
  try {
    parentPort.postMessage(reply);
  } catch (thrown) {
    parentPort.postMessage({
      type: 'threw',
      id,
      message: `${name} returned a value that cannot be passed back to Node: ${messageOf(thrown)}`
    });
  }
}

/**
 * Loads the script, applies the config, and starts answering calls; posts
 * `ready`, or `failed` with the reason.
 *
 * @returns {void}
 */
function start() {
  try {
    const services = createAppsScriptServices({
      fetchSync: fetchThroughCaller,
      log: workerData.logging ? logToCaller : null
    });
    const source = fs.readFileSync(workerData.scriptPath, 'utf8');
    const context = loadAppsScript(source, workerData.scriptPath, services);
    applyConfig(context, workerData.config);
    parentPort.on('message', (call) => answerCall(context, call));
    parentPort.postMessage({ type: 'ready' });
  } catch (thrown) {
    parentPort.postMessage({ type: 'failed', message: messageOf(thrown) });
  }
}

start();
