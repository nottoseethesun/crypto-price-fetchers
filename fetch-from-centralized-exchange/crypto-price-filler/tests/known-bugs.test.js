/**
 * Tests of the bugs known in the repo's code, each declared with `it.fails`.
 * @module tests/known-bugs.test
 *
 * Each test checks the behavior the code should have, so it fails while
 * the bug is there, and `it.fails` turns that failure into a pass. A fix
 * makes the test pass, so `it.fails` fails it: the same change declares the
 * test with `it` and moves it to `regressions.test.js`, or to
 * `regressions-command-line.test.js` for the filler's command lines, and
 * removes the
 * bug's row from the table in the repo's CLAUDE.md, which lists each test
 * here.
 *
 * The Sheets scripts run unchanged in the test's thread, through
 * `tests/helpers/sheets-script.js`, with a stand-in for the Apps Script
 * service each test is about: the script lock. The command line runs in a
 * child process, with the preloads of `tests/helpers/`: a settings file or
 * token list of the test's own, and a stand-in fetch. The repo's shared
 * helpers, in `lib/`, run in the test's thread.
 */

import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { filesUsingCommander } from "../../../lib/command-line-help.js";
import {
  compileSettingsSchema,
  KINDS,
  settingsProblems,
} from "../../../lib/settings-schema.js";
import {
  readSummCsvSettings,
  SUMM_CSV_SETTINGS_SCHEMA,
} from "../../../summ-csv/index.js";
import { SETTINGS_SCHEMA } from "../config.js";
import { readSupportedTokens } from "../supported-tokens.js";
import { loadSheetsScript } from "./helpers/sheets-script.js";

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

/** crypto-price-filler's folder, and the two preloads a run of its command line takes. */
const FILLER_DIR = path.resolve(__dirname, "..");
const SETTINGS_PRELOAD = pathToFileURL(
  path.resolve(__dirname, "helpers/stand-in-settings-preload.js"),
).href;
const FETCH_PRELOAD = pathToFileURL(
  path.resolve(__dirname, "helpers/stand-in-fetch-preload.js"),
).href;

/** A token list of one token, XTM, which MEXC lists and CoinGecko does not. */
const XTM_WITHOUT_COINGECKO = JSON.stringify({
  tokens: {
    xtm: {
      name: "Minotari",
      coingecko_id: null,
      coinpaprika_id: null,
      mexc_symbol: "XTM",
    },
  },
});

let folder;

beforeAll(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "crypto-price-filler-bugs-"));
  fs.writeFileSync(
    path.join(folder, "in.csv"),
    "date (UTC),amount,description\n2025-06-15 12:30:00,10,one XTM reward\n",
  );
});

afterAll(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

/**
 * Runs the command line, index.js, from the test's temp folder, with the
 * settings file or token list given in place of the tool's own.
 *
 * @param {string[]} args - Its arguments
 * @param {Object<string, string>} standIns - `STAND_IN_FILLER_CONFIG` and `STAND_IN_FILLER_TOKENS`, as the settings preload takes them
 * @returns {{status: number, stdout: string, stderr: string}} How it ended
 */
function runIndex(args, standIns) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      SETTINGS_PRELOAD,
      "--import",
      FETCH_PRELOAD,
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

describe("the command line's settings and token list", () => {
  it.fails(
    "index.js answers --help whatever its settings, and prints a settings file's or token list's problems as one error, with exit code 1 and no stack trace",
    () => {
      const badSettings = {
        STAND_IN_FILLER_CONFIG: '{"BACKFILL_HIGEST": true}',
      };
      const help = runIndex(["--help"], badSettings);
      expect(help.status).toBe(0);
      expect(help.stdout).toMatch(/^Usage: crypto-price-filler/);
      const run = runIndex(
        ["--token", "grc", "--input", "in.csv"],
        badSettings,
      );
      expect(run.status).toBe(1);
      expect(run.stderr).toBe(
        "Error: crypto-price-filler/config.json → BACKFILL_HIGEST is not a setting this tool reads\n",
      );
      const broken = runIndex(["--token", "grc", "--input", "in.csv"], {
        STAND_IN_FILLER_TOKENS: "{ not json",
      });
      expect(broken.status).toBe(1);
      expect(broken.stderr).toMatch(
        /^Error: \S*supported-tokens\.json is not valid JSON: /,
      );
      expect(broken.stderr).not.toMatch(/\n\s+at /);
    },
  );

  it.fails(
    "index.js logs no CoinGecko id for a token supported-tokens.json gives none",
    () => {
      const run = runIndex(
        [
          "--token",
          "xtm",
          "--input",
          "in.csv",
          "--output",
          "out.csv",
          "--verbose",
        ],
        { STAND_IN_FILLER_TOKENS: XTM_WITHOUT_COINGECKO },
      );
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("CoinGecko: skipped since set to null");
      expect(run.stdout).not.toMatch(/CoinGecko ID for xtm: xtm/);
    },
  );

  it.fails(
    "refuses a token keyed in upper case in supported-tokens.json, which no lookup finds",
    () => {
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
    },
  );
});

describe("the repo's shared helpers", () => {
  it.fails(
    "compiles a settings file's schema once, however often a file is read against it",
    () => {
      expect(compileSettingsSchema(SETTINGS_SCHEMA)).toBe(
        compileSettingsSchema(SETTINGS_SCHEMA),
      );
    },
  );

  it.fails(
    "describes an empty text and an empty list by what each lacks",
    () => {
      const validate = compileSettingsSchema({
        type: "object",
        additionalProperties: false,
        properties: { name: KINDS.text, id: KINDS.textOrNone },
      });
      expect(
        settingsProblems("config.json", validate, { name: "", id: "" }),
      ).toEqual([
        'config.json → name must be text that is not empty; it is ""',
        'config.json → id must be text that is not empty, or null for none; it is ""',
      ]);
      const settings = readSummCsvSettings();
      settings.referencePriceCurrencies = [];
      expect(
        settingsProblems(
          "summ-csv/settings.json",
          compileSettingsSchema(SUMM_CSV_SETTINGS_SCHEMA),
          settings,
        ),
      ).toEqual([
        "summ-csv/settings.json → referencePriceCurrencies must be a list of one or more currencies, each once; it is []",
      ]);
    },
  );

  it.fails(
    "counts a file that brings in Command or the whole of commander in each form that loads",
    () => {
      const top = fs.mkdtempSync(path.join(folder, "commander-forms-"));
      const files = {
        "re-export.js": 'export * from "commander";\n',
        "commented.js":
          'import { Command } from "commander"; // the command line\n',
        "indented.js": '  import { Command } from "commander";\n',
        "dynamic.js": 'const { Command } = await import("commander");\n',
        "parser.js":
          'import { InvalidArgumentError } from "commander"; // a parser\n',
        "in-a-comment.js":
          '/**\n * import { Command } from "commander";\n */\nexport const x = 1;\n',
      };
      for (const [name, text] of Object.entries(files)) {
        fs.writeFileSync(path.join(top, name), text);
      }
      expect(filesUsingCommander(top).sort()).toEqual([
        "commented.js",
        "dynamic.js",
        "indented.js",
        "re-export.js",
      ]);
    },
  );
});
