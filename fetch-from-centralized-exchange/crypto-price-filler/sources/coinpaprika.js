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

  const tickersUrl = config.COINPAPRIKA_TICKERS_TEMPLATE
    .replace('{base}', config.COINPAPRIKA_BASE)
    .replace('{id}', id);
  logv(2, `CoinPaprika tickers URL: ${tickersUrl}`);
  const res = await fetchWithRetry(tickersUrl, verbose);
  if (!res) return null;

  let data;
  try {
    data = await res.json();
    logv(2, `CoinPaprika tickers data received (keys: ${Object.keys(data).join(', ')})`);
  } catch (e) {
    logv(1, `CoinPaprika tickers JSON parse FAILED: ${e.message}`);
    return null;
  }

  if (!data.quotes || !data.quotes.USD) {
    logv(1, 'CoinPaprika quotes missing or no USD');
    return null;
  }

  const start = Math.floor(utcMs / 1000 - 60);
  const end = Math.floor(utcMs / 1000);
  const ohlcvUrl = config.COINPAPRIKA_OHLCV_TEMPLATE
    .replace('{base}', config.COINPAPRIKA_BASE)
    .replace('{id}', id)
    .replace('{start}', start)
    .replace('{end}', end);
  logv(2, `CoinPaprika OHLCV URL: ${ohlcvUrl}`);
  const ohlcvRes = await fetchWithRetry(ohlcvUrl, verbose);
  if (!ohlcvRes) return null;

  let ohlcv;
  try {
    ohlcv = await ohlcvRes.json();
    logv(2, `CoinPaprika OHLCV data received (length: ${ohlcv.length})`);
  } catch (e) {
    logv(1, `CoinPaprika OHLCV JSON parse FAILED: ${e.message}`);
    return null;
  }

  if (!ohlcv || ohlcv.length === 0) {
    logv(1, 'CoinPaprika OHLCV empty');
    return null;
  }

  const price = highOrLow === 'low' ? parseFloat(ohlcv[0].low) : parseFloat(ohlcv[0].high);
  logv(1, `CoinPaprika price: ${price}`);
  return price;
}
