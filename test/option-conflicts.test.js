/**
 * Tests for `lib/option-conflicts.js`, which refuses two conflicting
 * options of a command line when a settings file sets one of them, as
 * commander refuses two typed ones.
 * @module test/option-conflicts.test
 *
 * Each command is built here with commander, as a project's command line
 * is, its defaults standing for a settings file's values. Commander's
 * `exitOverride` turns a refusal into an error the test catches, and its
 * output goes to a list the test reads, so nothing is printed and the
 * process never exits.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Command, Option } from "commander";
import { checkConflicts } from "../lib/option-conflicts.js";

/**
 * Builds a command whose `--dex-tools-only` default stands for a settings
 * file's value, and parses the arguments typed.
 *
 * @param {boolean} dexToolsOnly - The settings file's value
 * @param {string[]} typed - The arguments typed
 * @returns {{command: import('commander').Command, errors: string[]}} The parsed command, and what it wrote as errors
 */
function parsed(dexToolsOnly, typed = []) {
  const errors = [];
  const command = new Command("tool")
    .exitOverride()
    .configureOutput({ writeErr: (text) => errors.push(text) })
    .addOption(
      new Option("--source <source>", "the source")
        .choices(["moralis", "geckoterminal"])
        .conflicts("dexToolsOnly"),
    )
    .option("--dex-tools-only", "ask DexTools alone", dexToolsOnly);
  command.parse(typed, { from: "user" });
  return { command, errors };
}

describe("checkConflicts", () => {
  it("refuses a typed option that conflicts with one the settings file sets, naming both and the file", () => {
    const { command, errors } = parsed(true, ["--source", "moralis"]);
    const message =
      "error: option '--source <source>' cannot be used with option '--dex-tools-only' (set in config.json)";
    assert.throws(() => checkConflicts(command, "config.json"), {
      code: "commander.conflictingOption",
      exitCode: 1,
      message,
    });
    assert.deepEqual(errors, [`${message}\n`]);
  });

  it("passes when the settings file sets neither of two conflicting options", () => {
    const { command, errors } = parsed(false, ["--source", "moralis"]);
    assert.doesNotThrow(() => checkConflicts(command, "config.json"));
    assert.deepEqual(errors, []);
  });

  it("passes when only the settings file's option is set", () => {
    const { command } = parsed(true);
    assert.doesNotThrow(() => checkConflicts(command, "config.json"));
  });

  it("leaves two typed conflicting options to commander, which refuses them as it parses", () => {
    assert.throws(
      () => parsed(false, ["--source", "moralis", "--dex-tools-only"]),
      {
        code: "commander.conflictingOption",
      },
    );
  });
});
