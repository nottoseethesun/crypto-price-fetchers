/**
 * GeckoTerminal's api, for the prices of tokens that trade in pools: a
 * token's facts and pools, the pool to read its price from, and a pool's
 * candles. It takes no key.
 * @module dex-prices/geckoterminal
 *
 * What: GeckoTerminal follows the pools of decentralized exchanges, and
 * keeps each pool's prices as candles. A candle covers one minute, hour or
 * day, and holds the time it opened and the open, high, low and close
 * prices of that period, with the volume traded. `tokenInfo` gives a
 * token's name and symbol, and the coin CoinGecko lists for it.
 * `tokenPools` lists the pools that trade a token, in GeckoTerminal's
 * ranking, and `bestPool` picks the one to read its price from.
 * `candlePage` gives up to a thousand of a pool's candles that opened
 * before a time, and `fetchCandles` every candle between two times.
 * `candleAt` and `priceAt` find a time's candle and price in a list of
 * candles.
 *
 * How: a pool's candles price one of its two tokens, which the query's
 * `token` names: 'base' or 'quote', as GeckoTerminal sides the pool, or a
 * token's address. The prices are in USD, unless the query asks for
 * `currency` 'token', which prices the token in the pool's other token.
 * GeckoTerminal makes no candle for a period in which nothing traded. Its
 * public api answers only requests that end within the last 180 days: a
 * request whose before-time is older is refused with 401. A page reaches
 * up to a thousand candles back from its before-time, so the oldest
 * candles the api serves are those of the page asked at the edge of the
 * 180 days, and `fetchCandles` asks its last page there.
 *
 * GeckoTerminal takes about thirty requests a minute from a caller, so,
 * as in LP Ranger, every request of the process shares one budget of
 * twenty in any sixty seconds, which leaves room for requests a run that
 * just ended still has in GeckoTerminal's count. A request waits before
 * each try until the budget has room, and a 429 is sent again after the
 * waits of `fetchWithRetries` (`web-request.js`).
 *
 * Fit: crypto-price-filler prices a token at a time from the candle that
 * holds the time (`sources/geckoterminal.js`); x1-validator-analytics
 * prices XNT from a pool's hourly candles; pulsechain-analytics' ratio
 * chart reads pools' closes and picks pools by their liquidity and
 * history. The two other projects install this repo and import
 * `crypto-price-fetchers/dex-prices/geckoterminal`.
 */

import { fetchWithRetries, requestSettings } from "./web-request.js";

/** GeckoTerminal's api. */
export const GECKO_TERMINAL_API_URL = "https://api.geckoterminal.com/api/v2";

/** The most candles one request gives. */
export const CANDLES_PER_REQUEST = 1000;

/** How far back the public api answers, in seconds: 180 days. */
export const PUBLIC_HISTORY_SECONDS = 180 * 24 * 60 * 60;

/** The length of each timeframe's candle, in seconds, by its name. */
export const TIMEFRAME_SECONDS = Object.freeze({
  minute: 60,
  hour: 60 * 60,
  day: 24 * 60 * 60,
});

/**
 * How far inside the 180 days the last page is asked, in seconds: a day,
 * so the before-time stays inside the limit while the request travels.
 */
const EDGE_MARGIN_SECONDS = 24 * 60 * 60;

/** The most requests the process sends GeckoTerminal in one window. */
const REQUESTS_PER_WINDOW = 20;

/** The window of the budget, in milliseconds. */
const WINDOW_MS = 60 * 1000;

/**
 * The times this process sent GeckoTerminal its recent requests, in
 * milliseconds, oldest first: the budget every caller shares.
 */
const recentRequests = [];

/** The positions of the prices in a candle, by their names. */
const PRICE_INDEX = Object.freeze({ open: 1, high: 2, low: 3, close: 4 });

/**
 * How GeckoTerminal is asked: the request settings (`web-request.js`),
 * with the api's address, a clock, and the record of recent requests the
 * budget counts.
 *
 * @typedef {import('./web-request.js').RequestSettings & {apiUrl: string, now: function(): number, requestLog: number[]}} GeckoTerminalSettings
 */

/**
 * Waits until the budget has room for one more request, then counts the
 * request in it.
 *
 * @param {GeckoTerminalSettings} settings - How GeckoTerminal is asked
 * @returns {Promise<void>} Settles once the request may be sent
 */
async function waitForBudget(settings) {
  const now = settings.now();
  const log = settings.requestLog;
  while (log.length > 0 && log[0] <= now - WINDOW_MS) log.shift();
  if (log.length >= REQUESTS_PER_WINDOW) {
    await settings.sleep(log[0] + WINDOW_MS - now);
  }
  log.push(settings.now());
}

