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
 *   `close`. A Date passed as the time works as a date cell does. A
 *   CoinGecko demo api key passed to it goes to the script as the Script
 *   Property the script reads the key from, as in Apps Script.
 * - The command line, `node getCryptoPriceFromCentralizedExchange.js <token>
 *   "<date>"`, with `--tz` and `--mode`, prints the price (`--help` gives
 *   the rest). Before it asks for a price, it opens the CoinGecko key saved
 *   in the project's encrypted key file and hands it to the script
 *   (`../api-key-store/`): with the password in `API_KEYS_PASSWORD`, which
 *   `unlock-api-keys.sh` keeps for a terminal, or else one it asks for.
 *   With no key saved, the script asks CoinGecko without one.
 *   `npm run api-keys`, in the repo's top folder, saves a key.
 * - `config.json` beside this file, which git ignores, may set other
 *   fields of the script's `CONFIG`; without it, the script runs on the
 *   values written in it.
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

import { fileURLToPath } from "node:url";
import {
  InvalidArgumentError,
  Option,
  isEntryPoint,
  openScriptFunctions,
  runScriptCommandLine,
} from "../apps-script-runner/index.js";
import { unlockProjectKeys } from "../api-key-store/index.js";

/**
 * The Sheets script this runs: its two files the function needs, in the
 * order Apps Script loads them. The third, its in-sheet tests, is left out.
 */
export const SHEETS_SCRIPT = [
  new URL("./getCryptoPriceFromCentralizedExchange.gs", import.meta.url),
  new URL(
    "./getCryptoPriceFromCentralizedExchange-sources.gs",
    import.meta.url,
  ),
];

/** The config file read when none is named. */
export const DEFAULT_CONFIG_FILE = fileURLToPath(
  new URL("./config.json", import.meta.url),
);

/** The project's top folder, which holds its key file. */
const PROJECT_TOP = fileURLToPath(new URL("..", import.meta.url));

/** The Script Property the script reads the CoinGecko key from: its `CONFIG.COINGECKO_API_KEY_PROPERTY`. */
export const COINGECKO_KEY_PROPERTY = "COINGECKO_API_KEY";

/**
 * The Script Properties that hand the script a CoinGecko key.
 *
 * @param {?string|undefined} key - The key, or null or absent for none
 * @returns {Object<string, string>} The properties: the key's, or none
 */
function coinGeckoKeyProperties(key) {
  return typeof key === "string" ? { [COINGECKO_KEY_PROPERTY]: key } : {};
}

/**
 * Opens the script and returns its Sheets function as an async call.
 *
 * @param {Object} [options] - How to open it (`openScriptFunctions`)
 * @param {Object<string, Object>} [options.config] - Values for the script's config objects, in place of the config file
 * @param {string} [options.configFile] - A config file in place of `config.json` beside this file
 * @param {{coingecko: (?string|undefined)}} [options.apiKeys={}] - The CoinGecko demo api key the script sends, such as `unlockProjectKeys` opens; none when absent
 * @param {function(string, Object): Promise<Response>} [options.fetch] - Does the script's web requests, in place of Node's fetch
 * @param {?function({level: string, text: string}): void} [options.onLog] - Takes each line the script logs
 * @returns {Promise<{getCryptoPrice: function(string, (string|Date), string, string=, number=): Promise<number|string>, close: function(): Promise<void>}>} The function, with the Sheets arguments
 */
export function openCentralizedExchangePrices(options = {}) {
  const { apiKeys = {}, ...rest } = options;
  return openScriptFunctions(SHEETS_SCRIPT, ["getCryptoPrice"], {
    ...rest,
    defaultConfigFile: DEFAULT_CONFIG_FILE,
    scriptProperties: coinGeckoKeyProperties(apiKeys.coingecko),
  });
}

/** What the help says of the CoinGecko key. */
const KEY_HELP = `
CoinGecko api key:
  When one is saved (npm run api-keys, in the repo's top folder), the
  command opens it with the password in API_KEYS_PASSWORD, which
  source ./unlock-api-keys.sh keeps for a terminal, or else asks for the
  password on stderr, and sends the key. Without one, it asks CoinGecko
  without a key.`;

/**
 * Checks that an argument is not empty.
 *
 * @param {string} value - The argument
 * @returns {string} The argument
 * @throws {InvalidArgumentError} When it is empty
 */
function notEmpty(value) {
  if (value.trim() === "") throw new InvalidArgumentError("It is empty.");
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
    .name("getCryptoPriceFromCentralizedExchange")
    .description(
      "A coin's USD price at a past time, from centralized exchanges (MEXC, then CoinGecko, then CoinPaprika), " +
        "worked out by getCryptoPriceFromCentralizedExchange.gs run under Node.",
    )
    .argument(
      "<token>",
      "the ticker symbol, such as btc, grc, xmr or xtm",
      notEmpty,
    )
    .argument(
      "<date>",
      'the time, as "YYYY-MM-DD HH:MM:SS" on a 24-hour clock, in quotes',
      notEmpty,
    )
    .option(
      "-z, --tz <abbreviation>",
      "the time zone the date is in, as an abbreviation the script knows, such as UTC or CST",
      "UTC",
    )
    .addOption(
      new Option(
        "-m, --mode <mode>",
        "the high or the low of the period the price comes from",
      )
        .choices(["high", "low"])
        .default("high"),
    )
    .addHelpText("after", KEY_HELP)
    .action((token, date, options, command) =>
      runCall(
        "getCryptoPrice",
        [token, date, options.tz, options.mode],
        command,
      ),
    );
}

/**
 * Opens the saved CoinGecko key for the command line's call, and gives the
 * Script Properties that hand it to the script.
 *
 * @param {Object} deps - What a test replaces (`runCommandLine`)
 * @param {{io: {stderr: {write: function(string): void}}}} call - Where messages go
 * @returns {Promise<{scriptProperties: Object<string, string>}>} The properties: the key's, or none when no key is saved
 * @throws {Error} With `keyRefused` set, when the key cannot be opened or CoinGecko refuses it
 */
async function openCallKey(deps, { io }) {
  const keys = await unlockProjectKeys({
    projectTop: PROJECT_TOP,
    services: ["coingecko"],
    env: deps.env,
    ask: deps.ask,
    say: (line) => io.stderr.write(`${line}\n`),
    checkOptions: { fetch: deps.fetch },
  });
  return { scriptProperties: coinGeckoKeyProperties(keys.coingecko) };
}

/**
 * Runs the command line.
 *
 * @param {string[]} argv - The arguments, shaped as `process.argv`
 * @param {Object} [deps] - What a test replaces: `fetch`, `stdout`, `stderr` (`runScriptCommandLine`)
 * @param {Object<string, string>} [deps.env] - The environment, for `API_KEYS_PASSWORD` and `API_KEYS_FILE_PATH`
 * @param {function(string): Promise<string>} [deps.ask] - Answers the password prompt, in place of the terminal
 * @returns {Promise<number>} The exit code
 */
export function runCommandLine(argv, deps = {}) {
  return runScriptCommandLine(
    {
      argv,
      scriptPath: SHEETS_SCRIPT,
      defaultConfigFile: DEFAULT_CONFIG_FILE,
      describe: describeCommandLine,
      apiKeys: (call) => openCallKey(deps, call),
    },
    deps,
  );
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await runCommandLine(process.argv);
}
