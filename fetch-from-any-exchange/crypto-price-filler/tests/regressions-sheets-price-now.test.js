/**
 * Tests that guard fixed bugs of the current-price script,
 * `crypto-price-fetchers/src/crypto-price-fetchers.gs`, and of the menu,
 * each running in the test's thread: a cell's own cache seconds, the
 * script's cache, the pool a cell names, what a request with no answer
 * gives and the time it keeps, and the menu's Refresh. The repo's
 * CLAUDE.md lists the other
 * files of fixed bugs' tests; a bug found later gets its test in
 * `known-bugs.test.js`, declared with `it.fails` while the bug is there,
 * and its fix moves the test to one of them.
 * @module tests/regressions-sheets-price-now.test
 *
 * The menu and the current-price script run unchanged in the test's
 * thread, joined as the build joins them, through
 * `tests/helpers/sheets-script.js`, against a stand-in DexTools; the
 * menu's Refresh runs against the spreadsheet of
 * `test/helpers/stand-in-spreadsheet.js` at the repo's top.
 */

import { describe, it, expect } from "vitest";
import { loadSheetsScript } from "./helpers/sheets-script.js";
import { MENU_AND_DEXTOOLS_SCRIPTS } from "./helpers/regression-runs.js";
import { standInSpreadsheet } from "../../../test/helpers/stand-in-spreadsheet.js";

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

describe("the menu's Refresh", () => {
  it("Refresh runs again the cells that call dexToolsGetTokenPrice", () => {
    const sheet = standInSpreadsheet({
      tabs: {
        Prices: [
          ["Token", "Price"],
          [
            "PLS",
            '=dexToolsGetTokenPrice("pulse", "0xA1077a294dDE1B09bB078844df40758a5D0f9a27")',
          ],
        ],
      },
    });
    const script = loadSheetsScript(MENU_AND_DEXTOOLS_SCRIPTS, () => null, {
      services: {
        SpreadsheetApp: sheet.SpreadsheetApp,
        HtmlService: sheet.HtmlService,
      },
    });
    script.refreshCurrentPrices();
    expect(sheet.runsOf("Prices!B2")).toBe(1);
  });
});

describe("the current-price script, when a request gets no answer", () => {
  it("gives the script's error message, not 0", () => {
    const script = loadSheetsScript(MENU_AND_DEXTOOLS_SCRIPTS, () => {
      throw new Error("Service invoked too many times for one day: urlfetch.");
    });
    expect(
      script.dexToolsGetTokenPrice(
        "ether",
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      ),
    ).toBe("⚠️ API error – check logs");
  });

  it("keeps the time of a request that got no answer", () => {
    const script = loadSheetsScript(MENU_AND_DEXTOOLS_SCRIPTS, () => {
      throw new Error("Service invoked too many times for one day: urlfetch.");
    });
    script.dexToolsGetTokenPrice(
      "ether",
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    );
    expect(
      script.PropertiesService.getScriptProperties().getProperty(
        "lastDexToolsCall",
      ),
    ).toMatch(/^\d+$/);
  });
});

describe("the current-price script's pool argument", () => {
  it("takes a pool named as text, not only as {{address, 0}}", () => {
    const script = loadSheetsScript(MENU_AND_DEXTOOLS_SCRIPTS, () => null);
    expect(script.poolNamed("0xPool")).toBe("0xPool");
    expect(script.poolNamed([["0xPool", 0]])).toBe("0xPool");
  });
});
