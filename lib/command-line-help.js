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
 *   repo's top folder, with node or the program the command line names,
 *   such as bash for a shell script, with an empty password and a key file
 *   that does not exist, so it cannot reach the owner's keys, and with an
 *   empty `NODE_V8_COVERAGE`: Node hands that variable to a child whose
 *   environment lacks it, and a child that has it adds its coverage to the
 *   test's report.
 * - `helpProblems` says what a help lacks: an exit code of 0, nothing on
 *   stderr, the usage line, the options, an `Examples:` section with at
 *   least one command (a line that starts with `$ `), and an
 *   `Exit codes:` section after it. It also names each option an example
 *   uses that the help does not list, under `Options:` or, for a
 *   subcommand, `Global Options:`, so that every option an example shows
 *   is one the help explains. An option that follows a command the help
 *   lists under `Commands:` is that command's, which its own help lists.
 * - `helpIntoClosedPipe` runs a command line's help with its standard
 *   output a pipe that is closed before the help is written, as `head`
 *   closes it once it has the lines it prints, so a write to it fails with
 *   EPIPE: a command line on Node whose entry point calls
 *   `endQuietlyWhenOutputCloses` (`lib/closed-output.js`) exits with 0 and
 *   writes nothing to stderr, and one that does not prints a stack trace
 *   and exits with 1; a shell script whose help another program prints,
 *   such as `cat`, with that program's errors sent to `/dev/null`, exits
 *   with 0 and writes nothing to stderr, since the closed pipe ends that
 *   program alone.
 * - `filesRunBy` gives the JavaScript files a package's npm targets
 *   (`node <file>.js`) and bins run, and `filesUsingCommander` the files
 *   that bring in from commander, the package that parses command lines,
 *   what declares a command (`Command`, `createCommand` or `program`, or
 *   the whole package), by any statement that loads it: an import or a
 *   re-export, on one line or over several, indented or not, with a
 *   comment after it or not, or a dynamic `import()`. A repo's test checks
 *   that each is in its list of command lines. A file that imports only
 *   `InvalidArgumentError`, to refuse a value as an option's parser,
 *   declares no command, and an import shown in a comment is none.
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
  "dist",
  ".git",
  "test",
  "tests",
]);

/**
 * A statement that imports or re-exports from commander, at the start of a
 * line or after a `;`, indented or not, written on one line or over
 * several: what it brings in, the words between `import` or `export` and
 * `from`, which hold no `from` of their own, so a match never starts at an
 * earlier statement.
 */
