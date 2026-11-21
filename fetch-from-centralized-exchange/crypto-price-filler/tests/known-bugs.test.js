/**
 * Tests of the bugs known in the repo's code, each declared with `it.fails`.
 * @module tests/known-bugs.test
 *
 * Each test checks the behavior the code should have, so it fails while
 * the bug is there, and `it.fails` turns that failure into a pass. A fix
 * makes the test pass, so `it.fails` fails it: the same change declares the
 * test with `it` and moves it to `regressions.test.js`, or to
 * `regressions-command-line.test.js` for the filler's command lines, and
 * removes the
 * bug's row from the table in the repo's CLAUDE.md, which lists each test
 * here.
 *
 * The Sheets scripts run unchanged in the test's thread, through
 * `tests/helpers/sheets-script.js`, with a stand-in for the Apps Script
 * service each test is about: the script lock, or the spreadsheet whose
 * time zone a date cell's time is shown in.
 */

import { describe, it, expect } from "vitest";
import path from "path";
import { callScriptFunction } from "../../../apps-script-runner/load-apps-script.js";
import { loadSheetsScript } from "./helpers/sheets-script.js";

/** How long Google lets a custom function run before it stops it. */
const CUSTOM_FUNCTION_LIMIT_MS = 30000;

/** The DexTools script, at the repo's top. */
const DEXTOOLS_SCRIPT = path.resolve(
  __dirname,
  "../../../crypto-price-fetchers.gs",
);

/** The exchange script's files its function needs, in the order Apps Script loads them. */
const EXCHANGE_SCRIPT = [
  "../../getCryptoPriceFromCentralizedExchange.gs",
  "../../getCryptoPriceFromCentralizedExchange-sources.gs",
].map((file) => path.resolve(__dirname, file));

/**
 * A script lock that is never free, recording each wait asked of it.
 *
 * @param {number[]} waits - Takes each wait, in ms
 * @returns {Object} The stand-in `LockService`
 */
function busyLockService(waits) {
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

describe("waits inside a custom function", () => {
  it.fails(
    "dexToolsGetTokenPrice waits for the script lock no longer than Google lets a custom function run",
    () => {
      const waits = [];
      const script = loadSheetsScript(DEXTOOLS_SCRIPT, () => null, {
        services: { LockService: busyLockService(waits) },
      });
      script.dexToolsGetTokenPrice(
        "pulse",
        "0xF84b84dAAce6Ac00DbBAed26CA32Ff3570Aaf66C",
      );
      expect(waits.length).toBeGreaterThan(0);
      expect(Math.max(...waits)).toBeLessThanOrEqual(CUSTOM_FUNCTION_LIMIT_MS);
    },
  );

  it.fails(
    "getCryptoPrice waits for the script lock, in all, no longer than Google lets a custom function run",
    () => {
      const waits = [];
      const sleeps = [];
      const script = loadSheetsScript(EXCHANGE_SCRIPT, () => null, {
        services: { LockService: busyLockService(waits) },
        sleep: (milliseconds) => sleeps.push(milliseconds),
      });
      script.getCryptoPrice("btc", "2026-01-15 14:30:00", "UTC", "high");
      const waited = [...waits, ...sleeps].reduce((sum, ms) => sum + ms, 0);
      expect(waits.length).toBeGreaterThan(0);
      expect(waited).toBeLessThanOrEqual(CUSTOM_FUNCTION_LIMIT_MS);
    },
  );
});

describe("a date cell", () => {
  it.fails(
    "getCryptoPrice reads a date cell as the time it shows, in the spreadsheet's time zone",
    () => {
      const asked = [];
      const script = loadSheetsScript(
        EXCHANGE_SCRIPT,
        (url) => {
          asked.push(url);
          return url.includes("/exchangeInfo")
            ? {
                symbols: [
                  { symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" },
                ],
              }
            : null;
        },
        {
          services: {
            SpreadsheetApp: {
              getActiveSpreadsheet: () => ({
                getSpreadsheetTimeZone: () => "America/Chicago",
              }),
            },
          },
        },
      );
      // A spreadsheet set to Central time hands a cell that shows
      // 2025-06-15 07:30:00, CDT, as this moment: 12:30 UTC; the runner
      // remakes it as the script's own Date, as Sheets hands it
      const cell = new Date(Date.UTC(2025, 5, 15, 12, 30, 0));
      callScriptFunction(script, "getCryptoPrice", [
        "xtm",
        cell,
        "CDT",
        "high",
      ]);
      const minute = asked.find((url) => url.includes("interval=1m"));
      expect(minute).toContain(`&endTime=${Date.UTC(2025, 5, 15, 12, 30, 0)}&`);
    },
  );
});
