/**
 * Tests that guard fixed bugs in the repo's shared helpers, in `lib/`,
 * which the repo's own tools, crypto-price-filler and the projects that
 * install this repo use.
 * The repo's CLAUDE.md lists the other files of fixed bugs' tests; a bug
 * found later gets its test in `known-bugs.test.js`, declared with
 * `it.fails` while the bug is there, and its fix moves the test to one of
 * them.
 * @module tests/regressions-lib.test
 *
 * The helpers run in the test's thread, but for the copy to the clipboard,
 * which runs in a child process, since its crash would fail the whole run;
 * the files the search for command lines reads are written in a temp
 * folder of the test's own.
 */

import { afterAll, beforeAll, describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { pathToFileURL } from "url";
import { PassThrough } from "stream";
import { askLine } from "../../../lib/ask-line.js";
import { askPassword, openSecretPrompt } from "../../../api-key-store/index.js";
import { filesUsingCommander } from "../../../lib/command-line-help.js";
import { localReferencesMissing } from "../../../lib/repo-checks.js";
import { fetchWithinTimeLimit } from "../../../lib/time-limited-fetch.js";
import {
  compileSettingsSchema,
  KINDS,
  settingsProblems,
} from "../../../lib/settings-schema.js";
import {
  readSummCsvSettings,
  SUMM_CSV_SETTINGS_SCHEMA,
} from "../../../summ-csv/index.js";
import { SETTINGS_SCHEMA } from "../config.js";

let folder;

beforeAll(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "crypto-price-filler-lib-"));
});

