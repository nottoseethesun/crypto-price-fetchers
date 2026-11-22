/**
 * Tests of the bugs known in the repo's code, each declared with `it.fails`.
 * @module tests/known-bugs.test
 *
 * Each test checks the behavior the code should have, so it fails while
 * the bug is there, and `it.fails` turns that failure into a pass. A fix
 * makes the test pass, so `it.fails` fails it: the same change declares the
 * test with `it` and moves it to `regressions-command-line.test.js` for the
 * filler's command lines, to `regressions-lib.test.js` for the repo's
 * shared helpers in `lib/`, to `regressions-sheets.test.js` for a test
 * that runs a Sheets script in the test's thread, or to
 * `regressions.test.js` for any other, and removes the bug's row from the
 * table in the repo's CLAUDE.md, which lists each test here.
 *
 * The Sheets scripts run unchanged in the test's thread, through
 * `tests/helpers/sheets-script.js`, with a stand-in for the Apps Script
 * service each test is about: the script lock, or the web.
 */

import { describe, it, expect } from "vitest";
import path from "path";
import {
  CUSTOM_FUNCTION_LIMIT_MS,
  busyLockService,
  loadSheetsScript,
  noResponse,
  reply,
} from "./helpers/sheets-script.js";
import {
  DAY_MS,
  SHEETS_SCRIPT_PATH,
  answerCoinGeckoForPastDay,
  cellTime,
} from "./helpers/regression-runs.js";

/** What a cell shows when the call was cut short. */
const BUSY = "Rate limit busy - retry later";

/** The DexTools script, at the repo's top. */
const DEXTOOLS_SCRIPT = path.resolve(
  __dirname,
  "../../../crypto-price-fetchers.gs",
);

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
});

describe("a call cut short", () => {
  it.fails(
    "getCryptoPrice asks CoinGecko again on the call after one it cut short, rather than keep the cut-short requests' silence as no data",
    () => {
      let refusing = true;
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
        if (url.includes("api.coingecko.com") && refusing)
          return reply(429, {});
        return answerCoinGeckoForPastDay(url);
      });
      const time = cellTime(Date.now() - 2 * DAY_MS);
      expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(BUSY);
      refusing = false;
      expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.23);
    },
  );

  it.fails(
    "getCryptoPrice shows the busy message, keeping nothing, when every request gets no response, as when Apps Script's daily quota of web requests is spent",
    () => {
      let spent = true;
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) =>
        spent
          ? noResponse("Service invoked too many times for one day: urlfetch.")
          : answerCoinGeckoForPastDay(url),
      );
      const time = cellTime(Date.now() - 2 * DAY_MS);
      expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(BUSY);
      spent = false;
      expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.23);
    },
  );
});
