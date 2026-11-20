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
 * test passes its own. `answer` gets the url and the whole request, its
 * headers included, and returns a json body, which goes with status 200,
 * null, which reads as a 404, `reply(status, body)` for any other status,
 * or `rawReply(status, text)` for a body that is no json. The script's log
 * lines are dropped.
 */

import fs from "fs";
import { createAppsScriptServices } from "../../../../apps-script-runner/apps-script-services.js";
import {
  applyConfig,
  loadAppsScript,
} from "../../../../apps-script-runner/load-apps-script.js";

/** Marks what `reply` returns, so no json body is taken for one. */
const REPLY = Symbol("reply");

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
 * with the json body, or 404 for null. `stand-in-exchange.js` reads
 * answers the same way.
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
 * Loads a Sheets script whose web requests answer from `answer`.
 *
 * @param {string|string[]} scriptPath - Path of the `.gs` file, or of a script's files in the order Apps Script loads them
 * @param {function(string, {url: string, headers: Object<string, string>}): *} answer - A json body, null for a 404, `reply(status, body)` or `rawReply(status, text)`
 * @param {Object} [options] - What else the script starts with
 * @param {Object<string, Object>} [options.config={}] - Fields to set in its config objects, as its Node version sets them, such as `{ CONFIG: { COINGECKO_API_KEY: '...' } }`
 * @param {function(number): void} [options.sleep] - Takes each wait the script makes; returns at once when absent
 * @returns {Object} The context holding the script's top-level functions
 */
export function loadSheetsScript(scriptPath, answer, options = {}) {
  const services = createAppsScriptServices({
    fetchSync: (request) => {
      const { status, text } = replyOf(answer(request.url, request));
      return { status, headers: {}, text };
    },
    sleep: options.sleep ?? (() => {}),
  });
  const files = [scriptPath].flat().map((filename) => ({
    source: fs.readFileSync(filename, "utf8"),
    filename,
  }));
  const context = loadAppsScript(files, services);
  applyConfig(context, options.config ?? {});
  return context;
}
