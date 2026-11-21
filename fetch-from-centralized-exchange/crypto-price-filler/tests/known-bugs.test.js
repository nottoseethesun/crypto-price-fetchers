/**
 * Tests of the bugs known in the repo's code, each declared with `it.fails`.
 * @module tests/known-bugs.test
 *
 * Each test checks the behavior the code should have, so it fails while
 * the bug is there, and `it.fails` turns that failure into a pass. A fix
 * makes the test pass, so `it.fails` fails it: the same change declares the
 * test with `it` and moves it to `regressions.test.js`, and removes the
 * bug's row from the table in the repo's CLAUDE.md, which lists each test
 * here.
 *
 * The Sheets scripts run unchanged in the test's thread, through
 * `tests/helpers/sheets-script.js`, with a stand-in for the Apps Script
 * service each test is about: the script lock. The command lines run as
 * their owner runs them: `index.js` in a child process, and `backfill.js`'s
 * command parsed here, with its config.json read from a stand-in that
 * leaves every other file to the real `fs`.
 */

import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { loadSheetsScript } from "./helpers/sheets-script.js";
import { runBackfill, setupBackfillCommander } from "../backfill.js";

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

/** crypto-price-filler's entry point. */
const FILLER_INDEX = path.resolve(__dirname, "../index.js");

/** A CSV of three rows, the second with no price, for backfill to fill. */
const CSV_WITH_A_GAP = `"date (UTC)","amount","$usd price","$usd amount","grand total ($usd)"
"2024-01-01 12:00:00","10","100","1000","1000"
"2024-01-02 12:00:00","20","","","1000"
"2024-01-03 12:00:00","15","200","3000","4000"
`;

/**
 * Whether a file is crypto-price-filler's config.json, however it is named:
 * a path or a file url.
 *
 * @param {string|URL} file - The file
 * @returns {boolean} Whether it is
 */
function isOwnConfig(file) {
  return /crypto-price-filler[\\/]config\.json$/.test(String(file));
}

describe("crypto-price-filler's command line", () => {
  it.fails(
    "refuses a --mode it does not know as commander refuses a wrong value, naming --mode, with no stack trace",
    () => {
      const run = spawnSync(
        process.execPath,
        [FILLER_INDEX, "--token", "grc", "--input", "x.csv", "--mode", "bogus"],
        { cwd: os.tmpdir(), encoding: "utf8", timeout: 30000 },
      );
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(
        "option '--mode <mode>' argument 'bogus' is invalid",
      );
      expect(run.stderr).not.toMatch(/\n\s+at /);
    },
  );
});

describe("backfill.js's command line", () => {
  it.fails(
    "takes BACKFILL_HIGHEST from config.json when neither backfill flag is given",
    async () => {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-config-"));
      const input = path.join(folder, "prices.csv");
      fs.writeFileSync(input, CSV_WITH_A_GAP);
      const realReadFileSync = fs.readFileSync;
      const realExistsSync = fs.existsSync;
      vi.spyOn(fs, "readFileSync").mockImplementation((file, ...rest) =>
        isOwnConfig(file)
          ? JSON.stringify({ BACKFILL_HIGHEST: true })
          : realReadFileSync(file, ...rest),
      );
      vi.spyOn(fs, "existsSync").mockImplementation(
        (file) => isOwnConfig(file) || realExistsSync(file),
      );
      vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const options = setupBackfillCommander()
          .parse(["node", "backfill.js", "--input", input])
          .opts();
        const stats = await runBackfill(options);
        expect(stats.emptyRowsFilled).toBe(1);
      } finally {
        vi.restoreAllMocks();
        fs.rmSync(folder, { recursive: true, force: true });
      }
    },
  );
});
