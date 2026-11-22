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
 * A project's top `config.json` also lists the api keys its programs use,
 * under `apiKeys`, for the key manager; that is no config object of a
 * script, so `readConfigFile` leaves it out.
 *
 * Fit: the command lines read their `--config` file with this
 * (`command-line.js`), and a program that imports a Node version can too.
 */

import { readSettingsFile } from "../lib/settings-file.js";
import { KINDS } from "../lib/settings-schema.js";

/**
 * The JSON Schema of a config file: each of the script's config objects
 * the schemas name, by name, and the project's `apiKeys` list, which the
 * key store reads; no other key.
 *
 * @param {Object<string, Object>} schemas - Each config object's JSON Schema, by its name in the script
 * @returns {Object} The file's schema
 */
export function configFileSchema(schemas) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ...schemas,
      apiKeys: {
        type: "array",
        uniqueItems: true,
        items: KINDS.text,
        description:
          "a list of the services whose keys the programs send, each once",
      },
    },
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
 * @returns {Object<string, Object>} The values, by config object, without the project's `apiKeys` list
 * @throws {Error} When the file cannot be read (or is missing and required), is not JSON, holds no JSON object, or has a problem the schemas find, every problem listed
 */
export function readConfigFile(file, { required = false, schemas } = {}) {
  const values = {
    ...readSettingsFile(file, {
      required,
      schema: schemas === undefined ? undefined : configFileSchema(schemas),
    }),
  };
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
  for (const [name, fields] of Object.entries(overlay))
    laid[name] = { ...(config[name] ?? {}), ...fields };
  return laid;
}
