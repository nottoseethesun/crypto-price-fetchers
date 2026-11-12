/**
 * Reads the config file of a Node version of a Sheets script.
 * @module apps-script-runner/config-file
 *
 * What: each Node version keeps the values it sets in its script's config
 * objects, such as api keys, in a JSON file beside it, `config.json`. Git
 * ignores that file; the committed `config-example.json` beside it shows
 * its shape: `{ "CONFIG": { "API_KEY": "..." } }`, the script's config
 * objects by name, each with the fields to set (`applyConfig`).
 *
 * How: `readConfigFile` reads and parses the file. A missing file reads as
 * no values when it is optional, as the default file is, so the script
 * runs on the values written in it. A file named on purpose is required.
 *
 * Fit: the command lines read their `--config` file with this
 * (`command-line.js`), and a program that imports a Node version can too.
 */

import fs from 'node:fs';

/**
 * Reads a config file.
 *
 * @param {string} file - The file's path
 * @param {Object} [options] - How to read it
 * @param {boolean} [options.required=false] - Whether a missing file is an error, rather than no values
 * @returns {Object<string, Object>} The values, by config object
 * @throws {Error} When the file cannot be read (or is missing and required), is not JSON, or holds no JSON object
 */
export function readConfigFile(file, { required = false } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' && !required) return {};
    throw new Error(`Cannot read the config file ${file}: ${error.message}`);
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new Error(`The config file ${file} is not valid JSON: ${error.message}`);
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`The config file ${file} holds no JSON object`);
  }
  return config;
}
