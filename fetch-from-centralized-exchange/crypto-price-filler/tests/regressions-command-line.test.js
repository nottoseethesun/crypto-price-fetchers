/**
 * Tests that guard fixed bugs in the repo's command lines:
 * crypto-price-filler's two, `index.js` and `backfill.js`, with their
 * checks of a value, the settings they fall back to, how a settings file
 * or token list they cannot take ends a run, and what `index.js` logs; and
 * the Sheets scripts' Node versions', with their checks of a value before
 * a key is opened, and the exchange script's settings. The other fixed bugs' tests are in
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
 * gives it. The Node versions' command lines run in the test's thread,
 * with a stand-in fetch and a key file in a temp folder of the test's own.
 */

import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { runBackfill, setupBackfillCommander } from "../backfill.js";
import { setupCommander } from "../commander.js";
import { backfillChoice, backfillPrices } from "../utils/backfill.js";
import { runCommandLine, runIndexIn } from "./helpers/regression-runs.js";
import { logLines } from "./helpers/log-lines.js";
import { saveEncryptedKey } from "../../../api-key-store/key-file.js";
import { runCommandLine as runPriceNowCommandLine } from "../../../bin/crypto-price-fetchers.js";
import {
  readCentralizedExchangeConfig,
  runCommandLine as runPastPriceCommandLine,
} from "../../../bin/getCryptoPriceFromCentralizedExchange.js";

/** crypto-price-filler's folder. */
const FILLER_DIR = path.resolve(__dirname, "..");

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
 * @param {Object<string, string>} standIns - As the settings preload takes them
 * @returns {{status: number, stdout: string, stderr: string}} How it ended
 */
function runIndex(args, standIns) {
  return runIndexIn(folder, args, standIns);
}

