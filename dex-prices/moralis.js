/**
 * Moralis's api, for the price of a token that trades in pools at a past
 * time, with the owner's Moralis api key.
 * @module dex-prices/moralis
 *
 * What: Moralis prices a token in USD from the pools it trades in, as they
 * stood at a block of its chain. `blockAt` gives the block a chain had at
 * a time, and `priceAtBlock` the token's price at that block, so the two
 * together price a token at a time. A block's price is one figure, with no
 * high or low. `pairCandles` gives a pool's candles over a span of time,
 * each with its open, high, low and close in USD, of the token the pool
 * lists first, as in HEX / WPLS, which prices HEX: Moralis names that
 * token in its answer, and a caller that charts another token checks it.
 * `tokenPairs` lists the pairs that trade a token, with the token each
 * lists first, and `pairListingFirst` picks the deepest pair that lists
 * a given token first, whose candles price it.
 *
 * How: each request carries the key in the `X-API-Key` header, never in
 * the url, so no url a log line or an error message quotes holds it. A
 * chain is named by Moralis's id for it, such as '0x171' for PulseChain,
 * which the caller gives: this module holds no chain's facts. Moralis
 * answers 404 when it has no block, price, pair or candle to give, which
 * is read as none; any other error is thrown, a refused key (401) among
 * them. Every request goes through `fetchWithRetries` (`web-request.js`),
 * which waits out a 429.
 *
 * Fit: crypto-price-filler asks Moralis first for a token's price at a
 * time, when the owner has saved a Moralis key (`sources/moralis.js`), and
 * GeckoTerminal (`geckoterminal.js`) for what Moralis does not answer.
 * pulsechain-analytics' ratio chart asks it for each token's pair and that
 * pair's candles. The key comes from the repo's key store
 * (`api-key-store/`), whose check of a Moralis key is in
 * `api-key-store/services.js`.
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
 * Completes a caller's settings for Moralis: its api's address, its name,
 * for the error of a request that runs out of time, and the request
 * settings of `requestSettings`.
 *
 * @param {Partial<MoralisSettings>} [settings={}] - The caller's settings
 * @returns {MoralisSettings} The completed settings
 */
export function moralisSettings(settings = {}) {
  return {
    apiUrl: MORALIS_API_URL,
    name: "Moralis",
    ...requestSettings(settings),
  };
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

/**
 * The most pages of a token's pairs `tokenPairs` reads. Moralis's docs do
 * not say how many pairs a page holds, nor in what order the pairs come.
 */
const MAX_PAIR_PAGES = 10;

/**
 * One of a pair's two tokens, as `tokenPairs` gives it.
 *
 * @typedef {Object} PairToken
 * @property {string} address - Its address, in lower case
 * @property {string} name - Its name, or '' when Moralis gives none
 * @property {string} symbol - Its symbol, or '' when Moralis gives none
 */

/**
 * A pair that trades a token, as `tokenPairs` gives it.
 *
 * @typedef {Object} TokenPair
 * @property {string} address - The pair's address, in lower case
 * @property {string} label - Moralis's label for it, such as 'HEX/WPLS', which names first the token it lists first, or '' when Moralis gives none
 * @property {(string|null)} baseToken - The address of the token it lists first, in lower case, or null when Moralis gives none
 * @property {number} liquidityUsd - The value it holds, in USD; 0 when Moralis gives none
 * @property {boolean} inactive - Whether nothing traded in it over the last day, as Moralis marks it
 * @property {PairToken[]} tokens - Its tokens Moralis names with a readable address
 */

/**
 * An address Moralis gave, in lower case.
 *
 * @param {*} value - What Moralis gave
 * @returns {(string|null)} The address, or null when it is not 0x and 40 hex digits
 */
function lowerCaseAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : null;
}

/**
 * A text Moralis gave, or '' where it gave none.
 *
 * @param {*} value - What Moralis gave
 * @returns {string} The text
 */
function textOf(value) {
  return typeof value === "string" ? value : "";
}

/**
 * A pair as Moralis lists it, read.
 *
 * @param {*} row - The pair: its pair_address, pair_label, base_token, liquidity_usd, inactive_pair and pair, the list of its tokens
 * @returns {(TokenPair|null)} The pair, or null when its address is unreadable
 */
function pairOf(row) {
  const address = lowerCaseAddress(row?.pair_address);
  if (address === null) return null;
  const liquidity = Number(row?.liquidity_usd);
  return {
    address,
    label: textOf(row?.pair_label),
    baseToken: lowerCaseAddress(row?.base_token),
    liquidityUsd: Number.isFinite(liquidity) ? liquidity : 0,
    inactive: row?.inactive_pair === true,
    tokens: (Array.isArray(row?.pair) ? row.pair : [])
      .map((token) => ({
        address: lowerCaseAddress(token?.token_address),
        name: textOf(token?.token_name),
        symbol: textOf(token?.token_symbol),
      }))
      .filter((token) => token.address !== null),
  };
}

