/**
 * Tests that guard fixed bugs, each running a Sheets script in the test's
 * thread. A fix moves its known-bug test here from `known-bugs.test.js`
 * when the test runs a Sheets script that way (see the repo's CLAUDE.md).
 * @module tests/regressions-sheets.test
 *
 * The Sheets scripts run unchanged in the test's thread, through
 * `tests/helpers/sheets-script.js`, against a stand-in MEXC, which answers
 * as MEXC does (`test/helpers/stand-in-mexc.js`), or a stand-in DexTools.
 */

import { describe, it, expect } from "vitest";
import { loadSheetsScript } from "./helpers/sheets-script.js";
import {
  MENU_AND_DEXTOOLS_SCRIPTS,
  SHEETS_SCRIPT_PATH,
  answerCoinGeckoForPastDay,
} from "./helpers/regression-runs.js";
import { mexcKlines } from "../../../test/helpers/stand-in-mexc.js";

describe("the exchange script's quote currency", () => {
  it("getPriceFromMEXC asks for the pairs quoted in CONFIG.QUOTE_CURRENCY, the token's and BTC's", () => {
    const symbols = [];
    const script = loadSheetsScript(
      SHEETS_SCRIPT_PATH,
      (url) => {
        if (url.includes("/exchangeInfo")) {
          return {
            symbols: [
              { baseAsset: "ABC", quoteAsset: "USDT" },
              { baseAsset: "ABC", quoteAsset: "USDC" },
              { baseAsset: "XYZ", quoteAsset: "BTC" },
              { baseAsset: "BTC", quoteAsset: "USDT" },
              { baseAsset: "BTC", quoteAsset: "USDC" },
            ],
          };
        }
        symbols.push(new URL(url).searchParams.get("symbol"));
        return mexcKlines(url, ["1.20", "1.60", "0.60", "1.20", "5"]);
      },
      { config: { CONFIG: { QUOTE_CURRENCY: "USDC" } } },
    );
    const time = Date.UTC(2025, 5, 15, 12, 30);
    script.getPriceFromMEXC("abc", time, "close");
    script.getPriceFromMEXC("xyz", time, "close");
    expect([...new Set(symbols)]).toEqual(["ABCUSDC", "XYZBTC", "BTCUSDC"]);
  });
});

describe("a cell's own cache seconds", () => {
  const token = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

  /**
   * Loads the current-price script against a stand-in DexTools that
   * answers every request with a price and an FDV, recording each url,
   * and a cache that keeps nothing and records the seconds each value is
   * handed with.
   *
   * @param {Object<string, Object>} [config={}] - Values for the script's config objects
   * @returns {{script: Object, asked: string[], kept: number[]}} The script, the urls asked, and the seconds handed to the cache
   */
  function scriptWithDexTools(config = {}) {
    const asked = [];
    const kept = [];
    const cache = {
      get: () => null,
      put: (key, value, seconds) => kept.push(seconds),
    };
    const script = loadSheetsScript(
      MENU_AND_DEXTOOLS_SCRIPTS,
      (url) => {
        asked.push(url);
        return { statusCode: 200, data: { price: 1.23, fdv: 5000000 } };
      },
      {
        config,
        services: { CacheService: { getScriptCache: () => cache } },
      },
    );
    return { script, asked, kept };
  }

  it("dexToolsGetTokenPrice and dexToolsGetTokenFDV refuse cache seconds outside 1 to 21600 with a message, asking DexTools nothing", () => {
    const { script, asked } = scriptWithDexTools();
    for (const name of ["dexToolsGetTokenPrice", "dexToolsGetTokenFDV"]) {
      for (const seconds of [0, 21601, 2.5, "five"]) {
        expect(script[name]("ether", token, [], seconds)).toMatch(/1 to 21600/);
      }
    }
    expect(script.dexToolsGetTokenPrice("ether", token, [], "300")).toBe(
      'Cache seconds must be a whole number from 1 to 21600, not "300"',
    );
    expect(asked).toEqual([]);
  });

  it("takes an empty cell as no cache seconds, so the config's apply", () => {
    const { script, asked, kept } = scriptWithDexTools({
      DEXTOOLS_CONFIG: { CACHE_SECONDS: 120 },
    });
    expect(script.dexToolsGetTokenPrice("ether", token, [], "")).toBe(1.23);
    expect(script.dexToolsGetTokenFDV("pulse", token, [], "")).toBe(5000000);
    expect(script.dexToolsGetTokenPrice("ether", token, [], 600)).toBe(1.23);
    expect(asked).toHaveLength(3);
    expect(kept).toEqual([120, 120, 600]);
  });
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
    const script = loadSheetsScript(MENU_AND_DEXTOOLS_SCRIPTS, (url) => {
      asked.push(url);
      const contract = url.match(/\/token\/[^/]+\/(0x[0-9a-fA-F]{40})\//);
      if (contract === null) return null;
      return { statusCode: 200, data: values[contract[1].toLowerCase()] };
    });
    return { script, asked };
  }

  it("dexToolsGetTokenFDV gives each token its own FDV when two cells name the same pool", () => {
    const { script } = scriptWithTwoTokens();
    expect(script.dexToolsGetTokenFDV("pulse", tokenA, [[pool, 0]])).toBe(111);
    expect(script.dexToolsGetTokenFDV("pulse", tokenB, [[pool, 0]])).toBe(222);
  });

  it("dexToolsGetTokenPrice asks again for a cell whose cache seconds differ from the cell that kept the answer", () => {
    const { script, asked } = scriptWithTwoTokens();
    expect(script.dexToolsGetTokenPrice("ether", tokenA, [], 21600)).toBe(1.11);
    expect(script.dexToolsGetTokenPrice("ether", tokenA, [], 60)).toBe(1.11);
    expect(asked).toHaveLength(2);
    expect(script.dexToolsGetTokenPrice("ether", tokenA, [], 60)).toBe(1.11);
    expect(asked).toHaveLength(2);
  });
});

describe("the exchange script before MEXC lists a pair", () => {
  it("getCryptoPrice asks CoinGecko for a time before MEXC listed the pair, rather than pricing it from MEXC's later candles", () => {
    const listed = Date.UTC(2025, 8, 1);
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
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
  });

  it("getPriceFromMEXC still prices a time after the listing from the larger window in which something traded", () => {
    const listed = Date.UTC(2025, 8, 1);
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
      if (url.includes("/exchangeInfo"))
        return {
          symbols: [
            { symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" },
          ],
        };
      if (url.includes("/klines")) {
        const interval = new URL(url).searchParams.get("interval");
        return mexcKlines(url, (open) => {
          if (open < listed) return null;
          return interval === "60m"
            ? ["0.20", "0.20", "0.20", "0.20", "0"]
            : ["0.10", "0.30", "0.10", "0.20", "10"];
        });
      }
      return null;
    });
    expect(
      script.getPriceFromMEXC("xtm", Date.UTC(2025, 9, 15, 12, 30), "close"),
    ).toBeCloseTo(0.2, 10);
  });
});
