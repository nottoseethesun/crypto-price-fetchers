/**
 * Tests of the bugs known in the repo's code, each declared with `it.fails`.
 * @module tests/known-bugs.test
 *
 * Each test checks the behavior the code should have, so it fails while
 * the bug is there, and `it.fails` turns that failure into a pass. A fix
 * makes the test pass, so `it.fails` fails it: the same change declares the
 * test with `it` and moves it to `regressions-command-line.test.js` for the
 * repo's command lines, to `regressions-lib.test.js` for the repo's
 * shared helpers in `lib/`, to `regressions-sheets.test.js` for a test
 * that runs a Sheets script in the test's thread, or to
 * `regressions.test.js` for any other, and removes the bug's row from the
 * table in the repo's CLAUDE.md, which lists each test here.
 *
 * The Sheets scripts run unchanged in the test's thread, through
 * `tests/helpers/sheets-script.js`, with a stand-in for the Apps Script
 * service their tests are about: the script lock.
 * The test of the copy to the clipboard (`lib/clipboard.js`) runs it in a
 * child process, since its crash would fail the whole run.
 * The tests of the questions at the terminal (`lib/ask-line.js`) and of
 * the key store's password prompt (`api-key-store/ask-password.js`) run
 * them in the test's thread.
 * The tests of `bin/unlock-api-keys.sh` have bash run or source a copy of
 * it in a temp folder of the test's own, beside a stand-in key manager.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { PassThrough } from "stream";
import { pathToFileURL } from "url";
import { askLine } from "../../../lib/ask-line.js";
import { askPassword } from "../../../api-key-store/index.js";
import {
  CUSTOM_FUNCTION_LIMIT_MS,
  busyLockService,
  loadSheetsScript,
} from "./helpers/sheets-script.js";

/** The DexTools script, at the repo's top. */
const DEXTOOLS_SCRIPT = path.resolve(
  __dirname,
  "../../../crypto-price-fetchers/src/crypto-price-fetchers.gs",
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

describe("the build's helpers in lib/", () => {
  it.fails(
    "copyToClipboard rejects, naming the exit code, when the tool exits without reading its input",
    () => {
      const clipboard = pathToFileURL(
        path.resolve(__dirname, "../../../lib/clipboard.js"),
      ).href;
      const code = [
        `import { copyToClipboard } from ${JSON.stringify(clipboard)};`,
        "const tool = { command: process.execPath, args: ['-e', 'process.exit(1)'] };",
        "try {",
        "  await copyToClipboard(tool, 'x'.repeat(10000000));",
        "  console.log('resolved');",
        "} catch (error) {",
        "  console.log(`rejected: ${error.message}`);",
        "}",
      ].join("\n");
      const run = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", code],
        {
          encoding: "utf8",
        },
      );
      expect(run.stdout.trim()).toBe(
        `rejected: ${process.execPath} exited with code 1`,
      );
      expect(run.status).toBe(0);
    },
  );

  it.fails(
    "askLine gives each question its own line of the answers piped in together",
    async () => {
      const input = new PassThrough();
      const output = { write: () => true };
      input.write("n\ny\n");
      const first = await askLine("First? ", { input, output });
      const asked = askLine("Second? ", { input, output });
      input.end();
      const second = await asked;
      expect([first, second]).toEqual(["n", "y"]);
    },
  );

  it.fails(
    "askLine gives null at once to a question asked after the input has ended",
    async () => {
      const input = new PassThrough();
      const output = { write: () => true };
      const first = askLine("First? ", { input, output });
      input.end();
      expect(await first).toBe(null);
      let timer;
      const waited = new Promise((resolve) => {
        timer = setTimeout(resolve, 1000, "no answer after 1 second");
      });
      const second = await Promise.race([
        askLine("Second? ", { input, output }),
        waited,
      ]);
      clearTimeout(timer);
      expect(second).toBe(null);
    },
  );
});

describe("the key store's password prompt", () => {
  it.fails(
    "askPassword rejects at once a question asked after its input has ended",
    async () => {
      const input = new PassThrough();
      const output = { write: () => true };
      input.resume();
      input.end();
      await new Promise((resolve) => input.once("end", resolve));
      let timer;
      const waited = new Promise((resolve) => {
        timer = setTimeout(resolve, 1000, "no answer after 1 second");
      });
      const answer = await Promise.race([
        askPassword("Password: ", { input, output }).catch(
          (error) => error.message,
        ),
        waited,
      ]);
      clearTimeout(timer);
      expect(answer).toBe("The input ended before an answer was typed");
    },
  );
});

describe("bin/unlock-api-keys.sh", () => {
  /**
   * Runs a copy of the script in bash from the top folder of a temp
   * project, whose bin/ holds it beside a stand-in manage-api-keys.js that
   * takes or refuses any password, with the test's own empty password.
   *
   * @param {string[]} args - bash's arguments
   * @param {{input?: string, takes?: boolean, env?: Object<string, string>}} [run] - What is typed, whether the stand-in takes the password, and more of the environment
   * @returns {import("child_process").SpawnSyncReturns<string>} How it ended
   */
  function runUnlock(args, { input = "a password\n", takes = true, env } = {}) {
    const top = fs.mkdtempSync(path.join(os.tmpdir(), "unlock-"));
    try {
      fs.mkdirSync(path.join(top, "bin"));
      fs.copyFileSync(
        path.resolve(__dirname, "../../../bin/unlock-api-keys.sh"),
        path.join(top, "bin", "unlock-api-keys.sh"),
      );
      fs.writeFileSync(
        path.join(top, "bin", "manage-api-keys.js"),
        `process.exit(${takes ? 0 : 1});\n`,
      );
      return spawnSync("bash", args, {
        cwd: top,
        input,
        encoding: "utf8",
        env: { ...process.env, API_KEYS_PASSWORD: "", ...env },
      });
    } finally {
      fs.rmSync(top, { recursive: true, force: true });
    }
  }

  it.fails(
    "finds the project's top folder when CDPATH lists . and it is sourced as bin/unlock-api-keys.sh",
    () => {
      const run = runUnlock(["-c", "source bin/unlock-api-keys.sh"], {
        env: { CDPATH: `.:${os.tmpdir()}` },
      });
      expect(run.stderr).toContain(
        "API_KEYS_PASSWORD is set for this terminal.",
      );
    },
  );

  it.fails(
    "answers --help and -h with its help, run or sourced, asking nothing and keeping no password",
    () => {
      for (const flag of ["--help", "-h"]) {
        for (const args of [
          ["bin/unlock-api-keys.sh", flag],
          ["-c", 'source bin/unlock-api-keys.sh "$1"', "bash", flag],
        ]) {
          const run = runUnlock(args);
          expect(run.stdout).toMatch(
            /^Usage: source \.\/bin\/unlock-api-keys\.sh \[options\]\n/,
          );
          expect(run.stderr).toBe("");
          expect(run.status).toBe(0);
        }
      }
    },
  );

  it.fails("ends with exit code 1 when it keeps no password", () => {
    for (const input of ["a wrong password\n", "\n"]) {
      const run = runUnlock(["-c", "source bin/unlock-api-keys.sh"], {
        input,
        takes: false,
      });
      expect(run.status).toBe(1);
    }
  });
});
