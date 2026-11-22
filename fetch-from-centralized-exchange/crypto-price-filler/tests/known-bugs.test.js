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
import path from "path";
import { loadSheetsScript, reply } from "./helpers/sheets-script.js";
import {
  SHEETS_SCRIPT_PATH,
  answerCoinGeckoForPastDay,
} from "./helpers/regression-runs.js";
import { mexcKlines } from "../../../test/helpers/stand-in-mexc.js";
import { fetchWithinTimeLimit } from "../../../lib/time-limited-fetch.js";

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

/** A MEXC candle in which something traded: open, high, low, close, volume. */
const TRADED = ["1.00", "1.50", "0.80", "1.20", "10"];

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
 * Loads the exchange script with a stand-in MEXC that lists XTMUSDT and
 * answers its klines with `klines`, and CoinGecko's answer for a past day.
 *
 * @param {function(string): *} klines - Answers a klines url
 * @returns {Object} The script's global scope
 */
function exchangeScriptWith(klines) {
  return loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
    if (url.includes("/exchangeInfo"))
      return {
        symbols: [{ symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" }],
      };
    if (url.includes("/klines")) return klines(url);
    return answerCoinGeckoForPastDay(url);
  });
}

describe("MEXC's minute candles", () => {
  it.fails(
    "getCryptoPrice prices a recent time from MEXC's hour when the request for its minute fails, rather than taking the failure for a minute before the pair's first trade",
    () => {
      const script = exchangeScriptWith((url) => {
        const asked = new URL(url).searchParams;
        if (asked.get("interval") === "1m" && asked.get("limit") === "1")
          return reply(503, null);
        return mexcKlines(url, () => TRADED);
      });
      const time = cellTime(Date.now() - 2 * 86400000);
      expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.2);
    },
  );

  it.fails(
    "getCryptoPrice prices a time in the hour MEXC's minute candles begin in from MEXC's hour, rather than taking the minutes MEXC let go for minutes before the pair's first trade",
    () => {
      const hour = Math.floor((Date.now() - 30 * 86400000) / 3600000) * 3600000;
      const keptFrom = hour + 30 * 60000;
      const script = exchangeScriptWith((url) =>
        mexcKlines(url, (open, end, interval) =>
          interval === "1m" && open < keptFrom ? null : TRADED,
        ),
      );
      const time = cellTime(hour + 10 * 60000);
      expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.2);
    },
  );
});

describe("the time-limited fetch", () => {
  it.fails(
    "fetchWithinTimeLimit refuses a limit Node's timers cannot keep, a fraction of a millisecond or more than 2147483647, saying so",
    async () => {
      const answers = async () => new Response("{}");
      for (const timeoutMs of [2009.9999999999998, 3e9]) {
        await expect(
          fetchWithinTimeLimit(
            "http://localhost/",
            {},
            { timeoutMs, fetch: answers },
          ),
        ).rejects.toThrow(
          /a whole number of milliseconds from 1 to 2147483647/,
        );
      }
    },
  );
});