/**
 * Completes a caller's settings for GeckoTerminal: its api's address, its
 * name, for the error of a request that runs out of time, the process's
 * budget of requests, and the request settings of `requestSettings`. A
 * test hands in a clock and a record of its own.
 *
 * @param {Partial<GeckoTerminalSettings>} [settings={}] - The caller's settings
 * @returns {GeckoTerminalSettings} The completed settings
 */
export function geckoTerminalSettings(settings = {}) {
  const completed = {
    apiUrl: GECKO_TERMINAL_API_URL,
    name: "GeckoTerminal",
    now: () => Date.now(),
    requestLog: recentRequests,
    ...requestSettings(settings),
  };
  return { ...completed, beforeTry: () => waitForBudget(completed) };
}

/**
 * Asks GeckoTerminal, and reads its answer.
 *
 * @param {string} url - The url
 * @param {GeckoTerminalSettings} settings - How to ask
 * @returns {Promise<{status: number, body: (Object|null)}>} The status, and the answer's body; null for a 401, which refuses a request older than the public api serves
 * @throws {Error} When GeckoTerminal answers with another error
 */
async function askGeckoTerminal(url, settings) {
  const response = await fetchWithRetries(
    url,
    { headers: { Accept: "application/json" } },
    settings,
  );
  if (response.status === 401) return { status: 401, body: null };
  if (!response.ok) {
    throw new Error(`GeckoTerminal answered ${response.status} for ${url}`);
  }
  return { status: response.status, body: await response.json() };
}

/**
 * A token's facts, as GeckoTerminal gives them.
 *
 * @typedef {Object} TokenInfo
 * @property {(string|null)} name - Its name
 * @property {(string|null)} symbol - Its symbol
 * @property {(string|null)} coingeckoCoinId - The id of the coin CoinGecko lists for it, if any
 */

/**
 * Asks GeckoTerminal about a token.
 *
 * @param {{network: string, token: string}} query - GeckoTerminal's id for the network, such as 'pulsechain', and the token's address
 * @param {GeckoTerminalSettings} settings - How to ask (`geckoTerminalSettings`)
 * @returns {Promise<TokenInfo>} The token's facts
 * @throws {Error} When GeckoTerminal answers with an error
 */
export async function tokenInfo({ network, token }, settings) {
  const { body } = await askGeckoTerminal(
    `${settings.apiUrl}/networks/${network}/tokens/${token}`,
    settings,
  );
  const attributes = body?.data?.attributes ?? {};
  return {
    name: attributes.name ?? null,
    symbol: attributes.symbol ?? null,
    coingeckoCoinId: attributes.coingecko_coin_id ?? null,
  };
}

/**
 * Reads an address from a GeckoTerminal id, which leads with the network:
 * `pulsechain_0xAbC…` gives `0xabc…`.
 *
 * @param {(string|undefined)} id - GeckoTerminal's id for a token or pool
 * @returns {string} The address, in lower case
 */
function addressOf(id) {
  return String(id ?? "")
    .split("_")
    .pop()
    .toLowerCase();
}

/**
 * Which side of a pool a token is on, as GeckoTerminal sides the pool.
 *
 * @param {Object} pool - The pool, as GeckoTerminal lists it
 * @param {string} token - The token's address
 * @returns {(string|null)} 'base', 'quote', or null when the token is on neither side
 */
function sideOf(pool, token) {
  const wanted = token.toLowerCase();
  if (addressOf(pool?.relationships?.base_token?.data?.id) === wanted) {
    return "base";
  }
  if (addressOf(pool?.relationships?.quote_token?.data?.id) === wanted) {
    return "quote";
  }
  return null;
}

/**
 * A pool that trades a token.
 *
 * @typedef {Object} TokenPool
 * @property {string} address - The pool's address
 * @property {string} name - Its name, such as 'HEX / WPLS'
 * @property {number} liquidityUsd - The value it holds, in USD
 * @property {number} volume24hUsd - The value traded in it over the last day, in USD
 * @property {(string|null)} side - Which side of it the token is on: 'base', 'quote', or null for neither
 */

/**
 * Lists the pools that trade a token: the first page GeckoTerminal gives,
 * in its ranking.
 *
 * @param {{network: string, token: string}} query - GeckoTerminal's id for the network, and the token's address
 * @param {GeckoTerminalSettings} settings - How to ask (`geckoTerminalSettings`)
 * @returns {Promise<TokenPool[]>} The pools, in GeckoTerminal's order
 * @throws {Error} When GeckoTerminal answers with an error
 */
