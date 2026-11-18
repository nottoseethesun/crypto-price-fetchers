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
 *   functions as async calls, with the Sheets arguments, plus `close`. The
 *   DexTools and x1.ninja keys passed to it go to the script as
 *   `CONFIG.API_KEY` and `X1_CONFIG.API_KEY`, which it reads each time it
 *   sends a request.
 * - The command line, `node crypto-price-fetchers.js price <chain> <token>`
 *   or `fdv <chain> <token>`, with `--pool <address>` for a pool, prints the
 *   number (`--help` gives the rest). Before it asks for a price, it opens
 *   the key the call sends, from the project's encrypted key file: x1.ninja's
 *   for x1, DexTools' for any other chain (`api-key-store/`). It opens it
 *   with the password in `API_KEYS_PASSWORD`, which `unlock-api-keys.sh`
 *   keeps for a terminal, or asks for the password; with no key saved, the
 *   script sends the placeholder written in it, which the service refuses.
 *   `npm run api-keys` saves the keys.
 * - `config.json` beside this file lists the keys the project's programs
 *   use, for the key manager, and may set other fields of the script's
 *   config objects. A field the script uses as it loads keeps the value
 *   written in the script: `SUBSCRIPTION_PLAN` and `API_HOST`, which build
 *   its DexTools url.
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
import { unlockProjectKeys } from './api-key-store/index.js';
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

/** The project's top folder, which holds its key file. */
const PROJECT_TOP = fileURLToPath(new URL('.', import.meta.url));

/** The script's Sheets functions. */
const FUNCTION_NAMES = ['dexToolsGetTokenPrice', 'dexToolsGetTokenFDV'];

/**
 * The config values that hand the script the keys given.
 *
 * @param {{dextools: (?string|undefined), x1ninja: (?string|undefined)}} keys - The keys, null or absent for none
 * @returns {Object<string, Object>} The values: `CONFIG.API_KEY` for DexTools and `X1_CONFIG.API_KEY` for x1.ninja
 */
function keyConfig(keys) {
  const config = {};
  if (typeof keys.dextools === 'string') config.CONFIG = { API_KEY: keys.dextools };
  if (typeof keys.x1ninja === 'string') config.X1_CONFIG = { API_KEY: keys.x1ninja };
  return config;
}

/**
 * Opens the script and returns its Sheets functions as async calls.
 *
 * @param {Object} [options] - How to open it (`openScriptFunctions`)
 * @param {Object<string, Object>} [options.config] - Values for the script's config objects, in place of the config file
 * @param {string} [options.configFile] - A config file in place of `config.json` beside this file
 * @param {{dextools: (?string|undefined), x1ninja: (?string|undefined)}} [options.apiKeys={}] - The DexTools and x1.ninja keys the script sends, such as `unlockProjectKeys` opens; none when absent
 * @param {function(string, Object): Promise<Response>} [options.fetch] - Does the script's web requests, in place of Node's fetch
 * @param {?function({level: string, text: string}): void} [options.onLog] - Takes each line the script logs
 * @returns {Promise<{dexToolsGetTokenPrice: function(string, string, Array=, number=): Promise<number|string>, dexToolsGetTokenFDV: function(string, string, Array=, number=): Promise<number|string>, close: function(): Promise<void>}>} The functions, with the Sheets arguments
 */
export function openCryptoPriceFetchers(options = {}) {
  const { apiKeys = {}, ...rest } = options;
  return openScriptFunctions(SHEETS_SCRIPT, FUNCTION_NAMES, {
    ...rest,
    defaultConfigFile: DEFAULT_CONFIG_FILE,
    configOverlay: keyConfig(apiKeys)
  });
}

/** What the help says of the keys. */
const KEY_HELP = `
Api keys:
  DexTools' key, for any chain but x1, and x1.ninja's, for x1, are kept
  encrypted in the project's api-keys.json (npm run api-keys saves them).
  The command opens the one it sends with the password in API_KEYS_PASSWORD,
  which source ./unlock-api-keys.sh keeps for a terminal, or else asks for
  the password on stderr.`;

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
    )
    .addHelpText('after', KEY_HELP);
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
 * Opens the key a call sends: x1.ninja's for x1, DexTools' for any other
 * chain, and gives the config values that hand it to the script.
 *
 * @param {Object} deps - What a test replaces (`runCommandLine`)
 * @param {{args: Array, io: {stderr: {write: function(string): void}}}} call - The call's arguments, the chain first, and where messages go
 * @returns {Promise<{config: Object<string, Object>}>} The config values: none when no key is saved
 * @throws {Error} With `keyRefused` set, when the key cannot be opened or its service refuses it
 */
async function openCallKey(deps, { args, io }) {
  const keys = await unlockProjectKeys({
    projectTop: PROJECT_TOP,
    services: [String(args[0]).toLowerCase() === 'x1' ? 'x1ninja' : 'dextools'],
    env: deps.env,
    ask: deps.ask,
    say: (line) => io.stderr.write(`${line}\n`),
    checkOptions: { fetch: deps.fetch, sleep: deps.sleep }
  });
  return { config: keyConfig(keys) };
}

/**
 * Runs the command line.
 *
 * @param {string[]} argv - The arguments, shaped as `process.argv`
 * @param {Object} [deps] - What a test replaces: `fetch`, `stdout`, `stderr` (`runScriptCommandLine`)
 * @param {Object<string, string>} [deps.env] - The environment, for `API_KEYS_PASSWORD` and `API_KEYS_FILE_PATH`
 * @param {function(string): Promise<string>} [deps.ask] - Answers the password prompt, in place of the terminal
 * @param {function(number): Promise<void>} [deps.sleep] - Waits between the DexTools key check's requests
 * @returns {Promise<number>} The exit code
 */
export function runCommandLine(argv, deps = {}) {
  return runScriptCommandLine(
    {
      argv,
      scriptPath: SHEETS_SCRIPT,
      defaultConfigFile: DEFAULT_CONFIG_FILE,
      describe: describeCommandLine,
      apiKeys: (call) => openCallKey(deps, call)
    },
    deps
  );
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await runCommandLine(process.argv);
}
