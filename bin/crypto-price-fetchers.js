/**
 * The Node version of src/crypto-price-fetchers.gs: a token's price and fully
 * diluted value (FDV) in USD, from DexTools, or from x1.ninja for X1, for
 * Node programs and the command line.
 * @module bin/crypto-price-fetchers
 *
 * What: the same answers as the Sheets functions `dexToolsGetTokenPrice`
 * and `dexToolsGetTokenFDV`, worked out by the same code, because this
 * file runs `src/crypto-price-fetchers.gs` itself, unchanged, through the
 * shared runner (`apps-script-runner/`). The `.gs` file's header says what
 * the two functions take and return: a number, 0 when there is no data, or
 * a message for the cell.
 *
 * How:
 *
 * - `openCryptoPriceFetchers` opens the script once and returns its two
 *   functions as async calls, with the Sheets arguments, plus `close`. The
 *   DexTools and x1.ninja keys passed to it go to the script as
 *   `DEXTOOLS_CONFIG.API_KEY` and `X1_CONFIG.API_KEY`, which it reads each
 *   time it sends a request.
 * - The command line, `node bin/crypto-price-fetchers.js price <chain> <token>`
 *   or `fdv <chain> <token>`, with `--pool <address>` for a pool, prints the
 *   number (`--help` gives the rest). A run on x1 with no `--pool` is
 *   refused before anything is asked, since x1.ninja answers only for a
 *   pool (`checkPoolForX1`). Before it asks for a price, it opens
 *   the key the call sends, from the project's encrypted key file: x1.ninja's
 *   for x1, DexTools' for any other chain (`api-key-store/`). It opens it
 *   with the password in `API_KEYS_PASSWORD`, which `bin/unlock-api-keys.sh`
 *   keeps for a terminal, or asks for the password; with no key saved, the
 *   script sends the placeholder written in it, which the service refuses.
 *   `npm run api-keys` saves the keys.
 * - `config.json` at the repo's top lists the keys the project's programs
 *   use, for the key manager, and may set the fields of `DEXTOOLS_CONFIG`
 *   the script reads each time it is called, which `CONFIG_SCHEMAS` names,
 *   each with its kind of value: the runner checks the file against it
 *   before the script opens. A field the script reads as it loads, to
 *   build its urls (`SUBSCRIPTION_PLAN`, `API_HOST` and `API_VERSION`, and
 *   `X1_CONFIG`'s two) or its spacing of requests
 *   (`MIN_SECONDS_BETWEEN_CALLS`), would keep the value written in the
 *   script, so the schema refuses it, as it refuses an api key, which is
 *   no setting.
 *
 * What differs from the sheet: it runs on this computer, so there is no
 * 30-second limit per call and no daily cap on requests. The cache and the
 * time of the last call, which spaces calls out, last while the script is
 * open: one run of the command line. The sheet's menu, which the build
 * step adds from `src/crypto-price-fetchers-menu.gs`, is not here.
 *
 * Fit: in `bin/`, the programs' folder; `src/crypto-price-fetchers.gs` stays
 * the one copy of the logic, so a fix to it is a fix to both.
 */

import { fileURLToPath } from "node:url";
import { unlockProjectKeys } from "../api-key-store/index.js";
import { KINDS } from "../lib/settings-schema.js";
import {
  CACHE_SECONDS_KIND,
  InvalidArgumentError,
  isEntryPoint,
  openScriptFunctions,
  runScriptCommandLine,
} from "../apps-script-runner/index.js";
import { endQuietlyWhenOutputCloses } from "../lib/closed-output.js";

/** The Sheets script this runs. */
export const SHEETS_SCRIPT = new URL(
  "../src/crypto-price-fetchers.gs",
  import.meta.url,
);

/** The config file read when none is named. */
export const DEFAULT_CONFIG_FILE = fileURLToPath(
  new URL("../config.json", import.meta.url),
);

/** The project's top folder, which holds its key file. */
const PROJECT_TOP = fileURLToPath(new URL("..", import.meta.url));

/** The script's Sheets functions. */
const FUNCTION_NAMES = ["dexToolsGetTokenPrice", "dexToolsGetTokenFDV"];

/**
 * The JSON Schema of each config object `config.json` may set, by its name
 * in the script: the fields the script reads each time it is called, each
 * of its kind of value, and no other.
 */
export const CONFIG_SCHEMAS = Object.freeze({
  DEXTOOLS_CONFIG: Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: {
      CACHE_SECONDS: CACHE_SECONDS_KIND,
      LOCK_WAIT_MS: KINDS.wholeAtLeast0,
    },
    description: "fields of DEXTOOLS_CONFIG",
  }),
});

/**
 * The config values that hand the script the keys given.
 *
 * @param {{dextools: (?string|undefined), x1ninja: (?string|undefined)}} keys - The keys, null or absent for none
 * @returns {Object<string, Object>} The values: `DEXTOOLS_CONFIG.API_KEY` for DexTools and `X1_CONFIG.API_KEY` for x1.ninja
 */
function keyConfig(keys) {
  const config = {};
  if (typeof keys.dextools === "string")
    config.DEXTOOLS_CONFIG = { API_KEY: keys.dextools };
  if (typeof keys.x1ninja === "string")
    config.X1_CONFIG = { API_KEY: keys.x1ninja };
  return config;
}

/**
 * What `npm run build apps-script` puts of this script in the one file it
 * gives for the sheet (`apps-script-build/`): its one file, whose header
 * holds a help section, with the DexTools and x1.ninja keys set at the end
 * of the built file as `keyConfig` sets them here.
 */
