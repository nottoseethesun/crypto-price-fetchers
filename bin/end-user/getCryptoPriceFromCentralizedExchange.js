/**
 * The Node version of
 * fetch-from-any-exchange/src/getCryptoPriceFromCentralizedExchange.gs:
 * a coin's USD price at a past time, from centralized exchanges, for Node
 * programs and the command line.
 * @module bin/end-user/getCryptoPriceFromCentralizedExchange
 *
 * What: the same answer as the Sheets function `getCryptoPrice`, worked out
 * by the same code, because this file runs
 * `fetch-from-any-exchange/src/getCryptoPriceFromCentralizedExchange.gs`
 * itself, unchanged, through the shared runner (`../../apps-script-runner/`). The `.gs` file's header says
 * what the function takes and returns: the average of the high and the
 * low of the period around the time, or its high, low or close, from MEXC,
 * then CoinGecko, then CoinPaprika, or a message for the cell when there
 * is none.
 *
 * How:
 *
 * - `openCentralizedExchangePrices` opens the script once and returns
 *   `getCryptoPrice` as an async call, with the Sheets arguments, plus
 *   `close`. A Date passed as the time works as a date cell does.
 * - `openCentralizedExchangeSources` opens it the same way and returns its
 *   three price sources instead, `getPriceFromMEXC`, `getPriceFromCoinGecko`
 *   and `getPriceFromCoinPaprika`, each taking an id, the time in UTC
 *   milliseconds and "average", "high", "low" or "close".
 *   crypto-price-filler prices
 *   its rows with them.
 * - Either takes the CoinGecko demo api key and the CoinPaprika api key,
 *   and sets each in the script's `CONFIG` (`keyConfig`), as the repo's
 *   build step sets them in the script it gives for the sheet.
 * - The command line, `node bin/end-user/getCryptoPriceFromCentralizedExchange.js <token>
 *   "<date>"`, with `--tz` and `--mode`, prints the price (`--help` gives
 *   the rest). It first checks the time zone and the date as the script
 *   reads them, with the script loaded in this thread, which asks nothing,
 *   and names a mistake as the option or argument it is in
 *   (`checkTimeArguments`). Before it asks for a price, it opens the CoinGecko and
 *   CoinPaprika keys saved in the project's encrypted key file and hands
 *   them to the script (`../../api-key-store/`): with the password in
 *   `API_KEYS_PASSWORD`, which `bin/unlock-api-keys.sh` keeps for a terminal,
 *   or else one it asks for. With no key saved, the script asks without
 *   one. `npm run api-keys`, in the repo's top folder, saves a key.
 * - `fetch-from-any-exchange/config.json`, which git ignores, may
 *   set other fields of the script's `CONFIG`; without it, the script runs
 *   on the values written in it, which `config-example.json`, beside it,
 *   shows for each field. `CONFIG_SCHEMAS` names each field it may set,
 *   with its kind of value, and the runner checks the file against it
 *   before the script opens: a field the script lacks, a value of the
 *   wrong kind, or an api key, which is no setting, stops the run, with
 *   every problem listed. A field that holds an object or a list is set
 *   whole, so the schema asks for the whole of it.
 *   `readCentralizedExchangeConfig` reads and checks the file the same
 *   way, for a program that opens the script only later: crypto-price-filler
 *   checks it before its first row.
 *
 * What differs from the sheet: it runs on this computer, so there is no
 * daily cap on requests, though the script keeps the budget of 25 seconds
 * a call it keeps for Google's 30-second limit (CALL_BUDGET_MS). The cache lasts
 * while the script is open: one run of the command line. The sheet's menu,
 * which the build step adds from `crypto-price-fetchers-menu.gs`, is not
 * here. The script waits its 200 milliseconds before each lookup, as in
 * the sheet.
 *
 * Fit: in `bin/end-user/`, the folder of the programs an end user runs;
 * `fetch-from-any-exchange/src/getCryptoPriceFromCentralizedExchange.gs`
 * stays the one copy of its logic. crypto-price-filler, in
 * `fetch-from-any-exchange/crypto-price-filler/`, is a separate
 * tool that asks the script's price sources through
 * `openCentralizedExchangeSources`.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CACHE_SECONDS_KIND,
  InvalidArgumentError,
  Option,
  applyConfig,
  callScriptFunction,
  createAppsScriptServices,
  isEntryPoint,
  loadAppsScript,
  openScriptFunctions,
  readConfigFile,
  runScriptCommandLine,
} from "../../apps-script-runner/index.js";
import { unlockProjectKeys } from "../../api-key-store/index.js";
import { endQuietlyWhenOutputCloses } from "../../lib/closed-output.js";
import { KINDS } from "../../lib/settings-schema.js";

/**
 * The Sheets script this runs: its two files the function needs, in the
 * order Apps Script loads them. The third, its in-sheet tests, is left out.
 */
