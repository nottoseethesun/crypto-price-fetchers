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

  it("leaves out the project's list of api keys, which is no config object of the script", () => {
    const file = write(
      "with-keys.json",
      '{ "apiKeys": ["dextools"], "CONFIG": { "CACHE_SECONDS": 60 } }',
    );
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
