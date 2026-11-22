/**
 * Tests that guard the fixed bugs of a Sheets script alone, each run on
 * the script in the test's thread: each bug's test moved here from
 * `known-bugs.test.js` with its fix, beside the tests written with the
 * fix. The Sheets scripts' bugs fixed before this file was made stay in
 * `regressions.test.js`.
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
