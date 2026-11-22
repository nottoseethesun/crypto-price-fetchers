/**
 * Tests for the JSON Schemas each Node version gives the config objects of
 * its Sheets script (`CONFIG_SCHEMAS`), which its config.json is checked
 * against before the script opens and before the build sets the values.
 * @module test/config-schemas.test
 *
 * The runner's check (`apps-script-runner/config-schema-check.js`) is
 * tested on a fixture script, then run on each Node version's schemas, its
 * script loaded as the build joins it. A config.json is then checked
 * against the schemas as the runner and the build check it.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { APPS_SCRIPTS } from "../apps-script-build/index.js";
import { readConfigFile } from "../apps-script-runner/config-file.js";
import { configSchemaProblems } from "../apps-script-runner/config-schema-check.js";
import { KINDS } from "../lib/settings-schema.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

/** The fixture script the check's own tests run on. */
const CHECK_SCRIPT = new URL(
  "./fixtures/config-schema-check.gs",
  import.meta.url,
);

describe("configSchemaProblems, on a script whose object has a field read as it loads, one read when called, and a key", () => {
  /** The fixture's object's schema, naming only what a config may set. */
  const FITTING = {
    SETTINGS: {
      type: "object",
      additionalProperties: false,
      properties: { WAIT_MS: KINDS.wholeAtLeast0 },
      description: "fields of SETTINGS",
    },
  };

  /** The fixture's key, as a Node version's keyConfig would set it. */
  const KEY_FIELDS = { SETTINGS: { API_KEY: "k" } };

  it("finds no problem in a schema that names each field read when called, and no other", () => {
    assert.deepEqual(
      configSchemaProblems({
        files: [CHECK_SCRIPT],
        configSchemas: FITTING,
        keyFields: KEY_FIELDS,
      }),
      [],
    );
  });

  it("names a field read as the script loads, an api key, a field the object lacks, and a field read when called that no schema names", () => {
    assert.deepEqual(
      configSchemaProblems({
        files: [CHECK_SCRIPT],
        configSchemas: {
          SETTINGS: {
            type: "object",
            additionalProperties: false,
            properties: {
              HOST: KINDS.url,
              API_KEY: { type: "string", description: "text" },
              RETRIES: KINDS.wholeAbove0,
            },
          },
        },
        keyFields: KEY_FIELDS,
      }),
      [
        "SETTINGS.HOST is read as the script loads, so a value laid after the load does not reach it, and its schema names it",
        "SETTINGS.API_KEY holds an api key, which the key store sets, and its schema names it",
        "SETTINGS.RETRIES is named in its schema, and the script's SETTINGS has no such field",
        "SETTINGS.WAIT_MS is not read as the script loads, so a config may set it, and no schema names it",
      ],
    );
  });

  it("names a value the script gives that its schema refuses", () => {
    assert.deepEqual(
      configSchemaProblems({
        files: [CHECK_SCRIPT],
        configSchemas: {
          SETTINGS: {
            type: "object",
            additionalProperties: false,
            properties: { WAIT_MS: KINDS.text },
          },
        },
        keyFields: KEY_FIELDS,
      }),
      [
        "the script's SETTINGS → WAIT_MS must be text that is not empty; it is 100",
      ],
    );
  });

  it("names an object the script does not declare as the check looks for it", () => {
    assert.deepEqual(
      configSchemaProblems({
        files: [fileURLToPath(CHECK_SCRIPT)],
        configSchemas: { ...FITTING, OTHER: { type: "object" } },
        keyFields: KEY_FIELDS,
      }),
      [
        'OTHER is not declared once as "const OTHER = {", down to a line "};", as the check needs',
      ],
    );
  });
});

for (const spec of APPS_SCRIPTS) {
  it(`${spec.name}'s schemas fit its config objects, each field the script reads when called named, and the script's own values taken`, () => {
    assert.deepEqual(
      configSchemaProblems({
        files: spec.files.map((file) => file.path),
        configSchemas: spec.configSchemas,
        keyFields: spec.keyConfig(
          Object.fromEntries(spec.services.map((service) => [service, "key"])),
        ),
      }),
      [],
    );
  });
}

