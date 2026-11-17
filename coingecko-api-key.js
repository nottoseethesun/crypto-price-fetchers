/**
 * The CoinGecko api key the tools in this repo send, kept encrypted in the
 * repo's key file and opened with its password as a run starts.
 * @module coingecko-api-key
 *
 * What:
 *
 * - `unlockCoinGeckoKey` puts the saved key in memory for a run: it asks
 *   for the key's password, opens the key, and asks CoinGecko once whether
 *   it takes it (`unlockApiKey`). With no key saved, the run asks CoinGecko
 *   without one, which CoinGecko answers at a lower rate.
 * - `saveCoinGeckoKey` asks for a key and a password, and saves the key,
 *   encrypted, once CoinGecko takes it (`enterApiKey`). `save-api-key.js`
 *   runs it: `npm run save-api-key -- coingecko`.
 * - `checkCoinGeckoKey` asks CoinGecko's ping whether it takes a key.
 * - `apiKeysFile` names the key file: `api-keys.json` at the repo's top,
 *   or the file the environment variable `API_KEYS_FILE_PATH` names, as
 *   LP Ranger's tests name theirs.
 *
 * How:
 *
 * - One key file serves the repo, so the key and its password are typed
 *   once for both tools that send it: crypto-price-filler and the Node
 *   version of getCryptoPriceFromCentralizedExchange.gs. Git ignores it.
 * - The key goes to CoinGecko in the `x-cg-demo-api-key` header, never in
 *   a url, so no url a log line or an error message quotes holds it.
 * - The Sheets script cannot read the file: in Apps Script the key is a
 *   Script Property its owner sets, and the script's Node version hands it
 *   the key opened here as that property.
 *
 * Fit: built on `api-key-store/`, the reusable part.
 */

import { fileURLToPath } from 'node:url';
import { enterApiKey, unlockApiKey } from './api-key-store/index.js';

/** The service's name in the key file, whose entry is `coingeckoEncrypted`. */
export const COINGECKO_SERVICE = 'coingecko';

/** The header CoinGecko reads a demo api key from. */
export const COINGECKO_KEY_HEADER = 'x-cg-demo-api-key';

/** CoinGecko's api, whose ping checks a key. */
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

/** How long CoinGecko has to answer the check, in milliseconds. */
const CHECK_TIMEOUT_MS = 15000;

/** The key file when the environment names none. */
const DEFAULT_API_KEYS_FILE = fileURLToPath(new URL('./api-keys.json', import.meta.url));

/** The command that saves a new key, as messages name it: it runs from any folder. */
export const SAVE_COMMAND = `node "${fileURLToPath(new URL('./save-api-key.js', import.meta.url))}" coingecko`;

/**
 * Names the key file.
 *
 * @param {Object<string, string>} [env=process.env] - The environment
 * @returns {string} `API_KEYS_FILE_PATH` when it names a file, else `api-keys.json` at the repo's top
 */
export function apiKeysFile(env = process.env) {
  const named = env.API_KEYS_FILE_PATH;
  return typeof named === 'string' && named !== '' ? named : DEFAULT_API_KEYS_FILE;
}

/**
 * Asks CoinGecko's ping whether it takes a demo api key.
 *
 * @param {string} key - The key
 * @param {Object} [options] - What a test replaces
 * @param {function(string, Object): Promise<Response>} [options.fetch=globalThis.fetch] - Does the request
 * @param {string} [options.baseUrl] - CoinGecko's api, such as a tool's setting for it
 * @returns {Promise<string>} 'valid' when CoinGecko takes the key, 'invalid' when it refuses it
 * @throws {Error} When CoinGecko does not answer, or answers with another status
 */
export async function checkCoinGeckoKey(key, options = {}) {
  const fetchFunction = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? COINGECKO_API;
  const response = await fetchFunction(`${baseUrl}/ping`, {
    headers: { [COINGECKO_KEY_HEADER]: key },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
  });
  if (response.status === 200) return 'valid';
  if (response.status === 400 || response.status === 401) return 'invalid';
  throw new Error(`CoinGecko answered with status ${response.status}`);
}

/**
 * Fills in the key's spec for the prompts (`KeySpec`).
 *
 * @param {Object} options - What the caller or a test gives
 * @returns {import('./api-key-store/key-prompts.js').KeySpec} The spec
 */
function coinGeckoKeySpec(options) {
  return {
    file: options.file ?? apiKeysFile(),
    service: COINGECKO_SERVICE,
    name: 'CoinGecko',
    saveCommand: SAVE_COMMAND,
    check: (key) => checkCoinGeckoKey(key, { fetch: options.fetch, baseUrl: options.baseUrl }),
    ask: options.ask,
    say: options.say ?? ((line) => console.error(line))
  };
}

/**
 * Puts the saved CoinGecko key in memory for the run, once CoinGecko
 * takes it.
 *
 * @param {Object} [options] - What the caller or a test gives
 * @param {string} [options.file] - The key file, in place of `apiKeysFile()`
 * @param {function(string): Promise<string>} [options.ask] - Answers the prompts, in place of the terminal
 * @param {function(string): void} [options.say] - Prints a line, in place of stderr
 * @param {function(string, Object): Promise<Response>} [options.fetch] - Asks CoinGecko, in place of Node's fetch
 * @param {string} [options.baseUrl] - CoinGecko's api, such as a tool's setting for it
 * @returns {Promise<?string>} The key, or null when none is saved
 * @throws {Error} With `keyRefused` set, when the password does not open the key or CoinGecko refuses it
 */
export function unlockCoinGeckoKey(options = {}) {
  return unlockApiKey(coinGeckoKeySpec(options));
}

/**
 * Asks for a CoinGecko key and a password, and saves the key, encrypted,
 * once CoinGecko takes it.
 *
 * @param {Object} [options] - What the caller or a test gives (`unlockCoinGeckoKey`)
 * @returns {Promise<string>} The key
 * @throws {Error} With `keyRefused` set, when no key is saved; its message says why
 */
export function saveCoinGeckoKey(options = {}) {
  return enterApiKey(coinGeckoKeySpec(options));
}
