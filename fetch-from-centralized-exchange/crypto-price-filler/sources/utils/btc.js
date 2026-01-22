/**
 * BTC price utility for Crypto Price Filler (used by MEXC)
 * @module sources/utils/btc
 */

import { fetchWithRetry } from '../../utils/fetch.js';
import config from '../../config.json' assert { type: 'json' };

/**
 * Fetches current BTC/USD price from CoinGecko.
 * @param {boolean} [verbose=false] - Enable verbose logging
 * @returns {Promise<number|null>} BTC price in USD or null if failed
 */
export async function getBTCUSDTPrice(verbose = false) {
  const logv = (level, message, ...args) => {
    if (!verbose || level < 1) return;
    console.log(`[VERBOSE:${level}] ${message}`, ...args);
  };

  const url = config.COINGECKO_SIMPLE_PRICE_TEMPLATE.replace('{base}', config.COINGECKO_BASE);
  logv(2, `BTC price URL: ${url}`);
  const res = await fetchWithRetry(url, verbose);
  if (!res) return null;

  let data;
  try {
    data = await res.json();
    logv(2, `BTC price data: ${JSON.stringify(data)}`);
  } catch (e) {
    logv(1, `BTC price JSON parse FAILED: ${e.message}`);
    return null;
  }

  const price = data.bitcoin?.usd;
  logv(1, `BTC price: ${price || 'null'}`);
  return price;
}
