/**
 * Tests for `lib/command-defaults.js`, which checks the option values a
 * command line took as its defaults from a settings file with the checks
 * commander gives the same values typed: each option's parser, its choices
 * among them, and its conflicts.
 * @module test/command-defaults.test
 *
 * Each command is built here with commander, as a project's command line
 * is, its defaults standing for a settings file's values. Commander's
 * `exitOverride` turns a refusal into an error the test catches, and its
 * output goes to a list the test reads, so nothing is printed and the
 * process never exits.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Command, InvalidArgumentError, Option } from "commander";
import { checkDefaults } from "../lib/command-defaults.js";

/**
 * Checks a whole number above 0, as a command line's option parser does.
 *
 * @param {string} value - The value, as text
 * @returns {number} The number
 * @throws {InvalidArgumentError} When it is not a whole number above 0
 */
function count(value) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new InvalidArgumentError("Not a whole number above 0.");
  }
  return Number(value);
}

/**
 * Builds a command whose defaults stand for a settings file's values, and
 * parses the arguments typed.
 *
 * @param {Object} settings - The settings file's values
 * @param {string[]} typed - The arguments typed
 * @returns {{command: import('commander').Command, errors: string[]}} The parsed command, and what it wrote as errors
 */
function parsed(settings, typed = []) {
  const errors = [];
  const command = new Command("tool")
    .exitOverride()
    .configureOutput({ writeErr: (text) => errors.push(text) })
    .option("--count <number>", "how many", count, settings.count)
    .addOption(
      new Option("--interval <interval>", "the interval")
        .choices(["hourly", "daily"])
        .default(settings.interval),
    )
    .addOption(
      new Option("--source <source>", "the source")
        .choices(["moralis", "geckoterminal"])
        .conflicts("dexToolsOnly"),
    )
    .option("--dex-tools-only", "ask DexTools alone", settings.dexToolsOnly)
    .option("--name <name>", "a name with no check", settings.name);
  command.parse(typed, { from: "user" });
  return { command, errors };
}

describe("checkDefaults", () => {
  it("passes defaults that their options' checks take", () => {
    const { command, errors } = parsed({
      count: 1000,
      interval: "daily",
      dexToolsOnly: false,
      name: "any",
    });
    assert.doesNotThrow(() => checkDefaults(command, "config.json"));
    assert.deepEqual(errors, []);
  });

  it("refuses a default its option's parser refuses, naming the settings file and the option", () => {
    const { command, errors } = parsed({ count: 0 });
    const message =
      "error: config.json gives option '--count <number>' the value '0', which is invalid. Not a whole number above 0.";
    assert.throws(() => checkDefaults(command, "config.json"), {
      code: "commander.invalidArgument",
      exitCode: 1,
      message,
    });
    assert.deepEqual(errors, [`${message}\n`]);
  });

  it("refuses a default outside its option's choices", () => {
    const { command } = parsed({ interval: "monthly" });
    assert.throws(() => checkDefaults(command, "config.json"), {
      code: "commander.invalidArgument",
      message:
        "error: config.json gives option '--interval <interval>' the value 'monthly', which is invalid. Allowed choices are hourly, daily.",
    });
  });

  it("checks no typed value again, and passes over a null or a false default", () => {
    const { command } = parsed(
      { count: null, dexToolsOnly: false, interval: null },
      ["--count", "5"],
    );
    assert.doesNotThrow(() => checkDefaults(command, "config.json"));
    assert.equal(command.opts().count, 5);
  });

  it("refuses a typed option that conflicts with one the settings file sets", () => {
    const { command } = parsed({ dexToolsOnly: true }, ["--source", "moralis"]);
    assert.throws(() => checkDefaults(command, "config.json"), {
      code: "commander.conflictingOption",
      exitCode: 1,
      message:
        "error: option '--source <source>' cannot be used with option '--dex-tools-only', which config.json sets",
    });
  });

  it("passes conflicting options when the settings file sets neither, and leaves two typed ones to commander", () => {
    const { command } = parsed({ dexToolsOnly: false }, [
      "--source",
      "moralis",
    ]);
    assert.doesNotThrow(() => checkDefaults(command, "config.json"));
    assert.throws(
      () => parsed({}, ["--source", "moralis", "--dex-tools-only"]),
      { code: "commander.conflictingOption" },
    );
  });

  it("knows a refusal by its code, from any copy of commander, and lets any other error through", () => {
    const refusal = Object.assign(new Error("Refused by another copy."), {
      code: "commander.invalidArgument",
    });
    const command = new Command("tool")
      .exitOverride()
      .configureOutput({ writeErr: () => {} })
      .option(
        "--one <value>",
        "refused by a copy of commander's error",
        () => {
          throw refusal;
        },
        "x",
      );
    command.parse([], { from: "user" });
    assert.throws(() => checkDefaults(command, "settings.json"), {
      message:
        "error: settings.json gives option '--one <value>' the value 'x', which is invalid. Refused by another copy.",
    });
    const broken = new Command("tool").option(
      "--two <value>",
      "a parser that breaks",
      () => {
        throw new TypeError("the parser broke");
      },
      "y",
    );
    broken.parse([], { from: "user" });
    assert.throws(() => checkDefaults(broken, "settings.json"), {
      name: "TypeError",
      message: "the parser broke",
    });
  });
});
