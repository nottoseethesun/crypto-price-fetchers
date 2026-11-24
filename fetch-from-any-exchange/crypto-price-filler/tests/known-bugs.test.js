/**
 * Tests of the bugs known in the repo's code, each declared with `it.fails`.
 * @module tests/known-bugs.test
 *
 * Each test checks the behavior the code should have, so it fails while
 * the bug is there, and `it.fails` turns that failure into a pass. A fix
 * makes the test pass, so `it.fails` fails it: the same change declares the
 * test with `it` and moves it to the regression file of its area, as the
 * repo's CLAUDE.md lists them, and removes the bug's row from the table
 * there, which lists each test here.
 *
 * The Sheets scripts run unchanged in the test's thread, through
 * `tests/helpers/sheets-script.js`, with a stand-in for the Apps Script
 * service a test is about, such as the script lock; crypto-price-filler's
 * two command lines run in a child process, with a settings file of the
 * test's own (`tests/helpers/stand-in-settings-preload.js`); and the
 * security lint's rule runs through ESLint's `Linter`.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { Linter } from "eslint";
import noSecretLogging from "../../../eslint-rules/no-secret-logging.js";
import {
  CUSTOM_FUNCTION_LIMIT_MS,
  busyLockService,
  loadSheetsScript,
} from "./helpers/sheets-script.js";
import {
  answerPaprikaBeyondCandles,
  answerPaprikaCandleOfTheDay,
  dateAt,
  ROW_UTC_MS,
  runIndexIn,
  SHEETS_SCRIPT_PATH,
} from "./helpers/regression-runs.js";

/** The DexTools script, at the repo's top. */
const DEXTOOLS_SCRIPT = path.resolve(
  __dirname,
  "../../../crypto-price-fetchers/src/crypto-price-fetchers.gs",
);

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
});

/** backfill's command line, at the repo's top. */
const BACKFILL_COMMAND_LINE = path.resolve(
  __dirname,
  "../../../bin/backfill.js",
);

/** A CSV the filler wrote, its second price one it could not find. */
const PRICES_WITH_A_GAP = `"date (UTC)","amount","$usd price","$usd amount","grand total ($usd)"
"2024-01-01 12:00:00","10","100","1000","1000"
"2024-01-02 12:00:00","20","Error","","1000"
"2024-01-03 12:00:00","15","200","3000","4000"
`;

/**
 * Runs backfill's command line on a copy of `PRICES_WITH_A_GAP` in the
 * folder given, with the arguments given and the settings file given in
 * place of the filler's own.
 *
 * @param {string} folder - A temp folder of the test's own
 * @param {string[]} args - The arguments after `--input`
 * @param {string} settings - The text of the settings file
 * @returns {{run: {status: number, stderr: string}, left: string}} How the run ended, and what the file holds after it
 */
function backfillIn(folder, args, settings) {
  const input = path.join(folder, "prices.csv");
  fs.writeFileSync(input, PRICES_WITH_A_GAP);
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      path.join(__dirname, "helpers/stand-in-settings-preload.js"),
      BACKFILL_COMMAND_LINE,
      `--input=${input}`,
      ...args,
    ],
    {
      env: { ...process.env, STAND_IN_FILLER_CONFIG: settings },
      encoding: "utf8",
      timeout: 30000,
    },
  );
  return { run, left: fs.readFileSync(input, "utf8") };
}

describe("a backfill flag typed against config.json's other backfill setting", () => {
  it.fails(
    "is refused by backfill's command line, naming both, with the file left as it was",
    () => {
      const folder = fs.mkdtempSync(
        path.join(os.tmpdir(), "backfill-conflict-"),
      );
      try {
        const { run, left } = backfillIn(
          folder,
          ["--backfill-lowest"],
          '{"BACKFILL_HIGHEST": true}',
        );
        expect(run.stderr).toContain(
          "option '--backfill-highest' (set in config.json) cannot be used with option '--backfill-lowest'",
        );
        expect(run.status).toBe(1);
        expect(left).toBe(PRICES_WITH_A_GAP);
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    },
  );

  it.fails(
    "is refused by the filler's command line, naming both, writing no file",
    () => {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), "filler-conflict-"));
      try {
        fs.writeFileSync(
          path.join(folder, "in.csv"),
          "date (UTC),amount\n2025-06-15 12:30:00,10\n",
        );
        const output = path.join(folder, "out.csv");
        const run = runIndexIn(
          folder,
          [
            "--token",
            "xtm",
            "--input",
            "in.csv",
            "--output",
            output,
            "--backfill-lowest",
          ],
          { STAND_IN_FILLER_CONFIG: '{"BACKFILL_HIGHEST": true}' },
        );
        expect(run.stderr).toContain(
          "option '--backfill-highest' (set in config.json) cannot be used with option '--backfill-lowest'",
        );
        expect(run.status).toBe(1);
        expect(fs.existsSync(output)).toBe(false);
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    },
  );
});

describe("the exchange script, for a time less than 12 hours ago", () => {
  it.fails(
    "gives no data, not when to ask again, for a ticker CoinGecko has no prices of",
    () => {
      const asked = [];
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
        asked.push(url);
        return null;
      });
      const time = new Date(Date.now() - 3600000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      expect(script.getCryptoPrice("btcc", time, "UTC")).toBe(
        "No data available from any source",
      );
      expect(asked.filter((url) => url.includes("coingecko"))).toHaveLength(1);
    },
  );
});

describe("the security lint's no-secret-logging", () => {
  it.fails(
    "refuses a key printed inside a new, a tagged template, a key written as a string, an assignment or a sequence",
    () => {
      const linter = new Linter();
      const refused = (code) =>
        linter.verify(code, {
          languageOptions: { ecmaVersion: "latest", sourceType: "module" },
          plugins: {
            local: { rules: { "no-secret-logging": noSecretLogging } },
          },
          rules: { "local/no-secret-logging": "error" },
        }).length;
      for (const code of [
        "console.error(new Error(`key ${apiKey} refused`))",
        'console.log(keys["apiKey"])',
        "console.log(String.raw`${apiKey}`)",
        "console.log((note = apiKey))",
        "console.log((0, apiKey))",
      ])
        expect(refused(code), code).toBe(1);
    },
  );
});

describe("CoinPaprika's source, for a time whose UTC day is not over", () => {
  it.fails(
    "gives no price from the day's candle, which can still change",
    () => {
      const asked = [];
      const script = loadSheetsScript(
        SHEETS_SCRIPT_PATH,
        (url) => {
          asked.push(url);
          return answerPaprikaCandleOfTheDay(url);
        },
        { services: { Date: dateAt(Date.UTC(2026, 10, 24, 13)) } },
      );
      expect(
        script.getPriceFromCoinPaprika(
          "xtm-tari",
          Date.UTC(2026, 10, 24, 12),
          "close",
        ),
      ).toBeNull();
      expect(asked).toEqual([]);
    },
  );
});

describe("CoinPaprika's close of a day older than its plan's candles reach", () => {
  it.fails("is its price at 00:00 UTC the next day, which ends the day", () => {
    const script = loadSheetsScript(
      SHEETS_SCRIPT_PATH,
      answerPaprikaBeyondCandles,
    );
    expect(
      script.getPriceFromCoinPaprika("xtm-tari", ROW_UTC_MS, "close"),
    ).toBe(2.15);
  });
});