const FROM_COMMANDER =
  /(?:^|[;\n])\s*(?:import|export)\s+((?:(?!\bfrom\b)[^;])*)\bfrom\s*["']commander["']/g;

/** A dynamic import of commander, which brings in the whole package. */
const IMPORT_OF_COMMANDER = /\bimport\s*\(\s*["']commander["']\s*\)/;

/** The names commander exports that declare a command. */
const DECLARING_NAMES = new Set(["Command", "createCommand", "program"]);

/**
 * A file's text without its comments, so an import shown in a comment is
 * not taken for one: each block comment, and each line comment whose `//`
 * follows no `:`, so the `//` of an url in a string stays.
 *
 * @param {string} text - The file's text
 * @returns {string} The text, its comments removed
 */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

/**
 * Says whether a file's text brings in from commander what declares a
 * command: one of `DECLARING_NAMES`, or the whole package, by a default
 * or namespace import, `export *`, or a dynamic import.
 *
 * @param {string} text - The file's text
 * @returns {boolean} Whether it does
 */
function declaresCommand(text) {
  const code = withoutComments(text);
  if (IMPORT_OF_COMMANDER.test(code)) return true;
  for (const [, clause] of code.matchAll(FROM_COMMANDER)) {
    const braces = /\{([^}]*)\}/.exec(clause);
    const whole = clause.replace(/\{[^}]*\}/, "").replace(/[\s,]/g, "");
    if (whole !== "") return true;
    if (braces === null) continue;
    const imported = braces[1]
      .split(",")
      .map((name) => name.trim().split(/\s+as\s+/)[0])
      .filter((name) => name !== "");
    if (imported.some((name) => DECLARING_NAMES.has(name))) return true;
  }
  return false;
}

/**
 * A command line: the file it runs, from the repo's top folder, the
 * program that runs that file, and the subcommand, if any, whose help is
 * asked for.
 *
 * @typedef {Object} CommandLine
 * @property {string} [program] - The program that runs the file: node when absent, or a shell, such as bash, for a shell script
 * @property {string} file - The file the program runs
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
export function helpOf(repoTop, { program, file, command }, flag) {
  const run = spawnSync(program ?? process.execPath, [file, ...command, flag], {
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
export function helpIntoClosedPipe(repoTop, { program, file, command }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      program ?? process.execPath,
      [file, ...command, "--help"],
      {
        cwd: repoTop,
        env: childEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30000,
      },
    );
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
    .map(([, problem]) => problem)
    .concat(unlistedExampleFlags(text, exampleCommands));
}

/**
 * The lines of each section of a help that has the heading given, such as
 * `Options:`: the lines after the heading, up to the first blank line, as
 * commander writes a section.
 *
 * @param {string} text - The help
 * @param {string} heading - The heading's line
 * @returns {string[]} The lines
 */
function sectionLines(text, heading) {
  const lines = text.split("\n");
  const found = [];
  lines.forEach((line, at) => {
    if (line !== heading) return;
    for (let next = at + 1; next < lines.length; next += 1) {
      if (lines[next].trim() === "") break;
      found.push(lines[next]);
    }
  });
  return found;
}

/**
 * The flags a help lists, short and long, in its `Options:` section and,
 * for a subcommand whose program shows them, its `Global Options:`
 * section. Commander writes each option two spaces in, its flags joined
 * by a comma and a space, then two spaces or more before its description,
 * and the lines that carry its description on further in.
 *
 * @param {string} text - The help
 * @returns {Set<string>} The flags, such as `-h` and `--help`
 */
function listedFlags(text) {
  const flags = new Set();
  for (const line of [
    ...sectionLines(text, "Options:"),
    ...sectionLines(text, "Global Options:"),
  ]) {
    if (!line.startsWith("  -")) continue;
    const entry = line.slice(2).split("  ")[0];
    for (const written of entry.split(", ")) {
      const flag = written.split(" ")[0];
      if (/^-[A-Za-z]$|^--[\w-]+$/.test(flag)) flags.add(flag);
    }
  }
  return flags;
}

/**
 * The commands a help lists in its `Commands:` section, by name.
 *
 * @param {string} text - The help
 * @returns {Set<string>} The names
 */
function listedCommands(text) {
  const names = sectionLines(text, "Commands:").map(
    (line) => /^ {2}([\w-]+)/.exec(line)?.[1],
  );
  return new Set(names.filter((name) => name !== undefined));
}

/** The words of a shell command after which the words are another program's, or no options. */
const COMMAND_ENDS = new Set(["|", "||", "&&", ";", ">", ">>", "<", "--"]);

/**
 * The flags an example gives the command line its help is for: the words
 * after the file node runs, or after the `--` that npm passes the rest on
 * after, or else after the bin, up to a command the help lists, whose own
 * help lists that command's flags, or up to the end of the command.
 *
 * @param {string} example - The example's command, after its `$ `
 * @param {Set<string>} commands - The commands the help lists
 * @returns {string[]} The flags, each once, such as `--verbose` or `-v`
 */
function exampleFlags(example, commands) {
  const words = example.trim().split(/\s+/);
  const file = words.findIndex((word) => /\.[cm]?js$/.test(word));
  const passedOn = words.indexOf("--");
  let start = 1;
  if (file >= 0) start = file + 1;
  else if (passedOn >= 0) start = passedOn + 1;
  const flags = new Set();
  for (const word of words.slice(start)) {
    if (COMMAND_ENDS.has(word) || commands.has(word)) break;
    const flag = word.split("=")[0];
    if (/^--[\w-]+$|^-[A-Za-z]$/.test(flag)) flags.add(flag);
  }
  return [...flags];
}

/**
 * Names each flag an example of a help uses that the help does not list,
 * so that every option an example shows is one the help explains.
 *
 * @param {string} text - The help
 * @param {string[]} exampleLines - The lines of its Examples section that hold a command
 * @returns {string[]} Each such flag, in words
 */
function unlistedExampleFlags(text, exampleLines) {
  const listed = listedFlags(text);
  const commands = listedCommands(text);
  return exampleLines.flatMap((line) => {
    const example = line.trim().slice(2);
    return exampleFlags(example, commands)
      .filter((flag) => !listed.has(flag))
      .map(
        (flag) =>
          `its example "${example}" uses ${flag}, which its options do not list`,
      );
  });
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
 * The JavaScript files of a repo that import from commander what declares
 * a command, outside tests and installed packages.
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
      declaresCommand(fs.readFileSync(path.join(repoTop, file), "utf8")),
    );
}
