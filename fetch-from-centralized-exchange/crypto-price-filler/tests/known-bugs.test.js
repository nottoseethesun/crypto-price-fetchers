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
 * service each test is about: the script lock.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { loadSheetsScript } from "./helpers/sheets-script.js";
import { answerCoinGeckoForPastDay } from "./helpers/regression-runs.js";
import { mexcKlines } from "../../../test/helpers/stand-in-mexc.js";
import { backfillPrices } from "../utils/backfill.js";

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

describe("the current-price script's cache", () => {
  const tokenA = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const tokenB = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
  const pool = "0x3416cF6C708Da44DB2624D63ea0AAef7113527C6";

  /**
   * Loads the current-price script against a stand-in DexTools that gives
   * each token an FDV and a price of its own, recording each url asked.
   *
   * @returns {{script: Object, asked: string[]}} The script and the urls asked
   */
  function scriptWithTwoTokens() {
    const asked = [];
    const values = {
      [tokenA.toLowerCase()]: { fdv: 111, price: 1.11 },
      [tokenB.toLowerCase()]: { fdv: 222, price: 2.22 },
    };
    const script = loadSheetsScript(DEXTOOLS_SCRIPT, (url) => {
      asked.push(url);
      const token = url.match(/\/token\/[^/]+\/(0x[0-9a-fA-F]{40})\//);
      if (token === null) return null;
      return { statusCode: 200, data: values[token[1].toLowerCase()] };
    });
    return { script, asked };
  }

  it.fails(
    "dexToolsGetTokenFDV gives each token its own FDV when two cells name the same pool",
    () => {
      const { script } = scriptWithTwoTokens();
      expect(script.dexToolsGetTokenFDV("pulse", tokenA, [[pool, 0]])).toBe(
        111,
      );
      expect(script.dexToolsGetTokenFDV("pulse", tokenB, [[pool, 0]])).toBe(
        222,
      );
    },
  );

  it.fails(
    "dexToolsGetTokenPrice asks again for a cell whose cache seconds differ from the cell that kept the answer",
    () => {
      const { script, asked } = scriptWithTwoTokens();
      expect(script.dexToolsGetTokenPrice("ether", tokenA, [], 21600)).toBe(
        1.11,
      );
      expect(script.dexToolsGetTokenPrice("ether", tokenA, [], 60)).toBe(1.11);
      expect(asked).toHaveLength(2);
    },
  );
});

describe("the exchange script before MEXC lists a pair", () => {
  it.fails(
    "getCryptoPrice asks CoinGecko for a time before MEXC listed the pair, rather than pricing it from MEXC's later candles",
    () => {
      const listed = Date.UTC(2025, 8, 1);
      const script = loadSheetsScript(EXCHANGE_SCRIPT, (url) => {
        if (url.includes("/exchangeInfo"))
          return {
            symbols: [
              { symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" },
            ],
          };
        if (url.includes("/klines"))
          return mexcKlines(url, (open) =>
            open >= listed ? ["0.10", "0.30", "0.10", "0.20", "10"] : null,
          );
        return answerCoinGeckoForPastDay(url);
      });
      expect(
        script.getCryptoPrice("xtm", "2025-06-15 12:30:00", "UTC", "close"),
      ).toBe(1.23);
    },
  );
});

describe("backfill and the rows that hold no data", () => {
  it.fails(
    "backfillPrices leaves out of the backfill and the grand total the rows the filler leaves blank on purpose, such as a Total row",
    () => {
      const row = (date, amount, price) => ({
        date,
        amount,
        "$usd price": price,
        "$usd amount": "",
        "grand total ($usd)": "",
      });
      const rows = [
        row("2025-06-01", "10", "2"),
        row("2025-06-02", "10", "Error"),
        row("2025-06-03", "10", "3"),
        row("Total", "30", ""),
      ];
      backfillPrices(rows, {
        priceColName: "$usd price",
        amountColName: "amount",
        usdAmountColName: "$usd amount",
        grandTotalColName: "grand total ($usd)",
        useHighest: true,
      });
      expect(rows[1]["$usd price"]).toBe(3);
      expect(rows[3]["$usd price"]).toBe("");
      expect(rows[3]["grand total ($usd)"]).toBe((80).toFixed(6));
    },
  );
});

describe("the check that the command line loads", () => {
  it.fails(
    "validate-parse fails when node exits with code 1, as it does when index.js cannot load",
    () => {
      const scripts = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
      ).scripts;
      const command = scripts["validate-parse"].replace(
        "node index.js --help",
        'node -e "process.exit(1)"',
      );
      expect(command).not.toBe(scripts["validate-parse"]);
      const run = spawnSync("sh", ["-c", command], { encoding: "utf8" });
      expect(run.status).not.toBe(0);
    },
  );
});
