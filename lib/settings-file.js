/**
 * Reads a file of settings written in JSON, such as a tool's `config.json`,
 * and checks it against its JSON Schema before the tool takes a setting.
 * @module lib/settings-file
 *
 * What: a tool keeps its settings in a JSON file, which may be the owner's
 * own and absent from a fresh checkout, or one the tool cannot run
 * without. `readSettingsFile` reads it by one rule: a missing file gives
 * no settings, so the tool runs on its defaults, unless the caller marks
 * the file required; a file that cannot be read, is not JSON, or holds no
 * JSON object is an error that names the file, so a broken file never
 * passes for a missing one. Given the file's schema, it checks the file
 * against it (`lib/settings-schema.js`) and refuses a file with any
 * problem, listing every problem at once, one line each. `checkSettings`
 * is that check alone, for settings a program is about to write, so it
 * never writes a file its next read would refuse.
 *
 * Fit: the Sheets runner reads a Node version's config file with it
 * (`apps-script-runner/config-file.js`), the key store reads and writes
 * its key file with it (`api-key-store/key-file.js`), and the projects that
 * install this repo read their `config.json` with it, as
 * `crypto-price-fetchers/lib/settings-file`.
 */

import fs from "node:fs";
import { compileSettingsSchema, settingsProblems } from "./settings-schema.js";

/**
 * Reads a settings file, and checks it against its schema when given one.
 *
 * @param {string} file - The file's path
 * @param {Object} [options] - How to read it
 * @param {boolean} [options.required=false] - Whether a missing file is an error, rather than no settings
 * @param {Object} [options.schema] - The file's JSON Schema, built from `KINDS` (`lib/settings-schema.js`)
 * @param {Object<string, function(string): boolean>} [options.formats] - The project's own formats the schema names
 * @param {string} [options.name=file] - The file's name in a problem, such as 'chart-price-ratio/config.json'
 * @returns {Object<string, *>} The settings: the file's JSON object, or an empty object for a missing file that is not required
 * @throws {Error} When the file cannot be read, or is missing and required, is not JSON, holds no JSON object, or has a problem its schema finds; then `problems` lists each problem
 */
export function readSettingsFile(
  file,
  { required = false, schema, formats, name = file } = {},
) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" && !required) return {};
    throw new Error(`Cannot read ${file}: ${error.message}`, { cause: error });
  }
  let settings;
  try {
    settings = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }
  if (
    settings === null ||
    typeof settings !== "object" ||
    Array.isArray(settings)
  ) {
    throw new Error(`${file} holds no JSON object`);
  }
  if (schema !== undefined) checkSettings(settings, schema, { formats, name });
  return settings;
}

/**
 * Checks settings against their schema, as `readSettingsFile` checks a
 * file's.
 *
 * @param {*} settings - The settings
 * @param {Object} schema - Their JSON Schema, built from `KINDS` (`lib/settings-schema.js`)
 * @param {Object} options - How to word a problem
 * @param {string} options.name - The file's name in a problem, such as 'api-keys.json'
 * @param {Object<string, function(string): boolean>} [options.formats] - The project's own formats the schema names
 * @returns {void}
 * @throws {Error} When the settings have a problem the schema finds; then `problems` lists each problem
 */
export function checkSettings(settings, schema, { name, formats }) {
  const problems = settingsProblems(
    name,
    compileSettingsSchema(schema, formats),
    settings,
  );
  if (problems.length > 0) {
    throw Object.assign(new Error(problems.join("\n")), { problems });
  }
}
