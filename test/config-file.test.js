/**
 * Tests for reading a Node version's config file, and laying opened keys
 * over its values.
 * @module test/config-file.test
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  layConfig,
  readConfigFile,
} from "../apps-script-runner/config-file.js";
import { KINDS } from "../lib/settings-schema.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

describe("readConfigFile", () => {
  let folder;

  before(() => {
    folder = makeTempFolder("config");
  });

  after(removeTempFolders);

  /**
   * Writes a file into the test's folder.
   *
   * @param {string} name - The file's name
   * @param {string} text - What it holds
   * @returns {string} Its path
   */
  function write(name, text) {
    const file = path.join(folder, name);
    fs.writeFileSync(file, text);
    return file;
  }

  it("reads the values for the config objects", () => {
    const file = write("config.json", '{ "CONFIG": { "CACHE_SECONDS": 60 } }');
    assert.deepEqual(readConfigFile(file), { CONFIG: { CACHE_SECONDS: 60 } });
  });

  it("reads a missing optional file as no values", () => {
    assert.deepEqual(readConfigFile(path.join(folder, "missing.json")), {});
  });

  it("refuses a missing file that is required, naming it", () => {
    const file = path.join(folder, "missing.json");
    assert.throws(
      () => readConfigFile(file, { required: true }),
      (error) => error.message.startsWith(`Cannot read ${file}: `),
    );
  });

  it("refuses a file that is not JSON", () => {
    const file = write("broken.json", '{ "CONFIG": ');
    assert.throws(() => readConfigFile(file), /is not valid JSON/);
  });

  it("refuses JSON that is not an object", () => {
    assert.throws(
      () => readConfigFile(write("list.json", '["k"]')),
      /holds no JSON object/,
    );
    assert.throws(
      () => readConfigFile(write("null.json", "null")),
      /holds no JSON object/,
    );
  });

  describe("with the Node version's schemas of its config objects", () => {
    /** A config object's schema, as a Node version writes one. */
    const SCHEMAS = {
      CONFIG: {
        type: "object",
        additionalProperties: false,
        properties: {
          CACHE_SECONDS: KINDS.wholeAbove0,
          BASE_URL: KINDS.url,
        },
        description: "fields of CONFIG",
      },
    };

    it("reads the values that hold to the schemas", () => {
      const file = write("good.json", '{ "CONFIG": { "CACHE_SECONDS": 60 } }');
      assert.deepEqual(readConfigFile(file, { schemas: SCHEMAS }), {
        CONFIG: { CACHE_SECONDS: 60 },
      });
    });

    it("refuses an object or field the schemas do not name, an api key among them, and a value of the wrong kind, listing every problem", () => {
      const file = write(
        "wrong.json",
        JSON.stringify({
          CONFIG: { CACHE_SECONDS: 0, BASE_URL: "ftp://x", API_KEY: "k" },
          OTHER_CONFIG: {},
        }),
      );
      assert.throws(() => readConfigFile(file, { schemas: SCHEMAS }), {
        message: [
          `${file} → OTHER_CONFIG is not a setting this tool reads`,
          `${file} → CONFIG.API_KEY is not a setting this tool reads`,
          `${file} → CONFIG.CACHE_SECONDS must be a whole number above 0; it is 0`,
          `${file} → CONFIG.BASE_URL must be an http or https url; it is "ftp://x"`,
        ].join("\n"),
      });
    });

    it("reads a missing optional file as no values, checking nothing", () => {
      assert.deepEqual(
        readConfigFile(path.join(folder, "absent.json"), { schemas: SCHEMAS }),
        {},
      );
    });
  });
});

describe("layConfig", () => {
  it("lays values over a config, object by object, keeping its other fields", () => {
    const config = {
      CONFIG: { CACHE_SECONDS: 60, API_KEY: "placeholder" },
      OTHER: { A: 1 },
    };
    assert.deepEqual(
      layConfig(config, {
        CONFIG: { API_KEY: "opened-key" },
        X1_CONFIG: { API_KEY: "x1-key" },
      }),
      {
        CONFIG: { CACHE_SECONDS: 60, API_KEY: "opened-key" },
        OTHER: { A: 1 },
        X1_CONFIG: { API_KEY: "x1-key" },
      },
    );
    assert.deepEqual(config.CONFIG.API_KEY, "placeholder");
  });
});
