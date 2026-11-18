/**
 * Tests that guard fixed bugs in the Node tool and its Sheets script.
 * @module tests/regressions.test
 *
 * Each block states what a fixed bug got wrong, as the behavior the tools
 * now have, and checks it everywhere the bug was: the Node tool's functions,
 * its command line, and the Sheets script. A bug found later gets its test
 * in `known-bugs.test.js`, declared with `it.fails` while the bug is there;
 * its fix declares the test with `it` and moves it here (see the repo's
 * CLAUDE.md).
 *
 * The tests drive the real code, with the price services standing in at the
 * http layer (see `tests/helpers/`): `fetchWithRetry` for the Node tool's
 * functions, a preloaded fetch for its command line, run in a child process,
 * and `UrlFetchApp` for the Sheets script, which runs unchanged under Node.
 * The Node tool's functions run on the committed settings, whatever a
 * `config.json` on this computer holds.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { getPriceFromMEXC } from "../sources/mexc.js";
import { getPriceFromCoinGecko } from "../sources/coingecko.js";
import { getPriceFromCoinPaprika } from "../sources/coinpaprika.js";
import { getCryptoPrice } from "../sources/price.js";
import { canonicalTimeZone, parseInputToUtcMs } from "../utils/date.js";
import * as fetchUtils from "../utils/fetch.js";
import { answeringFetchWithRetry } from "./helpers/fetch-with-retry.js";
import { loadSheetsScript } from "./helpers/sheets-script.js";

vi.mock("../utils/fetch.js", () => {
  const mockFn = vi.fn();
  return {
    fetchWithRetry: mockFn,
    default: mockFn,
  };
});

// The committed settings, read afresh for this file, whatever a config.json holds
vi.mock("../config.js", async () => {
  const { readFileSync } = await import("node:fs");
  return {
    default: JSON.parse(
      readFileSync(new URL("../config-example.json", import.meta.url), "utf8"),
    ),
  };
});

const mockFetchWithRetry = vi.mocked(fetchUtils.fetchWithRetry);

const FILLER_DIR = path.resolve(__dirname, "..");
// The Sheets script's files its function needs, in the order Apps Script
// loads them
const SHEETS_SCRIPT_PATH = [
  "../../getCryptoPriceFromCentralizedExchange.gs",
  "../../getCryptoPriceFromCentralizedExchange-sources.gs",
].map((file) => path.resolve(__dirname, file));
const PRELOAD_URL = pathToFileURL(
  path.resolve(__dirname, "helpers/stand-in-fetch-preload.js"),
).href;

const ROW_UTC_MS = Date.UTC(2025, 5, 15, 12, 30, 0);
const PAST_UTC_MS = Date.UTC(2025, 2, 15, 3, 0, 0);
const LIVE_PRICE = 9.99;
const DATED_PRICE = 1.23;

/** An api key in CoinGecko's form. */
const COINGECKO_KEY_PATTERN = /CG-[A-Za-z0-9]{20,}/;

/**
 * Answers as MEXC does for XTM, a pair it lists: one candle per request,
 * with open 1.00, high 1.50, low 0.80 and close 1.10.
 *
 * @param {string} url - The requested url
 * @returns {Object|Array|null} The json body, or null for a 404
 */
