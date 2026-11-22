/**
 * The services whose api keys the projects keep, and how each is asked
 * whether it takes a key.
 * @module api-key-store/services
 *
 * What: `SERVICES` holds each service a project's `config.json` may list
 * under `apiKeys`, by the name it is listed under: its name in messages,
 * and `check(key, options)`, which asks the service about a key once. A
 * check answers 'valid' when the service takes the key and 'invalid' when
 * it refuses it, and throws when the service does not answer, or answers
 * so that neither can be told. `serviceNamed` finds one by its listed name.
 *
 * How each is asked:
 *
 * - coingecko: CoinGecko's ping, with the key in the `x-cg-demo-api-key`
 *   header. 200 takes the key; 400 and 401 refuse it.
 * - coinpaprika: the facts CoinPaprika's paid server gives about a key
 *   (`/key/info`), with the key as the whole `Authorization` header, as
 *   its paid plans take it. 200 takes the key; 401 and 403 refuse it.
 * - dextools: DexTools' list of blockchains, with the key in the
 *   `X-API-Key` header, at the api its client asks
 *   (`dex-prices/dextools.js`). DexTools serves each plan at its own path and
 *   answers 403 for a key that plan does not know, so the check asks each
 *   plan in turn, 1.1 seconds apart, since the free plan takes one request
 *   a second: a 200 from any plan takes the key, and 403 from every plan
 *   refuses it.
 * - moralis: Moralis's api version (`/web3/version`), with the key in the
 *   `X-API-Key` header (`dex-prices/moralis.js`). The request names no
 *   chain, so the check holds for any chain a project prices on, and
 *   Moralis refuses it without a key it knows. 200 takes the key; 401
 *   refuses it.
 * - x1ninja: x1.ninja's XNT / USDC.X pool, the pool x1-validator-analytics
 *   prices XNT in, with the key as a bearer token. 200 takes the key; 401
 *   refuses it.
 *
 * A key goes only in a header, never in a url, so no url a log line or an
 * error message quotes holds it.
 *
 * Fit: the prompts (`key-prompts.js`) and the manager (`key-manager.js`)
 * ask these checks; a project names the services it uses in its
 * `config.json` (`project-keys.js`).
 */

import {
  DEXTOOLS_API_URL,
  DEXTOOLS_KEY_HEADER,
} from "../dex-prices/dextools.js";
import { MORALIS_API_URL, MORALIS_KEY_HEADER } from "../dex-prices/moralis.js";

/** How long a service has to answer a check, in milliseconds. */
const CHECK_TIMEOUT_MS = 15000;

/** The header CoinGecko reads a demo api key from. */
export const COINGECKO_KEY_HEADER = "x-cg-demo-api-key";

/** CoinGecko's ping. */
const COINGECKO_PING = "https://api.coingecko.com/api/v3/ping";

/** What CoinPaprika's paid server says of the key it is sent. */
const COINPAPRIKA_KEY_INFO = "https://api-pro.coinpaprika.com/v1/key/info";

/** DexTools' plans, in the order the check asks them: the one the projects use first. */
const DEXTOOLS_PLANS = Object.freeze([
  "standard",
  "trial",
  "free",
  "advanced",
  "pro",
]);

/** The time between two of the check's requests to DexTools, in milliseconds. */
const DEXTOOLS_SPACING_MS = 1100;

/** Moralis's api version, which names no chain and which Moralis gives only for a key it knows. */
const MORALIS_PROBE = `${MORALIS_API_URL}/web3/version`;

/** x1.ninja's XNT / USDC.X pool, which a key must be able to read. */
const X1_NINJA_POOL =
  "https://api.x1.ninja/v1/pools/CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR";

/**
 * Waits.
 *
 * @param {number} ms - How long, in milliseconds
 * @returns {Promise<void>} Settles once the time is up
 */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * What a check needs from its caller: what a test replaces.
 *
 * @typedef {Object} CheckOptions
 * @property {function(string, Object): Promise<Response>} [fetch=globalThis.fetch] - Does the request
 * @property {function(number): Promise<void>} [sleep] - Waits between two requests to one service
 */

/**
 * Asks a service, and gives the status it answers with.
 *
 * @param {CheckOptions} options - What a test replaces
 * @param {string} url - The url
 * @param {Object<string, string>} headers - The headers, the key's among them
 * @returns {Promise<number>} The status
 */
