/**
 * Tests for apps-script-build/built-script.js, which joins the parts of the
 * one file the build step gives and checks that they make one Apps Script
 * project.
 * @module test/built-script.test
 *
 * The parts are short scripts written here, loaded with the runner's
 * services as the build loads them.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAppsScriptServices } from "../apps-script-runner/apps-script-services.js";
import { loadAppsScript } from "../apps-script-runner/load-apps-script.js";
import {
  BUILT_FILE_NAME,
  combinedScript,
  configBlock,
} from "../apps-script-build/built-script.js";

/**
 * Loads a built file as Apps Script would, with the runner's services.
 *
 * @param {string} text - The file
 * @returns {Object} Its context
 */
function loadBuilt(text) {
  return loadAppsScript(
    [{ source: text, filename: BUILT_FILE_NAME }],
    createAppsScriptServices({ fetchSync: () => ({ failure: "no web here" }) }),
  );
}

describe("combinedScript and its block", () => {
  /**
   * Joins parts with an empty preamble.
   *
   * @param {Array<{name: string, source: string}>} parts - The parts
   * @param {Object<string, Object>} [values={}] - Fields to set
   * @param {string[]} [required] - Functions the file must hold
   * @returns {string} The file
   */
  const combine = (parts, values = {}, required = undefined) =>
    combinedScript({ preamble: "/** test */", parts, values, required });

  it("sets each field as JSON, after a dot when it can and in brackets otherwise", () => {
    const block = configBlock({
      CONFIG: { API_KEY: 'a "quoted" key', "odd-name": 2, LIST: [1, "b"] },
    });
    assert.match(block, /^\n\/\/ -+\n\/\/ Set by `npm run build apps-script`/);
    assert.match(block, /\nCONFIG\.API_KEY = "a \\"quoted\\" key";\n/);
    assert.match(block, /\nCONFIG\["odd-name"\] = 2;\n/);
    assert.match(block, /\nCONFIG\.LIST = \[1,"b"\];\n$/);
    assert.equal(configBlock({}), "");
    assert.equal(configBlock({ CONFIG: {} }), "");
  });

  it("names each part before it, and sets the values last, so a field read as the file loads keeps its written value", () => {
    const file = combine(
      [
        {
          name: "first.gs",
          source:
            "const C = { A: 1 };\nconst SEEN = C.A;\nfunction seen() { return SEEN; }",
        },
        { name: "second.gs", source: "function other() { return C.A; }" },
      ],
      { C: { A: 2 } },
    );
    assert.match(file, /\n\/\/ first\.gs\n/);
    assert.ok(file.indexOf("// second.gs") > file.indexOf("// first.gs"));
    const context = loadBuilt(file);
    assert.equal(context.seen(), 1);
    assert.equal(context.other(), 2);
  });

  it("refuses a field the scripts do not have, as a Node version does", () => {
    assert.throws(
      () =>
        combine([{ name: "a.gs", source: "const CONFIG = { A: 1 };" }], {
          CONFIG: { NO_SUCH_FIELD: 1 },
        }),
      /The script's CONFIG has no field NO_SUCH_FIELD/,
    );
  });

  it("refuses two parts that declare one function, where the later would replace the earlier", () => {
    assert.throws(
      () =>
        combine([
          { name: "a.gs", source: "function onOpen() {}" },
          { name: "b.gs", source: "function onOpen() {}" },
        ]),
      /a\.gs and b\.gs both declare onOpen; in one Apps Script project the later would replace the earlier/,
    );
  });

  it("refuses parts that do not load as one file, or one alone", () => {
    assert.throws(
      () =>
        combine([
          { name: "a.gs", source: "const X = 1;" },
          { name: "b.gs", source: "const X = 2;" },
        ]),
      /Loading the built file failed: .*'X' has already been declared/,
    );
    assert.throws(
      () => combine([{ name: "a.gs", source: "throw new Error('boom');" }]),
      /Loading a\.gs alone failed: boom/,
    );
  });

  it("refuses a file that holds no function the caller requires", () => {
    const parts = [{ name: "a.gs", source: "const HOLDER = { f: 1 };" }];
    assert.throws(
      () => combine(parts, {}, ["HOLDER.f"]),
      /The built file holds no function HOLDER\.f/,
    );
    assert.throws(
      () => combine(parts, {}, ["NOWHERE.f"]),
      /The built file holds no function NOWHERE\.f/,
    );
    assert.throws(
      () => combine(parts, {}, ["HOLDER['f']"]),
      /"HOLDER\['f'\]" is not a dotted name/,
    );
  });
});
