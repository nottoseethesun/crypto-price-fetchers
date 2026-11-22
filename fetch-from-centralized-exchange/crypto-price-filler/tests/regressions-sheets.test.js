/**
 * Tests that guard the fixed bugs of the Sheets scripts' settings and of
 * the arguments a cell hands their functions, each moved here from
 * `known-bugs.test.js` with its fix.
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
  it("dexToolsGetTokenPrice refuses cache seconds outside 1 to 21600 with a message, asking DexTools nothing", () => {
    const asked = [];
    const script = loadSheetsScript(MENU_AND_DEXTOOLS_SCRIPTS, (url) => {
      asked.push(url);
      return { statusCode: 200, data: { price: 1.23 } };
    });
    const token = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    for (const seconds of [0, 21601, 2.5, "five"]) {
      expect(script.dexToolsGetTokenPrice("ether", token, [], seconds)).toMatch(
        /1 to 21600/,
      );
    }
    expect(asked).toEqual([]);
  });
});
