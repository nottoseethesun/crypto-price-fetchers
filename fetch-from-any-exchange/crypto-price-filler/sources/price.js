/**
 * @file price.js
 * @description Main price fetching logic for crypto-price-filler.
 * Each token is asked of five sources until one gives a price: Moralis
 * (with a saved key) and GeckoTerminal, for a token that trades in pools
 * and names its contract in supported-tokens.json; and MEXC, CoinGecko and
 * CoinPaprika, the Sheets script getCryptoPriceFromCentralizedExchange's
 * own price sources, run through the repo's runner (`exchange.js`). The
 * order is the one the script's rule gives (`sourcesInPriority`): the
 * sources that take a key, Moralis, CoinGecko and CoinPaprika, in the
 * run's order of priority (`npm run api-keys -- rank`); GeckoTerminal
 * right after Moralis; and MEXC right before the first of CoinGecko and
 * CoinPaprika (`FILLER_SOURCES`).
 * Handles caching and verbose logging.
 *
 * @module price
 * @version 1.0.0
 * @author Christopher M. Balz with Grok and Claude.ai
 */

import { getApiKeyPriority } from "../../../api-key-store/index.js";
import { getPriceFromMoralis } from "./moralis.js";
import { getPriceFromGeckoTerminal } from "./geckoterminal.js";
import { exchangeSources } from "./exchange.js";
import { getCache, setCache } from "../utils/cache.js";
import { parseInputToUtcMs } from "../utils/date.js";
import { logv } from "../utils/log.js";
import { readSupportedTokens } from "../supported-tokens.js";

/**
 * The filler's sources, for the Sheets script's rule for the order to ask
 * sources in (`sourcesInPriority`): Moralis, which takes a key, with
 * GeckoTerminal, which prices pools without one, right after it; and MEXC,
 * which takes none, right before the first of CoinGecko and CoinPaprika,
 * which each take one. Those that take a key are asked in the run's order
 * of priority; with none, as before a run opens its keys, in the order
 * written here.
 */
const FILLER_SOURCES = Object.freeze([
  Object.freeze({ name: "Moralis", service: "moralis" }),
  Object.freeze({ name: "GeckoTerminal", after: "moralis" }),
  Object.freeze({
    name: "MEXC",
    before: Object.freeze(["coingecko", "coinpaprika"]),
  }),
  Object.freeze({ name: "CoinGecko", service: "coingecko" }),
  Object.freeze({ name: "CoinPaprika", service: "coinpaprika" }),
]);

/**
 * The order to ask the filler's sources in (`FILLER_SOURCES`), as the
 * Sheets script orders sources (`sourcesInPriority`), from the run's order
 * of priority (`getApiKeyPriority`).
 *
 * @param {boolean} verbose - Enable verbose logging, for the script's sources as they open
 * @returns {Promise<Array<string>>} The sources' names, in the order to ask them
 * @throws {Error} When the script's sources cannot be opened
 */
export async function sourceOrder(verbose) {
  const sources = await exchangeSources(verbose);
  return sources.sourcesInPriority(FILLER_SOURCES, getApiKeyPriority() ?? []);
}

/**
 * Reads the pool facts of a token's entry: its contract, and the ids
 * GeckoTerminal and Moralis give its chain.
 * @param {Object} tokenConfig - The token's entry in supported-tokens.json
 * @returns {import('./moralis.js').PoolToken|null} The facts, or null for a token that names no contract
 */
function poolTokenOf(tokenConfig) {
  if (typeof tokenConfig.contract !== "string") return null;
  return {
    contract: tokenConfig.contract,
    network: tokenConfig.geckoterminal_network ?? null,
    moralisChain: tokenConfig.moralis_chain ?? null,
  };
}

/**
 * Loads token configuration from supported-tokens.json.
 * @param {string} token - Token symbol
 * @returns {Object} Token configuration with coingeckoId, coinpaprikaId, mexcSymbol, and poolToken for a token that trades in pools
 */
export function loadTokenConfig(token) {
  const supportedTokens = readSupportedTokens();
  const tokenConfig = supportedTokens.tokens?.[token.toLowerCase()] ?? {};

  return {
    coingeckoId: tokenConfig.coingecko_id ?? null,
    coinpaprikaId: tokenConfig.coinpaprika_id ?? null,
    mexcSymbol: tokenConfig.mexc_symbol ?? null,
    poolToken: poolTokenOf(tokenConfig),
  };
}