afterAll(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

describe("the settings files' checks (lib/settings-schema.js)", () => {
  it("compiles a settings file's schema once, however often a file is read against it", () => {
    expect(compileSettingsSchema(SETTINGS_SCHEMA)).toBe(
      compileSettingsSchema(SETTINGS_SCHEMA),
    );
  });

  it("describes an empty text and an empty list by what each lacks", () => {
    const validate = compileSettingsSchema({
      type: "object",
      additionalProperties: false,
      properties: { name: KINDS.text, id: KINDS.textOrNone },
    });
    expect(
      settingsProblems("config.json", validate, { name: "", id: "" }),
    ).toEqual([
      'config.json → name must be text that is not empty; it is ""',
      'config.json → id must be text that is not empty, or null for none; it is ""',
    ]);
    const settings = readSummCsvSettings();
    settings.referencePriceCurrencies = [];
    expect(
      settingsProblems(
        "summ-csv/settings.json",
        compileSettingsSchema(SUMM_CSV_SETTINGS_SCHEMA),
        settings,
      ),
    ).toEqual([
      "summ-csv/settings.json → referencePriceCurrencies must be a list of one or more currencies, each once; it is []",
    ]);
  });
});

describe("the search for command lines (lib/command-line-help.js)", () => {
  it("counts a file that brings in Command or the whole of commander in each form that loads", () => {
    const top = fs.mkdtempSync(path.join(folder, "commander-forms-"));
    const files = {
      "re-export.js": 'export * from "commander";\n',
      "commented.js":
        'import { Command } from "commander"; // the command line\n',
      "indented.js": '  import { Command } from "commander";\n',
      "dynamic.js": 'const { Command } = await import("commander");\n',
      "parser.js":
        'import { InvalidArgumentError } from "commander"; // a parser\n',
      "in-a-comment.js":
        '/**\n * import { Command } from "commander";\n */\nexport const x = 1;\n',
    };
    for (const [name, text] of Object.entries(files)) {
      fs.writeFileSync(path.join(top, name), text);
    }
    expect(filesUsingCommander(top).sort()).toEqual([
      "commented.js",
      "dynamic.js",
      "indented.js",
      "re-export.js",
    ]);
  });
});

describe("the time-limited fetch", () => {
  it("fetchWithinTimeLimit refuses a limit Node's timers cannot keep, a fraction of a millisecond or more than 2147483647, saying so", async () => {
    const answers = async () => new Response("{}");
    for (const timeoutMs of [2009.9999999999998, 3e9]) {
      await expect(
        fetchWithinTimeLimit(
          "http://localhost/",
          {},
          { timeoutMs, fetch: answers },
        ),
      ).rejects.toThrow(/a whole number of milliseconds from 1 to 2147483647/);
    }
  });
});

describe("the copy to the clipboard (lib/clipboard.js)", () => {
  it("copyToClipboard rejects, naming the exit code, when the tool exits without reading its input", () => {
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
  });
});

describe("the questions at the terminal (lib/ask-line.js)", () => {
  it("askLine gives each question its own line of the answers piped in together", async () => {
    const input = new PassThrough();
    const output = { write: () => true };
    input.write("n\ny\n");
    const first = await askLine("First? ", { input, output });
    const asked = askLine("Second? ", { input, output });
    input.end();
    const second = await asked;
    expect([first, second]).toEqual(["n", "y"]);
  });

  it("askLine gives null at once to a question asked after the input has ended", async () => {
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
  });
});

describe("answers piped in together", () => {
  /** An input that has given `text` and ended, and an output that drops what it is given. */
  const piped = (text) => {
    const input = new PassThrough();
    input.end(text);
    return { input, output: { write: () => true } };
  };

  it("askLine gives a last answer that has no line end", async () => {
    const streams = piped("n\ny");
    const answers = [
      await askLine("First? ", streams),
      await askLine("Second? ", streams),
    ];
    expect(answers).toEqual(["n", "y"]);
  });

  it("the key store's password prompt takes the line askLine read past its answer", async () => {
    const streams = piped("n\npw\n");
    expect(await askLine("Include? ", streams)).toBe("n");
    const password = await askPassword("Password: ", streams).catch(
      (error) => error.message,
    );
    expect(password).toBe("pw");
  });

  it("askLine takes the line the password prompt read past its answer, once", async () => {
    const streams = piped("pw\ny");
    expect(await askPassword("Password: ", streams)).toBe("pw");
    expect(await askLine("Go on? ", streams)).toBe("y");
    expect(await askLine("Again? ", streams)).toBeNull();
  });

  it("askLine gets nothing of a password piped in without a line end, which the password prompt took", async () => {
    const streams = piped("pw");
    expect(await askPassword("Password: ", streams)).toBe("pw");
    expect(await askLine("Go on? ", streams)).toBeNull();
  });

  it("askLine takes once a line the open password prompt read when the input ended", async () => {
    const input = new PassThrough();
    const streams = { input, output: { write: () => true } };
    const prompts = openSecretPrompt(streams);
    const password = prompts.ask("Password: ");
    input.end("pw\ny");
    expect(await password).toBe("pw");
    await new Promise((resolve) => input.once("close", resolve));
    prompts.close();
    expect(await askLine("Go on? ", streams)).toBe("y");
    expect(await askLine("Again? ", streams)).toBeNull();
  });

  it("askLine gets nothing of a password the prompt was stopped in, with Ctrl+C", async () => {
    const input = new PassThrough();
    const streams = { input, output: { write: () => true } };
    const password = askPassword("Password: ", streams).catch(
      (error) => error.message,
    );
    input.write("secr\u0003");
    expect(await password).toBe("Stopped at the prompt");
    input.end("y\n");
    expect(await askLine("Go on? ", streams)).toBe("y");
  });
});

describe("the link check of lib/repo-checks.js", () => {
  it("takes no link from a code span, which Markdown shows as code, and checks a link beside one that runs over two lines, or after a backtick a blank line leaves alone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-span-link-"));
    try {
      fs.writeFileSync(
        path.join(dir, "README.md"),
        [
          "# A repo",
          "",
          "A link is written as `[text](target)`, and [this one](missing.md) points nowhere.",
          "",
          "Run `npm run build",
          "apps-script`, then read [the guide](missing-too.md) and `npm test`.",
          "",
          "A link is written as `[text](target)",
          "in Markdown`, or as ``[text](target)``, or as ``a ` [text](target)``.",
          "",
          "A backtick alone, `, ends with its paragraph.",
          "   ",
          "So [the third](missing-three.md) is checked, beside `npm test`.",
          "",
        ].join("\n"),
      );
      spawnSync("git", ["init", "-q"], { cwd: dir });
      spawnSync("git", ["add", "README.md"], { cwd: dir });
      expect(localReferencesMissing(dir).map(({ pointer }) => pointer)).toEqual(
        ["missing.md", "missing-too.md", "missing-three.md"],
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ends a code span with its block, as Markdown parses one, opens none at an escaped backtick, opens no block of code at a line that starts with a code span of three backticks, and takes no link from an HTML comment that starts a line", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-span-block-"));
    try {
      fs.writeFileSync(
        path.join(dir, "README.md"),
        [
          "# A repo",
          "",
          "An escaped backtick, \\`, opens no span, so [one](missing-1.md) is checked beside `npm test`.",
          "",
          "## A lone ` in a heading",
          "Then [two](missing-2.md) beside `npm test`.",
          "",
          "| A | B | C |",
          "| --- | --- | --- |",
          "| A lone ` here | [three](missing-3.md) | `npm test` |",
          "",
          "- A lone ` in an item",
          "- [four](missing-4.md) beside `npm test`",
          "- A link is written as `[text](target)",
          "  in Markdown`, in an item of two lines.",
          "",
          "> A lone ` in a quote.",
          ">",
          "> So [five](missing-5.md) is checked, beside `npm test`.",
          "",
          "A lone ` before a quote",
          "> [six](missing-6.md) beside `npm test`.",
          "",
          "A lone ` before a thematic break",
          "***",
          "[seven](missing-7.md) beside `npm test`.",
          "",
          "A lone ` in a heading of two lines",
          "===",
          "[eight](missing-8.md) beside `npm test`.",
          "",
          "<!-- A lone ` in a comment, and [no link](missing-in-a-comment.md) -->",
          "[nine](missing-9.md) beside `npm test`.",
          "",
          "```npm test``` opens no block of code, so [ten](missing-10.md) is checked.",
          "",
          "A link is written as `[text](target)",
          "2. in Markdown`: an item that does not start at 1 goes on a paragraph.",
          "",
          "A link is written as `[text](target)",
          "\u00a0",
          "in Markdown`: a line of a no-break space is no blank line.",
          "",
        ].join("\n"),
      );
      spawnSync("git", ["init", "-q"], { cwd: dir });
      spawnSync("git", ["add", "README.md"], { cwd: dir });
      expect(localReferencesMissing(dir).map(({ pointer }) => pointer)).toEqual(
        [
          "missing-1.md",
          "missing-2.md",
          "missing-3.md",
          "missing-4.md",
          "missing-5.md",
          "missing-6.md",
          "missing-7.md",
          "missing-8.md",
          "missing-9.md",
          "missing-10.md",
        ],
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
