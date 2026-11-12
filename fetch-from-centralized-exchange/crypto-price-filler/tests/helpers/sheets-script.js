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
 * from the test's `answer` function, where null reads as a 404, and sleeps
 * return at once. The script's log lines are dropped.
 */

import fs from 'fs';
import { createAppsScriptServices } from '../../../../apps-script-runner/apps-script-services.js';
import { loadAppsScript } from '../../../../apps-script-runner/load-apps-script.js';

/**
 * Loads a Sheets script whose web requests answer from `answer`.
 *
 * @param {string} scriptPath - Path of the `.gs` file
 * @param {function(string): (Object|Array|null)} answer - The json body for a url, or null for a 404
 * @returns {Object} The context holding the script's top-level functions
 */
export function loadSheetsScript(scriptPath, answer) {
  const services = createAppsScriptServices({
    fetchSync: (request) => {
      const body = answer(request.url);
      return { status: body === null ? 404 : 200, headers: {}, text: JSON.stringify(body) };
    },
    sleep: () => {}
  });
  return loadAppsScript(fs.readFileSync(scriptPath, 'utf8'), scriptPath, services);
}
