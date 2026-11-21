/**
 * The tool's settings.
 * @module config
 *
 * `config-example.json` holds the settings as committed, with no api key.
 * `config.json`, beside it, is the owner's own copy, which git ignores, so
 * the CoinGecko key goes there and never into the repo. Each setting in
 * `config.json` takes the place of the same setting in
 * `config-example.json`, so `config.json` needs only the settings that
 * differ, and without it the tool runs on the committed settings, asking
 * CoinGecko without a key.
 *
 * Nothing is read as this module loads: the entry point, `index.js`, and
 * the pool source, when it first needs a setting, call `loadConfig`. *
 * @version 1.0.0
 * @author Christopher M. Balz with Grok and Claude.ai
 */

import fs from "fs";

/** The settings as committed. */
const COMMITTED_SETTINGS = new URL("./config-example.json", import.meta.url);

/** The owner's own settings, which git ignores. */
const OWN_SETTINGS = new URL("./config.json", import.meta.url);

/**
 * Reads a settings file.
 *
 * @param {URL} file - The file
 * @returns {Object} Its settings
 */
function readSettings(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Reads the settings: the committed ones, with the owner's own laid over
 * them when `config.json` exists.
 *
 * @returns {Object} The settings
 */
export function loadConfig() {
  const own = fs.existsSync(OWN_SETTINGS) ? readSettings(OWN_SETTINGS) : {};
  return { ...readSettings(COMMITTED_SETTINGS), ...own };
}