describe("a config.json checked against a Node version's schemas", () => {
  const [dexTools, exchange] = APPS_SCRIPTS;
  let folder;

  before(() => {
    folder = makeTempFolder("config-schemas");
  });

  after(removeTempFolders);

  /**
   * Writes a config.json into a temp folder and reads it as the spec's
   * Node version reads it.
   *
   * @param {Object} spec - The Node version's build spec
   * @param {Object} values - What the file holds
   * @returns {{file: string, read: function(): Object}} The file, and its reading
   */
  function configOf(spec, values) {
    const file = `${folder}/config-${spec.name}.json`;
    fs.writeFileSync(file, JSON.stringify(values));
    return {
      file,
      read: () => readConfigFile(file, { schemas: spec.configSchemas }),
    };
  }

  it("is refused when it sets a field the script reads as it loads, or an api key, naming each", () => {
    const { file, read } = configOf(dexTools, {
      DEXTOOLS_CONFIG: { SUBSCRIPTION_PLAN: "pro", API_KEY: "k" },
      X1_CONFIG: { API_HOST: "https://api.x1.ninja" },
    });
    assert.throws(read, {
      message: [
        `${file} → X1_CONFIG is not a setting this tool reads`,
        `${file} → DEXTOOLS_CONFIG.SUBSCRIPTION_PLAN is not a setting this tool reads`,
        `${file} → DEXTOOLS_CONFIG.API_KEY is not a setting this tool reads`,
      ].join("\n"),
    });
  });

  it("is refused when a url, a time or a time zone is of the wrong kind, listing every problem", () => {
    const { file, read } = configOf(exchange, {
      CONFIG: {
        EXCHANGE_BASE_URL: "ftp://api.mexc.com/api/v3",
        QUOTE_CURRENCY: "EUR",
        TIMEZONE_OFFSETS: { UTC: 1, est: -5, IST: 15 },
        CACHE_EXPIRY_SECONDS: { DAILY_PRICE: 86400 },
        RETRY_DELAYS_MS: [5000, -1],
        MAX_LOCK_RETRIES: 0,
      },
    });
    assert.throws(read, {
      message: [
        `${file} → CONFIG.EXCHANGE_BASE_URL must be an http or https url; it is "ftp://api.mexc.com/api/v3"`,
        `${file} → CONFIG.QUOTE_CURRENCY must be USDT or USDC, a USD stablecoin MEXC quotes pairs in, as CoinGecko and CoinPaprika answer in USD; it is "EUR"`,
        `${file} → CONFIG.TIMEZONE_OFFSETS has the key "est", which must be a time zone's abbreviation, with no lower-case letter`,
        `${file} → CONFIG.TIMEZONE_OFFSETS.IST must be an offset from UTC in hours, from -12 to 14; it is 15`,
        `${file} → CONFIG.TIMEZONE_OFFSETS.UTC must be 0; it is 1`,
        `${file} → CONFIG.CACHE_EXPIRY_SECONDS.NEGATIVE_CACHE is missing`,
        `${file} → CONFIG.CACHE_EXPIRY_SECONDS.DAILY_PRICE must be a whole number of seconds from 1 to 21600; it is 86400`,
        `${file} → CONFIG.RETRY_DELAYS_MS[1] must be a whole number of at least 0; it is -1`,
        `${file} → CONFIG.MAX_LOCK_RETRIES must be a whole number above 0; it is 0`,
      ].join("\n"),
    });
  });

  it("gives the values that hold to the schemas, the project's list of api keys left out", () => {
    const { read } = configOf(exchange, {
      apiKeys: ["coingecko"],
      CONFIG: {
        COINGECKO_BASE: "https://pro-api.coingecko.com/api/v3",
        TIMEZONE_OFFSETS: { UTC: 0, IST: 5.5 },
      },
    });
    assert.deepEqual(read(), {
      CONFIG: {
        COINGECKO_BASE: "https://pro-api.coingecko.com/api/v3",
        TIMEZONE_OFFSETS: { UTC: 0, IST: 5.5 },
      },
    });
  });
});
