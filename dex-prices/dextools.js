/**
 * DexTools' api, for a token's current price in USD, with the owner's
 * DexTools api key.
 * @module dex-prices/dextools
 *
 * What: DexTools, a service that prices tokens from the pools of
 * decentralized exchanges, gives a token's price in USD now.
 * `currentUsdPrice` asks it for one token on one chain, named by DexTools'
 * name for it, such as 'pulse' for PulseChain, which the caller gives: this
 * module holds no chain's facts.
 *
 * How: DexTools serves each plan at its own path, `{host}/{plan}/{version}`,
 * which `dexToolsSettings` completes with the standard plan's, version 2,
 * unless the caller names another. Each request carries the key in the
 * `X-API-Key` header, never in the url, so no url a log line or an error
 * message quotes holds it. An answer other than a price, an error status
 * among them, is thrown. Every request goes through `fetchWithRetries`
 * (`web-request.js`), which waits out a 429 and gives each try its time
 * limit, the answer's body included.
 *
 * Fit: pulsechain-analytics' ratio chart, which charts the ratio of two
 * tokens' prices, asks it for each token's current price when GeckoTerminal
 * has no candles, as `crypto-price-fetchers/dex-prices/dextools`. The key
 * comes from the project's key store (`api-key-store/`), whose check of a
 * DexTools key (`api-key-store/services.js`) asks the same api, at
 * `DEXTOOLS_API_URL`.
 */

import { fetchWithRetries, requestSettings } from "./web-request.js";

/** DexTools' api, which serves each plan at its own path. */
export const DEXTOOLS_API_URL = "https://public-api.dextools.io";

/** The header DexTools reads an api key from. */
export const DEXTOOLS_KEY_HEADER = "X-API-Key";

/**
 * How DexTools is asked: the request settings (`web-request.js`), with the
 * api's address, the plan and the api's version.
 *
 * @typedef {import('./web-request.js').RequestSettings & {host: string, plan: string, version: string}} DexToolsSettings
 */

/**
 * Completes a caller's settings for DexTools: its api's address, the
 * standard plan, version 2, its name, for the error of a request that runs
 * out of time, and the request settings of `requestSettings`.
 *
 * @param {Partial<DexToolsSettings>} [settings={}] - The caller's settings
 * @returns {DexToolsSettings} The completed settings
 */
export function dexToolsSettings(settings = {}) {
  return {
    host: DEXTOOLS_API_URL,
    plan: "standard",
    version: "v2",
    name: "DexTools",
    ...requestSettings(settings),
  };
}

/**
 * Asks DexTools for a token's price in USD now.
 *
 * @param {{chain: string, token: string}} query - DexTools' name for the chain, such as 'pulse', and the token's address
 * @param {string} apiKey - The DexTools api key
 * @param {DexToolsSettings} settings - How to ask (`dexToolsSettings`)
 * @returns {Promise<number>} The price, above 0
 * @throws {Error} When DexTools answers with an error status, gives no json or gives no price above 0, or a try runs out of time
 */
export async function currentUsdPrice({ chain, token }, apiKey, settings) {
  const url = `${settings.host}/${settings.plan}/${settings.version}/token/${chain}/${token}/price`;
  const response = await fetchWithRetries(
    url,
    {
      headers: { Accept: "application/json", [DEXTOOLS_KEY_HEADER]: apiKey },
    },
    settings,
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `DexTools answered ${response.status} for ${url}: ${text.slice(0, 200)}`,
    );
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`DexTools gave an answer that is not json for ${url}`);
  }
  const price = Number(body?.data?.price);
  if (!Number.isFinite(price) || !(price > 0)) {
    throw new Error(`DexTools gave no price for ${token} on ${chain}`);
  }
  return price;
}
