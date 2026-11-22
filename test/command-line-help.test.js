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

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  filesRunBy,
  filesUsingCommander,
  helpIntoClosedPipe,
  helpOf,
  helpProblems,
} from "../lib/command-line-help.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

after(removeTempFolders);

/** The repo's top folder. */
const REPO_TOP = fileURLToPath(new URL("..", import.meta.url));

/** The folder of crypto-price-filler, a package of its own. */
const FILLER = "fetch-from-centralized-exchange/crypto-price-filler";

/**
 * Every command line: the file node runs, and the subcommand, if any, whose
 * help is asked for.
 */
const COMMAND_LINES = Object.freeze([
  { file: "build/tools/build.js", command: [] },
  { file: "build/tools/build.js", command: ["apps-script"] },
  { file: "bin/manage-api-keys.js", command: [] },
  { file: "bin/manage-api-keys.js", command: ["set"] },
  { file: "bin/manage-api-keys.js", command: ["check-password"] },
  { file: "bin/summ-csv.js", command: [] },
  { file: "bin/github-project-deps.js", command: [] },
  { file: "build/tools/audit-dex-screener.js", command: [] },
  { file: "bin/run-actionlint.js", command: [] },
  { file: "bin/crypto-price-fetchers.js", command: [] },
  { file: "bin/crypto-price-fetchers.js", command: ["price"] },
  { file: "bin/crypto-price-fetchers.js", command: ["fdv"] },
  { file: "bin/getCryptoPriceFromCentralizedExchange.js", command: [] },
  { file: "bin/crypto-price-filler.js", command: [] },
  { file: "bin/backfill.js", command: [] },
  { file: "install/install-os-dependencies.js", command: [] },
]);

/**
 * The modules that declare a command for a command line run from another
 * file, by the file node runs.
 */
const COMMAND_MODULES = Object.freeze({
  "build/tools/apps-script-build/index.js": "build/tools/build.js",
  "build/tools/apps-script-build/dex-screener-files.js":
    "build/tools/audit-dex-screener.js",
  "api-key-store/key-manager.js": "bin/manage-api-keys.js",
  "summ-csv/command-line.js": "bin/summ-csv.js",
  "github-project-deps/index.js": "bin/github-project-deps.js",
  "actionlint/index.js": "bin/run-actionlint.js",
  "apps-script-runner/command-line.js": "bin/crypto-price-fetchers.js",
  [`${FILLER}/commander.js`]: "bin/crypto-price-filler.js",
  [`${FILLER}/backfill.js`]: "bin/backfill.js",
  "install/os-dependencies.js": "install/install-os-dependencies.js",
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

describe("every command line's help into a closed pipe", () => {
  for (const commandLine of COMMAND_LINES) {
    const name = [commandLine.file, ...commandLine.command].join(" ");
    it(`${name} ends quietly, with exit code 0, when the program reading its help has closed the pipe`, async () => {
      assert.deepEqual(await helpIntoClosedPipe(REPO_TOP, commandLine), {
        status: 0,
        stderr: "",
      });
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

  it("name each option an example uses that the help does not list", () => {
    const help = (examples) => ({
      ...GOOD_HELP,
      stdout: [
        "Usage: tool [options] [command]",
        "",
        "Options:",
        "  -o, --out <file>  the file to write",
        "                    (default: out.csv)",
        "  --dry-run         write nothing",
        "  -h, --help        display help for command",
        "",
        "Commands:",
        "  run [options]     runs it",
        "  help [command]    display help for command",
        "",
        "Examples:",
        ...examples.map((example) => `    $ ${example}`),
        "",
        "Exit codes: 0 when it ran; 1 when it did not.",
        "",
      ].join("\n"),
    });
    const listedOnly = [
      "node tool.js --out x.csv -o y.csv --dry-run",
      "node tool.js --out=x.csv",
      "node --test tool.js",
      "node tool.js run --fast",
      "node tool.js --out x.csv | head -n 3",
      "npm start -- --dry-run",
      "npm run tool -- --help",
    ];
    assert.deepEqual(helpProblems(help(listedOnly)), []);
    assert.deepEqual(
      helpProblems(
        help([
          "node tool.js --verbose --verbose",
          "npm start -- -v",
          "tool --since 2026-01-01",
        ]),
      ),
      [
        'its example "node tool.js --verbose --verbose" uses --verbose, which its options do not list',
        'its example "npm start -- -v" uses -v, which its options do not list',
        'its example "tool --since 2026-01-01" uses --since, which its options do not list',
      ],
    );
  });

  it("count the options of a program that a subcommand's help lists under Global Options", () => {
    const subcommandHelp = {
      ...GOOD_HELP,
      stdout: GOOD_HELP.stdout
        .replace(
          "  -h, --help  display help for command\n",
          "  -h, --help  display help for command\n\nGlobal Options:\n  -v, --verbose  log each step\n",
        )
        .replace("$ node tool.js", "$ node tool.js --verbose fdv"),
    };
    assert.deepEqual(helpProblems(subcommandHelp), []);
  });

  it("are exported, so a project that installs this repo runs this one copy", async () => {
    const shared = await import("crypto-price-fetchers/lib/command-line-help");
    assert.equal(shared.helpProblems, helpProblems);
  });

  it("find the files that import from commander what declares a command, and only those", () => {
    const users = filesUsingCommander(REPO_TOP);
    assert.ok(users.includes("apps-script-runner/command-line.js"));
    assert.ok(users.includes("api-key-store/key-manager.js"));
    assert.ok(!users.includes("lib/command-line-help.js"));
    assert.ok(!users.includes("lib/settings-schema.js"));
    assert.ok(!users.includes("apps-script-runner/index.js"));
  });

  it("count an import over several lines, the whole package and a re-export, but not InvalidArgumentError or Option alone", () => {
    const top = makeTempFolder("commander-users");
    const files = {
      "one-line.js": 'import { Command } from "commander";\n',
      "several-lines.js":
        'import {\n  InvalidArgumentError,\n  Command as Cmd,\n} from "commander";\n',
      "whole.js": 'import commander from "commander";\n',
      "namespace.js": 'import * as commander from "commander";\n',
      "re-export.js": 'export { program } from "commander";\n',
      "parser.js": 'import { InvalidArgumentError } from "commander";\n',
      "options.js":
        'import {\n  InvalidArgumentError,\n  Option,\n} from "commander";\n',
      "other.js": 'import { Command } from "commander-plus";\n',
    };
    for (const [name, text] of Object.entries(files)) {
      fs.writeFileSync(path.join(top, name), text);
    }
    assert.deepEqual(filesUsingCommander(top).sort(), [
      "namespace.js",
      "one-line.js",
      "re-export.js",
      "several-lines.js",
      "whole.js",
    ]);
  });
});
