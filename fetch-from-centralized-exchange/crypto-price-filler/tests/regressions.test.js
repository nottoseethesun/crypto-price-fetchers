/**
 * Tests that guard fixed bugs in the Node tool, its Sheets script, and the
 * menu the build step puts in the one file it gives for a spreadsheet.
 * @module tests/regressions.test
 *
 * Each block states what a fixed bug got wrong, as the behavior the tools
 * now have, and checks it everywhere the bug was: the Node tool's functions,
 * its command line, the Sheets script, and the menu. A bug found later gets its test
 * in `known-bugs.test.js`, declared with `it.fails` while the bug is there;
 * its fix declares the test with `it` and moves it here (see the repo's
 * CLAUDE.md).
 *
 * The tests drive the real code, with the price services standing in at the
 * http layer (see `tests/helpers/`). The Node tool prices with the Sheets
 * script's sources, run in a worker thread through the repo's runner, so
 * its functions run against a stand-in fetch (`stand-in-fetch.js`); its
 * command line, run in a child process, against a preloaded fetch; and the
 * Sheets script, run unchanged in the test's thread, against a stand-in
 * `UrlFetchApp`. The Node tool's functions run on the committed settings,
 * whatever a `config.json` on this computer holds. The menu runs with the
 * DexTools script beside it, as in the built file, against the spreadsheet
 * of `test/helpers/stand-in-spreadsheet.js` at the repo's top.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { ESLint } from "eslint";
import { createAppsScriptServices } from "../../../apps-script-runner/apps-script-services.js";
import {
  callScriptFunction,
  loadAppsScript,
} from "../../../apps-script-runner/load-apps-script.js";
import { getCryptoPrice } from "../sources/price.js";
import { readSupportedTokens } from "../supported-tokens.js";
import { closeExchangeSources, exchangeSources } from "../sources/exchange.js";
import { canonicalTimeZone, parseInputToUtcMs } from "../utils/date.js";
import { answerWith, asked as askedByTool } from "./helpers/stand-in-fetch.js";
import { loadSheetsScript } from "./helpers/sheets-script.js";
import { standInSpreadsheet } from "../../../test/helpers/stand-in-spreadsheet.js";
import {
  mexcCandleOpen,
  mexcKlines,
} from "../../../test/helpers/stand-in-mexc.js";

// The Sheets script, opened by its Node version with the stand-in fetch
vi.mock(
  "../../getCryptoPriceFromCentralizedExchange.js",
  async (importOriginal) => {
    const { withStandInFetch } = await import("./helpers/stand-in-fetch.js");
    return withStandInFetch(await importOriginal());
  },
);

// The committed settings, read afresh for this file, whatever a config.json holds
vi.mock("../config.js", async () => {
  const { readFileSync } = await import("node:fs");
  const committed = JSON.parse(
    readFileSync(new URL("../config-example.json", import.meta.url), "utf8"),
  );
  return { loadConfig: () => committed };
});

import {
  answerCoinGeckoForPastDay,
  answerMexcCandle,
  answerPaprikaBeyondCandles,
  COINGECKO_KEY_PATTERN,
  DATED_PRICE,
  FILLER_DIR,
  gitIgnores,
  inTimeZone,
  MENU_AND_DEXTOOLS_SCRIPTS,
  PAST_UTC_MS,
  ROW_UTC_MS,
  runCommandLine,
  runCommandLineForOneRow,
  SHEETS_SCRIPT_PATH,
} from "./helpers/regression-runs.js";

describe("fixed bugs", () => {
  beforeEach(() => {
    answerWith(() => null);
  });

  afterEach(async () => {
    await closeExchangeSources();
  });

  describe("close mode gives the candle close, not its high", () => {
    it("MEXC, in close mode, gives the candle close", () => {
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, answerMexcCandle);
      expect(script.getPriceFromMEXC("xtm", ROW_UTC_MS, "close")).toBe(1.1);
    });

    it("the provider chain, in close mode, gives the candle close", async () => {
      answerWith(answerMexcCandle);
      expect(
        await getCryptoPrice(
          "xtm",
          "2025-06-15 12:30:00",
          "UTC",
          "close",
          false,
          new Map(),
        ),
      ).toBe(1.1);
    });

    it("the command line, with --mode=close, writes the candle close", () => {
      expect(runCommandLineForOneRow(["--mode=close", "--tz=UTC"]).price).toBe(
        "1.1",
      );
    });

    it("the Sheets script, in close mode, gives the candle close", () => {
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, answerMexcCandle);
      expect(
        script.getCryptoPrice("xtm", "2025-06-15 12:30:00", "UTC", "close", 0),
      ).toBe(1.1);
    });
  });

  describe("MEXC's candle is that of the minute, or the hour, that holds the time", () => {
    it("getCryptoPrice prices the minute that holds a time on a whole minute, and in its fallback the hour that holds a time on a whole hour", () => {
      const minuteAsked = Date.UTC(2025, 5, 15, 12, 30, 0);
      const hourAsked = Date.UTC(2025, 5, 15, 12, 0, 0);
      // Each candle's high is 1.5 when it holds the time asked, else 9.9.
      // MEXC keeps no candle of the minute of 12:00, as for a time older
      // than the 30 days or so of minute candles it keeps, so its hour
      // answers
      const answer = (url) => {
        if (!url.includes("/klines")) return answerMexcCandle(url);
        const open = mexcCandleOpen(url);
        const isMinute = url.includes("interval=1m");
        if (open === null || (isMinute && open === hourAsked)) return [];
        const holds = open === (isMinute ? minuteAsked : hourAsked);
        return [[open, "1.00", holds ? "1.50" : "9.90", "0.80", "1.10", "10"]];
      };
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, answer);
      expect(
        script.getCryptoPrice("xtm", "2025-06-15 12:30:00", "UTC", "high"),
      ).toBe(1.5);
      expect(
        script.getCryptoPrice("xtm", "2025-06-15 12:00:00", "UTC", "high"),
      ).toBe(1.5);
    });
  });

  describe("a past date gets the price of that day, never the live one", () => {
    it("CoinGecko gives its price for 2025-03-15", () => {
      const script = loadSheetsScript(
        SHEETS_SCRIPT_PATH,
        answerCoinGeckoForPastDay,
      );
      expect(script.getPriceFromCoinGecko("tezos", PAST_UTC_MS, "close")).toBe(
        DATED_PRICE,
      );
    });

    it("the provider chain gives the price for 2025-03-15 when MEXC lacks the pair", async () => {
      answerWith(answerCoinGeckoForPastDay);
      expect(
        await getCryptoPrice(
          "xtz",
          "2025-03-15 03:00:00",
          "UTC",
          "close",
          false,
          new Map(),
        ),
      ).toBe(DATED_PRICE);
    });

    it("the Sheets script gives the day's price once CoinGecko's hourly range is empty", () => {
      const script = loadSheetsScript(
        SHEETS_SCRIPT_PATH,
        answerCoinGeckoForPastDay,
      );
      expect(
        script.getCryptoPrice("xtz", "2025-03-15 03:00:00", "UTC", "close", 0),
      ).toBe(DATED_PRICE);
    });
  });

  describe("the day asked of CoinGecko and CoinPaprika is the UTC day, whatever the computer's clock", () => {
    it("on a computer set to Chicago time, 03:00 UTC on 2025-03-15 asks for 2025-03-15", () => {
      const asked = [];
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
        asked.push(url);
        return null;
      });
      inTimeZone("America/Chicago", () => {
        script.getPriceFromCoinGecko("tezos", PAST_UTC_MS, "close");
        script.getPriceFromCoinPaprika("xtz-tezos", PAST_UTC_MS, "close");
      });
      const geckoDays = asked
        .filter((url) => url.includes("/history"))
        .map((url) => new URL(url).searchParams.get("date"));
      expect(geckoDays).not.toHaveLength(0);
      for (const day of geckoDays) expect(day).toBe("15-03-2025");
      const paprikaDays = asked
        .filter((url) => url.includes("/ohlcv/"))
        .map((url) => new URL(url).searchParams.get("start"));
      expect(paprikaDays).toEqual(["2025-03-15"]);
    });
  });

  describe("a date cell is read as the time it shows, in the spreadsheet's time zone", () => {
    /**
     * Calls getCryptoPrice with a date cell from a spreadsheet in a time
     * zone, the Date remade in the script's realm as Sheets hands it, and
     * gives the minute asked of MEXC.
     *
     * @param {?string} spreadsheetZone - The spreadsheet's time zone, or null for no spreadsheet
     * @param {Date} cell - The moment the cell holds
     * @param {string} tz - The tz argument
     * @returns {string} The url of the minute's candle asked of MEXC
     */
    function minuteAskedFor(spreadsheetZone, cell, tz) {
      const asked = [];
      const services =
        spreadsheetZone === null
          ? {}
          : {
              SpreadsheetApp: {
                getActiveSpreadsheet: () => ({
                  getSpreadsheetTimeZone: () => spreadsheetZone,
                }),
              },
            };
      const script = loadSheetsScript(
        SHEETS_SCRIPT_PATH,
        (url) => {
          asked.push(url);
          return answerMexcCandle(url);
        },
        { services },
      );
      callScriptFunction(script, "getCryptoPrice", ["xtm", cell, tz, "high"]);
      return asked.find((url) => url.includes("interval=1m"));
    }

    /** The window of the minute that holds the row's time, as the script asks MEXC for it. */
    const ROW_MINUTE = `&startTime=${ROW_UTC_MS}&endTime=${ROW_UTC_MS + 59999}&`;

    it("reads a cell from a spreadsheet in Central time as its wall time, in the zone tz names", () => {
      // The spreadsheet hands a cell that shows 2025-06-15 07:30:00 as
      // 12:30 UTC; tz says that time is CDT
      const cell = new Date(ROW_UTC_MS);
      expect(minuteAskedFor("America/Chicago", cell, "CDT")).toContain(
        ROW_MINUTE,
      );
    });

    it("reads a cell from a spreadsheet in UTC as it was read before, and with no spreadsheet reads it in UTC", () => {
      // A cell that shows 2025-06-15 07:30:00 in a UTC spreadsheet, CDT by tz
      const cell = new Date(Date.UTC(2025, 5, 15, 7, 30, 0));
      expect(minuteAskedFor("UTC", cell, "CDT")).toContain(ROW_MINUTE);
      expect(minuteAskedFor(null, cell, "CDT")).toContain(ROW_MINUTE);
    });
  });

  describe("rows are read in the time zone named, daylight saving included", () => {
    it("Chicago time reads as UTC-5 in March and UTC-6 in January", () => {
      expect(
        new Date(
          parseInputToUtcMs("2025-03-15 21:00:00", "America/Chicago"),
        ).toISOString(),
      ).toBe("2025-03-16T02:00:00.000Z");
      expect(
        new Date(
          parseInputToUtcMs("2025-01-15 12:00:00", "America/Chicago"),
        ).toISOString(),
      ).toBe("2025-01-15T18:00:00.000Z");
    });

    it("a time zone the tool does not know is refused, not read as UTC", async () => {
      expect(canonicalTimeZone("CTS")).toBeNull();
      expect(() => parseInputToUtcMs("2025-06-15 12:30:00", "CTS")).toThrow(
        /Not a valid time zone: CTS/,
      );
      await expect(
        getCryptoPrice(
          "xtm",
          "2025-06-15 12:30:00",
          "CTS",
          "high",
          false,
          new Map(),
        ),
      ).rejects.toThrow(/Not a valid time zone: CTS/);
    });

    it("the command line, with --tz=America/Chicago, asks for the candle at 17:30 UTC", () => {
      expect(
        runCommandLineForOneRow(["--mode=high", "--tz=America/Chicago"])
          .candleUtc,
      ).toBe("2025-06-15T17:30:00.000Z");
    });

    it("the command line refuses an abbreviation, pointing to the list of valid zones", () => {
      const run = runCommandLine(["--token=xtm", "--input=in.csv", "--tz=CDT"]);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("not a valid time zone: CDT");
      expect(run.stderr).toContain("--list-valid-timezones");
    });

    it("the command line, with --list-valid-timezones, prints the zones it takes, one per line", () => {
      const run = runCommandLine(["--list-valid-timezones"]);
      const zones = run.stdout.trim().split("\n");
      expect(run.status).toBe(0);
      expect(zones).toContain("America/Chicago");
      expect(zones).toContain("UTC");
      expect(zones).not.toContain("CDT");
    });

    it("the Sheets script shows a message for a time zone it does not know, not a price", () => {
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, answerMexcCandle);
      expect(
        script.getCryptoPrice("xtm", "2025-06-15 12:30:00", "CTS", "high", 0),
      ).toMatch(/^Unknown time zone "CTS"/);
    });
  });

  describe("no CoinGecko api key is committed", () => {
    it("no file of the Sheets script carries a CoinGecko api key", () => {
      const scriptFiles = fs
        .readdirSync(path.resolve(__dirname, "../.."))
        .filter((name) => name.endsWith(".gs"));
      expect(scriptFiles.length).toBe(3);
      for (const name of scriptFiles) {
        const text = fs.readFileSync(
          path.resolve(__dirname, "../..", name),
          "utf8",
        );
        expect(text).not.toMatch(COINGECKO_KEY_PATTERN);
      }
    });

    it("the Node tool's committed settings carry no key, nor a place for one", () => {
      const committed = fs.readFileSync(
        path.join(FILLER_DIR, "config-example.json"),
        "utf8",
      );
      expect(committed).not.toMatch(COINGECKO_KEY_PATTERN);
      expect(Object.keys(JSON.parse(committed))).not.toContain(
        "COINGECKO_API_KEY",
      );
    });

    it("git ignores the files that hold keys: the encrypted key file, and the config.json files", () => {
      expect(gitIgnores("../../api-keys.json")).toBe(true);
      expect(gitIgnores("../../api-keys.json.tmp")).toBe(true);
      expect(gitIgnores("config.json")).toBe(true);
      expect(gitIgnores("../config.json")).toBe(true);
    });
  });

  describe("CoinPaprika's candles are asked at its OHLCV address", () => {
    it("the Node tool asks /coins/{id}/ohlcv/historical, through the Sheets script", async () => {
      answerWith((url) => (url.includes("/ohlcv/") ? [] : null));
      const sources = await exchangeSources();
      await sources.getPriceFromCoinPaprika("xtm-tari", ROW_UTC_MS, "high");
      expect(askedByTool[0]).toBe(
        "https://api.coinpaprika.com/v1/coins/xtm-tari/ohlcv/historical?start=2025-06-15&end=2025-06-15&quote=usd",
      );
    });

    it("the Sheets script asks the same address", () => {
      const asked = [];
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
        asked.push(url);
        if (url.includes("/exchangeInfo")) return { symbols: [] };
        if (url.includes("/market_chart/range")) return { prices: [] };
        if (url.includes("/ohlcv/")) {
          return [
            {
              time_open: "2025-06-15T00:00:00Z",
              time_close: "2025-06-15T23:59:59Z",
              high: 2.5,
              low: 2.0,
              close: 2.2,
            },
          ];
        }
        return null;
      });
      expect(
        script.getCryptoPrice("xtm", "2025-06-15 12:30:00", "UTC", "high", 0),
      ).toBe(2.5);
      expect(asked.find((url) => url.includes("/ohlcv/"))).toBe(
        "https://api.coinpaprika.com/v1/coins/xtm-tari/ohlcv/historical?start=2025-06-15&end=2025-06-15&quote=usd",
      );
    });
  });

  describe("CoinPaprika prices a day its free plan's candles do not reach", () => {
    it("the Sheets script gives the day's 00:00 UTC price for close when the candle is beyond the plan", () => {
      const script = loadSheetsScript(
        SHEETS_SCRIPT_PATH,
        answerPaprikaBeyondCandles,
      );
      expect(
        script.getPriceFromCoinPaprika("xtm-tari", ROW_UTC_MS, "close"),
      ).toBe(2.05);
    });

    it("the Node tool gives the same, through the Sheets script", async () => {
      answerWith(answerPaprikaBeyondCandles);
      const sources = await exchangeSources();
      expect(
        await sources.getPriceFromCoinPaprika("xtm-tari", ROW_UTC_MS, "close"),
      ).toBe(2.05);
    });
  });

  describe("CoinGecko's hourly prices are kept for the time asked, not for its day", () => {
    it("the Sheets script asks again for another time of the same day, and gives that time's price", () => {
      const asked = [];
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
        asked.push(url);
        const from = Number(new URL(url).searchParams.get("from")) * 1000;
        const centre = from + 43200000;
        return {
          prices: [[centre, centre === ROW_UTC_MS ? 2.4 : 3.1]],
        };
      });
      expect(script.getPriceFromCoinGecko("tezos", ROW_UTC_MS, "high")).toBe(
        2.4,
      );
      expect(
        script.getPriceFromCoinGecko("tezos", ROW_UTC_MS + 7200000, "high"),
      ).toBe(3.1);
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
});

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

