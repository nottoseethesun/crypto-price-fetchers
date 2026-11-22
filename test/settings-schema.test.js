/**
 * Tests for `lib/settings-schema.js`: a settings file's schema compiled by
 * Ajv, strict, with the formats code checks; the kinds of value with the
 * words a refusal uses; an option parser made from a kind; and the
 * problems a file has, in those words.
 * @module test/settings-schema.test
 *
 * The schemas and settings are written here, as a project writes its own.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  asWholeNumber,
  compileSettingsSchema,
  KINDS,
  kindParser,
  settingsProblems,
} from "../lib/settings-schema.js";

/** HEX's contract on PulseChain in lower case, not EIP-55's form, for the schema to refuse. */
const LOWER_CASE_ADDRESS = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";

/** A settings file's schema, as a project builds one from the kinds. */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rpcUrl"],
  properties: {
    rpcUrl: KINDS.url,
    maxCandles: KINDS.wholeAbove0,
    epochs: KINDS.wholeAbove0OrNone,
    verbose: KINDS.bool,
    wallet: KINDS.address,
    dextools: {
      type: "object",
      additionalProperties: false,
      properties: { host: KINDS.url, plan: KINDS.text },
    },
    apiKeys: {
      type: "array",
      uniqueItems: true,
      items: { enum: ["dextools", "moralis"], description: "a service" },
      description: "a list of services, each once",
    },
  },
};

describe("compileSettingsSchema", () => {
  it("passes settings that hold to the schema", () => {
    const validate = compileSettingsSchema(SCHEMA);
    assert.ok(
      validate({
        rpcUrl: "https://rpc.test",
        maxCandles: 1000,
        epochs: null,
        verbose: false,
        wallet: "0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39",
        dextools: { host: "https://public-api.dextools.io", plan: "standard" },
        apiKeys: ["dextools"],
      }),
    );
  });

  it("refuses a schema with a keyword Ajv does not know, as strict asks", () => {
    assert.throws(
      () => compileSettingsSchema({ type: "string", colour: "red" }),
      /unknown keyword: "colour"/,
    );
  });

  it("checks a project's own format beside the shared ones", () => {
    const validate = compileSettingsSchema(
      { type: "string", format: "even-length" },
      { "even-length": (text) => text.length % 2 === 0 },
    );
    assert.ok(validate("ab"));
    assert.ok(!validate("abc"));
  });
});

describe("settingsProblems", () => {
  it("names every value at fault at once, in the words of its kind", () => {
    const problems = settingsProblems(
      "config.json",
      compileSettingsSchema(SCHEMA),
      {
        maxCandles: 0,
        epochs: "two",
        verbose: "yes",
        wallet: LOWER_CASE_ADDRESS,
        colour: "red",
        dextools: { host: "ftp://x", tier: "pro" },
        apiKeys: ["moralis", "moralis"],
      },
    );
    assert.deepEqual(problems, [
      "config.json → rpcUrl is missing",
      "config.json → colour is not a setting this tool reads",
      "config.json → maxCandles must be a whole number above 0; it is 0",
      'config.json → epochs must be a whole number above 0, or null for none; it is "two"',
      'config.json → verbose must be true or false; it is "yes"',
      `config.json → wallet must be an EIP-55 address; it is "${LOWER_CASE_ADDRESS}"`,
      "config.json → dextools.tier is not a setting this tool reads",
      'config.json → dextools.host must be an http or https url; it is "ftp://x"',
      'config.json → apiKeys must be a list of services, each once; it is ["moralis","moralis"]',
    ]);
  });

  it("finds no problem in settings that hold to the schema", () => {
    assert.deepEqual(
      settingsProblems("config.json", compileSettingsSchema(SCHEMA), {
        rpcUrl: "http://127.0.0.1:8545",
      }),
      [],
    );
  });

  it("refuses a value no shape of a choice fits in one line, in the words of the schema that offers the choice", () => {
    const span = {
      type: "object",
      additionalProperties: false,
      properties: { days: KINDS.wholeAbove0, from: KINDS.text, to: KINDS.text },
      oneOf: [
        { type: "object", properties: { days: true }, required: ["days"] },
        {
          type: "object",
          properties: { from: true, to: true },
          required: ["from", "to"],
        },
      ],
      description: "a span: days, or a from and a to",
    };
    const validate = compileSettingsSchema({
      type: "object",
      additionalProperties: false,
      properties: { span },
    });
    assert.deepEqual(settingsProblems("config.json", validate, { span: {} }), [
      "config.json → span must be a span: days, or a from and a to; it is {}",
    ]);
    assert.deepEqual(
      settingsProblems("config.json", validate, {
        span: { days: 3, from: "a", to: "b" },
      }),
      [
        'config.json → span must be a span: days, or a from and a to; it is {"days":3,"from":"a","to":"b"}',
      ],
    );
    assert.deepEqual(
      settingsProblems("config.json", validate, { span: { days: 0 } }),
      ["config.json → span.days must be a whole number above 0; it is 0"],
    );
  });

  it("names a key another key needs as missing, and the key that needs it", () => {
    const validate = compileSettingsSchema({
      type: "object",
      additionalProperties: false,
      properties: { from: KINDS.text, to: KINDS.text },
      dependentRequired: { from: ["to"] },
    });
    assert.deepEqual(settingsProblems("config.json", validate, { from: "a" }), [
      "config.json → to is missing, since from is set",
    ]);
  });
});

describe("kindParser", () => {
  it("reads and checks a typed value with its kind, refusing it in the kind's words", () => {
    const count = kindParser(KINDS.wholeAbove0, asWholeNumber);
    assert.equal(count("1000"), 1000);
    for (const typed of ["0", "-3", "1.5", "1e3", " 7", "two"]) {
      assert.throws(() => count(typed), {
        code: "commander.invalidArgument",
        message: "Not a whole number above 0.",
      });
    }
    const url = kindParser(KINDS.url);
    assert.equal(url("https://rpc.test"), "https://rpc.test");
    assert.throws(() => url("ftp://x"), {
      message: "Not an http or https url.",
    });
  });
});
