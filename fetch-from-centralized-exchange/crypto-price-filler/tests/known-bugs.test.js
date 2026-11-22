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
 * service each test is about: the script lock, or the web, through a
 * stand-in MEXC.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  loadSheetsScript,
  noResponse,
  reply,
} from "./helpers/sheets-script.js";
import {
  SHEETS_SCRIPT_PATH,
  answerCoinGeckoForPastDay,
  runIndexIn,
} from "./helpers/regression-runs.js";
import { mexcKlines } from "../../../test/helpers/stand-in-mexc.js";

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

/** A day, in ms. */
const DAY_MS = 86400000;

/**
 * A time as a cell writes it, in UTC.
 *
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @returns {string} The time, as `YYYY-MM-DD HH:MM:SS`
 */
function cellTime(utcMs) {
  return new Date(utcMs).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * The exchange script with a stand-in MEXC that lists XTMUSDT and answers
 * its klines with `klines`, and CoinGecko's answer for a past day.
 *
 * @param {function(string): *} klines - Answers a klines url
 * @param {Object} [options] - More for `loadSheetsScript`, such as `sleep`
 * @returns {Object} The script's global scope
 */
function exchangeScriptWith(klines, options = {}) {
  return loadSheetsScript(
    SHEETS_SCRIPT_PATH,
    (url) => {
      if (url.includes("/exchangeInfo"))
        return {
          symbols: [
            { symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" },
          ],
        };
      if (url.includes("/klines")) return klines(url);
      return answerCoinGeckoForPastDay(url);
    },
    options,
  );
}

describe("MEXC's failures", () => {
  it.fails(
    "getCryptoPrice asks the next source when MEXC gives no response at all, as a timeout or a refused connection gives, rather than show the error",
    () => {
      const script = exchangeScriptWith(() =>
        noResponse("The operation was aborted due to timeout"),
      );
      const time = cellTime(Date.now() - 2 * DAY_MS);
      expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.23);
    },
  );

  it.fails(
    "getCryptoPrice waits, in all, no longer than Google lets a custom function run when MEXC refuses every request as one too many",
    () => {
      const sleeps = [];
      const script = exchangeScriptWith(() => reply(429, {}), {
        sleep: (milliseconds) => sleeps.push(milliseconds),
      });
      const time = cellTime(Date.now() - 2 * DAY_MS);
      script.getCryptoPrice("xtm", time, "UTC", "close");
      const waited = sleeps.reduce(
        (sum, milliseconds) => sum + milliseconds,
        0,
      );
      expect(waited).toBeLessThanOrEqual(CUSTOM_FUNCTION_LIMIT_MS);
    },
  );

  it.fails(
    "getCryptoPrice gives no MEXC price for a time on the day MEXC listed the pair when the request for the day before fails, rather than price it from the day's later trades",
    () => {
      const listingDay =
        Math.floor((Date.now() - 60 * DAY_MS) / DAY_MS) * DAY_MS;
      const firstTrade = listingDay + 12 * 3600000;
      const script = exchangeScriptWith((url) => {
        const asked = new URL(url).searchParams;
        if (
          asked.get("interval") === "1d" &&
          Number(asked.get("startTime")) === listingDay - DAY_MS
        )
          return reply(503, null);
        return mexcKlines(url, (open, end) =>
          end < firstTrade ? null : ["5.00", "9.00", "5.00", "8.00", "1000"],
        );
      });
      const time = cellTime(listingDay + 6 * 3600000);
      expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.23);
    },
  );
});

describe("crypto-price-filler's settings", () => {
  it.fails(
    "stops before the first row, with exit code 1, on a config.json of the exchange script it refuses, naming the problem",
    () => {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), "filler-exchange-"));
      fs.writeFileSync(
        path.join(folder, "in.csv"),
        "date (UTC),amount,description\n2025-06-15 12:30:00,10,one XTM reward\n",
      );
      try {
        const run = runIndexIn(
          folder,
          ["--token", "xtm", "--input", "in.csv"],
          {
            STAND_IN_EXCHANGE_CONFIG: "{ not json",
          },
        );
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("config.json is not valid JSON");
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    },
  );
});