export const SHEETS_SCRIPT = [
  new URL(
    "../../fetch-from-any-exchange/src/getCryptoPriceFromCentralizedExchange.gs",
    import.meta.url,
  ),
  new URL(
    "../../fetch-from-any-exchange/src/getCryptoPriceFromCentralizedExchange-sources.gs",
    import.meta.url,
  ),
];

/** The config file read when none is named. */
export const DEFAULT_CONFIG_FILE = fileURLToPath(
  new URL("../../fetch-from-any-exchange/config.json", import.meta.url),
);

/** The project's top folder, which holds its key file. */
const PROJECT_TOP = fileURLToPath(new URL("../..", import.meta.url));

/**
 * A CoinGecko url template that asks for prices in USD, as the script
 * gives every price in USD.
 */
const ASKS_COINGECKO_FOR_USD = Object.freeze({
  type: "string",
  pattern: "[?&]vs_currency=usd(&|$)",
  description:
    "a url template that asks CoinGecko for USD, with vs_currency=usd",
});

/**
 * A CoinPaprika url template that asks for prices in USD, as the script
 * gives every price in USD.
 */
const ASKS_COINPAPRIKA_FOR_USD = Object.freeze({
  type: "string",
  pattern: "[?&]quote=usd(&|$)",
  description: "a url template that asks CoinPaprika for USD, with quote=usd",
});

/** A list of waits, in milliseconds. */
const WAITS_MS = Object.freeze({
  type: "array",
  items: KINDS.wholeAtLeast0,
  description:
    "a list of waits, each a whole number of milliseconds of at least 0",
});

/**
 * The JSON Schema of each config object `config.json` may set, by its name
 * in the script: each field of `CONFIG` but its two api keys, of its kind
 * of value, and no other. A field that holds an object is set whole, so
 * its schema asks for every part the script reads: `UTC` among the time
 * zones, which an empty zone means, and both cache times.
 */
