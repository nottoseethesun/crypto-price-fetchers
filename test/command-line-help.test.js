/**
 * Tests that every command line in the repo answers `--help`, and `-h`, as
 * the repo's CLAUDE.md asks: its options, then examples of its common uses,
 * then its exit codes.
 * @module test/command-line-help.test
 *
 * The checks are those of `lib/command-line-help.js`, which the repos that
 * install this one use in their own tests. Each command line runs in a
 * child process, from the repo's top folder, with no way to the owner's
 * keys; a help is printed before anything is opened or asked.
 * `COMMAND_LINES` lists every command line, each subcommand on its own. A
 * second test holds the list to the repo: every npm target and bin that
 * runs a JavaScript file, and every file that declares a command with
 * commander, must be in it, so a command line added later is held to the
 * rule as well. A third checks that the checks find what a help lacks.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  filesRunBy,
  filesUsingCommander,
  helpOf,
  helpProblems,
} from "../lib/command-line-help.js";

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

/** A help that meets the rule, for the tests of the checks. */
const GOOD_HELP = Object.freeze({
  status: 0,
  stderr: "",
  stdout: [
    "Usage: tool [options]",
    "",
    "Options:",
    "  -h, --help  display help for command",
    "",
    "Examples:",
    "  Run it:",
    "    $ node tool.js",
    "",
    "Exit codes: 0 when it ran; 1 when it did not.",
    "",
  ].join("\n"),
});

describe("every command line's help", () => {
  for (const commandLine of COMMAND_LINES) {
    const name = [commandLine.file, ...commandLine.command].join(" ");
    it(`${name} answers --help with its options, examples of its uses and its exit codes, and -h with the same`, () => {
      const help = helpOf(REPO_TOP, commandLine, "--help");
      assert.deepEqual(helpProblems(help), []);
      assert.deepEqual(helpOf(REPO_TOP, commandLine, "-h"), help);
    });
  }
});

describe("the list of command lines", () => {
  it("holds every file an npm target or a bin runs, and every file that declares a command with commander", () => {
    const listed = new Set(COMMAND_LINES.map(({ file }) => file));
    for (const file of [
      ...filesRunBy(REPO_TOP, "."),
      ...filesRunBy(REPO_TOP, FILLER),
    ]) {
      assert.ok(listed.has(path.posix.normalize(file)), `${file} is listed`);
    }
    for (const file of filesUsingCommander(REPO_TOP)) {
      assert.ok(
        listed.has(file) || listed.has(COMMAND_MODULES[file]),
        `${file} declares a command; list its command line`,
      );
    }
  });
});

describe("the checks of a help", () => {
  it("find nothing missing in a help that meets the rule", () => {
    assert.deepEqual(helpProblems(GOOD_HELP), []);
  });

  it("name each thing a help lacks", () => {
    const noExamples = GOOD_HELP.stdout.replace(
      "Examples:\n  Run it:\n    $ node tool.js\n",
      "",
    );
    assert.deepEqual(helpProblems({ ...GOOD_HELP, stdout: noExamples }), [
      "it has no Examples section",
      "its Examples section shows no command",
    ]);
    const noExitCodes = GOOD_HELP.stdout.replace(/Exit codes:.*\n/, "");
    assert.deepEqual(helpProblems({ ...GOOD_HELP, stdout: noExitCodes }), [
      "it has no Exit codes section after its examples",
    ]);
    assert.deepEqual(
      helpProblems({ status: 1, stderr: "error: unknown option", stdout: "" }),
      [
        "it exits with 1, not 0",
        "it writes to stderr",
        "it does not start with its usage line",
        "it lists no options",
        "it has no Examples section",
        "its Examples section shows no command",
        "it has no Exit codes section after its examples",
      ],
    );
  });

  it("are exported, so a project that installs this repo runs this one copy", async () => {
    const shared = await import("crypto-price-fetchers/lib/command-line-help");
    assert.equal(shared.helpProblems, helpProblems);
  });

  it("find the files that import commander, and only those", () => {
    const users = filesUsingCommander(REPO_TOP);
    assert.ok(users.includes("apps-script-runner/index.js"));
    assert.ok(users.includes("api-key-store/key-manager.js"));
    assert.ok(!users.includes("lib/command-line-help.js"));
  });
});
