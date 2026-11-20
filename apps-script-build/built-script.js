/**
 * A Sheets script as the build gives it for the sheet: its files, the
 * first one ending with the values its Node version sets.
 * @module apps-script-build/built-script
 *
 * What: `builtFiles` reads a script's files and gives each one's text,
 * the first ending with a block of assignments that set the values its
 * Node version would set as it opens the script: the fields of the
 * config.json that version reads, with the api keys laid over them.
 * `configBlock` writes that block.
 *
 * How: each assignment sets a field as the runner sets it under Node
 * (`applyConfig` in `apps-script-runner/load-apps-script.js`): the field's
 * value replaced by the value given, written as JSON. Before the block is
 * written, the script is loaded with the runner's services and the values
 * applied to it, so a field the script does not have stops the build, as
 * it stops the Node version. The block is the first file's last
 * statements, after its top-level code, so a field the script reads as it
 * loads keeps the value written in the file, as under Node.
 *
 * Fit: `index.js` builds each Sheets script listed in it this way, then
 * copies the files to the clipboard or writes them.
 */

import fs from "node:fs";
import { createAppsScriptServices } from "../apps-script-runner/apps-script-services.js";
import {
  applyConfig,
  loadAppsScript,
} from "../apps-script-runner/load-apps-script.js";

/** A field name that can follow a dot. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The comment that opens the block, saying where it came from and how to treat the copy. */
const BLOCK_HEAD = Object.freeze([
  "",
  "// ---------------------------------------------------------------------------",
  "// Set by `npm run build apps-script`, in the crypto-price-fetchers repo,",
  "// from the api keys saved there (npm run api-keys) and the config.json the",
  "// script's Node version reads, as that version sets them. A copy with api",
  "// keys here is for pasting into Apps Script: never commit or share it.",
  "// ---------------------------------------------------------------------------",
]);

/**
 * One file of a Sheets script, as a build spec names it.
 *
 * @typedef {Object} ScriptFile
 * @property {string} path - The file on this computer
 * @property {string} appsScriptName - The name of its script file in Apps Script, without `.gs`
 * @property {boolean} [optional=false] - Whether the sheet works without it, as with in-editor tests
 */

/**
 * One file as the build gives it.
 *
 * @typedef {Object} BuiltFile
 * @property {string} appsScriptName - The name of its script file in Apps Script, without `.gs`
 * @property {boolean} optional - Whether the sheet works without it
 * @property {boolean} holdsKeys - Whether its text holds an api key
 * @property {string} text - Its text, ready to paste
 */

/**
 * Writes the assignments that set the values, after the comment that says
 * where they came from.
 *
 * @param {Object<string, Object>} values - Fields to set, by config object, such as `{ CONFIG: { API_KEY: '...' } }`
 * @returns {string} The block, starting with a line break; empty when there is nothing to set
 */
export function configBlock(values) {
  const lines = [];
  for (const [name, fields] of Object.entries(values)) {
    for (const [field, value] of Object.entries(fields)) {
      const target = IDENTIFIER.test(field)
        ? `${name}.${field}`
        : `${name}[${JSON.stringify(field)}]`;
      lines.push(`${target} = ${JSON.stringify(value)};`);
    }
  }
  if (lines.length === 0) return "";
  return `${[...BLOCK_HEAD, ...lines].join("\n")}\n`;
}

/**
 * Loads the script with the runner's services and applies the values, so
 * a field it does not have is refused as the Node version refuses it.
 *
 * @param {Array<{path: string, source: string}>} files - The script's files, with their text
 * @param {Object<string, Object>} values - Fields to set, by config object
 * @returns {void}
 * @throws {Error} When the script cannot load, or does not have a field named
 */
function checkValues(files, values) {
  const services = createAppsScriptServices({
    fetchSync: () => ({ failure: "The build asks nothing of the web" }),
  });
  const context = loadAppsScript(
    files.map((file) => ({ source: file.source, filename: file.path })),
    services,
  );
  applyConfig(context, values);
}

/**
 * Reads a script's files and gives each one's text, the first ending with
 * the values set.
 *
 * @param {ScriptFile[]} files - The script's files, in the order Apps Script loads them
 * @param {Object<string, Object>} values - Fields to set, by config object: the config's, with the keys laid over them
 * @param {boolean} holdsKeys - Whether the values hold an api key
 * @returns {BuiltFile[]} The files, in the same order
 * @throws {Error} When a file cannot be read, or the script does not have a field named
 */
export function builtFiles(files, values, holdsKeys) {
  const read = files.map((file) => ({
    ...file,
    source: fs.readFileSync(file.path, "utf8"),
  }));
  checkValues(read, values);
  const block = configBlock(values);
  return read.map((file, index) => ({
    appsScriptName: file.appsScriptName,
    optional: file.optional === true,
    holdsKeys: index === 0 && holdsKeys,
    text: index === 0 ? file.source + block : file.source,
  }));
}
