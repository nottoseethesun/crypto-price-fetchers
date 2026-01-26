/**
 * @file price.js
 * @description Main price fetching logic for crypto-price-filler.
 * Tries MEXC first (preferred), falls back to CoinGecko, then CoinPaprika if needed.
 * Handles caching, rate-limit retry, BTC pair adjustment, verbose logging.
 *
 * @module price
 * @version 1.0.0
 * @author Christopher M. Balz with Grok and Claude.ai
 */

import { getPriceFromMEXC } from './mexc.js';
import { getPriceFromCoinGecko } from './coingecko.js';
import { getPriceFromCoinPaprika } from './coinpaprika.js';
import { getCache, setCache } from '../utils/cache.js';
import { parseInputToUtcMs, getTimezoneOffsetHours } from '../utils/date.js';
import fs from 'fs';

/**
 * Helper logging function.
 * @param {boolean} shouldLog - Whether to log
 * @param {number} level - Log level
 * @param {string} message - Message to log
 * @param {...*} args - Additional arguments
 */
function logv(shouldLog, level, message, ...args) {
  if (!shouldLog || level < 1) return;
  console.log(`[VERBOSE:${level}] ${message}`, ...args);
}

/**
 * Loads token configuration from supported-tokens.json.
 * @param {string} token - Token symbol
 * @returns {Object} Token configuration with coingeckoId, coinpaprikaId, mexcSymbol
 */
function loadTokenConfig(token) {
  const supportedTokens = JSON.parse(fs.readFileSync('./supported-tokens.json', 'utf8'));
  const tokenConfig = supportedTokens.tokens?.[token.toLowerCase()] || {};

  return {
    coingeckoId: tokenConfig.coingecko_id || null,
    coinpaprikaId: tokenConfig.coinpaprika_id || null,
    mexcSymbol: tokenConfig.mexc_symbol || null
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
  const dateKey = new Date(utcMs).toISOString().slice(0, 19).replace(/[-:T]/g, '');
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
 * Attempts to fetch price from MEXC.
 * @param {string} mexcSymbol - MEXC symbol
 * @param {number} utcMs - UTC timestamp
 * @param {string} target - Price target
 * @param {boolean} verbose - Enable verbose logging
 * @returns {Promise<number|null>} Price or null
 */
async function tryMEXC(mexcSymbol, utcMs, target, verbose) {
  if (mexcSymbol === null) {
    logv(verbose, 1, 'MEXC skipped since set to null');
    return null;
  }

  try {
    const price = await getPriceFromMEXC(mexcSymbol, utcMs, target, verbose);
    if (price !== null) {
      logv(verbose, 1, `MEXC success - price: ${price}`);
    }
    return price;
  } catch (err) {
    logv(verbose, 1, `MEXC failed: ${err.message}`);
    return null;
  }
}

/**
 * Attempts to fetch price from CoinGecko.
 * @param {string} token - Token symbol
 * @param {string} coingeckoId - CoinGecko ID
 * @param {number} utcMs - UTC timestamp
 * @param {string} target - Price target
 * @param {boolean} verbose - Enable verbose logging
 * @returns {Promise<number|null>} Price or null
 */
async function tryCoinGecko(token, coingeckoId, utcMs, target, verbose) {
  if (!coingeckoId) {
    logv(verbose, 1, 'CoinGecko skipped since set to null');
    return null;
  }

  logv(verbose, 1, 'Falling back to CoinGecko');
  try {
    const price = await getPriceFromCoinGecko(token, utcMs, target, verbose, coingeckoId);
    if (price !== null) {
      logv(verbose, 1, `CoinGecko success - price: ${price}`);
    }
    return price;
  } catch (err) {
    logv(verbose, 1, `CoinGecko failed: ${err.message}`);
    return null;
  }
}

/**
 * Attempts to fetch price from CoinPaprika.
 * @param {string} coinpaprikaId - CoinPaprika ID
 * @param {number} utcMs - UTC timestamp
 * @param {string} target - Price target
 * @param {boolean} verbose - Enable verbose logging
 * @returns {Promise<number|null>} Price or null
 */
async function tryCoinPaprika(coinpaprikaId, utcMs, target, verbose) {
  if (!coinpaprikaId) {
    logv(verbose, 1, 'CoinPaprika skipped since set to null');
    return null;
  }

  logv(verbose, 1, 'Falling back to CoinPaprika');
  try {
    const price = await getPriceFromCoinPaprika(coinpaprikaId, utcMs, target, verbose);
    if (price !== null) {
      logv(verbose, 1, `CoinPaprika success - price: ${price}`);
    }
    return price;
  } catch (err) {
    logv(verbose, 1, `CoinPaprika failed: ${err.message}`);
    return null;
  }
}

/**
 * Fetches historical crypto price for a given token, date/time, and target (high/low/close).
 *
 * Priority:
 * 1. Cache hit
 * 2. MEXC
 * 3. CoinGecko
 * 4. CoinPaprika (additional fallback for coins like GRC)
 *
 * @param {string} token - Token symbol (e.g. 'xtm', 'grc')
 * @param {string} dateStr - Date/time string in 'yyyy-MM-dd HH:mm:ss' format
 * @param {string} tz - Timezone abbreviation (e.g. 'UTC', 'CDT')
 * @param {string} [target='high'] - Price target: 'high', 'low', 'close'
 * @param {boolean} [verbose=false] - Enable verbose logging
 * @param {Object} [testCache=null] - Optional test cache object (for unit tests)
 * @returns {Promise<number|null>} Price in USD, or null if unavailable
 */
export async function getCryptoPrice(
  token,
  dateStr,
  tz,
  target = 'high',
  verbose = false,
  testCache = null
) {
  const { coingeckoId, coinpaprikaId, mexcSymbol } = loadTokenConfig(token);

  // Log resolved IDs
  const coingeckoStatus = coingeckoId || 'skipped since set to null';
  const coinpaprikaStatus = coinpaprikaId || 'skipped since set to null';
  const mexcStatus = mexcSymbol || 'skipped since set to null';
  logv(verbose, 1, `Resolved IDs - CoinGecko: ${coingeckoStatus}, CoinPaprika: ${coinpaprikaStatus}, MEXC: ${mexcStatus}`);

  // Parse date
  const offsetHours = getTimezoneOffsetHours(tz);
  const utcMs = parseInputToUtcMs(dateStr, offsetHours);

  if (utcMs === null) {
    logv(verbose, 1, `Invalid date/time: "${dateStr}"`);
    return null;
  }

  if (utcMs > Date.now()) {
    logv(verbose, 1, `Skipping future date: ${dateStr} (${new Date(utcMs).toISOString()})`);
    return null;
  }

  // Check cache
  const cacheKey = generateCacheKey(token, utcMs, target);
  const cachedPrice = checkCache(cacheKey, testCache, verbose);
  if (cachedPrice !== undefined) {
    return cachedPrice;
  }

  logv(verbose, 1, `Cache MISS for "${cacheKey}" - fetching price`);

  // Try sources in order
  let price = await tryMEXC(mexcSymbol, utcMs, target, verbose);

  if (price === null) {
    price = await tryCoinGecko(token, coingeckoId, utcMs, target, verbose);
  }

  if (price === null) {
    price = await tryCoinPaprika(coinpaprikaId, utcMs, target, verbose);
  }

  // Cache and return
  storeInCache(cacheKey, price, testCache);
  logv(verbose, 1, `[getCryptoPrice] Final price: ${price ?? 'null'}`);

  return price;
}