function answerMexcCandle(url) {
  if (url.includes("/exchangeInfo")) {
    return {
      symbols: [{ symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" }],
    };
  }
  if (url.includes("/klines"))
    return [[ROW_UTC_MS - 30000, "1.00", "1.50", "0.80", "1.10", "10"]];
  return null;
}

/**
 * Answers for a coin MEXC does not list and CoinGecko lists against USD,
 * as it does Tezos: CoinGecko's hourly range has no prices, and its price
 * for the day asked says 1.23. Its live ticker says 9.99, so a tool that
 * put the live price on a past date would give 9.99. The tickers carry
 * both the Node tool's field (`last`) and the Sheets script's
 * (`converted_last`).
 *
 * @param {string} url - The requested url
 * @returns {Object|null} The json body, or null for a 404
 */
function answerCoinGeckoForPastDay(url) {
  if (url.includes("/exchangeInfo")) return { symbols: [] };
  if (url.includes("/market_chart/range")) return { prices: [] };
  if (url.includes("/tickers")) {
    return {
      tickers: [
        {
          target: "USD",
          last: LIVE_PRICE,
          converted_last: { usd: LIVE_PRICE },
          volume: 100,
          is_stale: false,
        },
      ],
    };
  }
  if (url.includes("/history"))
    return { market_data: { current_price: { usd: DATED_PRICE } } };
  return null;
}

/**
 * Runs the command line, `index.js`, over one XTM row (12:30 on 2025-06-15)
 * in a child process, with the stand-in MEXC of
 * `helpers/stand-in-fetch-preload.js`, in a temp folder removed afterwards.
 *
 * @param {string[]} options - Options beyond --token, --input and --output
 * @returns {{price: string, candleUtc: string}} The row's price as written, and the UTC end time of the candle asked for
 */
function runCommandLineForOneRow(options) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "crypto-price-filler-test-"),
  );
  try {
    const input = path.join(dir, "in.csv");
    const output = path.join(dir, "out.csv");
    const askedPath = path.join(dir, "asked.json");
    fs.writeFileSync(
      input,
      "date (UTC),amount,description\n2025-06-15 12:30:00,10,one XTM reward\n",
    );
    execFileSync(
      process.execPath,
      [
        "--import",
        PRELOAD_URL,
        "index.js",
        "--token=xtm",
        `--input=${input}`,
        `--output=${output}`,
        ...options,
      ],
      {
        cwd: FILLER_DIR,
        env: { ...process.env, NODE_ENV: "test", STAND_IN_ASKED: askedPath },
        stdio: "pipe",
      },
    );
    const row = fs
      .readFileSync(output, "utf8")
      .trim()
      .split("\n")[1]
      .split(",");
    const candleUrl = JSON.parse(fs.readFileSync(askedPath, "utf8")).find(
      (url) => url.includes("/klines"),
    );
    const candleUtc = new Date(
      Number(new URL(candleUrl).searchParams.get("endTime")),
    ).toISOString();
    return { price: row[3], candleUtc };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Runs the command line, `index.js`, with the arguments given, in a child
 * process with the stand-in MEXC, and gives back how it ended.
 *
 * @param {string[]} args - The arguments
 * @returns {{status: number, stdout: string, stderr: string}} The exit code and what it printed
 */
function runCommandLine(args) {
  const run = spawnSync(
    process.execPath,
    ["--import", PRELOAD_URL, "index.js", ...args],
    {
      cwd: FILLER_DIR,
      env: { ...process.env, NODE_ENV: "test" },
      encoding: "utf8",
    },
  );
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/**
 * Says whether git ignores a path, as it does a file it does not track
 * that an ignore rule names.
 *
 * @param {string} relativePath - The path, from the tool's folder
 * @returns {boolean} Whether git ignores it
 */
function gitIgnores(relativePath) {
  return (
    spawnSync("git", ["check-ignore", "-q", relativePath], { cwd: FILLER_DIR })
      .status === 0
  );
}

describe("fixed bugs", () => {
  beforeEach(() => {
    mockFetchWithRetry.mockReset();
  });

  describe("close mode gives the candle close, not its high", () => {
    it("MEXC, in close mode, gives the candle close", async () => {
      mockFetchWithRetry.mockImplementation(
        answeringFetchWithRetry(answerMexcCandle),
      );
      expect(await getPriceFromMEXC("xtm", ROW_UTC_MS, "close")).toBe(1.1);
    });

    it("the provider chain, in close mode, gives the candle close", async () => {
      mockFetchWithRetry.mockImplementation(
        answeringFetchWithRetry(answerMexcCandle),
      );
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
  });

  describe("a past date gets the price of that day, never the live one", () => {
    it("CoinGecko gives its price for 2025-03-15", async () => {
      mockFetchWithRetry.mockImplementation(
        answeringFetchWithRetry(answerCoinGeckoForPastDay),
      );
      expect(
        await getPriceFromCoinGecko(
          "xtz",
          PAST_UTC_MS,
          "close",
          false,
          "tezos",
        ),
      ).toBe(DATED_PRICE);
    });

    it("the provider chain gives the price for 2025-03-15 when MEXC lacks the pair", async () => {
      mockFetchWithRetry.mockImplementation(
        answeringFetchWithRetry(answerCoinGeckoForPastDay),
      );
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
        script.getPriceFromCoinGecko("tezos", PAST_UTC_MS, "high"),
      ).toBeCloseTo(DATED_PRICE * 1.015, 10);
    });
  });

  describe("CoinGecko's day is the UTC day, whatever the computer's clock", () => {
    it("on a computer set to Chicago time, 03:00 UTC on 2025-03-15 asks for 15-03-2025", async () => {
      // CoinGecko answers nothing, so the tool goes on to ask for the day's price
      mockFetchWithRetry.mockImplementation(
        answeringFetchWithRetry(() => null),
      );
      const zone = process.env.TZ;
      /*-
       *  TEST-ONLY global swap: the day under test would come from the time
       *  zone the computer is set to, and the tool offers no seam for it.
       *  Restored pristine in the `finally` below, immediately after the call
       *  that needed it.
       */
      process.env.TZ = "America/Chicago";
      try {
        await getPriceFromCoinGecko(
          "xtz",
          PAST_UTC_MS,
          "close",
          false,
          "tezos",
        );
      } finally {
        if (zone === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = zone;
        }
      }
      const days = mockFetchWithRetry.mock.calls
        .map(([url]) => url)
        .filter((url) => url.includes("/history"))
        .map((url) => new URL(url).searchParams.get("date"));
      expect(days).not.toHaveLength(0);
      for (const day of days) expect(day).toBe("15-03-2025");
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
    it("the Node tool asks /coins/{id}/ohlcv/historical", async () => {
      mockFetchWithRetry.mockImplementation(
        answeringFetchWithRetry((url) => (url.includes("/ohlcv/") ? [] : null)),
      );
      await getPriceFromCoinPaprika("xtm-tari", ROW_UTC_MS, "high", false);
      const asked = mockFetchWithRetry.mock.calls.map(([url]) => url);
      expect(asked[0]).toMatch(
        /^https:\/\/api\.coinpaprika\.com\/v1\/coins\/xtm-tari\/ohlcv\/historical\?start=\d+&end=\d+$/,
      );
    });

    it("the Sheets script asks the same address", () => {
      const asked = [];
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
        asked.push(url);
        if (url.includes("/exchangeInfo")) return { symbols: [] };
        if (url.includes("/market_chart/range")) return { prices: [] };
        if (url.includes("/tickers/")) return { quotes: { USD: { price: 1 } } };
        if (url.includes("/ohlcv/")) return [{ high: "2.5", low: "2.0" }];
        return null;
      });
      expect(
        script.getCryptoPrice("xtm", "2025-06-15 12:30:00", "UTC", "high", 0),
      ).toBe(2.5);
      expect(asked.find((url) => url.includes("/ohlcv/"))).toMatch(
        /^https:\/\/api\.coinpaprika\.com\/v1\/coins\/xtm-tari\/ohlcv\/historical\?start=\d+&end=\d+&quote=usd$/,
      );
    });
  });
});
