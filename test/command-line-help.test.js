/**
 * Tests that every command line in the repo answers `--help`, and `-h`, as
 * the repo's CLAUDE.md asks: its options, then examples of its common uses,
 * then its exit codes.
 * @module test/command-line-help.test
 *
 * Each command line runs in a child process, from the repo's top folder,
 * with an empty password and a key file that does not exist, so none can
 * reach the owner's keys; a help is printed before anything is opened or
 * asked. `COMMAND_LINES` lists every command line, each subcommand on its
 * own. A second test holds the list to the repo: every npm target and bin
 * that runs a JavaScript file, and every file that declares a command with
 * commander, must be in it, so a command line added later is held to the
 * rule as well.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The repo's top folder. */
const REPO_TOP = fileURLToPath(new URL("..", import.meta.url));

/** The folder of crypto-price-filler, a package of its own. */
const FILLER = "fetch-from-centralized-exchange/crypto-price-filler";

/**
 * Every command line: the file node runs, and the subcommand, if any, whose
 * help is asked for.
 */
const COMMAND_LINES = Object.freeze([
  { file: "build.js", command: [] },
  { file: "build.js", command: ["apps-script"] },
  { file: "manage-api-keys.js", command: [] },
  { file: "manage-api-keys.js", command: ["set"] },
  { file: "manage-api-keys.js", command: ["check-password"] },
  { file: "summ-csv.js", command: [] },
  { file: "github-project-deps.js", command: [] },
  { file: "audit-dex-screener.js", command: [] },
  { file: "crypto-price-fetchers.js", command: [] },
  { file: "crypto-price-fetchers.js", command: ["price"] },
  { file: "crypto-price-fetchers.js", command: ["fdv"] },
  {
    file: "fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js",
    command: [],
  },
  { file: `${FILLER}/index.js`, command: [] },
  { file: `${FILLER}/backfill.js`, command: [] },
]);

/**
 * The modules that declare a command for a command line run from another
 * file, by the file node runs.
 */
const COMMAND_MODULES = Object.freeze({
  "apps-script-build/index.js": "build.js",
  "apps-script-build/dex-screener-files.js": "audit-dex-screener.js",
  "api-key-store/key-manager.js": "manage-api-keys.js",
  "summ-csv/command-line.js": "summ-csv.js",
  "github-project-deps/index.js": "github-project-deps.js",
  "apps-script-runner/command-line.js": "crypto-price-fetchers.js",
  "apps-script-runner/index.js": "crypto-price-fetchers.js",
  [`${FILLER}/commander.js`]: `${FILLER}/index.js`,
});

/** The folders the search for commander's users passes over. */
const NOT_SEARCHED = new Set([
  "node_modules",
  "coverage",
  "build",
  ".git",
  "test",
  "tests",
]);

/**
 * Runs a command line's help in a child process.
 *
 * @param {{file: string, command: string[]}} commandLine - The command line
 * @param {string} flag - `--help` or `-h`
 * @returns {{status: number, stdout: string, stderr: string}} How it ended and what it printed
 */
function helpOf({ file, command }, flag) {
  const run = spawnSync(process.execPath, [file, ...command, flag], {
    cwd: REPO_TOP,
    encoding: "utf8",
    timeout: 30000,
    env: {
      ...process.env,
      API_KEYS_PASSWORD: "",
      API_KEYS_FILE_PATH: path.join(
        os.tmpdir(),
        "command-line-help-no-key-file.json",
      ),
    },
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/**
 * The JavaScript files an npm target or a bin of a package runs.
 *
 * @param {string} folder - The package's folder, from the repo's top
 * @returns {string[]} The files, from the repo's top
 */
function filesRunBy(folder) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(REPO_TOP, folder, "package.json"), "utf8"),
  );
  const fromScripts = Object.values(pkg.scripts ?? {}).flatMap((script) =>
    [...script.matchAll(/(?:^|&&\s*)node\s+([\w./-]+\.js)\b/g)].map(
      (match) => match[1],
    ),
  );
  const fromBins = Object.values(pkg.bin ?? {});
  return [...fromScripts, ...fromBins].map((file) =>
    path.posix.join(folder, file),
  );
}

/**
 * The JavaScript files that import commander, outside tests and installed
 * packages.
 *
 * @returns {string[]} The files, from the repo's top
 */
function filesUsingCommander() {
  return fs
    .readdirSync(REPO_TOP, { recursive: true })
    .map((entry) => entry.split(path.sep).join("/"))
    .filter(
      (file) =>
        file.endsWith(".js") &&
        !file.split("/").some((part) => NOT_SEARCHED.has(part)),
    )
    .filter((file) =>
      /from "commander"/.test(
        fs.readFileSync(path.join(REPO_TOP, file), "utf8"),
      ),
    );
}

describe("every command line's help", () => {
  for (const commandLine of COMMAND_LINES) {
    const name = [commandLine.file, ...commandLine.command].join(" ");
    it(`${name} answers --help with its options, examples of its uses and its exit codes, and -h with the same`, () => {
      const help = helpOf(commandLine, "--help");
      assert.equal(help.stderr, "");
      assert.equal(help.status, 0);
      assert.match(help.stdout, /^Usage: /);
      assert.match(help.stdout, /\nOptions:\n/);
      const examples = help.stdout.indexOf("\nExamples:\n");
      const exitCodes = help.stdout.search(/\nExit codes:/);
      assert.ok(examples > 0, "the help has an Examples section");
      assert.ok(exitCodes > examples, "Exit codes come after the examples");
      const exampleCommands = help.stdout
        .slice(examples, exitCodes)
        .split("\n")
        .filter((line) => /^\s+\$ \S/.test(line));
      assert.ok(exampleCommands.length > 0, "each example is a command");
      assert.deepEqual(helpOf(commandLine, "-h"), help);
    });
  }
});

describe("the list of command lines", () => {
  it("holds every file an npm target or a bin runs, and every file that declares a command with commander", () => {
    const listed = new Set(COMMAND_LINES.map(({ file }) => file));
    for (const file of [...filesRunBy("."), ...filesRunBy(FILLER)]) {
      assert.ok(listed.has(path.posix.normalize(file)), `${file} is listed`);
    }
    for (const file of filesUsingCommander()) {
      assert.ok(
        listed.has(file) || listed.has(COMMAND_MODULES[file]),
        `${file} declares a command; list its command line`,
      );
    }
  });
});