export const CONFIG_SCHEMAS = Object.freeze({
  CONFIG: Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: {
      EXCHANGE_BASE_URL: KINDS.url,
      QUOTE_CURRENCY: {
        enum: ["USDT", "USDC"],
        description:
          "USDT or USDC, the USD stablecoins MEXC quotes the most pairs in, as CoinGecko and CoinPaprika answer in USD",
      },
      TIMEZONE_OFFSETS: {
        type: "object",
        required: ["UTC"],
        properties: { UTC: { const: 0, description: "0" } },
        propertyNames: {
          type: "string",
          pattern: "^\\P{Ll}+$",
          description: "a time zone's abbreviation, with no lower-case letter",
        },
        additionalProperties: {
          type: "number",
          minimum: -12,
          maximum: 14,
          description: "an offset from UTC in hours, from -12 to 14",
        },
        description:
          "each time zone's offset from UTC in hours, by its abbreviation, UTC among them",
      },
      CACHE_EXPIRY_SECONDS: {
        type: "object",
        additionalProperties: false,
        required: ["DAILY_PRICE", "NEGATIVE_CACHE"],
        properties: {
          DAILY_PRICE: CACHE_SECONDS_KIND,
          NEGATIVE_CACHE: CACHE_SECONDS_KIND,
        },
        description: "the seconds a price, and a price not found, are kept",
      },
      COINGECKO_BASE: KINDS.url,
      COINPAPRIKA_BASE: KINDS.url,
      COINPAPRIKA_PRO_BASE: KINDS.url,
      COINGECKO_API_KEY_HEADER: KINDS.text,
      COINPAPRIKA_API_KEY_HEADER: KINDS.text,
      COINGECKO_HISTORY_TEMPLATE: KINDS.text,
      COINGECKO_MARKET_CHART_RANGE_TEMPLATE: ASKS_COINGECKO_FOR_USD,
      COINPAPRIKA_OHLCV_TEMPLATE: ASKS_COINPAPRIKA_FOR_USD,
      COINPAPRIKA_DAY_PRICE_TEMPLATE: ASKS_COINPAPRIKA_FOR_USD,
      RETRY_DELAYS_MS: WAITS_MS,
      LOCK_WAIT_MS: KINDS.wholeAtLeast0,
      GENERAL_DELAY_MS: KINDS.wholeAbove0,
      MAX_LOCK_RETRIES: KINDS.wholeAbove0,
      LOCK_RETRY_BACKOFF: WAITS_MS,
    },
    description: "fields of CONFIG",
  }),
});

/** The script's in-editor tests, which the sheet works without. */
const SHEETS_TESTS = new URL(
  "../../fetch-from-any-exchange/src/getCryptoPriceFromCentralizedExchange-tests.gs",
  import.meta.url,
);

/** The script's price sources, which `openCentralizedExchangeSources` returns. */
const SOURCE_FUNCTIONS = Object.freeze([
  "getPriceFromMEXC",
  "getPriceFromCoinGecko",
  "getPriceFromCoinPaprika",
]);

/**
 * The api keys the script sends, by the service each is saved under.
 *
 * @typedef {Object} ScriptKeys
 * @property {?string} [coingecko] - The CoinGecko demo api key, or null or absent for none
 * @property {?string} [coinpaprika] - The CoinPaprika api key, or null or absent for none
 */

/**
 * The config values that hand the script its api keys:
 * `CONFIG.COINGECKO_API_KEY` and `CONFIG.COINPAPRIKA_API_KEY`.
 *
 * @param {ScriptKeys} apiKeys - The keys, such as `unlockProjectKeys` opens
 * @returns {Object<string, Object>} The values: one field for each key given, none for no key
 */
export function keyConfig(apiKeys) {
  const fields = {};
  if (typeof apiKeys.coingecko === "string")
    fields.COINGECKO_API_KEY = apiKeys.coingecko;
  if (typeof apiKeys.coinpaprika === "string")
    fields.COINPAPRIKA_API_KEY = apiKeys.coinpaprika;
  return Object.keys(fields).length === 0 ? {} : { CONFIG: fields };
}

/**
 * What `npm run build apps-script` puts of this script in the one file it
 * gives for the sheet (`build/tools/apps-script-build/`): its three
 * files, the in-editor tests included, the first one's header holding a
 * help section, with the
 * CoinGecko and CoinPaprika keys set at the end of the built file as
 * `keyConfig` sets them here.
 */
export const APPS_SCRIPT_BUILD = Object.freeze({
  name: "getCryptoPriceFromCentralizedExchange",
  files: Object.freeze([
    Object.freeze({ path: fileURLToPath(SHEETS_SCRIPT[0]), help: true }),
    Object.freeze({ path: fileURLToPath(SHEETS_SCRIPT[1]) }),
    Object.freeze({ path: fileURLToPath(SHEETS_TESTS) }),
  ]),
  services: Object.freeze(["coingecko", "coinpaprika"]),
  keyConfig,
  defaultConfigFile: DEFAULT_CONFIG_FILE,
  configSchemas: CONFIG_SCHEMAS,
});

