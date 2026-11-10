/**
 * Runs a Sheets script, unchanged, under Node for tests.
 * @module tests/helpers/sheets-script
 *
 * The Sheets scripts in this repo (the `.gs` files) are Google Apps Script:
 * plain JavaScript that calls Apps Script services such as `UrlFetchApp`
 * and `CacheService`. `loadSheetsScript` reads a script and runs it in a
 * fresh Node `vm` context whose globals stand in for those services, then
 * returns the context. The script's top-level functions are properties of
 * that context, so a test calls them as `script.getCryptoPrice(...)`.
 *
 * The stand-ins: `UrlFetchApp.fetch` answers each url from the test's
 * `answer` function, where null reads as a 404; the cache starts empty; the
 * lock is always free; sleeps return at once; and `Utilities.formatDate`
 * knows the one format the scripts give dates in, `dd-MM-yyyy` in UTC.
 */

import fs from 'fs';
import vm from 'vm';

/**
 * Loads a Sheets script with stand-ins for the Apps Script services.
 *
 * @param {string} scriptPath - Path of the `.gs` file
 * @param {function(string): (Object|Array|null)} answer - The json body for a url, or null for a 404
 * @returns {Object} The context holding the script's top-level functions
 */
export function loadSheetsScript(scriptPath, answer) {
  const cache = new Map();
  const pad = (n) => String(n).padStart(2, '0');
  const context = vm.createContext({
    Logger: { log() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => cache.get(key) ?? null,
        put: (key, value) => {
          cache.set(key, value);
        },
        remove: (key) => {
          cache.delete(key);
        }
      })
    },
    Utilities: {
      sleep() {},
      formatDate: (date, zone, format) => {
        if (zone !== 'UTC' || format !== 'dd-MM-yyyy') {
          throw new Error(`The stand-in formatDate has no ${zone} ${format}`);
        }
        return `${pad(date.getUTCDate())}-${pad(date.getUTCMonth() + 1)}-${date.getUTCFullYear()}`;
      }
    },
    UrlFetchApp: {
      fetch: (url) => {
        const body = answer(url);
        return {
          getResponseCode: () => (body === null ? 404 : 200),
          getContentText: () => JSON.stringify(body)
        };
      }
    }
  });
  vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), context);
  return context;
}