async function statusOf(options, url, headers) {
  const fetchFunction = options.fetch ?? globalThis.fetch;
  const response = await fetchFunction(url, {
    headers,
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  return response.status;
}

/**
 * Asks CoinGecko's ping whether it takes a demo api key.
 *
 * @param {string} key - The key
 * @param {CheckOptions} [options] - What a test replaces
 * @returns {Promise<string>} 'valid' or 'invalid'
 * @throws {Error} When CoinGecko does not answer, or answers with another status
 */
async function checkCoinGecko(key, options = {}) {
  const status = await statusOf(options, COINGECKO_PING, {
    [COINGECKO_KEY_HEADER]: key,
  });
  if (status === 200) return "valid";
  if (status === 400 || status === 401) return "invalid";
  throw new Error(`CoinGecko answered with status ${status}`);
}

/**
 * Asks CoinPaprika's paid server whether it takes a key.
 *
 * @param {string} key - The key
 * @param {CheckOptions} [options] - What a test replaces
 * @returns {Promise<string>} 'valid' or 'invalid'
 * @throws {Error} When CoinPaprika does not answer, or answers with another status
 */
async function checkCoinPaprika(key, options = {}) {
  const status = await statusOf(options, COINPAPRIKA_KEY_INFO, {
    Authorization: key,
    Accept: "application/json",
  });
  if (status === 200) return "valid";
  if (status === 401 || status === 403) return "invalid";
  throw new Error(`CoinPaprika answered with status ${status}`);
}

/**
 * Asks DexTools, plan by plan, whether one of its plans takes a key.
 *
 * @param {string} key - The key
 * @param {CheckOptions} [options] - What a test replaces
 * @returns {Promise<string>} 'valid' when a plan takes it, 'invalid' when every plan refuses it
 * @throws {Error} When DexTools does not answer, or answers with a status other than 200 or 403
 */
async function checkDexTools(key, options = {}) {
  const sleep = options.sleep ?? wait;
  for (const [index, plan] of DEXTOOLS_PLANS.entries()) {
    if (index > 0) await sleep(DEXTOOLS_SPACING_MS);
    const url = `${DEXTOOLS_API_URL}/${plan}/v2/blockchain?sort=name&order=asc`;
    const status = await statusOf(options, url, {
      [DEXTOOLS_KEY_HEADER]: key,
      Accept: "application/json",
    });
    if (status === 200) return "valid";
    if (status !== 403)
      throw new Error(`DexTools answered with status ${status}`);
  }
  return "invalid";
}

/**
 * Asks Moralis whether it takes a key, by asking its api version with it.
 *
 * @param {string} key - The key
 * @param {CheckOptions} [options] - What a test replaces
 * @returns {Promise<string>} 'valid' or 'invalid'
 * @throws {Error} When Moralis does not answer, or answers with another status
 */
async function checkMoralis(key, options = {}) {
  const status = await statusOf(options, MORALIS_PROBE, {
    [MORALIS_KEY_HEADER]: key,
    Accept: "application/json",
  });
  if (status === 200) return "valid";
  if (status === 401) return "invalid";
  throw new Error(`Moralis answered with status ${status}`);
}

/**
 * Asks x1.ninja whether it takes a key, by reading a pool with it.
 *
 * @param {string} key - The key
 * @param {CheckOptions} [options] - What a test replaces
 * @returns {Promise<string>} 'valid' or 'invalid'
 * @throws {Error} When x1.ninja does not answer, or answers with another status
 */
async function checkX1Ninja(key, options = {}) {
  const status = await statusOf(options, X1_NINJA_POOL, {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  });
  if (status === 200) return "valid";
  if (status === 401) return "invalid";
  throw new Error(`x1.ninja answered with status ${status}`);
}

/**
 * A service whose key a project keeps.
 *
 * @typedef {Object} Service
 * @property {string} service - Its name in `config.json` and the key file, such as 'coingecko'
 * @property {string} name - Its name in messages, such as 'CoinGecko'
 * @property {function(string, CheckOptions=): Promise<string>} check - Asks it about a key: 'valid' or 'invalid'; throws when it does not answer
 */

/** The services, by the name `config.json` lists them under. */
export const SERVICES = Object.freeze({
  coingecko: Object.freeze({
    service: "coingecko",
    name: "CoinGecko",
    check: checkCoinGecko,
  }),
  coinpaprika: Object.freeze({
    service: "coinpaprika",
    name: "CoinPaprika",
    check: checkCoinPaprika,
  }),
  dextools: Object.freeze({
    service: "dextools",
    name: "DexTools",
    check: checkDexTools,
  }),
  moralis: Object.freeze({
    service: "moralis",
    name: "Moralis",
    check: checkMoralis,
  }),
  x1ninja: Object.freeze({
    service: "x1ninja",
    name: "x1.ninja",
    check: checkX1Ninja,
  }),
});

/**
 * Finds a service by the name `config.json` lists it under.
 *
 * @param {string} name - The name, such as 'coingecko'
 * @param {Object<string, Service>} [services=SERVICES] - The services known
 * @returns {Service} The service
 * @throws {Error} When no service known has that name
 */
export function serviceNamed(name, services = SERVICES) {
  if (typeof name !== "string" || !Object.hasOwn(services, name)) {
    throw new Error(
      `No service is named ${JSON.stringify(name)}; the services are ${Object.keys(services).join(", ")}`,
    );
  }
  return services[name];
}