/** A CSV of three rows, the second with no price, for backfill to fill. */
const CSV_WITH_A_GAP = `"date (UTC)","amount","$usd price","$usd amount","grand total ($usd)"
"2024-01-01 12:00:00","10","100","1000","1000"
"2024-01-02 12:00:00","20","Error","","1000"
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

  it("stops before the first row, with exit code 1, on a config.json of the exchange script it refuses, naming the problem", () => {
    const run = runIndex(["--token", "xtm", "--input", "in.csv"], {
      STAND_IN_EXCHANGE_CONFIG: "{ not json",
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(
      /^Error: \S*fetch-from-centralized-exchange[/\\]config\.json is not valid JSON: /,
    );
    expect(run.stderr).not.toMatch(/\n\s+at /);
    expect(run.stdout).toBe("");
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
    logLines();
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

describe("the check that the command line loads", () => {
  it("validate-parse fails when node exits with code 1, as it does when the command line cannot load", () => {
    const scripts = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
    ).scripts;
    const command = scripts["validate-parse"].replace(
      "node ../../bin/crypto-price-filler.js --help",
      'node -e "process.exit(1)"',
    );
    expect(command).not.toBe(scripts["validate-parse"]);
    const run = spawnSync("sh", ["-c", command], { encoding: "utf8" });
    expect(run.status).not.toBe(0);
  });
});

describe("backfill and the rows that hold no data", () => {
  it("backfillPrices leaves out of the backfill and the grand total the rows the filler leaves blank on purpose, such as a Total row", () => {
    const row = (date, amount, price) => ({
      date,
      amount,
      "$usd price": price,
      "$usd amount": "",
      "grand total ($usd)": "",
    });
    const rows = [
      row("2025-06-01", "10", "2"),
      row("2025-06-02", "10", "Error"),
      row("2025-06-03", "10", "3"),
      row("Total", "30", ""),
    ];
    backfillPrices(rows, {
      priceColName: "$usd price",
      amountColName: "amount",
      usdAmountColName: "$usd amount",
      grandTotalColName: "grand total ($usd)",
      useHighest: true,
    });
    expect(rows[1]["$usd price"]).toBe(3);
    expect(rows[3]["$usd price"]).toBe("");
    expect(rows[3]["grand total ($usd)"]).toBe((80).toFixed(6));
  });
});

describe("backfill beside a row that holds no data", () => {
  it("backfillPrices brackets a block of Error prices with the nearest priced rows, past a blank row beside it", () => {
    const row = (date, price) => ({
      date,
      amount: "1",
      "$usd price": price,
      "$usd amount": "",
      "grand total ($usd)": "",
    });
    const options = {
      priceColName: "$usd price",
      amountColName: "amount",
      usdAmountColName: "$usd amount",
      grandTotalColName: "grand total ($usd)",
    };
    const highest = [
      row("2025-06-01", "30"),
      row("", ""),
      row("2025-06-02", "Error"),
      row("2025-06-03", "20"),
    ];
    backfillPrices(highest, { ...options, useHighest: true });
    expect(highest[2]["$usd price"]).toBe(30);
    const lowest = [
      row("2025-06-01", "10"),
      row("", ""),
      row("2025-06-02", "Error"),
      row("2025-06-03", "20"),
    ];
    backfillPrices(lowest, { ...options, useHighest: false });
    expect(lowest[2]["$usd price"]).toBe(10);
  });
});

describe("the filler's test commands and its input", () => {
  it("test:ci and test:debug give vitest their flags before any bare --, which vitest never reads", () => {
    const scripts = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
    ).scripts;
    for (const name of ["test:ci", "test:debug"]) {
      expect(scripts[name]).not.toMatch(/ -- --/);
    }
  });

  it("names an input file that does not exist, with exit code 1 and no stack trace", () => {
    const run = runCommandLine([
      "--token=xtm",
      "--input=no-such-input.csv",
      "--output=/tmp/never-written.csv",
    ]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Input file not found: no-such-input.csv");
    expect(run.stderr).not.toMatch(/\n\s+at /);
  });

  it("names an input with a header and no rows", () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "filler-no-rows-"));
    const input = path.join(folder, "header-only.csv");
    fs.writeFileSync(input, '"date (UTC)","amount"\n');
    try {
      const run = runCommandLine([
        "--token=xtm",
        `--input=${input}`,
        `--output=${path.join(folder, "out.csv")}`,
      ]);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(
        "The input CSV has no rows below its header",
      );
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

/**
 * Collects what a command line writes to a stream.
 *
 * @returns {{text: string, write: function(string): void}} The stream
 */
function written() {
  return {
    text: "",
    write(text) {
      this.text += text;
    },
  };
}

describe("the command lines' checks", () => {
  it("getCryptoPriceFromCentralizedExchange.js names --tz or the date, before it opens a key, for a time zone the script does not know or a day the calendar does not have", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "past-price-"));
    const keyFile = path.join(folder, "api-keys.json");
    await saveEncryptedKey(
      keyFile,
      "coingecko",
      "made-up-key-for-the-test",
      "test-password",
    );
    try {
      for (const [args, named] of [
        [
          ["btc", "2026-01-15 14:30:00", "--tz", "XYZ"],
          /option '-z, --tz <abbreviation>'/,
        ],
        [["btc", "2026-02-30 14:30:00"], /argument 'date'/],
      ]) {
        const asked = [];
        const prompts = [];
        const stderr = written();
        const code = await runPastPriceCommandLine(["node", "x", ...args], {
          env: { API_KEYS_FILE_PATH: keyFile },
          ask: async (prompt) => {
            prompts.push(prompt);
            return "test-password";
          },
          fetch: async (url) => {
            asked.push(String(url));
            return new Response("{}", { status: 200 });
          },
          stdout: written(),
          stderr,
        });
        expect(code).toBe(1);
        expect(stderr.text).toMatch(named);
        expect(prompts).toEqual([]);
        expect(asked).toEqual([]);
      }
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it("crypto-price-fetchers.js refuses a run on x1 with no --pool, naming it, before it asks anything", async () => {
    const asked = [];
    const stderr = written();
    const code = await runPriceNowCommandLine(
      [
        "node",
        "x",
        "price",
        "x1",
        "So11111111111111111111111111111111111111112",
      ],
      {
        env: {
          API_KEYS_FILE_PATH: path.join(os.tmpdir(), "no-such-key-file.json"),
        },
        fetch: async (url) => {
          asked.push(String(url));
          return new Response('{"error":"not found"}', { status: 404 });
        },
        stdout: written(),
        stderr,
      },
    );
    expect(code).toBe(1);
    expect(stderr.text).toMatch(/--pool/);
    expect(asked).toEqual([]);
  });

  it("refuses a config.json that sets the exchange script's GENERAL_DELAY_MS to 0, with which a call takes no lock", () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "past-price-"));
    const file = path.join(folder, "config.json");
    fs.writeFileSync(file, JSON.stringify({ CONFIG: { GENERAL_DELAY_MS: 0 } }));
    try {
      expect(() => readCentralizedExchangeConfig(file)).toThrow(
        /GENERAL_DELAY_MS/,
      );
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("the file the tool writes when no --output is given", () => {
  it("is one git ignores, when the tool runs from the repo's top folder", () => {
    const repoTop = path.resolve(__dirname, "../../..");
    const { output } = setupCommander()
      .parse([
        "node",
        "crypto-price-filler",
        "--token=grc",
        "--input=mining.csv",
      ])
      .opts();
    const checked = spawnSync(
      "git",
      ["check-ignore", "-q", path.resolve(repoTop, output)],
      { cwd: repoTop },
    );
    expect(checked.status).toBe(0);
  });
});