export const APPS_SCRIPT_BUILD = Object.freeze({
  name: "crypto-price-fetchers",
  files: Object.freeze([
    Object.freeze({ path: fileURLToPath(SHEETS_SCRIPT), help: true }),
  ]),
  services: Object.freeze(["dextools", "x1ninja"]),
  keyConfig,
  defaultConfigFile: DEFAULT_CONFIG_FILE,
  configSchemas: CONFIG_SCHEMAS,
});

/**
 * Opens the script and returns its Sheets functions as async calls.
 *
 * @param {Object} [options] - How to open it (`openScriptFunctions`)
 * @param {Object<string, Object>} [options.config] - Values for the script's config objects, in place of the config file
 * @param {string} [options.configFile] - A config file in place of `config.json` at the repo's top
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
    configSchemas: CONFIG_SCHEMAS,
    configOverlay: keyConfig(apiKeys),
  });
}

/** What the help says of the keys. */
const KEY_HELP = `
Api keys:
  DexTools' key, for any chain but x1, and x1.ninja's, for x1, are kept
  encrypted in the project's api-keys.json (npm run api-keys saves them).
  The command opens the one it sends with the password in API_KEYS_PASSWORD,
  which source ./bin/unlock-api-keys.sh keeps for a terminal, or else asks for
  the password on stderr.`;

/** What the help says of the number printed, for the top command and each command. */
const RESULT_HELP = `
What it prints:
  The number the script would give a cell: the price, or the FDV, in USD.
  A 0 means that DexTools, or x1.ninja for x1, has no data for the token or
  pool, or answered with an error: the script gives 0 then, so that a
  sheet's sums keep working. --verbose shows the script's log, with what
  the service answered.`;

/** The examples of the top command's help: one of each common use. */
const EXAMPLES_HELP = `
Examples:
  USDC's price on Ethereum, from the pools DexTools picks:
    $ node bin/crypto-price-fetchers.js price ether 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
  Wrapped XNT's price on X1, in its pool with USDC.X, which x1 needs:
    $ node bin/crypto-price-fetchers.js price x1 So11111111111111111111111111111111111111112 --pool CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR
  A token's fully diluted value on PulseChain:
    $ node bin/crypto-price-fetchers.js fdv pulse 0xF84b84dAAce6Ac00DbBAed26CA32Ff3570Aaf66C`;

/** The examples of each command's own help, by its name. */
const COMMAND_EXAMPLES_HELP = Object.freeze({
  price: `
Examples:
  USDC's price on Ethereum, from the pools DexTools picks:
    $ node bin/crypto-price-fetchers.js price ether 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
  HEX's price on Ethereum, in one of its pools:
    $ node bin/crypto-price-fetchers.js price ether 0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39 --pool 0x69D91B94f0AaF8e8A2586909fA77A5c2c89818d5
  Wrapped XNT's price on X1, in its pool with USDC.X, which x1 needs:
    $ node bin/crypto-price-fetchers.js price x1 So11111111111111111111111111111111111111112 --pool CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR`,
  fdv: `
Examples:
  A token's fully diluted value on PulseChain:
    $ node bin/crypto-price-fetchers.js fdv pulse 0xF84b84dAAce6Ac00DbBAed26CA32Ff3570Aaf66C
  The same, with the script's log on stderr, to see what DexTools answered:
    $ node bin/crypto-price-fetchers.js --verbose fdv pulse 0xF84b84dAAce6Ac00DbBAed26CA32Ff3570Aaf66C`,
});

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
    .name("crypto-price-fetchers")
    .description(
      "A token's price or fully diluted value (FDV) in USD, from DexTools, or from x1.ninja for X1, " +
        "worked out by crypto-price-fetchers.gs run under Node.",
    )
    .addHelpText("after", KEY_HELP)
    .addHelpText("after", RESULT_HELP)
    .addHelpText("after", EXAMPLES_HELP);
  const commands = [
    [
      "price",
      "dexToolsGetTokenPrice",
      "the token's price in USD",
      "a pool to price the token in; required for x1",
    ],
    [
      "fdv",
      "dexToolsGetTokenFDV",
      "the token's fully diluted value in USD",
      "the pool to read; required for x1, unused elsewhere",
    ],
  ];
  for (const [commandName, functionName, description, poolHelp] of commands) {
    program
      .command(commandName)
      .description(description)
      .argument(
        "<chain>",
        "the chain's DexTools slug, such as ether, pulse or bsc; or x1",
        notEmpty,
      )
      .argument("<token>", "the token's address", notEmpty)
      .option("-p, --pool <address>", poolHelp, notEmpty)
      .addHelpText("after", RESULT_HELP)
      .addHelpText("after", COMMAND_EXAMPLES_HELP[commandName])
      .hook("preAction", (command) => checkPoolForX1(command))
      .action((chain, token, options, command) =>
        runCall(functionName, [chain, token, poolCells(options.pool)], command),
      );
  }
}

/**
 * Refuses a run on x1 with no `--pool`, before anything is asked: x1.ninja
 * answers only for a pool, so the script would ask it for the token's mint
 * as one, and give its 0. The chain is x1 in any letter case, as the
 * script reads it.
 *
 * @param {import('commander').Command} command - The command about to run
 * @throws {import('commander').CommanderError} With exit code 1, on x1 with no pool
 */
function checkPoolForX1(command) {
  const [chain] = command.processedArgs;
  if (chain.toLowerCase() === "x1" && command.opts().pool === undefined)
    command.error(
      "error: option '-p, --pool <address>' is needed for x1, since x1.ninja answers only for a pool",
    );
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
    services: [String(args[0]).toLowerCase() === "x1" ? "x1ninja" : "dextools"],
    env: deps.env,
    ask: deps.ask,
    say: (line) => io.stderr.write(`${line}\n`),
    checkOptions: { fetch: deps.fetch, sleep: deps.sleep },
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
