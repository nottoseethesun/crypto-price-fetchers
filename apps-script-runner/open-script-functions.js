/**
 * Opens a Sheets script as the module of its Node version: its functions,
 * by name, as async calls.
 * @module apps-script-runner/open-script-functions
 *
 * What: each Node version of a Sheets script exports one open function,
 * such as `openCryptoPriceFetchers`, that returns the script's Sheets
 * functions under their Sheets names, taking the same arguments and
 * returning what the cell would show, plus `close`. `openScriptFunctions`
 * is that open function's body, written once.
 *
 * How: the values for the script's config objects come from `config` when
 * the caller passes them, or else from a config file: `configFile` when
 * named, which must then exist, or the Node version's default file, which
 * may be missing (`readConfigFile`). The script opens once
 * (`openAppsScript`), and each function calls into it.
 *
 * Fit: the Node versions' open functions call this.
 */

import { readConfigFile } from './config-file.js';
import { openAppsScript } from './run-apps-script.js';

/**
 * Opens a Sheets script and returns the named functions as async calls.
 *
 * @param {string|URL} scriptPath - The `.gs` file
 * @param {string[]} names - The script's functions to return
 * @param {Object} options - How to open it
 * @param {string} options.defaultConfigFile - The Node version's config file, used when neither `config` nor `configFile` is given; it may be missing
 * @param {Object<string, Object>} [options.config] - Values for the script's config objects, in place of a file
 * @param {string} [options.configFile] - A config file to read in place of the default; it must exist
 * @param {function(string, Object): Promise<Response>} [options.fetch] - Does the script's web requests, in place of Node's fetch
 * @param {?function({level: string, text: string}): void} [options.onLog] - Takes each line the script logs
 * @returns {Promise<Object<string, function(...*): Promise<*>>>} The functions by name, and `close`
 * @throws {Error} When the config file cannot be read, or the script cannot be opened (`openAppsScript`)
 */
export async function openScriptFunctions(scriptPath, names, options) {
  const { defaultConfigFile, config, configFile, fetch, onLog } = options;
  const values =
    config ?? readConfigFile(configFile ?? defaultConfigFile, { required: configFile !== undefined && configFile !== null });
  const script = await openAppsScript(scriptPath, { config: values, fetch, onLog });
  const functions = { close: script.close };
  for (const name of names) {
    functions[name] = (...args) => script.call(name, ...args);
  }
  return functions;
}
