/**
 * Tests for `lib/settings-file.js`, which reads a file of settings written
 * in JSON: a missing file gives no settings unless it is required, and a
 * file that cannot be read, is not JSON or holds no JSON object is an
 * error that names it.
 * @module test/settings-file.test
 *
 * The files are written in a temp folder of the tests' own
 * (`helpers/temp-folders.js`), removed afterwards.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readSettingsFile } from "../lib/settings-file.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

let folder;

before(() => {
  folder = makeTempFolder("settings");
});

after(removeTempFolders);

/**
 * Writes a file in the tests' folder.
 *
 * @param {string} name - The file's name
 * @param {string} text - Its text
 * @returns {string} Its path
 */
function write(name, text) {
  const file = path.join(folder, name);
  fs.writeFileSync(file, text);
  return file;
}

describe("readSettingsFile", () => {
  it("gives the file's JSON object, every field kept", () => {
    const file = write(
      "config.json",
      '{ "rpcUrl": "https://rpc.test", "apiKeys": ["dextools"], "epochs": null }',
    );
    assert.deepEqual(readSettingsFile(file), {
      rpcUrl: "https://rpc.test",
      apiKeys: ["dextools"],
      epochs: null,
    });
  });

  it("gives no settings for a missing file, unless the caller marks it required", () => {
    const file = path.join(folder, "missing.json");
    assert.deepEqual(readSettingsFile(file), {});
    assert.throws(
      () => readSettingsFile(file, { required: true }),
      (error) => error.message.startsWith(`Cannot read ${file}: ENOENT`),
    );
  });

  it("refuses a file it cannot read, though it is not required", () => {
    // A folder exists but cannot be read as a file
    const file = path.join(folder, "a-folder.json");
    fs.mkdirSync(file);
    assert.throws(
      () => readSettingsFile(file),
      (error) => error.message.startsWith(`Cannot read ${file}: EISDIR`),
    );
  });

  it("refuses a file that is not JSON, naming it, though it is not required", () => {
    const file = write("broken.json", '{ "rpcUrl": ');
    assert.throws(
      () => readSettingsFile(file),
      (error) => error.message.startsWith(`${file} is not valid JSON: `),
    );
  });

  it("refuses JSON that is not an object", () => {
    for (const [name, text] of [
      ["list.json", '["dextools"]'],
      ["null.json", "null"],
      ["number.json", "7"],
    ]) {
      const file = write(name, text);
      assert.throws(() => readSettingsFile(file), {
        message: `${file} holds no JSON object`,
      });
    }
  });
});
