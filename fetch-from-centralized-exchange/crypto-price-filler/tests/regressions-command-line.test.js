/**
 * Tests that guard fixed bugs in crypto-price-filler's two command lines,
 * `index.js` and `backfill.js`: their checks of a value, the settings they
 * fall back to, how a settings file or token list they cannot take ends a
 * run, and what `index.js` logs. The other fixed bugs' tests are in
 * `regressions.test.js`, `regressions-lib.test.js` and
 * `regressions-sheets.test.js`; a bug found later gets its test in
 * `known-bugs.test.js`, declared with `it.fails` while the bug is there,
 * and its fix moves the test to one of the four (see the repo's
 * CLAUDE.md).
 * @module tests/regressions-command-line.test
 *
 * `index.js` runs as its owner runs it, in a child process, given a
 * settings file or token list of the test's own through the preload
 * `helpers/stand-in-settings-preload.js`, and a stand-in fetch through
 * `helpers/stand-in-fetch-preload.js`; its command, and `backfill.js`'s,
 * are also parsed here, in the test's thread, and `backfill.js` backfills
 * a CSV in a temp folder of the test's own, with the settings the test
 * gives it.
 */

import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { runBackfill, setupBackfillCommander } from "../backfill.js";
import { setupCommander } from "../commander.js";
import { backfillChoice } from "../utils/backfill.js";

/** crypto-price-filler's folder, and the two preloads a run of index.js takes. */
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
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "crypto-price-filler-cli-"));
  fs.writeFileSync(
    path.join(folder, "in.csv"),
    "date (UTC),amount,description\n2025-06-15 12:30:00,10,one XTM reward\n",
  );
});

afterAll(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

/**
 * Runs index.js from the test's temp folder, with the settings file or
 * token list given in place of the tool's own.
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

/** A CSV of three rows, the second with no price, for backfill to fill. */
const CSV_WITH_A_GAP = `"date (UTC)","amount","$usd price","$usd amount","grand total ($usd)"
"2024-01-01 12:00:00","10","100","1000","1000"
"2024-01-02 12:00:00","20","","","1000"
"2024-01-03 12:00:00","15","200","3000","4000"
`;

describe("crypto-price-filler's command line", () => {
  it("answers --help whatever its settings, and prints a settings file's or token list's problems as one error, with exit code 1 and no stack trace", () => {
    const badSettings = { STAND_IN_FILLER_CONFIG: '{"BACKFILL_HIGEST": true}' };
    const help = runIndex(["--help"], badSettings);
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/^Usage: crypto-price-filler/);
    const run = runIndex(["--token", "grc", "--input", "in.csv"], badSettings);
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
  });

  it("logs no CoinGecko id for a token supported-tokens.json gives none", () => {
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
  });

  it("refuses a --mode it does not know as commander refuses a wrong value, naming --mode, with no stack trace", () => {
    const run = spawnSync(
      process.execPath,
      [
        path.join(FILLER_DIR, "index.js"),
        "--token",
        "grc",
        "--input",
        "x.csv",
        "--mode",
        "bogus",
      ],
      { cwd: os.tmpdir(), encoding: "utf8", timeout: 30000 },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      "option '--mode <mode>' argument 'bogus' is invalid",
    );
    expect(run.stderr).not.toMatch(/\n\s+at /);
  });

  it("leaves both backfill modes to config.json when neither flag is given, in index.js as in backfill.js", () => {
    const parsed = setupCommander()
      .parse(["node", "index.js", "--token", "grc", "--input", "x.csv"])
      .opts();
    expect(backfillChoice(parsed, { BACKFILL_HIGHEST: true })).toEqual({
      highest: true,
      lowest: false,
    });
    const flagged = setupCommander()
      .parse([
        "node",
        "index.js",
        "--token",
        "grc",
        "--input",
        "x.csv",
        "--backfill-lowest",
      ])
      .opts();
    expect(backfillChoice(flagged, { BACKFILL_HIGHEST: false })).toEqual({
      highest: false,
      lowest: true,
    });
  });
});

describe("backfill.js's command line", () => {
  it("takes BACKFILL_HIGHEST from config.json when neither backfill flag is given", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-config-"));
    const input = path.join(folder, "prices.csv");
    fs.writeFileSync(input, CSV_WITH_A_GAP);
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const options = setupBackfillCommander()
        .parse(["node", "backfill.js", "--input", input])
        .opts();
      const stats = await runBackfill(options, {
        BACKFILL_HIGHEST: true,
        BACKFILL_LOWEST: false,
      });
      expect(stats.emptyRowsFilled).toBe(1);
    } finally {
      vi.restoreAllMocks();
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
