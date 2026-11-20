/**
 * Moralis's api, for the price of a token that trades in pools at a past
 * time, with the owner's Moralis api key.
 * @module dex-prices/moralis
 *
 * What: Moralis prices a token in USD from the pools it trades in, as they
 * stood at a block of its chain. `blockAt` gives the block a chain had at
 * a time, and `priceAtBlock` the token's price at that block, so the two
 * together price a token at a time. A block's price is one figure, with no
 * high or low.
 *
 * How: each request carries the key in the `X-API-Key` header, never in
 * the url, so no url a log line or an error message quotes holds it. A
 * chain is named by Moralis's id for it, such as '0x171' for PulseChain,
 * which the caller gives: this module holds no chain's facts. Moralis
 * answers 404 when it has no price or block to give, which is read as
 * none; any other error is thrown, a refused key (401) among them. Every
 * request goes through `fetchWithRetries` (`web-request.js`), which waits
 * out a 429.
 *
 * Fit: crypto-price-filler asks Moralis first for a token's price at a
 * time, when the owner has saved a Moralis key (`sources/moralis.js`), and
 * GeckoTerminal (`geckoterminal.js`) for what Moralis does not answer. The
 * key comes from the repo's key store (`api-key-store/`), whose check of a
 * Moralis key is in `api-key-store/services.js`.
 */

import { fetchWithRetries, requestSettings } from "./web-request.js";

/** Moralis's api. */
export const MORALIS_API_URL = "https://deep-index.moralis.io/api/v2.2";

/** The header Moralis reads an api key from. */
export const MORALIS_KEY_HEADER = "X-API-Key";

/**
 * How Moralis is asked: the request settings (`web-request.js`), with the
 * api's address.
 *
 * @typedef {import('./web-request.js').RequestSettings & {apiUrl: string}} MoralisSettings
 */

/**
 * Completes a caller's settings for Moralis: its api's address, and the
 * request settings of `requestSettings`.
 *
 * @param {Partial<MoralisSettings>} [settings={}] - The caller's settings
 * @returns {MoralisSettings} The completed settings
 */
export function moralisSettings(settings = {}) {
  return { apiUrl: MORALIS_API_URL, ...requestSettings(settings) };
}

/**
 * Asks Moralis, with the key, and reads its answer.
 *
 * @param {string} url - The url
 * @param {string} apiKey - The Moralis api key
 * @param {MoralisSettings} settings - How to ask
 * @returns {Promise<(Object|null)>} The answer's body, or null for a 404
 * @throws {Error} When Moralis answers with another error, a refused key among them
 */
async function askMoralis(url, apiKey, settings) {
  const response = await fetchWithRetries(
    url,
    {
      headers: { Accept: "application/json", [MORALIS_KEY_HEADER]: apiKey },
    },
    settings,
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Moralis answered ${response.status} for ${url}`);
  }
  return response.json();
}

/**
 * Asks Moralis for the block a chain had at a time.
 *
 * @param {{chain: string, seconds: number}} query - Moralis's id for the chain, such as '0x171', and the time, in unix seconds
 * @param {string} apiKey - The Moralis api key
 * @param {MoralisSettings} settings - How to ask (`moralisSettings`)
 * @returns {Promise<(number|null)>} The block's number, or null when Moralis has none
 * @throws {Error} When Moralis answers with an error, a refused key among them
 */
export async function blockAt({ chain, seconds }, apiKey, settings) {
  const body = await askMoralis(
    `${settings.apiUrl}/dateToBlock?chain=${chain}&date=${seconds}`,
    apiKey,
    settings,
  );
  const block = Number(body?.block);
  return Number.isInteger(block) && block >= 0 ? block : null;
}

/**
 * Asks Moralis for a token's price at a block, in USD.
 *
 * @param {{chain: string, token: string, block: number}} query - Moralis's id for the chain, the token's address, and the block's number
 * @param {string} apiKey - The Moralis api key
 * @param {MoralisSettings} settings - How to ask (`moralisSettings`)
 * @returns {Promise<(number|null)>} The price, or null when Moralis has none
 * @throws {Error} When Moralis answers with an error, a refused key among them
 */
export async function priceAtBlock({ chain, token, block }, apiKey, settings) {
  const body = await askMoralis(
    `${settings.apiUrl}/erc20/${token}/price?chain=${chain}&to_block=${block}`,
    apiKey,
    settings,
  );
  const price = Number(body?.usdPrice);
  return Number.isFinite(price) && price > 0 ? price : null;
}
