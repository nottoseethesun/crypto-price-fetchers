/**
 * Tests that guard fixed bugs in backfill's command line, `backfill.js`,
 * the second of crypto-price-filler's two command lines: its options and
 * the settings it falls back to, how it fills the rows that hold no data,
 * and its flags set against each other. Those of the first, `index.js`,
 * are in `regressions-command-line.test.js`, and the repo's CLAUDE.md
 * lists the other files of fixed bugs' tests; a bug found later gets its
 * test in `known-bugs.test.js`, declared with `it.fails` while the bug is
 * there, and its fix moves the test to one of them.
 * @module tests/regressions-backfill.test
 *
 * `backfill.js` backfills a CSV in a temp folder of the test's own, with
 * the settings the test gives it, in the test's thread or, through
 * `backfillIn` (`helpers/regression-runs.js`), as backfill's command line,
 * in a child process; its command is also parsed here, in the test's
 * thread. A test of the flags set against each other also runs
 * crypto-price-filler's command line, through `runIndexIn`, on a CSV of
 * one row.
 */

import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runBackfill, setupBackfillCommander } from "../backfill.js";
import { backfillPrices } from "../utils/backfill.js";
import {
  backfillIn,
  CSV_WITH_A_GAP,
  runIndexIn,
} from "./helpers/regression-runs.js";
import { logLines } from "./helpers/log-lines.js";

let folder;

beforeAll(() => {
  folder = fs.mkdtempSync(
    path.join(os.tmpdir(), "crypto-price-filler-backfill-"),
  );
  fs.writeFileSync(
    path.join(folder, "in.csv"),
    "date (UTC),amount,description\n2025-06-15 12:30:00,10,one XTM reward\n",
  );
});

afterAll(() => {
  fs.rmSync(folder, { recursive: true, force: true });
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

describe("backfill flags set against each other", () => {
  it.each([
    [
      "a flag typed against the other's setting",
      ["--backfill-lowest"],
      '{"BACKFILL_HIGHEST": true}',
      "option '--backfill-highest' (set in config.json) cannot be used with option '--backfill-lowest'",
    ],
    [
      "the two flags typed together",
      ["--backfill-highest", "--backfill-lowest"],
      "{}",
      "option '--backfill-highest' cannot be used with option '--backfill-lowest'",
    ],
    [
      "the two settings both true",
      [],
      '{"BACKFILL_HIGHEST": true, "BACKFILL_LOWEST": true}',
      "option '--backfill-highest' (set in config.json) cannot be used with option '--backfill-lowest' (set in config.json)",
    ],
  ])(
    "backfill's command line refuses %s, naming both, with the file left as it was",
    (_, args, settings, refusal) => {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-flags-"));
      try {
        const { run, left } = backfillIn(folder, args, settings);
        expect(run.stderr).toContain(refusal);
        expect(run.status).toBe(1);
        expect(left).toBe(CSV_WITH_A_GAP);
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    },
  );

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

  it.each([
    [["--backfill-lowest"], '{"BACKFILL_LOWEST": true}', "100"],
    [[], '{"BACKFILL_HIGHEST": true}', "200"],
  ])(
    "backfill's command line takes the flags %j with the settings %s, filling the gap with %s",
    (args, settings, price) => {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-flags-"));
      try {
        const { run, left } = backfillIn(folder, args, settings);
        expect(run.status).toBe(0);
        expect(left).toContain(`2024-01-02 12:00:00,20,${price},`);
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    },
  );
});
