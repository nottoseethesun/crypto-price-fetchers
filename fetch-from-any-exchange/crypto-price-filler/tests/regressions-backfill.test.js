/**
 * Tests that guard fixed bugs in backfill's command line, `backfill.js`,
 * the second of crypto-price-filler's two command lines: its options and
 * the settings it falls back to, and its flags set against each other.
 * Those of the first, `index.js`, and of the code the two share, are in
 * `regressions-command-line.test.js`, and the repo's `docs/engineering.md` (Known Bugs)
 * lists the other files of fixed bugs' tests; a bug found later gets its
 * test in `known-bugs.test.js`, declared with `it.fails` while the bug is
 * there, and its fix moves the test to one of them.
 * @module tests/regressions-backfill.test
 *
 * `backfill.js` backfills a CSV in a temp folder of the test's own, with
 * the settings the test gives it, in the test's thread or, through
 * `backfillIn` (`helpers/regression-runs.js`), as backfill's command line,
 * in a child process; its command is also parsed here, in the test's
 * thread.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runBackfill, setupBackfillCommander } from "../backfill.js";
import { backfillIn, CSV_WITH_A_GAP } from "./helpers/regression-runs.js";
import { logLines } from "./helpers/log-lines.js";

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
