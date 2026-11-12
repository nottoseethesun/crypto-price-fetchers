/**
 * The runner that runs Sheets scripts under Node, unchanged: what the Node
 * versions of the Sheets scripts import.
 * @module apps-script-runner
 *
 * What: a Sheets script (`.gs`) is Google Apps Script. Its Node version
 * runs the same file under Node, so a fix to the script is a fix to both,
 * and supplies the Apps Script services the script calls. This module
 * gathers what the Node versions use:
 *
 * - `openAppsScript` loads a script in a worker thread and returns its
 *   functions as async calls (`run-apps-script.js`), and
 *   `openScriptFunctions` returns the named ones under their Sheets names,
 *   with the config read from the Node version's config file
 *   (`open-script-functions.js`).
 * - `readConfigFile` reads a Node version's `config.json`, the values it
 *   sets in the script's config objects, such as api keys
 *   (`config-file.js`).
 * - `runScriptCommandLine` and `isEntryPoint` make a Node version a
 *   command line (`command-line.js`); `InvalidArgumentError` and `Option`
 *   are commander's, for checking an argument as it is parsed and for an
 *   option with set choices.
 * - `createAppsScriptServices`, `loadAppsScript`, `applyConfig` and
 *   `callScriptFunction` run a script in the calling thread, which is how
 *   tests run one with stand-in services.
 *
 * Fit: the Node versions in this repo import this file; pulsechain-analytics
 * installs this repo and imports it as `crypto-price-fetchers/apps-script-runner`.
 */

export { InvalidArgumentError, Option } from 'commander';
export { createAppsScriptServices } from './apps-script-services.js';
export { isEntryPoint, runScriptCommandLine } from './command-line.js';
export { readConfigFile } from './config-file.js';
export { applyConfig, callScriptFunction, loadAppsScript } from './load-apps-script.js';
export { openScriptFunctions } from './open-script-functions.js';
export { DEFAULT_REQUEST_TIMEOUT_MS, openAppsScript } from './run-apps-script.js';
