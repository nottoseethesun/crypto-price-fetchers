/**
 * Reads the config file of a Node version of a Sheets script, and lays
 * more values over it.
 * @module apps-script-runner/config-file
 *
 * What: a Node version may set fields of its script's config objects from
 * a JSON file, `config.json` beside it, shaped as the script's config
 * objects by name, each with the fields to set:
 * `{ "CONFIG": { "CACHE_SECONDS": 60 } }` (`applyConfig`). No api key is
 * kept there: a Node version opens its keys from the project's encrypted
 * key file (`api-key-store/`) and lays them over the file's values with
 * `layConfig`.
 *
 * How: `readConfigFile` reads and parses the file. A missing file reads as
 * no values when it is optional, as the default file is, so the script
 * runs on the values written in it. A file named on purpose is required.
 * A project's top `config.json` also lists the api keys its programs use,
 * under `apiKeys`, for the key manager; that is no config object of a
 * script, so `readConfigFile` leaves it out.
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
 * @returns {Object<string, Object>} The values, by config object, without the project's `apiKeys` list
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
  const values = { ...config };
  delete values.apiKeys;
  return values;
}

/**
 * Lays values over a config's, object by object: a field given replaces
 * the same field, and the config's other fields stay.
 *
 * @param {Object<string, Object>} config - The values, by config object
 * @param {Object<string, Object>} overlay - The values laid over them, by config object
 * @returns {Object<string, Object>} The values, laid over
 */
export function layConfig(config, overlay) {
  const laid = { ...config };
  for (const [name, fields] of Object.entries(overlay)) laid[name] = { ...(config[name] ?? {}), ...fields };
  return laid;
}
