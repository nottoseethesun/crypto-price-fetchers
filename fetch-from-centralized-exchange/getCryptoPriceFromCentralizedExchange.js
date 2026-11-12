/**
 * The Node version of getCryptoPriceFromCentralizedExchange.gs: a coin's
 * USD price at a past time, from centralized exchanges, for Node programs
 * and the command line.
 * @module fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange
 *
 * What: the same answer as the Sheets function `getCryptoPrice`, worked out
 * by the same code, because this file runs
 * `getCryptoPriceFromCentralizedExchange.gs` itself, unchanged, through the
 * shared runner (`../apps-script-runner/`). The `.gs` file's header says
 * what the function takes and returns: the high or low price of the
 * period around the time, from MEXC, then CoinGecko, then CoinPaprika, or
 * a message for the cell when there is none.
 *
 * How:
 *
 * - `openCentralizedExchangePrices` opens the script once and returns
 *   `getCryptoPrice` as an async call, with the Sheets arguments, plus
 *   `close`. A Date passed as the time works as a date cell does.
 * - `config.json` beside this file, which git ignores, may set
 *   `CONFIG.COINGECKO_API_KEY`, the CoinGecko demo key the script sends
 *   for hourly prices; `config-example.json` shows the shape. Without the
 *   file, the script uses the key written in it.
 * - The command line, `node getCryptoPriceFromCentralizedExchange.js <token>
 *   "<date>"`, with `--tz` and `--mode`, prints the price (`--help` gives
 *   the rest).
 *
 * What differs from the sheet: it runs on this computer, so there is no
 * 30-second limit per call and no daily cap on requests. The cache lasts
 * while the script is open: one run of the command line. The sheet's menu
 * is not here. The script waits its 200 milliseconds before each lookup,
 * as in the sheet.
 *
 * Fit: beside `getCryptoPriceFromCentralizedExchange.gs`, which stays the
 * one copy of its logic. crypto-price-filler, in the folder below, is a
 * separate tool with code of its own.
 */

import { fileURLToPath } from 'node:url';
import {
  InvalidArgumentError,
  Option,
  isEntryPoint,
  openScriptFunctions,
  runScriptCommandLine
} from '../apps-script-runner/index.js';

/** The Sheets script this runs. */
export const SHEETS_SCRIPT = new URL('./getCryptoPriceFromCentralizedExchange.gs', import.meta.url);

/** The config file read when none is named. */
export const DEFAULT_CONFIG_FILE = fileURLToPath(new URL('./config.json', import.meta.url));

/**
 * Opens the script and returns its Sheets function as an async call.
 *
 * @param {Object} [options] - How to open it (`openScriptFunctions`)
 * @param {Object<string, Object>} [options.config] - Values for the script's config objects, in place of the config file
 * @param {string} [options.configFile] - A config file in place of `config.json` beside this file
 * @param {function(string, Object): Promise<Response>} [options.fetch] - Does the script's web requests, in place of Node's fetch
 * @param {?function({level: string, text: string}): void} [options.onLog] - Takes each line the script logs
 * @returns {Promise<{getCryptoPrice: function(string, (string|Date), string, string=, number=): Promise<number|string>, close: function(): Promise<void>}>} The function, with the Sheets arguments
 */
export function openCentralizedExchangePrices(options = {}) {
  return openScriptFunctions(SHEETS_SCRIPT, ['getCryptoPrice'], { ...options, defaultConfigFile: DEFAULT_CONFIG_FILE });
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
 * Describes the command line.
 *
 * @param {import('commander').Command} program - The program, with the shared options
 * @param {function(string, Array, import('commander').Command): Promise<void>} runCall - Runs a script function and prints what it returned
 * @returns {void}
 */
function describeCommandLine(program, runCall) {
  program
    .name('getCryptoPriceFromCentralizedExchange')
    .description(
      "A coin's USD price at a past time, from centralized exchanges (MEXC, then CoinGecko, then CoinPaprika), " +
        'worked out by getCryptoPriceFromCentralizedExchange.gs run under Node.'
    )
    .argument('<token>', 'the ticker symbol, such as btc, grc, xmr or xtm', notEmpty)
    .argument('<date>', 'the time, as "YYYY-MM-DD HH:MM:SS" on a 24-hour clock, in quotes', notEmpty)
    .option('-z, --tz <abbreviation>', 'the time zone the date is in, as an abbreviation the script knows, such as UTC or CST', 'UTC')
    .addOption(
      new Option('-m, --mode <mode>', 'the high or the low of the period the price comes from')
        .choices(['high', 'low'])
        .default('high')
    )
    .action((token, date, options, command) => runCall('getCryptoPrice', [token, date, options.tz, options.mode], command));
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
