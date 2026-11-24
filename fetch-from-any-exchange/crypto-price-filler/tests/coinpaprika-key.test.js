/**
 * Tests of what CoinPaprika gives without a key, whose free server keeps
 * no candle of a day already over: the exchange script's CoinPaprika
 * source, which then gives no average, high or low, and asks nothing for
 * one, and the cell, which says CoinPaprika needs a key, the script run
 * unchanged in the test's thread (`helpers/sheets-script.js`); and the
 * question crypto-price-filler then asks for a high or a low,
 * `utils/coinpaprika-key.js`, asked with streams of the test's own, and
 * through the command line, run in a child process with the stand-in MEXC
 * of `helpers/stand-in-fetch-preload.js`, its answer given on its input.
 * No CoinPaprika key is saved: `vitest.config.js` names a key file that
 * does not exist.
 * @module tests/coinpaprika-key.test
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { PassThrough } from "stream";
import {
  goOnWithoutCoinPaprika,
  NO_COINPAPRIKA_KEY,
} from "../utils/coinpaprika-key.js";
import { loadSheetsScript } from "./helpers/sheets-script.js";
import { loadTokenConfig } from "../sources/price.js";
import {
  answerPaprikaCandleOfTheDay,
  COMMAND_LINE,
  dateAt,
  FILLER_DIR,
  ROW_UTC_MS,
  SHEETS_SCRIPT_PATH,
} from "./helpers/regression-runs.js";

/** The preload that answers the command line's requests as MEXC does. */
const FETCH_PRELOAD = new URL(
  "./helpers/stand-in-fetch-preload.js",
  import.meta.url,
).href;

/** A run for a high, of a token CoinPaprika lists, with no CoinPaprika key saved. */
const NO_KEY = { mode: "high", coinpaprikaId: "xtm-tari", keySaved: false };

/**
 * Asks with the text given as the whole input.
 *
 * @param {Object} run - What decides it (`goOnWithoutCoinPaprika`)
 * @param {string} typed - The input
 * @returns {Promise<{goOn: boolean, written: string}>} Whether to go on, and what was written
 */
async function askWith(run, typed) {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = "";
  output.on("data", (chunk) => {
    written += chunk;
  });
  input.end(typed);
  const goOn = await goOnWithoutCoinPaprika(run, { input, output });
  return { goOn, written };
}

/**
 * Runs the command line over one XTM row with `--mode high`, the input
 * given, in a temp folder removed afterwards.
 *
 * @param {string} answer - The command line's input
 * @returns {{status: number, stderr: string, written: boolean, asked: string[]}} How it ended, whether it wrote its file, and the urls it asked for
 */
