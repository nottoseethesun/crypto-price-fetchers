/**
 * Tests that guard fixed bugs in the repo's command lines other than
 * crypto-price-filler's two: the Sheets scripts' Node versions', with
 * their checks of a value before a key is opened, the exchange script's
 * settings, a start without `.js`, and the words they do not take; the
 * Summ csv utility's; the key manager's; and `bin/unlock-api-keys.sh`,
 * which finds the project's folder whatever `CDPATH` lists or the shell's
 * `cd` or `pwd` prints, answers `--help`, and returns 1 when it keeps no
 * password.
 * crypto-price-filler's are in `regressions-command-line.test.js` and
 * `regressions-backfill.test.js`, and
 * the repo's CLAUDE.md lists the other files of fixed bugs' tests; a bug
 * found later gets its test in `known-bugs.test.js`, declared with
 * `it.fails` while the bug is there, and its fix moves the test to one of
 * them.
 * @module tests/regressions-other-command-lines.test
 *
 * The Node versions' command lines, the key manager and the Summ csv
 * utility's run in the test's thread, with a stand-in fetch, stand-in
 * streams and files in a temp folder of the test's own; a Node version
 * started without `.js` runs in a child process. The tests of
 * `bin/unlock-api-keys.sh` have bash run or source a copy of it in the
 * `bin/` of a temp folder of the test's own, whose `bin/end-user/` holds a
 * stand-in key manager.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { SUMM_TEMPLATE } from "./helpers/regression-runs.js";
import { saveEncryptedKey } from "../../../api-key-store/key-file.js";
import { runKeyManager } from "../../../api-key-store/key-manager.js";
import { runCommandLine as runPriceNowCommandLine } from "../../../bin/end-user/crypto-price-fetchers.js";
import {
  readCentralizedExchangeConfig,
  runCommandLine as runPastPriceCommandLine,
} from "../../../bin/end-user/getCryptoPriceFromCentralizedExchange.js";
import { runSummCsv } from "../../../summ-csv/command-line.js";

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

describe("npm run summ-csv", () => {
  it("npm run summ-csv refuses a folder as --out, naming --out, before it reads the rows", () => {
    const top = fs.mkdtempSync(path.join(os.tmpdir(), "summ-csv-"));
    try {
      fs.mkdirSync(path.join(top, "csv"));
      fs.writeFileSync(path.join(top, "rows.json"), "not json");
      let stderr = "";
      const exitCode = runSummCsv(
        [
          "node",
          "bin/summ-csv.js",
          "--rows",
          path.join(top, "rows.json"),
          "--template",
          SUMM_TEMPLATE,
          "--out",
          path.join(top, "csv"),
          "--replace",
        ],
        {
          stdout: { write: () => true },
          stderr: { write: (text) => (stderr += text) },
        },
      );
      expect(exitCode).toBe(1);
      expect(stderr).toBe(
        `error: option '--out <file>' argument '${path.join(top, "csv")}' is invalid. It is a folder, not a file.\n`,
      );
      expect(fs.readdirSync(top).sort()).toEqual(["csv", "rows.json"]);
    } finally {
      fs.rmSync(top, { recursive: true, force: true });
    }
  });

  it("npm run summ-csv refuses a word it does not take, writing nothing", () => {
    const top = fs.mkdtempSync(path.join(os.tmpdir(), "summ-csv-"));
    try {
      fs.writeFileSync(path.join(top, "rows.json"), "[]");
      let stderr = "";
      const exitCode = runSummCsv(
        [
          "node",
          "bin/summ-csv.js",
          "--rows",
          path.join(top, "rows.json"),
          "--template",
          SUMM_TEMPLATE,
          "--out",
          path.join(top, "out.csv"),
          "extra",
        ],
        {
          stdout: { write: () => true },
          stderr: { write: (text) => (stderr += text) },
        },
      );
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/^error: too many arguments/);
      expect(fs.readdirSync(top)).toEqual(["rows.json"]);
    } finally {
      fs.rmSync(top, { recursive: true, force: true });
    }
  });
});

describe("the Node versions of the Sheets scripts", () => {
  it("answer --help when node is started with the file's name without .js", () => {
    const run = spawnSync(
      process.execPath,
      ["bin/end-user/crypto-price-fetchers", "--help"],
      { cwd: path.resolve(__dirname, "../../.."), encoding: "utf8" },
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/^Usage: crypto-price-fetchers /);
  });
});

describe("the key manager's command line", () => {
  it("refuses a command it does not know, asking for no key", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "key-manager-"));
    try {
      fs.writeFileSync(
        path.join(folder, "config.json"),
        JSON.stringify({ apiKeys: ["dextools"] }),
      );
      let stderr = "";
      const asked = [];
      const exitCode = await runKeyManager(
        ["node", "bin/end-user/manage-api-keys.js", "chek-password"],
        { projectTop: folder },
        {
          env: { API_KEYS_FILE_PATH: path.join(folder, "api-keys.json") },
          ask: async (prompt) => {
            asked.push(prompt);
            return "";
          },
          stdout: { write: () => true },
          stderr: { write: (text) => (stderr += text) },
        },
      );
      expect(asked).toEqual([]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/^error: too many arguments/);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("the Node versions' stray words", () => {
  it("a Node version refuses a word past its command's arguments, asking nothing", async () => {
    let stderr = "";
    let asked = 0;
    const exitCode = await runPastPriceCommandLine(
      ["node", "x", "btc", "2025-06-15 12:30:00", "extra"],
      {
        fetch: async () => {
          asked += 1;
          return new Response("{}", { status: 404 });
        },
        stdout: { write: () => true },
        stderr: { write: (text) => (stderr += text) },
      },
    );
    expect(asked).toBe(0);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/^error: too many arguments\./);
  });

  it("the current-price script's Node version refuses a word past price's or fdv's arguments, asking nothing", async () => {
    for (const command of ["price", "fdv"]) {
      let stderr = "";
      let asked = 0;
      const exitCode = await runPriceNowCommandLine(
        [
          "node",
          "x",
          command,
          "ether",
          "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          "extra",
        ],
        {
          fetch: async () => {
            asked += 1;
            return new Response("{}", { status: 404 });
          },
          stdout: { write: () => true },
          stderr: { write: (text) => (stderr += text) },
        },
      );
      expect(asked, command).toBe(0);
      expect(exitCode, command).toBe(1);
      expect(stderr, command).toMatch(
        `error: too many arguments for '${command}'.`,
      );
    }
  });
});

describe("bin/unlock-api-keys.sh", () => {
  /**
   * Runs a copy of the script in bash from the top folder of a temp
   * project, whose bin/ holds it, and whose bin/end-user/ a stand-in
   * manage-api-keys.js that takes or refuses any password, with the
   * test's own empty password.
   *
   * @param {string[]} args - bash's arguments
   * @param {{input?: string, takes?: boolean, env?: Object<string, string>}} [run] - What is typed, whether the stand-in takes the password, and more of the environment
   * @returns {import("child_process").SpawnSyncReturns<string>} How it ended
   */
  function runUnlock(args, { input = "a password\n", takes = true, env } = {}) {
    const top = fs.mkdtempSync(path.join(os.tmpdir(), "unlock-"));
    try {
      fs.mkdirSync(path.join(top, "bin", "end-user"), { recursive: true });
      fs.copyFileSync(
        path.resolve(__dirname, "../../../bin/unlock-api-keys.sh"),
        path.join(top, "bin", "unlock-api-keys.sh"),
      );
      fs.writeFileSync(
        path.join(top, "bin", "end-user", "manage-api-keys.js"),
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

  it("finds the project's top folder when CDPATH lists . and it is sourced as bin/unlock-api-keys.sh", () => {
    const run = runUnlock(["-c", "source bin/unlock-api-keys.sh"], {
      env: { CDPATH: `.:${os.tmpdir()}` },
    });
    expect(run.stderr).toContain("API_KEYS_PASSWORD is set for this terminal.");
  });

  it("answers --help and -h with its help, run or sourced, asking nothing and keeping no password", () => {
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
  });

  it("ends with exit code 1 when it keeps no password", () => {
    for (const input of ["a wrong password\n", "\n"]) {
      const run = runUnlock(["-c", "source bin/unlock-api-keys.sh"], {
        input,
        takes: false,
      });
      expect(run.status).toBe(1);
    }
  });
});

describe("bin/unlock-api-keys.sh in bash", () => {
  it("finds the project's top folder when the shell's pwd prints more than the folder", () => {
    const top = fs.mkdtempSync(path.join(os.tmpdir(), "unlock-"));
    try {
      fs.mkdirSync(path.join(top, "bin", "end-user"), { recursive: true });
      fs.copyFileSync(
        path.resolve(__dirname, "../../../bin/unlock-api-keys.sh"),
        path.join(top, "bin", "unlock-api-keys.sh"),
      );
      fs.writeFileSync(
        path.join(top, "bin", "end-user", "manage-api-keys.js"),
        "process.exit(0);\n",
      );
      const run = spawnSync(
        "bash",
        [
          "-c",
          'pwd() { echo "now in"; builtin pwd; }; source bin/unlock-api-keys.sh',
        ],
        {
          cwd: top,
          input: "a password\n",
          encoding: "utf8",
        },
      );
      expect(run.stderr).toContain(
        `Password for the api keys of ${path.basename(top)}: `,
      );
      expect(run.stderr).toContain(
        "API_KEYS_PASSWORD is set for this terminal.",
      );
    } finally {
      fs.rmSync(top, { recursive: true, force: true });
    }
  });

  it("finds the project's top folder when the shell's cd prints", () => {
    const top = fs.mkdtempSync(path.join(os.tmpdir(), "unlock-"));
    try {
      fs.mkdirSync(path.join(top, "bin", "end-user"), { recursive: true });
      fs.copyFileSync(
        path.resolve(__dirname, "../../../bin/unlock-api-keys.sh"),
        path.join(top, "bin", "unlock-api-keys.sh"),
      );
      fs.writeFileSync(
        path.join(top, "bin", "end-user", "manage-api-keys.js"),
        "process.exit(0);\n",
      );
      const run = spawnSync(
        "bash",
        [
          "-c",
          'cd() { builtin cd "$@" && echo "now in $PWD"; }; source bin/unlock-api-keys.sh',
        ],
        {
          cwd: top,
          input: "a password\n",
          encoding: "utf8",
        },
      );
      expect(run.stderr).toContain(
        "API_KEYS_PASSWORD is set for this terminal.",
      );
    } finally {
      fs.rmSync(top, { recursive: true, force: true });
    }
  });
});