export async function tokenPools({ network, token }, settings) {
  const { body } = await askGeckoTerminal(
    `${settings.apiUrl}/networks/${network}/tokens/${token}/pools?page=1`,
    settings,
  );
  return (body?.data ?? []).map((pool) => ({
    address: pool?.attributes?.address ?? "",
    name: pool?.attributes?.name ?? "",
    liquidityUsd: Number(pool?.attributes?.reserve_in_usd ?? 0),
    volume24hUsd: Number(pool?.attributes?.volume_usd?.h24 ?? 0),
    side: sideOf(pool, token),
  }));
}

/**
 * Picks the pool to read a token's price from, as LP Ranger does: the
 * deepest of the first pools GeckoTerminal ranks, leaving out a pool that
 * traded nothing over the last day, which has no candles to read, and a
 * pool the token is on neither side of, whose candles cannot be asked
 * for it.
 *
 * @param {TokenPool[]} pools - The pools, as `tokenPools` lists them
 * @param {number} considered - How many of the first pools to consider
 * @returns {(TokenPool|null)} The pool, or null when none of them qualifies
 */
export function bestPool(pools, considered) {
  const candidates = pools
    .slice(0, considered)
    .filter(
      (pool) =>
        pool.address !== "" && pool.volume24hUsd > 0 && pool.side !== null,
    );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, pool) =>
    pool.liquidityUsd > best.liquidityUsd ? pool : best,
  );
}

/**
 * What a request for candles names.
 *
 * @typedef {Object} CandleQuery
 * @property {string} network - GeckoTerminal's id for the network, such as 'pulsechain'
 * @property {string} pool - The pool's address
 * @property {string} timeframe - 'minute', 'hour' or 'day'
 * @property {(string|null)} [token] - The pool's token to price: 'base', 'quote' or its address; GeckoTerminal's base when absent or null
 * @property {string} [currency='usd'] - 'usd', or 'token' for the pool's other token
 * @property {(number|null)} [beforeSeconds] - Only candles that opened before this time, in unix seconds; the latest candles when absent or null
 * @property {number} [limit=CANDLES_PER_REQUEST] - The most candles to give
 */

/**
 * Builds the url of a request for candles.
 *
 * @param {CandleQuery} query - What to ask for
 * @param {string} apiUrl - GeckoTerminal's api
 * @returns {string} The url
 */
function candlesUrl(query, apiUrl) {
  const params = new URLSearchParams({
    aggregate: "1",
    limit: String(query.limit ?? CANDLES_PER_REQUEST),
    currency: query.currency ?? "usd",
  });
  if (query.beforeSeconds !== undefined && query.beforeSeconds !== null) {
    params.set("before_timestamp", String(query.beforeSeconds));
  }
  if (query.token !== undefined && query.token !== null) {
    params.set("token", query.token);
  }
  return (
    `${apiUrl}/networks/${query.network}/pools/${query.pool}` +
    `/ohlcv/${query.timeframe}?${params}`
  );
}

/**
 * Reads one of GeckoTerminal's candles as numbers: [open time in unix
 * seconds, open, high, low, close, volume], or null when it is not one.
 *
 * @param {Array<(number|string)>} row - The candle as GeckoTerminal gives it
 * @returns {(number[]|null)} The candle, or null
 */
function candleOf(row) {
  if (!Array.isArray(row) || row.length < 5) return null;
  const candle = row.map(Number);
  const pricesValid = candle.slice(0, 5).every(Number.isFinite);
  return pricesValid && candle[PRICE_INDEX.close] > 0 ? candle : null;
}

/**
 * A page of a pool's candles.
 *
 * @typedef {Object} CandlePage
 * @property {Array<number[]>} candles - The candles, as [open time in unix seconds, open, high, low, close, volume], newest first
 * @property {(string|null)} base - The address of the token GeckoTerminal calls the pool's base
 * @property {(string|null)} quote - The address of the pool's other token
 * @property {number} received - How many candles GeckoTerminal sent, unreadable ones among them
 * @property {boolean} outOfReach - Whether the public api refused the request as older than it serves
 */

/**
 * Asks GeckoTerminal for a page of a pool's candles.
 *
 * @param {CandleQuery} query - What to ask for
 * @param {GeckoTerminalSettings} settings - How to ask (`geckoTerminalSettings`)
 * @returns {Promise<CandlePage>} The page; no candles, and outOfReach, when the request is older than the public api serves
 * @throws {Error} When GeckoTerminal answers with another error, or gives no candle list
 */
export async function candlePage(query, settings) {
  const { status, body } = await askGeckoTerminal(
    candlesUrl(query, settings.apiUrl),
    settings,
  );
  if (status === 401) {
    return {
      candles: [],
      base: null,
      quote: null,
      received: 0,
      outOfReach: true,
    };
  }
  const list = body?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) {
    throw new Error(`GeckoTerminal gave no candle list for pool ${query.pool}`);
  }
  return {
    candles: list.map(candleOf).filter((candle) => candle !== null),
    base: body?.meta?.base?.address ?? null,
    quote: body?.meta?.quote?.address ?? null,
    received: list.length,
    outOfReach: false,
  };
}