/**
 * How to open the script, for both openers.
 *
 * @typedef {Object} OpenOptions
 * @property {Object<string, Object>} [config] - Values for the script's config objects, in place of the config file
 * @property {string} [configFile] - A config file in place of `fetch-from-any-exchange/config.json`
 * @property {ScriptKeys} [apiKeys={}] - The api keys the script sends; none when absent
 * @property {function(string, Object): Promise<Response>} [fetch] - Does the script's web requests, in place of Node's fetch
 * @property {?function({level: string, text: string}): void} [onLog] - Takes each line the script logs
 */

/**
 * Opens the script with the named functions (`openScriptFunctions`).
 *
 * @param {string[]} names - The functions
 * @param {OpenOptions} options - How to open it
 * @returns {Promise<Object>} The functions as async calls, and `close`
 */
function openWith(names, options) {
  const { apiKeys = {}, ...rest } = options;
  return openScriptFunctions(SHEETS_SCRIPT, names, {
    ...rest,
    defaultConfigFile: DEFAULT_CONFIG_FILE,
    configSchemas: CONFIG_SCHEMAS,
    configOverlay: keyConfig(apiKeys),
  });
}

/**
 * Reads `fetch-from-any-exchange/config.json`, or the file named, and checks it
 * against `CONFIG_SCHEMAS`, as the runner does when the script opens: for
 * a program that opens the script only later, as crypto-price-filler does
 * at its first price, so a file the schemas refuse stops it before it
 * starts.
 *
 * @param {string} [file] - The config file: `fetch-from-any-exchange/config.json`, unless another is named
 * @returns {Object<string, Object>} The values it sets, by config object
 * @throws {Error} When the file cannot be read, is not JSON, or has a problem the schemas find, every problem listed
 */
export function readCentralizedExchangeConfig(file = DEFAULT_CONFIG_FILE) {
  return readConfigFile(file, { schemas: CONFIG_SCHEMAS });
}

/**
 * Opens the script and returns its Sheets function as an async call.
 *
 * @param {OpenOptions} [options] - How to open it
 * @returns {Promise<{getCryptoPrice: function(string, (string|Date), string, string=, number=): Promise<number|string>, close: function(): Promise<void>}>} The function, with the Sheets arguments
 */
export function openCentralizedExchangePrices(options = {}) {
  return openWith(["getCryptoPrice"], options);
}

/**
 * Opens the script and returns its three price sources as async calls.
 * Each takes an id (the ticker for MEXC, the coin's id at CoinGecko or
 * CoinPaprika), the time in UTC milliseconds, and "average", "high", "low"
 * or "close", and gives the price in USD, or null when the source has
 * none.
 *
 * @param {OpenOptions} [options] - How to open it
 * @returns {Promise<{getPriceFromMEXC: function(string, number, string): Promise<?number>, getPriceFromCoinGecko: function(string, number, string): Promise<?number>, getPriceFromCoinPaprika: function(string, number, string): Promise<?number>, close: function(): Promise<void>}>} The sources
 */
export function openCentralizedExchangeSources(options = {}) {
  return openWith([...SOURCE_FUNCTIONS], options);
}

/** What the help says of the api keys. */
const KEY_HELP = `
Api keys:
  The command sends a CoinGecko demo api key and a CoinPaprika api key
  when either is saved (npm run api-keys, in the repo's top folder). It
  opens them with the password in API_KEYS_PASSWORD, which
  source ./bin/unlock-api-keys.sh keeps for a terminal, or else asks for the
  password on stderr. Without a key, it asks that service without one.`;

