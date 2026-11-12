/**
 * Node versions of the Apps Script services a Sheets script calls, for
 * running the script under Node, unchanged.
 * @module apps-script-runner/apps-script-services
 *
 * What: a Sheets script (a `.gs` file) is plain JavaScript that reaches the
 * world through Apps Script's global services. `createAppsScriptServices`
 * builds Node versions of the ones the scripts in these repos call, as one
 * object whose properties become the globals of the script's `vm` context
 * (`load-apps-script.js`).
 *
 * How, service by service:
 *
 * - `UrlFetchApp.fetch` makes a web request and returns the response
 *   synchronously, as Apps Script does. It builds the request from its
 *   options (`toRequest`) and hands it to the `fetchSync` function the
 *   services were built with, which does the request and returns the
 *   status, headers and text. `run-apps-script.js` gives one that blocks
 *   the script's worker thread while the caller's thread does the request;
 *   a test can give one that answers at once. As in Apps Script, a status
 *   of 400 or more throws unless `muteHttpExceptions` is true, and a
 *   request that gets no response at all throws.
 * - `CacheService`'s caches keep each value in memory until it expires:
 *   600 seconds unless the script asks otherwise, and at most Apps
 *   Script's limit of 21,600 seconds (six hours).
 * - `LockService`'s locks are always free, since one script answers one
 *   call at a time, so nothing else can hold them.
 * - `PropertiesService`'s properties live in memory.
 * - `Utilities.sleep` blocks the thread for the time asked, and
 *   `Utilities.formatDate` writes a date in a time zone (`format-date.js`).
 * - `Logger.log` and `console` hand each line, with its level, to the `log`
 *   function the services were built with, or drop it when there is none.
 *
 * Caches and properties last as long as the services do: for the Node
 * versions, as long as the script stays open.
 *
 * Only the methods the scripts in these repos call are here. A script that
 * calls another gets "is not a function", which names the method.
 *
 * Fit: `script-worker.js` builds these for each script it runs; tests build
 * them with a stand-in `fetchSync`.
 */

import util from 'node:util';
import { formatDate } from './format-date.js';

/** Apps Script's cache expiry when the script gives none, in seconds. */
export const DEFAULT_CACHE_SECONDS = 600;

/** Apps Script's longest cache expiry, in seconds. */
export const MAX_CACHE_SECONDS = 21600;

/** How much of the response an http error's message quotes, as Apps Script's does. */
const QUOTED_RESPONSE_CHARACTERS = 200;

/**
 * Blocks the thread for a time, as `Utilities.sleep` does.
 *
 * @param {number} milliseconds - How long
 * @returns {void}
 * @throws {Error} When the time is not a number of milliseconds from zero up
 */
