/**
 * The tool's settings, each checked against the settings' JSON Schema
 * before the tool takes it.
 * @module config
 *
 * `config-example.json` holds the settings as committed. `config.json`,
 * beside it, is the owner's own copy, which git ignores. Each setting in
 * `config.json` takes the place of the same setting in
 * `config-example.json`, so `config.json` needs only the settings that
 * differ, and without it the tool runs on the committed settings. No api
 * key is a setting: the keys are kept in the repo's key store
 * (`api-key-store/`).
 *
 * Both files are read with `readSettingsFile` (`lib/settings-file.js`) and
 * held to `SETTINGS_SCHEMA`, which names each setting the tool reads and
 * refuses any other, so a misspelled setting or a value of the wrong kind
 * stops the run, with every problem listed, before a price is asked.
 *
 * Nothing is read as this module loads: the entry point, `index.js`, and
 * the pool source, when it first needs a setting, call `loadConfig`.
 *
 * @version 1.0.0
 * @author Christopher M. Balz with Grok and Claude.ai
 */

import path from "path";
import { fileURLToPath } from "url";
import { readSettingsFile } from "../../lib/settings-file.js";
import { KINDS } from "../../lib/settings-schema.js";

/** The settings as committed. */
const COMMITTED_SETTINGS = fileURLToPath(
  new URL("./config-example.json", import.meta.url),
);

/** The owner's own settings, which git ignores. */
const OWN_SETTINGS = fileURLToPath(new URL("./config.json", import.meta.url));

/**
 * The JSON Schema of both settings files: the settings the tool reads,
 * each of its kind, and no other.
 */
export const SETTINGS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    GECKOTERMINAL_TOP_POOLS_CONSIDERED: KINDS.wholeAbove0,
    BACKFILL_HIGHEST: KINDS.bool,
    BACKFILL_LOWEST: KINDS.bool,
  },
});

/**
 * A settings file's name in a problem, such as
 * 'crypto-price-filler/config.json'.
 *
 * @param {string} file - The file's path
 * @returns {string} The name
 */
function nameOf(file) {
  return `crypto-price-filler/${path.basename(file)}`;
}

/**
 * Reads the settings: the committed ones, with the owner's own laid over
 * them when `config.json` exists, each file checked against
 * `SETTINGS_SCHEMA`.
 *
 * @param {Object} [files] - The files to read, which a test names
 * @param {string} [files.committedFile] - The committed settings, `config-example.json` beside this file
 * @param {string} [files.ownFile] - The owner's own settings, `config.json` beside this file
 * @returns {Object} The settings
 * @throws {Error} When a file cannot be read or is not JSON, the committed one is missing, or the schema finds a problem in either, every problem listed
 */
export function loadConfig({
  committedFile = COMMITTED_SETTINGS,
  ownFile = OWN_SETTINGS,
} = {}) {
  const committed = readSettingsFile(committedFile, {
    required: true,
    schema: SETTINGS_SCHEMA,
    name: nameOf(committedFile),
  });
  const own = readSettingsFile(ownFile, {
    schema: SETTINGS_SCHEMA,
    name: nameOf(ownFile),
  });
  return { ...committed, ...own };
}
