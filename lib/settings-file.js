/**
 * Reads a file of settings written in JSON, such as a tool's `config.json`.
 * @module lib/settings-file
 *
 * What: a tool keeps its settings in a JSON file, which may be the owner's
 * own and absent from a fresh checkout, or one the tool cannot run
 * without. `readSettingsFile` reads it by one rule: a missing file gives
 * no settings, so the tool runs on its defaults, unless the caller marks
 * the file required; a file that cannot be read, is not JSON, or holds no
 * JSON object is an error that names the file, so a broken file never
 * passes for a missing one.
 *
 * Fit: the Sheets runner reads a Node version's config file with it
 * (`apps-script-runner/config-file.js`), and the projects that install this
 * repo read their `config.json` with it, as
 * `crypto-price-fetchers/lib/settings-file`.
 */

import fs from "node:fs";

/**
 * Reads a settings file.
 *
 * @param {string} file - The file's path
 * @param {Object} [options] - How to read it
 * @param {boolean} [options.required=false] - Whether a missing file is an error, rather than no settings
 * @returns {Object<string, *>} The settings: the file's JSON object, or an empty object for a missing file that is not required
 * @throws {Error} When the file cannot be read, or is missing and required, is not JSON, or holds no JSON object
 */
export function readSettingsFile(file, { required = false } = {}) {
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
  return settings;
}
