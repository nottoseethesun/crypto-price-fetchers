/**
 * Tests that guard fixed bugs in crypto-price-filler's two command lines,
 * `index.js` and `backfill.js`: their checks of a value and the settings
 * they fall back to. The other fixed bugs' tests are in
 * `regressions.test.js`; a bug found later gets its test in
 * `known-bugs.test.js`, declared with `it.fails` while the bug is there,
 * and its fix moves the test to one of the two (see the repo's CLAUDE.md).
 * @module tests/regressions-command-line.test
 *
 * `index.js` runs as its owner runs it, in a child process; its command,
 * and `backfill.js`'s, are also parsed here, in the test's thread, and
 * `backfill.js` backfills a CSV in a temp folder of the test's own, with
 * the settings the test gives it.
 */

import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { runBackfill, setupBackfillCommander } from "../backfill.js";
import { setupCommander } from "../commander.js";
import { backfillChoice } from "../utils/backfill.js";

/** crypto-price-filler's folder. */
const FILLER_DIR = path.resolve(__dirname, "..");

/** A CSV of three rows, the second with no price, for backfill to fill. */
const CSV_WITH_A_GAP = `"date (UTC)","amount","$usd price","$usd amount","grand total ($usd)"
"2024-01-01 12:00:00","10","100","1000","1000"
"2024-01-02 12:00:00","20","","","1000"
"2024-01-03 12:00:00","15","200","3000","4000"
`;

describe("crypto-price-filler's command line", () => {
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
