/**
 * CoinGecko API integration for Crypto Price Filler
 * @module sources/coingecko
 * @description Fetches historical crypto prices from CoinGecko as fallback.
 * Uses tickers endpoint first, falls back to history endpoint if needed.
 * Handles rate limiting, invalid responses, missing keys, parse errors.
 * @version 1.0.0
 * @author Christopher M. Balz with Grok
 */

import fetchWithRetry from '../utils/fetch.js';
const VERBOSE = process.env.VERBOSE ? Number(process.env.VERBOSE) : 1;
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

/**
 * Log verbose messages if VERBOSE is enabled.
 * @param {number} level - Verbosity level (1-4)
 * @param {...any} args - Messages to log
 */
function logv(level, ...args) {
  if (VERBOSE >= level) {
    console.log(...args);
  }
}

/**
 * Try fetching price from CoinGecko tickers endpoint.
 * @param {string} token - Token ID (e.g. 'xtm')
 * @param {boolean} verbose - Verbose logging
 * @returns {Promise<number|null>} Price in USD or null
 */
async function tryCoinGeckoTickers(token, verbose) {
  const url = `${COINGECKO_BASE}/coins/${token}/tickers`;
  logv(2, '[CoinGecko] Tickers URL:', url);

  try {
    const res = await fetchWithRetry(url, verbose);
    if (!res.ok) {
      logv(1, '[CoinGecko] Tickers failed with status:', res.status);
      return null;
    }

    const data = await res.json();
    logv(2, '[CoinGecko] Tickers data received (keys:', Object.keys(data), ')');

    const tickers = data.tickers || [];
    logv(2, '[CoinGecko] Tickers count:', tickers.length);

    let maxVolumePrice = null;
    let maxVolume = 0;

    for (const ticker of tickers) {
      const vol = ticker.volume || 0;
      const price = ticker.converted_last?.usd;
      const stale = ticker.is_stale || false;

      logv(3, '[CoinGecko] Ticker:', ticker.base?.toLowerCase(), '/', ticker.target?.toLowerCase(), 'vol=' + vol, 'usd=' + price, 'stale=' + stale);

      if (price && !stale && vol > maxVolume) {
        maxVolume = vol;
        maxVolumePrice = price;
      }
    }

    logv(2, '[CoinGecko] Selected tickers price:', maxVolumePrice, '(max vol:', maxVolume, ')');
    return maxVolumePrice;
  } catch (err) {
    logv(1, '[CoinGecko] Tickers JSON parse FAILED:', err.message);
    return null;
  }
}

/**
 * Try fetching price from CoinGecko history endpoint.
 * @param {string} token - Token ID
 * @param {string} date - Date in YYYY-MM-DD
 * @param {boolean} verbose - Verbose logging
 * @returns {Promise<number|null>} Price in USD or null
 */
async function tryCoinGeckoHistory(token, date, verbose) {
  const url = `${COINGECKO_BASE}/coins/${token}/history?date=${date}`;
  logv(2, '[CoinGecko] History URL:', url);

  try {
    const res = await fetchWithRetry(url, verbose);
    if (!res.ok) {
      logv(1, '[CoinGecko] History failed with status:', res.status);
      return null;
    }

    const data = await res.json();
    logv(2, '[CoinGecko] History data received (keys:', Object.keys(data), ')');

    const price = data.market_data?.current_price?.usd;

    if (price) {
      logv(2, '[CoinGecko] History price:', price, '(usd key present: true)');
      return price;
    }

    logv(2, '[CoinGecko] History price: null (usd key present: false)');
    return null; // Explicit return (safety - prevents undefined if code changes later)
  } catch (err) {
    logv(1, '[CoinGecko] History JSON parse FAILED:', err.message);
    return null;
  }
}

/**
 * Get USD price from CoinGecko (tickers first, history fallback).
 * @param {string} token - Token ID
 * @param {number} utcMs - Target timestamp (not used directly, only date)
 * @param {boolean} verbose - Verbose logging
 * @returns {Promise<number|null>} Price in USD or null
 */
export async function getPriceFromCoinGecko(token, utcMs, verbose = false) {
  const date = new Date(utcMs).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).replace(/\//g, '-');

  logv(2, '[CoinGecko] Calculated date for CoinGecko:', date);

  let price = await tryCoinGeckoTickers(token, verbose);
  if (price) return price;

  price = await tryCoinGeckoHistory(token, date, verbose);
  if (price) return price;

  logv(1, '[CoinGecko] CoinGecko both paths failed');
  return null;
}