describe("the token list", () => {
  it("refuses a token keyed in upper case in supported-tokens.json, which no lookup finds", () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "filler-tokens-"));
    try {
      const file = path.join(folder, "supported-tokens.json");
      fs.writeFileSync(
        file,
        JSON.stringify({
          tokens: {
            XMR: {
              name: "Monero",
              coingecko_id: "monero",
              coinpaprika_id: "xmr-monero",
              mexc_symbol: "XMR",
            },
          },
        }),
      );
      expect(() => readSupportedTokens(file)).toThrow(
        'crypto-price-filler/supported-tokens.json → tokens has the key "XMR", which must be a symbol in lower case',
      );
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("the command line, run from another folder", () => {
  it("index.js answers --help when run from a folder other than its own", () => {
    const run = spawnSync(
      process.execPath,
      [path.join(FILLER_DIR, "index.js"), "--help"],
      { cwd: os.tmpdir(), encoding: "utf8" },
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/^Usage: /);
  });

  it("index.js prices a row when run from a folder other than its own", () => {
    const { price } = runCommandLineForOneRow([], os.tmpdir());
    expect(Number(price)).toBeGreaterThan(0);
  });
});

describe("the gate's checks of the file the build step writes", () => {
  it("the security lint passes over build/, where the build step writes the file to paste when there is no clipboard, as the lint, the format check and the secret scan do", async () => {
    const top = path.resolve(__dirname, "../../..");
    const eslint = new ESLint({
      cwd: top,
      overrideConfigFile: path.join(top, "eslint-security.config.js"),
    });
    const built = path.join(top, "build/apps-script/crypto-price-fetchers.gs");
    expect(await eslint.isPathIgnored(built)).toBe(true);
  });
});

describe("the runner's Apps Script services", () => {
  it("the runner's cache has getAll, putAll and removeAll, as Apps Script's has", () => {
    const source = [
      "function rememberAndForget() {",
      "  const cache = CacheService.getScriptCache();",
      '  cache.putAll({ price: "1.5", pool: "0xabc" }, 60);',
      '  const found = cache.getAll(["price", "pool", "missing"]);',
      '  cache.removeAll(["price"]);',
      '  return JSON.stringify([found, cache.get("price"), cache.get("pool")]);',
      "}",
    ].join("\n");
    const context = loadAppsScript(
      [{ source, filename: "cache-check.gs" }],
      createAppsScriptServices({ fetchSync: () => ({ failure: "no web" }) }),
    );
    expect(JSON.parse(context.rememberAndForget())).toEqual([
      { price: "1.5", pool: "0xabc" },
      null,
      "0xabc",
    ]);
  });
});
