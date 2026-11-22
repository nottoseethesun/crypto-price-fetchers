/**
 * Runs a Sheets script, unchanged, under Node for tests.
 * @module tests/helpers/sheets-script
 *
 * The Sheets scripts in this repo (the `.gs` files) are Google Apps Script:
 * plain JavaScript that calls Apps Script services such as `UrlFetchApp`
 * and `CacheService`. `loadSheetsScript` runs a script in the test's own
 * thread with the Node versions of those services from the repo's runner,
 * `apps-script-runner/`, which the scripts' Node versions use too, and
 * returns the script's context. The script's top-level functions are
 * properties of that context, so a test calls them as
 * `script.getCryptoPrice(...)`.
 *
 * Two services are stand-ins here: `UrlFetchApp.fetch` answers each url
 * from the test's `answer` function, and sleeps return at once unless the
 * test passes its own. A test may hand more stand-ins, such as the
 * spreadsheet of `test/helpers/stand-in-spreadsheet.js` at the repo's top,
 * or the script lock of `busyLockService`, which is never free, which
 * replace the runner's services of the same name. `answer` gets the url
 * and the whole request, its headers included, and returns a json body,
 * which goes with status 200, null, which reads as a 404,
 * `reply(status, body)` for any other status, `rawReply(status, text)` for
 * a body that is no json, or `noResponse(why)` for no response at all.
 * The script's log lines are dropped. `CUSTOM_FUNCTION_LIMIT_MS` is the
 * time Google lets a custom function, a function a cell calls, run.
 */

import fs from "fs";
import { createAppsScriptServices } from "../../../../apps-script-runner/apps-script-services.js";
import {
  applyConfig,
  loadAppsScript,
} from "../../../../apps-script-runner/load-apps-script.js";

/** How long Google lets a custom function run before it stops it. */
export const CUSTOM_FUNCTION_LIMIT_MS = 30000;

/** Marks what `reply` returns, so no json body is taken for one. */
const REPLY = Symbol("reply");

/** Marks what `noResponse` returns. */
const NO_RESPONSE = Symbol("no response");

/**
 * No response at all, as a timeout or a refused connection gives, for
 * `answer` to return: the script's `UrlFetchApp.fetch` then throws, as
 * Apps Script's does.
 *
 * @param {string} why - Why there was no response
 * @returns {Object} The answer
 */
export function noResponse(why) {
  return { [NO_RESPONSE]: why };
}

/**
 * A reply with a status of its own, for `answer` to return.
 *
 * @param {number} status - The status, such as 402 or 429
 * @param {*} [body=null] - The json body
 * @returns {{status: number, text: string}} The reply
 */
export function reply(status, body = null) {
  return { [REPLY]: true, status, text: JSON.stringify(body) };
}

/**
 * A reply whose body is the text given, json or not, for `answer` to
 * return.
 *
 * @param {number} status - The status
 * @param {string} text - The body
 * @returns {{status: number, text: string}} The reply
 */
export function rawReply(status, text) {
  return { [REPLY]: true, status, text };
}

/**
 * The status and body text an answer stands for: a reply's own, else 200
 * with the json body, or 404 for null. `stand-in-fetch.js` reads its
 * answers through this function too.
 *
 * @param {*} answered - What `answer` returned
 * @returns {{status: number, text: string}} The status and the body
 */
export function replyOf(answered) {
  if (answered !== null && typeof answered === "object" && answered[REPLY])
    return answered;
  return answered === null
    ? { status: 404, text: "null" }
    : { status: 200, text: JSON.stringify(answered) };
}

/**
 * A script lock that is never free, recording each wait asked of it, for
 * `options.services` of `loadSheetsScript`.
 *
 * @param {number[]} waits - Takes each wait, in ms
 * @returns {Object} The stand-in `LockService`
 */
export function busyLockService(waits) {
  const lock = {
    tryLock: (milliseconds) => {
      waits.push(milliseconds);
      return false;
    },
    releaseLock: () => {},
    hasLock: () => false,
  };
  return { getScriptLock: () => lock, getDocumentLock: () => lock };
}

/**
 * Loads a Sheets script whose web requests answer from `answer`.
 *
 * @param {string|string[]} scriptPath - Path of the `.gs` file, or of a script's files in the order Apps Script loads them
 * @param {function(string, {url: string, headers: Object<string, string>}): *} answer - A json body, null for a 404, `reply(status, body)`, `rawReply(status, text)` or `noResponse(why)`
 * @param {Object} [options] - What else the script starts with
 * @param {Object<string, Object>} [options.config={}] - Fields to set in its config objects, as its Node version sets them, such as `{ CONFIG: { COINGECKO_API_KEY: '...' } }`
 * @param {function(number): void} [options.sleep] - Takes each wait the script makes; returns at once when absent
 * @param {Object<string, Object>} [options.services={}] - More services, by name, such as `{ SpreadsheetApp }`, laid over the runner's
 * @returns {Object} The context holding the script's top-level functions
 */
export function loadSheetsScript(scriptPath, answer, options = {}) {
  const services = createAppsScriptServices({
    fetchSync: (request) => {
      const answered = answer(request.url, request);
      if (answered !== null && answered?.[NO_RESPONSE] !== undefined)
        return { failure: answered[NO_RESPONSE] };
      const { status, text } = replyOf(answered);
      return { status, headers: {}, text };
    },
    sleep: options.sleep ?? (() => {}),
  });
  const files = [scriptPath].flat().map((filename) => ({
    source: fs.readFileSync(filename, "utf8"),
    filename,
  }));
  const context = loadAppsScript(files, {
    ...services,
    ...options.services,
  });
  applyConfig(context, options.config ?? {});
  return context;
}