/**
 * Asks Moralis for the pairs that trade a token, page by page, up to
 * MAX_PAIR_PAGES pages.
 *
 * @param {{chain: string, token: string}} query - Moralis's id for the chain, such as '0x171', and the token's address
 * @param {string} apiKey - The Moralis api key
 * @param {MoralisSettings} settings - How to ask (`moralisSettings`)
 * @returns {Promise<TokenPair[]>} The pairs, in Moralis's order; none when Moralis answers 404
 * @throws {Error} When Moralis answers with another error, a refused key among them
 */
export async function tokenPairs({ chain, token }, apiKey, settings) {
  const pairs = [];
  let cursor = null;
  for (let page = 1; page <= MAX_PAIR_PAGES; page++) {
    const query = new URLSearchParams({ chain });
    if (cursor !== null) query.set("cursor", cursor);
    const body = await askMoralis(
      `${settings.apiUrl}/erc20/${token}/pairs?${query}`,
      apiKey,
      settings,
    );
    if (body === null) break;
    for (const row of Array.isArray(body.pairs) ? body.pairs : []) {
      const pair = pairOf(row);
      if (pair !== null) pairs.push(pair);
    }
    cursor =
      typeof body.cursor === "string" && body.cursor !== ""
        ? body.cursor
        : null;
    if (cursor === null) break;
  }
  return pairs;
}

/**
 * Picks the pair whose candles price a token: the deepest of the pairs
 * that list the token first, leaving out a pair Moralis marks inactive,
 * which has no candles for the last day.
 *
 * @param {TokenPair[]} pairs - The pairs, as `tokenPairs` gives them
 * @param {string} token - The token's address, in either case
 * @returns {(TokenPair|null)} The pair, or null when none lists the token first
 */
export function pairListingFirst(pairs, token) {
  const address = token.toLowerCase();
  const candidates = pairs.filter(
    (pair) => !pair.inactive && pair.baseToken === address,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, pair) =>
    pair.liquidityUsd > best.liquidityUsd ? pair : best,
  );
}

/**
 * The most pages `pairCandles` reads, so an answer whose cursor never ends
 * cannot hold its caller.
 */
const MAX_CANDLE_PAGES = 50;

/**
 * A candle as Moralis gives it, read as numbers.
 *
 * @param {*} row - The candle: its timestamp, an ISO time, and its open, high, low, close and volume
 * @returns {?{seconds: number, open: number, high: number, low: number, close: number, volume: number}} The candle, its time in unix seconds; or null when a field is unreadable or the close is not above 0
 */
function candleOf(row) {
  const seconds = Date.parse(row?.timestamp) / 1000;
  const candle = {
    seconds,
    open: Number(row?.open),
    high: Number(row?.high),
    low: Number(row?.low),
    close: Number(row?.close),
    volume: Number(row?.volume),
  };
  const readable = Object.values(candle).every(Number.isFinite);
  return readable && candle.close > 0 ? candle : null;
}

/**
 * Asks Moralis for a pool's candles over a span of time, page by page, in
 * USD: those of the token the pool lists first.
 *
 * @param {{chain: string, pair: string, timeframe: string, fromSeconds: number, toSeconds: number}} query - Moralis's id for the chain, such as '0x171', the pool's address, the candles' timeframe, such as '1d', and the span's first and last times, in unix seconds
 * @param {string} apiKey - The Moralis api key
 * @param {MoralisSettings} settings - How to ask (`moralisSettings`)
 * @returns {Promise<{tokenAddress: (string|null), candles: Array<{seconds: number, open: number, high: number, low: number, close: number, volume: number}>}>} The token Moralis priced, in lower case, and the candles, oldest first; no candles when Moralis has none
 * @throws {Error} When Moralis answers with an error, a refused key among them, or gives more than MAX_CANDLE_PAGES pages
 */
export async function pairCandles(
  { chain, pair, timeframe, fromSeconds, toSeconds },
  apiKey,
  settings,
) {
  const candles = [];
  let tokenAddress = null;
  let cursor = null;
  for (let page = 1; ; page++) {
    if (page > MAX_CANDLE_PAGES) {
      throw new Error(
        `Moralis gave more than ${MAX_CANDLE_PAGES} pages of candles for pool ${pair}`,
      );
    }
    const query = new URLSearchParams({
      chain,
      timeframe,
      currency: "usd",
      fromDate: String(fromSeconds),
      toDate: String(toSeconds),
    });
    if (cursor !== null) query.set("cursor", cursor);
    const body = await askMoralis(
      `${settings.apiUrl}/pairs/${pair}/ohlcv?${query}`,
      apiKey,
      settings,
    );
    if (body === null) break;
    if (typeof body.tokenAddress === "string") {
      tokenAddress = body.tokenAddress.toLowerCase();
    }
    for (const row of Array.isArray(body.result) ? body.result : []) {
      const candle = candleOf(row);
      if (candle !== null) candles.push(candle);
    }
    cursor =
      typeof body.cursor === "string" && body.cursor !== ""
        ? body.cursor
        : null;
    if (cursor === null) break;
  }
  candles.sort((a, b) => a.seconds - b.seconds);
  return { tokenAddress, candles };
}
