/**
 * Tests that guard fixed bugs in the repo's shared helpers, in `lib/`,
 * which crypto-price-filler and the projects that install this repo use.
 * The other fixed bugs' tests are in `regressions.test.js`,
 * `regressions-command-line.test.js` and `regressions-sheets.test.js`; a
 * bug found later gets its test in `known-bugs.test.js`, declared with
 * `it.fails` while the bug is there, and its fix moves the test to one of
 * the four (see the repo's CLAUDE.md).
 * @module tests/regressions-lib.test
 *
 * The helpers run in the test's thread; the files the search for command
 * lines reads are written in a temp folder of the test's own.
 */

import { afterAll, beforeAll, describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { filesUsingCommander } from "../../../lib/command-line-help.js";
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
