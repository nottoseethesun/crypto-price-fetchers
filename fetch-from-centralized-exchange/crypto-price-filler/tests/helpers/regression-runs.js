/**
 * The settings, stand-in answers and runs the regression tests share
 * (`tests/regressions.test.js`, `tests/regressions-sheets.test.js`).
 * @module tests/helpers/regression-runs
 *
 * The answers stand in for the price services at the http layer: MEXC for
 * a pair it lists, CoinGecko for a coin MEXC does not list, and
 * CoinPaprika for a day its plan's candles do not reach. The runs start
 * the command line, `index.js`, in a child process with the stand-in MEXC
 * of `stand-in-fetch-preload.js`, or change the computer's time zone for
 * one call.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reply } from "./sheets-script.js";
import { mexcKlines } from "../../../../test/helpers/stand-in-mexc.js";

export const FILLER_DIR = fileURLToPath(new URL("../..", import.meta.url));
/** The Sheets script's files its function needs, in the order Apps Script loads them. */
export const SHEETS_SCRIPT_PATH = [
  "../../../getCryptoPriceFromCentralizedExchange.gs",
  "../../../getCryptoPriceFromCentralizedExchange-sources.gs",
].map((file) => fileURLToPath(new URL(file, import.meta.url)));
/** The menu and the DexTools script, as the build joins them, from the repo's top. */
export const MENU_AND_DEXTOOLS_SCRIPTS = [
  "../../../../crypto-price-fetchers-menu.gs",
  "../../../../crypto-price-fetchers.gs",
].map((file) => fileURLToPath(new URL(file, import.meta.url)));
const PRELOAD_URL = new URL("./stand-in-fetch-preload.js", import.meta.url)
  .href;

export const ROW_UTC_MS = Date.UTC(2025, 5, 15, 12, 30, 0);
export const PAST_UTC_MS = Date.UTC(2025, 2, 15, 3, 0, 0);
const LIVE_PRICE = 9.99;
export const DATED_PRICE = 1.23;

/** An api key in CoinGecko's form. */
export const COINGECKO_KEY_PATTERN = /CG-[A-Za-z0-9]{20,}/;

/**
 * Answers as MEXC does for XTM, a pair it lists: the candle of the period
 * asked (`test/helpers/stand-in-mexc.js`), with open 1.00, high 1.50, low
 * 0.80 and close 1.10.
 *
 * @param {string} url - The requested url
 * @returns {Object|Array|null} The json body, or null for a 404
 */
export function answerMexcCandle(url) {
  if (url.includes("/exchangeInfo")) {
    return {
      symbols: [{ symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" }],
    };
  }
  if (url.includes("/klines"))
    return mexcKlines(url, ["1.00", "1.50", "0.80", "1.10", "10"]);
  return null;
}

/**
 * Answers for a coin MEXC does not list and CoinGecko lists against USD,
 * as it does Tezos: CoinGecko's hourly range has no prices, and its price
 * for the day asked says 1.23. Its live ticker says 9.99, so a tool that
 * put the live price on a past date would give 9.99.
 *
 * @param {string} url - The requested url
 * @returns {Object|null} The json body, or null for a 404
 */
export function answerCoinGeckoForPastDay(url) {
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
 * Answers as CoinPaprika's free plan does for a day older than a day:
 * it refuses the candle, as beyond the plan, and gives the day's price
 * at 00:00 UTC, 2.05 on 2025-06-15.
 *
 * @param {string} url - The requested url
 * @returns {*} The answer
 */
export function answerPaprikaBeyondCandles(url) {
  if (url.includes("/ohlcv/historical")) {
    return reply(402, {
      error:
        "Getting historical OHLCV data before 2026-11-19 is not allowed in this plan",
    });
  }
  if (url.includes("/tickers/xtm-tari/historical"))
    return [{ timestamp: "2025-06-15T00:00:00Z", price: 2.05 }];
  return null;
}

/**
 * Runs the command line, `index.js`, over one XTM row (12:30 on 2025-06-15)
 * in a child process, with the stand-in MEXC of
 * `helpers/stand-in-fetch-preload.js`, in a temp folder removed afterwards.
 *
 * @param {string[]} options - Options beyond --token, --input and --output
 * @param {string} [cwd=FILLER_DIR] - The folder the command runs in
 * @returns {{price: string, candleUtc: string}} The row's price as written, and the UTC time the candle asked for opens at
 */
export function runCommandLineForOneRow(options, cwd = FILLER_DIR) {
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
        path.join(FILLER_DIR, "index.js"),
        "--token=xtm",
        `--input=${input}`,
        `--output=${output}`,
        ...options,
      ],
      {
        cwd,
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
      Number(new URL(candleUrl).searchParams.get("startTime")),
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
/** The preload that hands a run of index.js settings of the test's own. */
const SETTINGS_PRELOAD_URL = new URL(
  "./stand-in-settings-preload.js",
  import.meta.url,
).href;

/**
 * Runs index.js in a folder, with the stand-in settings and the stand-in
 * fetch, as the owner runs it there.
 *
 * @param {string} folder - The folder it runs in
 * @param {string[]} args - Its arguments
 * @param {Object<string, string>} [standIns] - `STAND_IN_FILLER_CONFIG`, `STAND_IN_FILLER_TOKENS` or `STAND_IN_EXCHANGE_CONFIG`, as the settings preload takes them
 * @returns {{status: number, stdout: string, stderr: string}} How it ended
 */
export function runIndexIn(folder, args, standIns = {}) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      SETTINGS_PRELOAD_URL,
      "--import",
      PRELOAD_URL,
      path.join(FILLER_DIR, "index.js"),
      ...args,
    ],
    {
      cwd: folder,
      env: { ...process.env, ...standIns },
      encoding: "utf8",
      timeout: 30000,
    },
  );
}

export function runCommandLine(args) {
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
export function gitIgnores(relativePath) {
  return (
    spawnSync("git", ["check-ignore", "-q", relativePath], { cwd: FILLER_DIR })
      .status === 0
  );
}

/**
 * Runs a function with the computer's time zone set to another, then
 * restores it.
 *
 * @param {string} zone - The time zone, such as 'America/Chicago'
 * @param {function(): *} run - What to run in it
 * @returns {*} What it returned
 */
export function inTimeZone(zone, run) {
  const saved = process.env.TZ;
  /*-
   *  TEST-ONLY global swap: the day under test would come from the time
   *  zone the computer is set to, and the script offers no seam for it.
   *  Restored pristine in the `finally` below, immediately after the call
   *  that needed it.
   */
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    if (saved === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = saved;
    }
  }
}
