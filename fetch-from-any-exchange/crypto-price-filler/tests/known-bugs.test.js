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
 * The exchange script runs unchanged in the test's thread, through
 * `tests/helpers/sheets-script.js`, against a stand-in MEXC. The link check
 * of `lib/repo-checks.js` reads a repo made for the test in a temp folder,
 * whose file git keeps. The command line runs in a child process with the
 * stand-in fetch and settings preloads (`helpers/regression-runs.js`).
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSheetsScript } from "./helpers/sheets-script.js";
import {
  ROW_UTC_MS,
  SHEETS_SCRIPT_PATH,
  answerMexcCandle,
  cellTime,
  runIndexIn,
} from "./helpers/regression-runs.js";
import { localReferencesMissing } from "../../../lib/repo-checks.js";

/** What a cell shows when it names no token as text. */
const INVALID_TOKEN =
  'Invalid token: give the coin\'s symbol as text, such as "btc"';

describe("getCryptoPrice's token", () => {
  it.fails("gives a message, not an error, when the token is not text", () => {
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, answerMexcCandle);
    expect(
      script.getCryptoPrice(42, cellTime(ROW_UTC_MS), "UTC", "close", 0),
    ).toBe(INVALID_TOKEN);
  });
});

describe("the link check of lib/repo-checks.js", () => {
  it.fails(
    "takes no link from a code span, which Markdown shows as code",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "known-bug-span-"));
      try {
        fs.writeFileSync(
          path.join(dir, "README.md"),
          "# A repo\n\nA link is written as `[text](target)`.\n",
        );
        spawnSync("git", ["init", "-q"], { cwd: dir });
        spawnSync("git", ["add", "README.md"], { cwd: dir });
        expect(localReferencesMissing(dir)).toEqual([]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("crypto-price-filler's date column", () => {
  it.fails(
    'is the first whose name holds "date", in any letter case, and "UTC", before an earlier column of dates',
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "known-bug-date-"));
      try {
        const input = path.join(dir, "in.csv");
        fs.writeFileSync(
          input,
          "Date (local),Date (UTC),amount\n2025-06-15 07:30:00,2025-06-15 12:30:00,10\n",
        );
        const run = runIndexIn(dir, [
          "--token=xtm",
          `--input=${input}`,
          `--output=${path.join(dir, "out.csv")}`,
        ]);
        expect(run.stdout).toContain('Using date column: "Date (UTC)"');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
