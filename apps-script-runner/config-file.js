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
 * How: `readConfigFile` reads and parses the file with `readSettingsFile`
 * (`lib/settings-file.js`). A missing file reads as no values when it is
 * optional, as the default file is, so the script runs on the values
 * written in it. A file named on purpose is required. Given the Node
 * version's schemas of its script's config objects, it checks the file
 * against them first (`configFileSchema`): each object a schema of the
 * Node version's own names, each field of the kind of value it takes, and
 * no other, an api key among the fields refused, since no key is a
 * setting; every problem is listed at once.
 *
 * Fit: the command lines read their `--config` file with this
 * (`command-line.js`), and a program that imports a Node version can too.
 */

import { readSettingsFile } from "../lib/settings-file.js";
import { MAX_CACHE_SECONDS } from "./apps-script-services.js";

/**
 * The kind of value of a config field a script hands Apps Script's cache
 * as the seconds to keep a value: a whole number from 1 to 21600, the
 * longest Apps Script's cache keeps one, for a Node version's schemas.
 */
export const CACHE_SECONDS_KIND = Object.freeze({
  type: "integer",
  minimum: 1,
  maximum: MAX_CACHE_SECONDS,
  description: `a whole number of seconds from 1 to ${MAX_CACHE_SECONDS}`,
});

/**
 * The JSON Schema of a config file: each of the script's config objects
 * the schemas name, by name, and no other key.
 *
 * @param {Object<string, Object>} schemas - Each config object's JSON Schema, by its name in the script
 * @returns {Object} The file's schema
 */
export function configFileSchema(schemas) {
  return {
    type: "object",
    additionalProperties: false,
    properties: { ...schemas },
  };
}

/**
 * Reads a config file, checked against the Node version's schemas when it
 * gives them.
 *
 * @param {string} file - The file's path
 * @param {Object} [options] - How to read it
 * @param {boolean} [options.required=false] - Whether a missing file is an error, rather than no values
 * @param {Object<string, Object>} [options.schemas] - Each config object's JSON Schema, by its name in the script (`configFileSchema`)
 * @returns {Object<string, Object>} The values, by config object
 * @throws {Error} When the file cannot be read (or is missing and required), is not JSON, holds no JSON object, or has a problem the schemas find, every problem listed
 */
export function readConfigFile(file, { required = false, schemas } = {}) {
  return {
    ...readSettingsFile(file, {
      required,
      schema: schemas === undefined ? undefined : configFileSchema(schemas),
    }),
  };
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
  for (const [name, fields] of Object.entries(overlay))
    laid[name] = { ...(config[name] ?? {}), ...fields };
  return laid;
}
