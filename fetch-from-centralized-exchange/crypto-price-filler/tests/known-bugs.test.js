/**
 * Tests of the bugs known in the repo's code, each declared with `it.fails`.
 * @module tests/known-bugs.test
 *
 * Each test checks the behavior the code should have, so it fails while
 * the bug is there, and `it.fails` turns that failure into a pass. A fix
 * makes the test pass, so `it.fails` fails it: the same change declares the
 * test with `it` and moves it to `regressions-command-line.test.js` for the
 * filler's command lines, to `regressions-lib.test.js` for the repo's
 * shared helpers in `lib/`, to `regressions-sheets.test.js` for a test
 * that runs a Sheets script in the test's thread, or to
 * `regressions.test.js` for any other, and removes the bug's row from the
 * table in the repo's CLAUDE.md, which lists each test here.
 *
 * The Sheets scripts run unchanged in the test's thread, through
 * `tests/helpers/sheets-script.js`, with a stand-in for the Apps Script
 * service each test is about: the script lock. The command lines run in
 * the test's own process, with a stand-in fetch and a key file in a temp
 * folder of the test's own.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { saveEncryptedKey } from "../../../api-key-store/key-file.js";
import { runCommandLine as runPriceNowCommandLine } from "../../../crypto-price-fetchers.js";
import { summCsvText } from "../../../summ-csv/index.js";
import {
  readCentralizedExchangeConfig,
  runCommandLine as runPastPriceCommandLine,
} from "../../getCryptoPriceFromCentralizedExchange.js";
import {
  CUSTOM_FUNCTION_LIMIT_MS,
  busyLockService,
  loadSheetsScript,
} from "./helpers/sheets-script.js";

/** The DexTools script, at the repo's top. */
const DEXTOOLS_SCRIPT = path.resolve(
  __dirname,
  "../../../crypto-price-fetchers.gs",
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
  it.fails(
    "getCryptoPriceFromCentralizedExchange.js names --tz or the date, before it opens a key, for a time zone the script does not know or a day the calendar does not have",
    async () => {
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
    },
  );

  it.fails(
    "crypto-price-fetchers.js refuses a run on x1 with no --pool, naming it, before it asks anything",
    async () => {
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
    },
  );

  it.fails(
    "refuses a config.json that sets the exchange script's GENERAL_DELAY_MS to 0, with which a call takes no lock",
    () => {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), "past-price-"));
      const file = path.join(folder, "config.json");
      fs.writeFileSync(
        file,
        JSON.stringify({ CONFIG: { GENERAL_DELAY_MS: 0 } }),
      );
      try {
        expect(() => readCentralizedExchangeConfig(file)).toThrow(
          /GENERAL_DELAY_MS/,
        );
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    },
  );
});

describe("the Summ csv utility's times", () => {
  it.fails(
    "refuses a time past 9999-12-31, as a time in milliseconds given for seconds is, rather than write a timestamp Summ cannot read",
    () => {
      const header = fs
        .readFileSync(
          path.resolve(__dirname, "../../../test/fixtures/summ-template.csv"),
          "utf8",
        )
        .split(/\r?\n/)[0];
      const row = (timestamp) => ({
        timestamp,
        type: "income",
        baseCurrency: "HEX",
        baseAmount: "1.5",
        from: `0x${"11".repeat(20)}`,
        to: `0x${"22".repeat(20)}`,
        blockchain: "pulsechain",
        id: `0x${"ab".repeat(32)}`,
        contractAddress: `0x${"33".repeat(20)}`,
      });
      expect(summCsvText([row(1763800000)], header)).toContain(
        "2025-11-22 08:26:40",
      );
      expect(() => summCsvText([row(1763800000000)], header)).toThrow(
        /Timestamp/,
      );
      expect(() => summCsvText([row(253402300800)], header)).toThrow(
        /Timestamp/,
      );
    },
  );
});
