/**
 * Tests that guard fixed bugs in crypto-price-filler's command line,
 * `index.js`, and in what it shares with backfill's, `backfill.js`: their
 * checks of a value, the settings they fall back to, a backfill flag typed
 * against the other's setting, how a settings file or token list they
 * cannot take ends a run, how they fill the rows that hold no data, what
 * `index.js` logs, the column of dates it reads, and the exit code a run
 * ends with. Those of
 * backfill's alone are in `regressions-backfill.test.js`; the repo's
 * other command lines' are in `regressions-other-command-lines.test.js`,
 * and the repo's CLAUDE.md lists the other files of fixed bugs' tests; a
 * bug found later gets its test in `known-bugs.test.js`, declared with
 * `it.fails` while the bug is there, and its fix moves the test to one of
 * them.
 * @module tests/regressions-command-line.test
 *
 * The command line, `bin/end-user/crypto-price-filler.js`, which loads `index.js`,
 * runs as its owner runs it, in a child process, given a settings file or
 * token list of the test's own through the preload
 * `helpers/stand-in-settings-preload.js`, a stand-in fetch through
 * `helpers/stand-in-fetch-preload.js`, and, for one test, a full disk
 * through `helpers/full-disk-preload.js`; its command, and `backfill.js`'s,
 * are also parsed here, in the test's thread; `backfillPrices`
 * (`utils/backfill.js`), which both command lines run, fills rows in the
 * test's thread; and backfill's command line, run through `backfillIn`
 * (`helpers/regression-runs.js`) in a child process, is refused an
 * `--output` in a folder that does not exist.
 */

import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { setupBackfillCommander } from "../backfill.js";
import { parseTimeZone, setupCommander } from "../commander.js";
import { backfillChoice, backfillPrices } from "../utils/backfill.js";
import {
  backfillIn,
  runCommandLine,
  runIndexIn,
} from "./helpers/regression-runs.js";

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
 * Runs the command line, `bin/end-user/crypto-price-filler.js`, from the test's temp
 * folder, with the settings file or token list given in place of the tool's
 * own.
 *
 * @param {string[]} args - Its arguments
 * @param {Object<string, string>} standIns - As the settings preload takes them
 * @returns {{status: number, stdout: string, stderr: string}} How it ended
 */
function runIndex(args, standIns) {
  return runIndexIn(folder, args, standIns);
}

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
      /^Error: \S*fetch-from-any-exchange[/\\]config\.json is not valid JSON: /,
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