/**
 * Generates a cache key for the price lookup.
 * @param {string} token - Token symbol
 * @param {number} utcMs - UTC timestamp in milliseconds
 * @param {string} target - Price target (high/low/close)
 * @returns {string} Cache key
 */
function generateCacheKey(token, utcMs, target) {
  const dateKey = new Date(utcMs)
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, "");
  return `price_${token.toLowerCase()}_${dateKey}_UTC_${target}`;
}

/**
 * Checks cache for a price.
 * @param {string} cacheKey - Cache key to look up
 * @param {Object|null} testCache - Optional test cache
 * @param {boolean} verbose - Enable verbose logging
 * @returns {number|null|undefined} Cached price, or undefined if not found
 */
function checkCache(cacheKey, testCache, verbose) {
  if (testCache) {
    if (testCache.has(cacheKey)) {
      const cached = testCache.get(cacheKey);
      logv(verbose, 1, `Cache HIT for key "${cacheKey}"`);
      return cached;
    }
  } else if (getCache(cacheKey)) {
    const cached = getCache(cacheKey);
    logv(verbose, 1, `Cache HIT for key "${cacheKey}"`);
    return cached;
  }
  return undefined;
}

/**
 * Stores a price in cache.
 * @param {string} cacheKey - Cache key
 * @param {number|null} price - Price to cache
 * @param {Object|null} testCache - Optional test cache
 */
function storeInCache(cacheKey, price, testCache) {
  if (testCache) {
    testCache.set(cacheKey, price);
  } else {
    setCache(cacheKey, price);
  }
}

/**
 * Attempts to fetch price from Moralis, for a token that trades in pools
 * and names Moralis's id for its chain.
 * @param {import('./moralis.js').PoolToken|null} poolToken - The token's pool facts, or null
 * @param {number} utcMs - UTC timestamp
 * @param {string} target - Price target
 * @param {boolean} verbose - Enable verbose logging
 * @returns {Promise<number|null>} Price or null
 */
async function tryMoralis(poolToken, utcMs, target, verbose) {
  if (poolToken === null || poolToken.moralisChain === null) {
    logv(verbose, 1, "Moralis skipped: no contract or Moralis chain set");
    return null;
  }
  const price = await getPriceFromMoralis(poolToken, utcMs, target, verbose);
  if (price !== null) logv(verbose, 1, `Moralis success - price: ${price}`);
  return price;
}

/**
 * Attempts to fetch price from GeckoTerminal, for a token that trades in
 * pools and names GeckoTerminal's id for its chain.
 * @param {import('./moralis.js').PoolToken|null} poolToken - The token's pool facts, or null
 * @param {number} utcMs - UTC timestamp
 * @param {string} target - Price target
 * @param {boolean} verbose - Enable verbose logging
 * @returns {Promise<number|null>} Price or null
 */
async function tryGeckoTerminal(poolToken, utcMs, target, verbose) {
  if (poolToken === null || poolToken.network === null) {
    logv(verbose, 1, "GeckoTerminal skipped: no contract or network set");
    return null;
  }
  const price = await getPriceFromGeckoTerminal(
    poolToken,
    utcMs,
    target,
    verbose,
  );
  if (price !== null) {
    logv(verbose, 1, `GeckoTerminal success - price: ${price}`);
  }
  return price;
}

/**
 * Asks one of the Sheets script's price sources (`exchange.js`) for a
 * price, skipping it when the token's entry names no id for it.
 * @param {string} name - The source's name in log lines, such as 'MEXC'
 * @param {string} sourceFunction - The script's function, such as 'getPriceFromMEXC'
 * @param {string|null} id - The token's id at the source (its MEXC symbol, CoinGecko id or CoinPaprika id), or null to skip it
 * @param {number} utcMs - UTC timestamp
 * @param {string} target - Price target
 * @param {boolean} verbose - Enable verbose logging
 * @returns {Promise<number|null>} Price or null
 */
async function tryExchangeSource(
  name,
  sourceFunction,
  id,
  utcMs,
  target,
  verbose,
) {
  if (id === null) {
    logv(verbose, 1, `${name} skipped since set to null`);
    return null;
  }
  try {
    const sources = await exchangeSources(verbose);
    const price = await sources[sourceFunction](id, utcMs, target);
    if (typeof price !== "number" || !Number.isFinite(price)) {
      logv(verbose, 1, `${name} has no ${target} price`);
      return null;
    }
    logv(verbose, 1, `${name} success - price: ${price}`);
    return price;
  } catch (err) {
    logv(verbose, 1, `${name} failed: ${err.message}`);
    return null;
  }
}