function runForAHigh(answer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coinpaprika-key-test-"));
  try {
    const input = path.join(dir, "in.csv");
    const output = path.join(dir, "out.csv");
    const askedPath = path.join(dir, "asked.json");
    fs.writeFileSync(
      input,
      "date (UTC),amount,description\n2025-06-15 12:30:00,10,one XTM reward\n",
    );
    const run = spawnSync(
      process.execPath,
      [
        "--import",
        FETCH_PRELOAD,
        COMMAND_LINE,
        "--token=xtm",
        `--input=${input}`,
        `--output=${output}`,
        "--mode=high",
      ],
      {
        cwd: FILLER_DIR,
        env: { ...process.env, NODE_ENV: "test", STAND_IN_ASKED: askedPath },
        input: answer,
        encoding: "utf8",
        timeout: 30000,
      },
    );
    return {
      status: run.status,
      stderr: run.stderr,
      written: fs.existsSync(output),
      asked: JSON.parse(fs.readFileSync(askedPath, "utf8")),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Loads the exchange script, with no CoinPaprika key, its present 13:00
 * UTC on 2026-11-24, recording each url it asks.
 *
 * @returns {{script: Object, asked: string[]}} The script, and the urls asked
 */
function scriptWithoutKey() {
  const asked = [];
  const script = loadSheetsScript(
    SHEETS_SCRIPT_PATH,
    (url) => {
      asked.push(url);
      return answerPaprikaCandleOfTheDay(url);
    },
    { services: { Date: dateAt(Date.UTC(2026, 10, 24, 13)) } },
  );
  return { script, asked };
}

describe("the exchange script without a CoinPaprika key", () => {
  it("has CoinPaprika's source give no average, high or low, asking nothing", () => {
    const { script, asked } = scriptWithoutKey();
    for (const target of ["average", "high", "low"]) {
      expect(
        script.getPriceFromCoinPaprika("xtm-tari", ROW_UTC_MS, target),
      ).toBeNull();
    }
    expect(asked).toEqual([]);
  });

  it("leaves a cell no other source prices to say CoinPaprika needs a key for an average, a high or a low, for a past day or today", () => {
    const { script, asked } = scriptWithoutKey();
    for (const mode of ["average", "high", "low"]) {
      for (const time of ["2025-06-15 12:30:00", "2026-11-24 12:00:00"]) {
        expect(
          script.getCryptoPrice("xtm", time, "UTC", mode),
          `${mode} ${time}`,
        ).toBe(
          "No data available from any source; CoinPaprika gives average, high and low only with an api key",
        );
      }
    }
    expect(asked.some((url) => url.includes("coinpaprika"))).toBe(false);
  });

  it("says no source has a price, not that CoinPaprika needs a key, for a token CoinPaprika lists as inactive", () => {
    const { script } = scriptWithoutKey();
    expect(
      script.getCryptoPrice("grc", "2025-06-15 12:30:00", "UTC", "high"),
    ).toBe("No data available from any source");
  });
});

describe("the question a run asks when CoinPaprika can give it no price", () => {
  it("is not asked for GridCoin, whose entry names no CoinPaprika id, since CoinPaprika lists it as inactive", async () => {
    const run = {
      ...NO_KEY,
      coinpaprikaId: loadTokenConfig("grc").coinpaprikaId,
    };
    expect(await askWith(run, "")).toEqual({ goOn: true, written: "" });
  });

  it("is not asked for close, for a token with no CoinPaprika id, or with a key saved", async () => {
    for (const run of [
      { ...NO_KEY, mode: "close" },
      { ...NO_KEY, coinpaprikaId: null },
      { ...NO_KEY, keySaved: true },
    ]) {
      expect(await askWith(run, "")).toEqual({ goOn: true, written: "" });
    }
  });

  it("says why, and goes on at y", async () => {
    const { goOn, written } = await askWith(NO_KEY, "y\n");
    expect(goOn).toBe(true);
    expect(written).toContain(NO_COINPAPRIKA_KEY);
  });

  it("stops at Enter, at n, and when the input ends with no answer", async () => {
    for (const typed of ["\n", "n\n", ""]) {
      expect((await askWith({ ...NO_KEY, mode: "low" }, typed)).goOn).toBe(
        false,
      );
    }
  });

  it("asks again after an answer it does not take", async () => {
    const { goOn, written } = await askWith(NO_KEY, "maybe\nyes\n");
    expect(goOn).toBe(true);
    expect(written).toContain("Answer y or n, or press Enter for n.");
  });
});

describe("the command line, with --mode high and no CoinPaprika key saved", () => {
  it("says why and stops at Enter, with exit code 1, before any price is asked for", () => {
    const run = runForAHigh("\n");
    expect(run.stderr).toContain(NO_COINPAPRIKA_KEY.split("\n")[0]);
    expect(run.status).toBe(1);
    expect(run.written).toBe(false);
    expect(run.asked).toEqual([]);
  });

  it("goes on at y, and writes the file", () => {
    const run = runForAHigh("y\n");
    expect(run.status).toBe(0);
    expect(run.written).toBe(true);
  });
});