describe("the check that the command line loads", () => {
  it("validate-parse fails when node exits with code 1, as it does when the command line cannot load", () => {
    const scripts = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
    ).scripts;
    const command = scripts["validate-parse"].replace(
      "node ../../bin/end-user/crypto-price-filler.js --help",
      'node -e "process.exit(1)"',
    );
    expect(command).not.toBe(scripts["validate-parse"]);
    const run = spawnSync("sh", ["-c", command], { encoding: "utf8" });
    expect(run.status).not.toBe(0);
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

describe("crypto-price-filler's exit code", () => {
  it("is 1, not 0, when the program reading its log stops before the file is written", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "filler-log-"));
    try {
      const input = path.join(folder, "in.csv");
      const output = path.join(folder, "out.csv");
      fs.writeFileSync(input, "date (UTC),amount\n2025-06-15 10:30:00,1\n");
      const child = spawn(
        process.execPath,
        [
          "--import",
          path.join(__dirname, "helpers/stand-in-fetch-preload.js"),
          path.resolve(
            __dirname,
            "../../../bin/end-user/crypto-price-filler.js",
          ),
          "--token=xtm",
          `--input=${input}`,
          `--output=${output}`,
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      child.stdout.destroy();
      const exitCode = await new Promise((resolve) =>
        child.on("exit", resolve),
      );
      expect(fs.existsSync(output)).toBe(false);
      expect(exitCode).toBe(1);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("crypto-price-filler's output file", () => {
  it("names the file and the error, with exit code 1 and no stack trace, when it cannot write it", () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "filler-full-disk-"));
    try {
      fs.writeFileSync(
        path.join(folder, "in.csv"),
        "date (UTC),amount,description\n2025-06-15 12:30:00,10,one XTM reward\n",
      );
      const output = path.join(folder, "out.csv");
      const run = spawnSync(
        process.execPath,
        [
          "--import",
          path.join(__dirname, "helpers/stand-in-settings-preload.js"),
          "--import",
          path.join(__dirname, "helpers/stand-in-fetch-preload.js"),
          "--import",
          path.join(__dirname, "helpers/full-disk-preload.js"),
          path.resolve(
            __dirname,
            "../../../bin/end-user/crypto-price-filler.js",
          ),
          "--token=xtm",
          "--input=in.csv",
          `--output=${output}`,
        ],
        {
          cwd: folder,
          env: {
            ...process.env,
            STAND_IN_FILLER_TOKENS: XTM_WITHOUT_COINGECKO,
          },
          encoding: "utf8",
          timeout: 30000,
        },
      );
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(
        `Error: ${output} could not be written: ENOSPC: no space left on device, write '${output}'`,
      );
      expect(run.stderr).not.toMatch(/\n\s+at /);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("the --output of crypto-price-filler and of backfill", () => {
  it.each(["crypto-price-filler", "backfill"])(
    "%s refuses a file in a folder that does not exist, naming --output, before it reads its input",
    (tool) => {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), "filler-output-"));
      try {
        const input = path.join(folder, "in.csv");
        fs.writeFileSync(input, "date (UTC),amount\n2025-06-15 10:30:00,1\n");
        const missing = path.join(folder, "no-such-folder");
        const output = path.join(missing, "out.csv");
        const run =
          tool === "backfill"
            ? backfillIn(folder, [`--output=${output}`], "{}").run
            : runCommandLine([
                "--token=xtm",
                `--input=${input}`,
                `--output=${output}`,
              ]);
        expect(run.status).toBe(1);
        expect(run.stderr).toBe(
          `error: option '--output <path>' argument '${output}' is invalid. Its folder, ${missing}, does not exist.\n`,
        );
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    },
  );
});

describe("crypto-price-filler's --tz", () => {
  it("takes a zone's current name, as the zone the list spells, and still refuses an abbreviation", () => {
    expect(parseTimeZone("Asia/Kolkata")).toBe("Asia/Calcutta");
    expect(parseTimeZone("Europe/Kyiv")).toBe("Europe/Kiev");
    expect(() => parseTimeZone("EST")).toThrow(/not a valid time zone/);
  });
});

describe("crypto-price-filler's stray words", () => {
  it("crypto-price-filler and backfill refuse a word they do not take", () => {
    const quiet = (command) =>
      command.exitOverride().configureOutput({ writeErr: () => {} });
    expect(() =>
      quiet(setupCommander()).parse(
        ["--token=xtm", "--input=in.csv", "backfill-highest"],
        { from: "user" },
      ),
    ).toThrow(/too many arguments/);
    expect(() =>
      quiet(setupBackfillCommander()).parse(["--input=in.csv", "highest"], {
        from: "user",
      }),
    ).toThrow(/too many arguments/);
  });
});

describe("crypto-price-filler's date column", () => {
  it('is the first whose name holds "date", in any letter case, and "UTC", before an earlier column of dates', () => {
    const input = path.join(folder, "two-date-columns.csv");
    fs.writeFileSync(
      input,
      "Date (local),Date (UTC),amount\n2025-06-15 07:30:00,2025-06-15 12:30:00,10\n",
    );
    const run = runIndex([
      "--token=xtm",
      `--input=${input}`,
      `--output=${path.join(folder, "two-date-columns-out.csv")}`,
    ]);
    expect(run.stdout).toContain('Using date column: "Date (UTC)"');
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

describe("the filler's backfill flags set against each other", () => {
  it("the filler's command line refuses a flag typed against the other's setting, naming both, writing no file", () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "filler-flags-"));
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
  });
});