/**
 * Fetches historical crypto price for a given token, date/time, and target (high/low/close).
 *
 * A price kept in the cache comes first. Then the sources, in the order
 * `sourceOrder` gives:
 * - Moralis, for a token with a contract and a Moralis chain, when a
 *   Moralis key is saved; it answers the close only
 * - GeckoTerminal, for a token with a contract and a GeckoTerminal
 *   network, within the last 180 days
 * - MEXC, under the token's mexc_symbol
 * - CoinGecko, under its coingecko_id
 * - CoinPaprika, under its coinpaprika_id
 *
 * The last three are the Sheets script's price sources (`exchange.js`);
 * each is skipped when the token's entry names no id for it. When the
 * script's sources cannot be opened, so the order cannot be had, the price
 * is null, and nothing is cached.
 *
 * @param {string} token - Token symbol (e.g. 'xtm', 'grc')
 * @param {string} dateStr - Date/time string in 'yyyy-MM-dd HH:mm:ss' format
 * @param {string} tz - Time zone the date is in, named in full (e.g. 'America/Chicago') or 'UTC'
 * @param {string} [target='high'] - Price target: 'high', 'low', 'close'
 * @param {boolean} [verbose=false] - Enable verbose logging
 * @param {Object} [testCache=null] - Optional test cache object (for unit tests)
 * @returns {Promise<number|null>} Price in USD, or null if unavailable
 * @throws {Error} When the time zone is not a full name or UTC (see utils/date.js)
 */
export async function getCryptoPrice(
  token,
  dateStr,
  tz,
  target = "high",
  verbose = false,
  testCache = null,
) {
  const { coingeckoId, coinpaprikaId, mexcSymbol, poolToken } =
    loadTokenConfig(token);

  // Log resolved IDs
  const coingeckoStatus = coingeckoId ?? "skipped since set to null";
  const coinpaprikaStatus = coinpaprikaId ?? "skipped since set to null";
  const mexcStatus = mexcSymbol ?? "skipped since set to null";
  logv(
    verbose,
    1,
    `Resolved IDs - CoinGecko: ${coingeckoStatus}, CoinPaprika: ${coinpaprikaStatus}, MEXC: ${mexcStatus}`,
  );

  // Parse date, at the offset the time zone had then
  const utcMs = parseInputToUtcMs(dateStr, tz);

  if (utcMs === null) {
    logv(verbose, 1, `Invalid date/time: "${dateStr}"`);
    return null;
  }

  if (utcMs > Date.now()) {
    logv(
      verbose,
      1,
      `Skipping future date: ${dateStr} (${new Date(utcMs).toISOString()})`,
    );
    return null;
  }

  // Check cache
  const cacheKey = generateCacheKey(token, utcMs, target);
  const cachedPrice = checkCache(cacheKey, testCache, verbose);
  if (cachedPrice !== undefined) {
    return cachedPrice;
  }

  logv(verbose, 1, `Cache MISS for "${cacheKey}" - fetching price`);

  let order;
  try {
    order = await sourceOrder(verbose);
  } catch (err) {
    logv(verbose, 1, `The sources' order could not be had: ${err.message}`);
    return null;
  }
  logv(verbose, 1, `Sources, in order: ${order.join(", ")}`);
  const askSource = {
    Moralis: () => tryMoralis(poolToken, utcMs, target, verbose),
    GeckoTerminal: () => tryGeckoTerminal(poolToken, utcMs, target, verbose),
    MEXC: () =>
      tryExchangeSource(
        "MEXC",
        "getPriceFromMEXC",
        mexcSymbol,
        utcMs,
        target,
        verbose,
      ),
    CoinGecko: () =>
      tryExchangeSource(
        "CoinGecko",
        "getPriceFromCoinGecko",
        coingeckoId,
        utcMs,
        target,
        verbose,
      ),
    CoinPaprika: () =>
      tryExchangeSource(
        "CoinPaprika",
        "getPriceFromCoinPaprika",
        coinpaprikaId,
        utcMs,
        target,
        verbose,
      ),
  };
  let price = null;
  for (const name of order) {
    price = await askSource[name]();
    if (price !== null) break;
  }

  // Cache and return
  storeInCache(cacheKey, price, testCache);
  logv(verbose, 1, `[getCryptoPrice] Final price: ${price ?? "null"}`);

  return price;
}
