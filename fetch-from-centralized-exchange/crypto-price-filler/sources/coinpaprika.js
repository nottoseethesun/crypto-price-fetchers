/**
 * CoinPaprika price fetching for Crypto Price Filler
 * @module sources/coinpaprika
 */

import { fetchWithRetry } from '../utils/fetch.js';
import config from '../config.json' with { type: 'json' };

/**
 * Fetches historical high/low price from CoinPaprika.
 * @param {string} id - CoinPaprika coin ID (e.g. 'xtm-tari')
 * @param {number} utcMs - Target time in UTC milliseconds
 * @param {'high'|'low'} highOrLow - Which price to return
 * @param {boolean} [verbose=false] - Enable verbose logging
 * @returns {Promise<number|null>} Price in USD or null if failed
 */
export async function getPriceFromCoinPaprika(id, utcMs, highOrLow, verbose = false) {
  const logv = (level, message, ...args) => {
    if (!verbose || level < 1) return;
    console.log(`[VERBOSE:${level}] ${message}`, ...args);
  };

  const date = new Date(utcMs);
  const dateStr = date.toISOString().split('T')[0]; // yyyy-mm-dd

  // First attempt: precise timestamp (minute-level if available)
  const start = Math.floor(utcMs / 1000 - 60);
  const end = Math.floor(utcMs / 1000);
  const ohlcvUrl = config.COINPAPRIKA_OHLCV_TEMPLATE
    .replace('{base}', config.COINPAPRIKA_BASE)
    .replace('{id}', id)
    .replace('{start}', start)
    .replace('{end}', end);
  logv(2, `CoinPaprika OHLCV URL (precise): ${ohlcvUrl}`);
  let ohlcvRes = await fetchWithRetry(ohlcvUrl, {}, verbose);

  let ohlcv = null;
  if (ohlcvRes && ohlcvRes.ok) {
    try {
      ohlcv = await ohlcvRes.json();
      logv(2, `CoinPaprika precise OHLCV data received (length: ${ohlcv.length})`);
    } catch (e) {
      logv(1, `CoinPaprika precise OHLCV JSON parse FAILED: ${e.message}`);
    }
  }

  // If no data or error, fallback to daily granularity (same day)
  if (!ohlcv || ohlcv.length === 0) {
    logv(1, 'No precise data - retrying with daily granularity');
    const dailyOhlcvUrl = config.COINPAPRIKA_OHLCV_TEMPLATE
      .replace('{base}', config.COINPAPRIKA_BASE)
      .replace('{id}', id)
      .replace('{start}', dateStr)
      .replace('{end}', dateStr);
    logv(2, `CoinPaprika daily OHLCV URL: ${dailyOhlcvUrl}`);
    ohlcvRes = await fetchWithRetry(dailyOhlcvUrl, {}, verbose);

    if (ohlcvRes && ohlcvRes.ok) {
      try {
        ohlcv = await ohlcvRes.json();
        logv(2, `CoinPaprika daily OHLCV data received (length: ${ohlcv.length})`);
      } catch (e) {
        logv(1, `CoinPaprika daily OHLCV JSON parse FAILED: ${e.message}`);
        return null;
      }
    }
  }

  if (!ohlcv || ohlcv.length === 0) {
    logv(1, 'CoinPaprika OHLCV empty after fallback');
    return null;
  }

  const dayData = ohlcv[0]; // daily or closest data point
  let price = null;

  if (highOrLow === 'close') price = parseFloat(dayData.close);
  else if (highOrLow === 'high') price = parseFloat(dayData.high);
  else if (highOrLow === 'low') price = parseFloat(dayData.low);

  if (price !== null && !isNaN(price)) {
    logv(1, `CoinPaprika success - ${highOrLow} price: ${price}`);
    return price;
  }

  logv(1, `CoinPaprika missing/invalid ${highOrLow} price`);
  return null;
}