export function sleepSync(milliseconds) {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new Error(`Utilities.sleep needs a number of milliseconds, not ${String(milliseconds)}`);
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Builds the request `fetchSync` is handed from `UrlFetchApp.fetch`'s
 * arguments: the method upper-cased (GET when none is given), the headers
 * with the content type added, and the payload as the body. A payload that
 * is an object is sent as a form, as Apps Script sends it.
 *
 * @param {string} url - The url asked for
 * @param {Object} params - `UrlFetchApp.fetch`'s options
 * @returns {{url: string, method: string, headers: Object<string, string>, body: (string|undefined), redirect: string}} The request
 */
export function toRequest(url, params) {
  const headers = { ...(params.headers ?? {}) };
  let body;
  if (typeof params.payload === 'string') {
    body = params.payload;
  } else if (params.payload !== undefined && params.payload !== null) {
    body = new URLSearchParams(Object.entries(params.payload)).toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  if (typeof params.contentType === 'string') headers['content-type'] = params.contentType;
  return {
    url: String(url),
    method: typeof params.method === 'string' ? params.method.toUpperCase() : 'GET',
    headers,
    body,
    redirect: params.followRedirects === false ? 'manual' : 'follow'
  };
}

/**
 * Turns what `fetchSync` answered into what `UrlFetchApp.fetch` returns,
 * or throws, as Apps Script does.
 *
 * @param {string} url - The url asked for
 * @param {Object} params - `UrlFetchApp.fetch`'s options
 * @param {{status: number, headers: Object<string, string>, text: string}|{failure: string}} answer - The response, or why there was none
 * @returns {{getResponseCode: function(): number, getContentText: function(): string, getHeaders: function(): Object, getAllHeaders: function(): Object}} The response, as an Apps Script HTTPResponse
 * @throws {Error} When there was no response, or its status is 400 or more and `muteHttpExceptions` is not true
 */
export function toHttpResponse(url, params, answer) {
  if (typeof answer.failure === 'string') {
    throw new Error(`The request for ${url} got no response: ${answer.failure}`);
  }
  if (answer.status >= 400 && params.muteHttpExceptions !== true) {
    throw new Error(
      `Request failed for ${url} returned code ${answer.status}. ` +
        `Truncated server response: ${answer.text.slice(0, QUOTED_RESPONSE_CHARACTERS)} ` +
        '(use muteHttpExceptions option to examine full response)'
    );
  }
  return {
    getResponseCode: () => answer.status,
    getContentText: () => answer.text,
    getHeaders: () => ({ ...answer.headers }),
    getAllHeaders: () => ({ ...answer.headers })
  };
}

/**
 * Builds `UrlFetchApp`.
 *
 * @param {function(Object): Object} fetchSync - Does a request built by `toRequest`, and returns the response or why there was none
 * @returns {{fetch: function(string, Object=): Object}} `UrlFetchApp`
 */
function createUrlFetchApp(fetchSync) {
  return {
    fetch(url, params) {
      const options = params ?? {};
      return toHttpResponse(url, options, fetchSync(toRequest(url, options)));
    }
  };
}

/**
 * Builds a cache that keeps each value until it expires.
 *
 * @param {function(): number} now - The time now, in milliseconds
 * @returns {{get: function(string): ?string, put: function(string, *, number=): void, remove: function(string): void}} The cache
 */
function createCache(now) {
  const entries = new Map();
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return null;
      if (now() >= entry.expiresAtMs) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    put(key, value, expirationInSeconds = DEFAULT_CACHE_SECONDS) {
      if (typeof expirationInSeconds !== 'number' || !Number.isFinite(expirationInSeconds) || expirationInSeconds < 1) {
        throw new Error(`Cache.put needs an expiry of one second or more, not ${String(expirationInSeconds)}`);
      }
      const seconds = Math.min(expirationInSeconds, MAX_CACHE_SECONDS);
      entries.set(key, { value: String(value), expiresAtMs: now() + seconds * 1000 });
    },
    remove(key) {
      entries.delete(key);
    }
  };
}

/**
 * Builds a lock that is always free.
 *
 * @returns {{tryLock: function(number): boolean, waitLock: function(number): void, releaseLock: function(): void, hasLock: function(): boolean}} The lock
 */
function createLock() {
  let held = false;
  return {
    tryLock() {
      held = true;
      return true;
    },
    waitLock() {
      held = true;
    },
    releaseLock() {
      held = false;
    },
    hasLock() {
      return held;
    }
  };
}

/**
 * Builds a store of properties held in memory.
 *
 * @returns {{getProperty: function(string): ?string, setProperty: function(string, *): Object, deleteProperty: function(string): Object}} The properties
 */
function createProperties() {
  const values = new Map();
  const properties = {
    getProperty: (key) => values.get(key) ?? null,
    setProperty(key, value) {
      values.set(key, String(value));
      return properties;
    },
    deleteProperty(key) {
      values.delete(key);
      return properties;
    }
  };
  return properties;
}

/**
 * Builds `Logger` and `console`, which hand each line to `log`.
 *
 * @param {?function({level: string, text: string}): void} log - Takes each line, or null to drop them
 * @returns {{Logger: Object, console: Object}} The two
 */
function createLogging(log) {
  const write = (level, values) => {
    if (log !== null) log({ level, text: util.format(...values) });
  };
  const Logger = {
    log(...values) {
      write('log', values);
      return Logger;
    }
  };
  const console = {
    log: (...values) => write('log', values),
    info: (...values) => write('info', values),
    warn: (...values) => write('warn', values),
    error: (...values) => write('error', values),
    debug: (...values) => write('debug', values)
  };
  return { Logger, console };
}

/**
 * Builds the Apps Script services for one script.
 *
 * @param {Object} options - What the services use
 * @param {function(Object): Object} options.fetchSync - Does one request, built by `toRequest`, and returns `{status, headers, text}`, or `{failure}` when there was no response
 * @param {function(number): void} [options.sleep=sleepSync] - Blocks for a number of milliseconds
 * @param {?function({level: string, text: string}): void} [options.log=null] - Takes each line the script logs, or null to drop them
 * @param {function(): number} [options.now=Date.now] - The time now, in milliseconds, for the cache's expiry
 * @returns {Object} The services, by their Apps Script names
 */
export function createAppsScriptServices({ fetchSync, sleep = sleepSync, log = null, now = Date.now }) {
  const cache = createCache(now);
  const properties = createProperties();
  const { Logger, console } = createLogging(log);
  return {
    UrlFetchApp: createUrlFetchApp(fetchSync),
    CacheService: { getScriptCache: () => cache, getUserCache: () => cache, getDocumentCache: () => cache },
    LockService: { getScriptLock: createLock, getUserLock: createLock, getDocumentLock: createLock },
    PropertiesService: {
      getScriptProperties: () => properties,
      getUserProperties: () => properties,
      getDocumentProperties: () => properties
    },
    Utilities: { sleep, formatDate },
    Logger,
    console
  };
}
