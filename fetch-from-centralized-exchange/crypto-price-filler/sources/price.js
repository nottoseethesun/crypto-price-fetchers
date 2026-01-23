/**
 * @file price.js
 * @description Main price fetching logic for crypto-price-filler.
 * Tries MEXC first (preferred), falls back to CoinGecko, then CoinPaprika if needed.
 * Handles caching, rate-limit retry, BTC pair adjustment, verbose logging.
 *
 * @module price
 * @version 1.0.0
 * @author Christopher M. Balz with Grok
 */

import { getPriceFromMEXC } from './mexc.js';
import { getPriceFromCoinGecko } from './coingecko.js';
import { getPriceFromCoinPaprika } from './coinpaprika.js';
import { getCache, setCache } from '../utils/cache.js';
import { parseInputToUtcMs, getTimezoneOffsetHours } from '../utils/date.js';
import fs from 'fs';

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
  // Load central token configurations from supported-tokens.json
  const supportedTokens = JSON.parse(fs.readFileSync('./supported-tokens.json', 'utf8'));
  const tokenConfig = supportedTokens.tokens?.[token.toLowerCase()] || {};

  const coingeckoId = tokenConfig.coingecko_id || null;
  const coinpaprikaId = tokenConfig.coinpaprika_id || null;
  const mexcSymbol = tokenConfig.mexc_symbol;

  // Uniform skipped logging for all sources (generic for future additions)
  const coingeckoStatus = coingeckoId ? coingeckoId : 'skipped since set to null';
  const coinpaprikaStatus = coinpaprikaId ? coinpaprikaId : 'skipped since set to null';
  const mexcStatus = mexcSymbol ? mexcSymbol : 'skipped since set to null';
  logv(verbose, 1, `Resolved IDs - CoinGecko: ${coingeckoStatus}, CoinPaprika: ${coinpaprikaStatus}, MEXC: ${mexcStatus}`);

  const offsetHours = getTimezoneOffsetHours(tz);
  const utcMs = parseInputToUtcMs(dateStr, offsetHours);

  if (utcMs === null) {
    logv(verbose, 1, `Invalid date/time: "${dateStr}"`);
    return null;
  }

  // Skip future dates
  if (utcMs > Date.now()) {
    logv(verbose, 1, `Skipping future date: ${dateStr} (${new Date(utcMs).toISOString()})`);
    return null;
  }

  // Cache key
  const dateKey = new Date(utcMs).toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const cacheKey = `price_${token.toLowerCase()}_${dateKey}_UTC_${target}`;

  // Cache check
  let cachedPrice;
  if (testCache) {
    if (testCache.has(cacheKey)) {
      cachedPrice = testCache.get(cacheKey);
      logv(verbose, 1, `Cache HIT for key "${cacheKey}"`);
      return cachedPrice;
    }
  } else if (getCache(cacheKey)) {
    cachedPrice = getCache(cacheKey);
    logv(verbose, 1, `Cache HIT for key "${cacheKey}"`);
    return cachedPrice;
  }

  logv(verbose, 1, `Cache MISS for "${cacheKey}" - fetching price`);

  let price = null;

  // Try MEXC first (only if symbol exists)
  if (mexcSymbol !== null) {
    try {
      price = await getPriceFromMEXC(mexcSymbol, utcMs, target, verbose);
      if (price !== null) {
        logv(verbose, 1, `MEXC success - price: ${price}`);
      }
    } catch (err) {
      logv(verbose, 1, `MEXC failed: ${err.message}`);
    }
  } else {
    logv(verbose, 1, `MEXC skipped since set to null`);
  }

  // CoinGecko fallback (only if ID defined)
  if (price === null && coingeckoId) {
    logv(verbose, 1, 'Falling back to CoinGecko');
    try {
      price = await getPriceFromCoinGecko(token, utcMs, target, verbose, coingeckoId);
      if (price !== null) {
        logv(verbose, 1, `CoinGecko success - price: ${price}`);
      }
    } catch (err) {
      logv(verbose, 1, `CoinGecko failed: ${err.message}`);
    }
  } else if (price === null) {
    logv(verbose, 1, 'CoinGecko skipped since set to null');
  }

  // CoinPaprika fallback (only if ID defined)
  if (price === null && coinpaprikaId) {
    logv(verbose, 1, 'Falling back to CoinPaprika');
    try {
      price = await getPriceFromCoinPaprika(coinpaprikaId, utcMs, target, verbose);
      if (price !== null) {
        logv(verbose, 1, `CoinPaprika success - price: ${price}`);
      }
    } catch (err) {
      logv(verbose, 1, `CoinPaprika failed: ${err.message}`);
    }
  } else if (price === null) {
    logv(verbose, 1, 'CoinPaprika skipped since set to null');
  }

  // Cache result
  if (testCache) {
    testCache.set(cacheKey, price);
  } else {
    setCache(cacheKey, price);
  }

  logv(verbose, 1, `[getCryptoPrice] Final price: ${price ?? 'null'}`);
  return price;
}

// Helper logging
function logv(shouldLog, level, message, ...args) {
  if (!shouldLog || level < 1) return;
  console.log(`[VERBOSE:${level}] ${message}`, ...args);
}
