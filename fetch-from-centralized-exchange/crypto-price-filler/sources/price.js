/**
 * High-level price fetching utilities for Crypto Price Filler
 * @module sources/price
 * @description Provides the main `getCryptoPrice` entry point that handles date parsing,
 * timezone offsets, future-date skipping, and calls the primary source (MEXC) with fallback to CoinGecko.
 * 
 * @version 1.0.0
 * @author Christopher M. Balz with Grok
 */

import { getPriceFromMEXC } from './mexc.js';
import { getPriceFromCoinGecko } from './coingecko.js'; // ← Add this import
import { getTimezoneOffsetHours, parseInputToUtcMs } from '../utils/date.js';

/**
 * Fetches the price of a cryptocurrency at a specific date and time.
 * 
 * Primary entry point for historical prices. Tries MEXC first, falls back to CoinGecko on failure.
 * 
 * @param {string} token - Token symbol (case-insensitive)
 * @param {string} dateStr - 'YYYY-MM-DD HH:mm:ss'
 * @param {string} tz - Timezone abbreviation
 * @param {'high'|'low'} target - Price type
 * @param {boolean} [verbose=false] - Logging
 * @param {Map} [testCache=null] - Optional cache for testing
 * @returns {Promise<number|null>}
 */
export async function getCryptoPrice(token, dateStr, tz, target, verbose = false, testCache = null) {
  const offset = getTimezoneOffsetHours(tz);
  const utcMs = parseInputToUtcMs(dateStr, offset, verbose);
  if (utcMs === null) return null;

  if (utcMs > Date.now()) return null;

  const cache = testCache || null;

  let price = await getPriceFromMEXC(token, utcMs, target, verbose, cache);

  if (price === null) {
    if (verbose) console.log('[getCryptoPrice] MEXC failed - falling back to CoinGecko');
    price = await getPriceFromCoinGecko(token, utcMs, target, verbose, cache); // ← Add this
  }

  if (verbose) console.log(`[getCryptoPrice] Final price: ${price ?? 'null'}`);
  return price;  // ← THIS WAS THE MISSING RETURN STATEMENT
}
