/**
 * CoinGecko price fetching logic for crypto-price-filler.
 * Tries tickers endpoint first, then historical endpoint.
 * Handles rate-limit retry, verbose logging.
 *
 * @module coingecko
 * @version 1.0.0
 * @author Christopher M. Balz with Grok
 */

import { fetchWithRetry } from '../utils/fetch.js';

/**
 * Fetch price from CoinGecko for a given token and timestamp.
 * @param {string} token - Token symbol (for logging/fallback)
 * @param {number} utcMs - Unix timestamp in milliseconds
 * @param {string} target - 'high', 'low', or 'close'
 * @param {boolean} verbose - Enable verbose logging
 * @param {string} [coingeckoId=token.toLowerCase()] - Resolved CoinGecko ID
 * @returns {Promise<number|null>} Price in USD or null
 */
export async function getPriceFromCoinGecko(
  token,
  utcMs,
  target = 'close',
  verbose = false,
  coingeckoId = token.toLowerCase()
) {
  const logv = (level, message, ...args) => {
    if (!verbose || level < 1) return;
    console.log(`[VERBOSE:${level}] ${message}`, ...args);
  };

  const date = new Date(utcMs);
  const dateStr = `${date.getDate().toString().padStart(2, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getFullYear()}`;

  let price = null;

  // Try tickers endpoint first (current price)
  const tickersUrl = `https://api.coingecko.com/api/v3/coins/${coingeckoId}/tickers`;
  try {
    logv(2, `Fetch attempt 1/3 for ${tickersUrl}`);
    const response = await fetchWithRetry(tickersUrl, {}, verbose);
    if (response.ok) {
      const data = await response.json();
      const ticker = data.tickers?.find(t => t.target === 'USD' || t.base === 'USD');
      if (ticker) {
        price = ticker.last;
        logv(1, `CoinGecko tickers success - price: ${price}`);
        return price;
      }
    }
  } catch (err) {
    logv(1, `Tickers fetch failed: ${err.message}`);
  }

  // Fallback to historical endpoint (precise timestamp attempt)
  const historyUrl = `https://api.coingecko.com/api/v3/coins/${coingeckoId}/history?date=${dateStr}`;
  try {
    logv(2, `Fetch attempt 1/3 for ${historyUrl}`);
    const response = await fetchWithRetry(historyUrl, {}, verbose);
    if (response.ok) {
      const data = await response.json();
      const marketData = data.market_data;
      if (marketData) {
        if (target === 'close') price = marketData.current_price?.usd;
        else if (target === 'high') price = marketData.high_24h?.usd;
        else if (target === 'low') price = marketData.low_24h?.usd;
        if (price) {
          logv(1, `CoinGecko history success - ${target} price: ${price}`);
          return price;
        }
      }
    }
  } catch (err) {
    logv(1, `History fetch failed: ${err.message}`);
  }

  // Fallback to daily granularity (same day) when precise timestamp fails
  if (price === null) {
    logv(1, 'No precise data - retrying with daily granularity');
    try {
      const response = await fetchWithRetry(historyUrl, {}, verbose);
      if (response.ok) {
        const data = await response.json();
        const marketData = data.market_data;
        if (marketData) {
          if (target === 'close') price = marketData.current_price?.usd;
          else if (target === 'high') price = marketData.high_24h?.usd;
          else if (target === 'low') price = marketData.low_24h?.usd;
          if (price) {
            logv(1, `CoinGecko daily fallback success - ${target} price: ${price}`);
            return price;
          }
        }
      }
    } catch (err) {
      logv(1, `Daily fallback fetch failed: ${err.message}`);
    }
  }

  logv(1, `CoinGecko both paths failed for ${coingeckoId}`);
  return null;
}
