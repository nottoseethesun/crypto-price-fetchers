/**
 * The checks of a command line's help that the owner's repos ask for, for
 * their tests.
 * @module lib/command-line-help
 *
 * What: each of the owner's repos asks, in its CLAUDE.md, that every
 * command line answer `--help`, and `-h`, with its options, then examples
 * of its common uses, then its exit codes. Each repo has a test that runs
 * the help of every command line it has and holds it to that, and a test
 * that holds its list of command lines to the repo, so that a command line
 * added later is held to the rule too. The checks both tests make are
 * here, once.
 *
 * How:
 *
 * - `helpOf` runs a command line's help in a child process, from the
 *   repo's top folder, with an empty password and a key file that does not
 *   exist, so it cannot reach the owner's keys, and with an empty
 *   `NODE_V8_COVERAGE`: Node hands that variable to a child whose
 *   environment lacks it, and a child that has it adds its coverage to the
 *   test's report.
 * - `helpProblems` says what a help lacks: an exit code of 0, nothing on
 *   stderr, the usage line, the options, an `Examples:` section with at
 *   least one command (a line that starts with `$ `), and an
 *   `Exit codes:` section after it.
 * - `helpIntoClosedPipe` runs a command line's help with its standard
 *   output a pipe that is closed before the help is written, as `head`
 *   closes it once it has the lines it prints, so a write to it fails with
 *   EPIPE: a command line whose entry point calls
 *   `endQuietlyWhenOutputCloses` (`lib/closed-output.js`) exits with 0 and
 *   writes nothing to stderr, and one that does not prints a stack trace
 *   and exits with 1.
 * - `filesRunBy` gives the JavaScript files a package's npm targets
 *   (`node <file>.js`) and bins run, and `filesUsingCommander` the files
 *   that import commander, the package that parses command lines: a
 *   repo's test checks that each is in its list of command lines.
 *
 * Fit: crypto-price-fetchers' `test/command-line-help.test.js` uses it,
 * and the package exports it as `crypto-price-fetchers/lib/command-line-help`
 * for the tests of pulsechain-analytics, pulsechain-validator-analytics
 * and x1-validator-analytics.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The folders `filesUsingCommander` passes over. */
const NOT_SEARCHED = new Set([
  "node_modules",
  "coverage",
  "build",
  ".git",
  "test",
  "tests",
]);

/**
 * A statement that imports or re-exports commander: on one line, or the
 * last line of one written over several.
 */
const IMPORTS_COMMANDER =
  /^(?:(?:import|export)\b.*|\}) from ["']commander["'];?$/m;

/**
 * A command line: the file node runs, from the repo's top folder, and the
 * subcommand, if any, whose help is asked for.
 *
 * @typedef {Object} CommandLine
 * @property {string} file - The file node runs
 * @property {string[]} command - The subcommand's words, or none
 */

/**
 * Runs a command line's help in a child process.
 *
 * @param {string} repoTop - The repo's top folder
 * @param {CommandLine} commandLine - The command line
 * @param {string} flag - `--help` or `-h`
 * @returns {{status: number, stdout: string, stderr: string}} How it ended and what it printed
 */
export function helpOf(repoTop, { file, command }, flag) {
  const run = spawnSync(process.execPath, [file, ...command, flag], {
    cwd: repoTop,
    encoding: "utf8",
    timeout: 30000,
    env: childEnvironment(),
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/**
 * The environment a command line's help runs in: this process's, with an
 * empty password, a key file that does not exist, and no coverage.
 *
 * @returns {Object<string, string>} The environment
 */
function childEnvironment() {
  return {
    ...process.env,
    NODE_V8_COVERAGE: "",
    API_KEYS_PASSWORD: "",
    API_KEYS_FILE_PATH: path.join(
      os.tmpdir(),
      "command-line-help-no-keys.json",
    ),
  };
}

/**
 * Runs a command line's `--help` in a child process whose standard output
 * is a pipe closed before the help is written.
 *
 * @param {string} repoTop - The repo's top folder
 * @param {CommandLine} commandLine - The command line
 * @returns {Promise<{status: number, stderr: string}>} How it ended, and what it wrote to stderr
 */
export function helpIntoClosedPipe(repoTop, { file, command }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...command, "--help"], {
      cwd: repoTop,
      env: childEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
    child.stdout.destroy();
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr }));
  });
}

/**
 * Says what a help lacks of what the rule asks.
 *
 * @param {{status: number, stdout: string, stderr: string}} help - A help, as `helpOf` gives it
 * @returns {string[]} Each thing it lacks, in words; none when it meets the rule
 */
export function helpProblems({ status, stdout, stderr }) {
  const text = stdout ?? "";
  const examples = text.indexOf("\nExamples:\n");
  const exitCodes = text.search(/\nExit codes:/);
  const exampleCommands =
    examples < 0
      ? []
      : text
          .slice(examples, exitCodes < 0 ? undefined : exitCodes)
          .split("\n")
          .filter((line) => /^\s+\$ \S/.test(line));
  return [
    [status === 0, `it exits with ${status}, not 0`],
    [stderr === "", "it writes to stderr"],
    [text.startsWith("Usage: "), "it does not start with its usage line"],
    [text.includes("\nOptions:\n"), "it lists no options"],
    [examples > 0, "it has no Examples section"],
    [exampleCommands.length > 0, "its Examples section shows no command"],
    [exitCodes > examples, "it has no Exit codes section after its examples"],
  ]
    .filter(([met]) => !met)
    .map(([, problem]) => problem);
}

/**
 * The JavaScript files a package's npm targets and bins run.
 *
 * @param {string} repoTop - The repo's top folder
 * @param {string} folder - The package's folder, from the repo's top
 * @returns {string[]} The files, from the repo's top
 */
export function filesRunBy(repoTop, folder) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(repoTop, folder, "package.json"), "utf8"),
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
 * The JavaScript files of a repo that import commander, outside tests and
 * installed packages.
 *
 * @param {string} repoTop - The repo's top folder
 * @returns {string[]} The files, from the repo's top
 */
export function filesUsingCommander(repoTop) {
  return fs
    .readdirSync(repoTop, { recursive: true })
    .map((entry) => entry.split(path.sep).join("/"))
    .filter(
      (file) =>
        file.endsWith(".js") &&
        !file.split("/").some((part) => NOT_SEARCHED.has(part)),
    )
    .filter((file) =>
      IMPORTS_COMMANDER.test(fs.readFileSync(path.join(repoTop, file), "utf8")),
    );
}