/**
 * The before-time of the oldest page the public api serves: a day inside
 * its 180 days.
 *
 * @param {GeckoTerminalSettings} settings - How GeckoTerminal is asked, for its clock
 * @returns {number} The time, in unix seconds
 */
function oldestBeforeSeconds(settings) {
  return (
    Math.floor(settings.now() / 1000) -
    PUBLIC_HISTORY_SECONDS +
    EDGE_MARGIN_SECONDS
  );
}

/**
 * Asks GeckoTerminal for every candle of a pool that opened from one time
 * to another, page by page back from the later, as far back as the
 * public api serves.
 *
 * Each page's before-time is the open time of the oldest candle the page
 * before gave, so no candle is skipped, and never older than the edge of
 * the public api's 180 days. The pages stop once they reach the earlier
 * time, once a page comes back short (the pool has no older candles), or
 * once the next before-time would be no older than the last.
 *
 * @param {CandleQuery} query - What to ask for; its beforeSeconds is ignored
 * @param {number} earliestSeconds - The earliest open time wanted, in unix seconds
 * @param {number} latestSeconds - The latest open time wanted, in unix seconds
 * @param {GeckoTerminalSettings} settings - How to ask (`geckoTerminalSettings`)
 * @returns {Promise<{candles: Array<number[]>, base: (string|null), quote: (string|null)}>} The candles, oldest first, and the pool's tokens as the first page names them
 * @throws {Error} When GeckoTerminal answers with an error
 */
export async function fetchCandles(
  query,
  earliestSeconds,
  latestSeconds,
  settings,
) {
  const limit = query.limit ?? CANDLES_PER_REQUEST;
  const edge = oldestBeforeSeconds(settings);
  const byOpen = new Map();
  let pool = { base: null, quote: null };
  let before = Math.max(
    latestSeconds + TIMEFRAME_SECONDS[query.timeframe],
    edge,
  );
  for (let first = true; ; first = false) {
    const page = await candlePage(
      { ...query, limit, beforeSeconds: before },
      settings,
    );
    if (first) pool = { base: page.base, quote: page.quote };
    for (const candle of page.candles) byOpen.set(candle[0], candle);
    if (page.received < limit || page.candles.length === 0) break;
    const oldest = Math.min(...page.candles.map((candle) => candle[0]));
    const next = Math.max(oldest, edge);
    if (oldest <= earliestSeconds || next >= before) break;
    before = next;
  }
  const candles = [...byOpen.values()]
    .filter(([open]) => open >= earliestSeconds && open <= latestSeconds)
    .sort((a, b) => a[0] - b[0]);
  return { candles, ...pool };
}

/**
 * Finds the candle that holds a time: the one that opened at the start of
 * the time's minute, hour or day. A time in a period with no trade has
 * none, since GeckoTerminal makes no candle for such a period.
 *
 * @param {Array<number[]>} candles - Candles, as `candlePage` gives them, in any order
 * @param {number} seconds - The time, in unix seconds
 * @param {string} timeframe - The candles' timeframe: 'minute', 'hour' or 'day'
 * @returns {(number[]|null)} The candle, or null
 */
export function candleAt(candles, seconds, timeframe) {
  const step = TIMEFRAME_SECONDS[timeframe];
  const open = seconds - (seconds % step);
  return candles.find((candle) => candle[0] === open) ?? null;
}

/**
 * Reads one of a candle's prices by its name.
 *
 * @param {number[]} candle - A candle, as `candlePage` gives it
 * @param {string} name - 'open', 'high', 'low' or 'close'
 * @returns {number} The price
 */
export function candlePrice(candle, name) {
  return candle[PRICE_INDEX[name]];
}

/**
 * The price at a time from a list of candles: the close of the last candle
 * that opened at or before the time, if it opened less than `maxAgeSeconds`
 * before it.
 *
 * @param {Array<number[]>} candles - Candles, as `fetchCandles` gives them, oldest first
 * @param {number} seconds - The time, in unix seconds
 * @param {number} maxAgeSeconds - How long before the time the candle may have opened, in seconds
 * @returns {(number|null)} The price, or null when no candle qualifies
 */
export function priceAt(candles, seconds, maxAgeSeconds) {
  let low = 0;
  let high = candles.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (candles[middle][0] <= seconds) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (found === -1) return null;
  const candle = candles[found];
  const age = seconds - candle[0];
  return age < maxAgeSeconds ? candlePrice(candle, "close") : null;
}