/** The examples of the help: one of each common use. */
const EXAMPLES_HELP = `
Examples:
  Bitcoin's average price in the period around 14:30 UTC on 15 January 2026:
    $ node bin/end-user/getCryptoPriceFromCentralizedExchange.js btc "2026-01-15 14:30:00"
  Gridcoin's close at a time given in US Central time:
    $ node bin/end-user/getCryptoPriceFromCentralizedExchange.js grc "2026-01-15 08:30:00" --tz CST --mode close
  Monero's low, with the script's log on stderr, to see which service answered:
    $ node bin/end-user/getCryptoPriceFromCentralizedExchange.js xmr "2026-01-15 14:30:00" --mode low --verbose`;

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
        "the average of the high and the low of the period the price comes from, or its high, low or close",
      )
        .choices(["average", "high", "low", "close"])
        .default("average"),
    )
    .addHelpText("after", KEY_HELP)
    .addHelpText("after", EXAMPLES_HELP)
    .hook("preAction", (_program, command) => checkTimeArguments(command))
    .action((token, date, options, command) =>
      runCall(
        "getCryptoPrice",
        [token, date, options.tz, options.mode],
        command,
      ),
    );
}

/**
 * The script, loaded in this thread with a config file's values, for the
 * checks of a call's arguments, which ask nothing: its services refuse a
 * web request.
 *
 * @param {Object<string, Object>} config - The config file's values
 * @returns {Object} The script's context
 */
function scriptForChecks(config) {
  const context = loadAppsScript(
    SHEETS_SCRIPT.map((url) => ({
      source: fs.readFileSync(url, "utf8"),
      filename: fileURLToPath(url),
    })),
    createAppsScriptServices({
      fetchSync: () => {
        throw new Error("a check of the arguments sends no request");
      },
      sleep: () => {},
    }),
  );
  applyConfig(context, config);
  return context;
}

/**
 * Checks the call's time zone and date as the script reads them, with the
 * config file's zones, before the keys are opened, so a mistake is named
 * as the option or argument it is in, as commander names one, before
 * anything is asked.
 *
 * @param {import('commander').Command} command - The command about to run
 * @throws {import('commander').CommanderError} With exit code 1, when the zone or the date is one the script refuses
 */
function checkTimeArguments(command) {
  const options = command.optsWithGlobals();
  const [, date] = command.processedArgs;
  const config = readConfigFile(options.config, {
    required: command.getOptionValueSourceWithGlobals("config") !== "default",
    schemas: CONFIG_SCHEMAS,
  });
  const script = scriptForChecks(config);
  const offset = callScriptFunction(script, "getTimezoneOffsetHours", [
    options.tz,
  ]);
  if (offset === null)
    command.error(
      `error: option '-z, --tz <abbreviation>' argument '${options.tz}' is invalid. ${callScriptFunction(script, "unknownTimeZoneMessage", [options.tz])}`,
    );
  const time = callScriptFunction(script, "parseInputToUtcMs", [date, offset]);
  if (typeof time === "string")
    command.error(
      `error: command-argument value '${date}' is invalid for argument 'date'. ${time}`,
    );
}

/**
 * Opens the saved CoinGecko and CoinPaprika keys for the command line's
 * call, and gives the config values that hand them to the script.
 *
 * @param {Object} deps - What a test replaces (`runCommandLine`)
 * @param {{io: {stderr: {write: function(string): void}}}} call - Where messages go
 * @returns {Promise<{config: Object<string, Object>}>} The config values: one field for each key saved
 * @throws {Error} With `keyRefused` set, when the keys cannot be opened or a service refuses its key
 */
async function openCallKey(deps, { io }) {
  const keys = await unlockProjectKeys({
    projectTop: PROJECT_TOP,
    services: ["coingecko", "coinpaprika"],
    env: deps.env,
    ask: deps.ask,
    say: (line) => io.stderr.write(`${line}\n`),
    checkOptions: { fetch: deps.fetch },
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
 * @returns {Promise<number>} The exit code
 */
export function runCommandLine(argv, deps = {}) {
  return runScriptCommandLine(
    {
      argv,
      scriptPath: SHEETS_SCRIPT,
      defaultConfigFile: DEFAULT_CONFIG_FILE,
      configSchemas: CONFIG_SCHEMAS,
      describe: describeCommandLine,
      apiKeys: (call) => openCallKey(deps, call),
    },
    deps,
  );
}

if (isEntryPoint(import.meta.url)) {
  endQuietlyWhenOutputCloses();
  process.exitCode = await runCommandLine(process.argv);
}
