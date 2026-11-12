/**
 * The Node version of crypto-price-fetchers.gs: a token's price and fully
 * diluted value (FDV) in USD, from DexTools, or from x1.ninja for X1, for
 * Node programs and the command line.
 * @module crypto-price-fetchers
 *
 * What: the same answers as the Sheets functions `dexToolsGetTokenPrice`
 * and `dexToolsGetTokenFDV`, worked out by the same code, because this
 * file runs `crypto-price-fetchers.gs` itself, unchanged, through the
 * shared runner (`apps-script-runner/`). The `.gs` file's header says what
 * the two functions take and return: a number, 0 when there is no data, or
 * a message for the cell.
 *
 * How:
 *
 * - `openCryptoPriceFetchers` opens the script once and returns its two
 *   functions as async calls, with the Sheets arguments, plus `close`.
 * - The keys come from `config.json` beside this file, which git ignores:
 *   `CONFIG.API_KEY` for DexTools and `X1_CONFIG.API_KEY` for x1.ninja.
 *   `config-example.json` shows the shape. The script reads both keys each
 *   time it sends a request, so they take effect. A field the script uses
 *   as it loads keeps the value written in the script: `SUBSCRIPTION_PLAN`
 *   and `API_HOST`, which build its DexTools url.
 * - The command line, `node crypto-price-fetchers.js price <chain> <token>`
 *   or `fdv <chain> <token>`, with `--pool <address>` for a pool, prints the
 *   number (`--help` gives the rest).
 *
 * What differs from the sheet: it runs on this computer, so there is no
 * 30-second limit per call and no daily cap on requests. The cache and the
 * time of the last call, which spaces calls out, last while the script is
 * open: one run of the command line. The sheet's menu is not here.
 *
 * Fit: beside `crypto-price-fetchers.gs`, which stays the one copy of the
 * logic, so a fix to it is a fix to both.
 */

import { fileURLToPath } from 'node:url';
import {
  InvalidArgumentError,
  isEntryPoint,
  openScriptFunctions,
  runScriptCommandLine
} from './apps-script-runner/index.js';

/** The Sheets script this runs. */
export const SHEETS_SCRIPT = new URL('./crypto-price-fetchers.gs', import.meta.url);

/** The config file read when none is named. */
export const DEFAULT_CONFIG_FILE = fileURLToPath(new URL('./config.json', import.meta.url));

/** The script's Sheets functions. */
const FUNCTION_NAMES = ['dexToolsGetTokenPrice', 'dexToolsGetTokenFDV'];

/**
 * Opens the script and returns its Sheets functions as async calls.
 *
 * @param {Object} [options] - How to open it (`openScriptFunctions`)
 * @param {Object<string, Object>} [options.config] - Values for the script's config objects, in place of the config file
 * @param {string} [options.configFile] - A config file in place of `config.json` beside this file
 * @param {function(string, Object): Promise<Response>} [options.fetch] - Does the script's web requests, in place of Node's fetch
 * @param {?function({level: string, text: string}): void} [options.onLog] - Takes each line the script logs
 * @returns {Promise<{dexToolsGetTokenPrice: function(string, string, Array=, number=): Promise<number|string>, dexToolsGetTokenFDV: function(string, string, Array=, number=): Promise<number|string>, close: function(): Promise<void>}>} The functions, with the Sheets arguments
 */
export function openCryptoPriceFetchers(options = {}) {
  return openScriptFunctions(SHEETS_SCRIPT, FUNCTION_NAMES, { ...options, defaultConfigFile: DEFAULT_CONFIG_FILE });
}

/**
 * Checks that an argument is not empty.
 *
 * @param {string} value - The argument
 * @returns {string} The argument
 * @throws {InvalidArgumentError} When it is empty
 */
function notEmpty(value) {
  if (value.trim() === '') throw new InvalidArgumentError('It is empty.');
  return value;
}

/**
 * The pool argument as the script takes it from a Sheets cell range:
 * `[[pool, 0]]`, or none.
 *
 * @param {string|undefined} pool - The pool's address, or undefined
 * @returns {Array<Array<(string|number)>>} The pool cells
 */
function poolCells(pool) {
  return pool === undefined ? [] : [[pool, 0]];
}

/**
 * Describes the command line: its two commands, `price` and `fdv`.
 *
 * @param {import('commander').Command} program - The program, with the shared options
 * @param {function(string, Array, import('commander').Command): Promise<void>} runCall - Runs a script function and prints what it returned
 * @returns {void}
 */
function describeCommandLine(program, runCall) {
  program
    .name('crypto-price-fetchers')
    .description(
      "A token's price or fully diluted value (FDV) in USD, from DexTools, or from x1.ninja for X1, " +
        'worked out by crypto-price-fetchers.gs run under Node.'
    );
  const commands = [
    ['price', 'dexToolsGetTokenPrice', "the token's price in USD", 'a pool to price the token in; required for x1'],
    ['fdv', 'dexToolsGetTokenFDV', "the token's fully diluted value in USD", 'the pool to read; required for x1, unused elsewhere']
  ];
  for (const [commandName, functionName, description, poolHelp] of commands) {
    program
      .command(commandName)
      .description(description)
      .argument('<chain>', "the chain's DexTools slug, such as ether, pulse or bsc; or x1", notEmpty)
      .argument('<token>', "the token's address", notEmpty)
      .option('-p, --pool <address>', poolHelp, notEmpty)
      .action((chain, token, options, command) => runCall(functionName, [chain, token, poolCells(options.pool)], command));
  }
}

/**
 * Runs the command line.
 *
 * @param {string[]} argv - The arguments, shaped as `process.argv`
 * @param {Object} [deps] - What a test replaces: `fetch`, `stdout`, `stderr` (`runScriptCommandLine`)
 * @returns {Promise<number>} The exit code
 */
export function runCommandLine(argv, deps = {}) {
  return runScriptCommandLine(
    { argv, scriptPath: SHEETS_SCRIPT, defaultConfigFile: DEFAULT_CONFIG_FILE, describe: describeCommandLine },
    deps
  );
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await runCommandLine(process.argv);
}
