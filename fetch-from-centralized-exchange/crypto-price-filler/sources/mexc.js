/**
 * MEXC price fetching module for Crypto Price Filler
 * @module sources/mexc
 * @description Primary price source using MEXC API (exchangeInfo + klines).
 * Handles symbol lookup, 1m/60m klines, BTC pair adjustment, and 429 retry.
 * 
 * @version 1.0.0
 * @author Christopher M. Balz with Grok
 */

import { fetchWithRetry } from '../utils/fetch.js';
import config from '../config.json' with { type: 'json' };
import { getBTCUSDTPrice } from './utils/btc.js';

/**
 * Fetches historical high/low price for a token from MEXC.
 * @param {string} token - Token symbol (e.g. 'xtm')
 * @param {number} utcMs - Target time in UTC milliseconds
 * @param {'high'|'low'} target - Which price to return ('high' or 'low')
 * @param {boolean} [verbose=false] - Enable verbose logging
 * @param {Map<string, number>} [providedCache=null] - Optional cache Map for testing (if null, no cache used)
 * @returns {Promise<number|null>} Price in USD or null if failed
 */
export async function getPriceFromMEXC(token, utcMs, target, verbose = false, providedCache = null) {
  const logv = (level, message, ...args) => {
    if (!verbose || level < 1) return;
    console.log(`[VERBOSE:${level}] ${message}`, ...args);
  };

  logv(1, `getPriceFromMEXC called with token=${token}, utcMs=${utcMs}, target=${target}`);

  const skipTokens = new Set(['grc']);
  if (skipTokens.has(token.toLowerCase())) {
    logv(1, `Token ${token} skipped for MEXC`);
    return null;
  }

  // FIXED: Generate human-readable YYYYMMDDHHMMSS format to match test expectation
  const dt = new Date(utcMs);
  const year = dt.getUTCFullYear().toString();
  const month = (dt.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = dt.getUTCDate().toString().padStart(2, '0');
  const hour = dt.getUTCHours().toString().padStart(2, '0');
  const minute = dt.getUTCMinutes().toString().padStart(2, '0');
  const second = dt.getUTCSeconds().toString().padStart(2, '0');
  const dateNumeric = year + month + day + hour + minute + second;

  const cacheKey = `price_${token.toLowerCase()}_${dateNumeric}_UTC_${target}`;
  logv(1, `Generated cache key: "${cacheKey}" (length ${cacheKey.length})`);

  let cache = providedCache;
  logv(2, `Cache instance provided: ${cache ? 'yes' : 'no'}`);

  if (cache) {
    logv(2, `Current cache keys: ${Array.from(cache.keys()).join(', ') || 'empty'}`);
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      logv(1, `Cache HIT for key "${cacheKey}" - cached value type: ${typeof cached}, value: ${cached}`);
      return cached;
    }
  } else {
    logv(1, `No cache provided - skipping cache lookup`);
  }

  logv(1, `Cache MISS or no cache - proceeding to fetch from MEXC`);

  const exchangeInfoUrl = config.EXCHANGE_BASE_URL + '/exchangeInfo';
  logv(2, `MEXC exchangeInfo URL: ${exchangeInfoUrl}`);

  let exchangeRes = null;
  let attempts = 0;
  while (attempts < config.MAX_RETRIES) {
    attempts++;
    logv(verbose, 1, `Attempt ${attempts}/${config.MAX_RETRIES} fetching exchangeInfo`);

    exchangeRes = await fetchWithRetry(exchangeInfoUrl, {}, verbose);
    logv(verbose, 2, `exchangeRes after attempt ${attempts}: ${exchangeRes ? 'received' : 'null'}`);

    if (exchangeRes === null) {
      logv(verbose, 1, `Fetch returned null on attempt ${attempts} - retrying`);
      const backoff = config.RETRY_BACKOFF_MS[attempts - 1] || 5000;
      logv(verbose, 2, `Waiting ${backoff}ms before retry`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      continue;
    }

    logv(verbose, 3, `exchangeRes details: ok=${exchangeRes.ok}, status=${exchangeRes.status}, statusText=${exchangeRes.statusText || 'undefined'}`);
    if (exchangeRes.headers) {
      logv(verbose, 4, `exchangeRes headers: ${JSON.stringify(Array.from(exchangeRes.headers.entries()))}`);
    }

    if (exchangeRes.ok) {
      logv(verbose, 1, `exchangeInfo succeeded on attempt ${attempts} (status ${exchangeRes.status})`);
      break;
    }

    if (exchangeRes.status === 429) {
      const backoff = config.RETRY_BACKOFF_MS[attempts - 1] || 5000;
      logv(verbose, 1, `429 rate limit on exchangeInfo - waiting ${backoff}ms (attempt ${attempts})`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      continue;
    } else {
      logv(verbose, 1, `exchangeInfo failed on attempt ${attempts} with status ${exchangeRes.status} - giving up`);
      return null;
    }
  }

  if (!exchangeRes || !exchangeRes.ok) {
    logv(1, 'All exchangeInfo retries failed - returning null');
    return null;
  }

  let exchangeData;
  try {
    exchangeData = await exchangeRes.json();
    logv(3, `MEXC exchangeInfo raw data length: ${JSON.stringify(exchangeData).length} chars`);
    logv(3, `MEXC exchangeInfo symbols count: ${exchangeData.symbols?.length || 0}`);
    if (exchangeData.symbols?.length > 0) {
      logv(4, `exchangeData.symbols first item: ${JSON.stringify(exchangeData.symbols[0])}`);
    }
  } catch (e) {
    logv(1, `MEXC exchangeInfo JSON parse FAILED: ${e.message}`);
    return null;
  }

  const symbols = exchangeData.symbols || [];
  logv(2, `MEXC symbols loaded: ${symbols.length} symbols`);

  const upperToken = token.toUpperCase();
  let symbol = null;
  let useBTC = false;

  for (const sym of symbols) {
    const symStr = sym.symbol || 'missing';
    const base = sym.baseAsset || 'missing';
    const quote = sym.quoteAsset || 'missing';
    logv(3, `Checking symbol: symbol=${symStr}, base=${base}, quote=${quote}`);
    if (base === upperToken) {
      if (quote === 'USDT') {
        symbol = upperToken + 'USDT';
        logv(2, `Found USDT pair: ${symbol}`);
        break;
      } else if (quote === 'BTC') {
        symbol = upperToken + 'BTC';
        useBTC = true;
        logv(2, `Found BTC pair: ${symbol}`);
      }
    }
  }

  if (!symbol) {
    logv(1, `No matching symbol found for ${token} in MEXC - returning null`);
    return null;
  }

  logv(1, `Using symbol: ${symbol} (BTC pair: ${useBTC})`);

  let interval = config.DEFAULT_INTERVAL;
  let klineUrl = config.EXCHANGE_BASE_URL + `/klines?symbol=${symbol}&interval=${interval}&startTime=${utcMs - 60000}&endTime=${utcMs}&limit=1`;
  logv(2, `MEXC klines URL (${interval}): ${klineUrl}`);
  let klineRes = await fetchWithRetry(klineUrl, {}, verbose);
  logv(2, `MEXC klines response (1m): ${klineRes ? 'received' : 'null'}`);

  let data = null;

  if (klineRes) {
    logv(2, `MEXC klines (1m) response ok: ${klineRes.ok}, status: ${klineRes.status}`);
    try {
      data = await klineRes.json();
      logv(2, `MEXC ${interval} klines data length: ${JSON.stringify(data).length} chars`);
      if (data.length > 0) {
        logv(3, `MEXC klines first candle: ${JSON.stringify(data[0])}`);
      }
    } catch (e) {
      logv(1, `MEXC ${interval} klines JSON parse FAILED: ${e.message}`);
      data = null;
    }
  }

  if (data && data.length > 0) {
    const candleTime = data[0][0];
    logv(2, `MEXC candle time: ${candleTime} (diff from target: ${Math.abs(candleTime - utcMs)}ms)`);
    if (Math.abs(candleTime - utcMs) > 120000) {
      logv(1, '1m candle time too far from target - discarding and trying fallback');
      data = null;
    } else {
      logv(2, '1m candle time acceptable');
    }
  } else {
    logv(1, 'No data or empty data from 1m klines - trying fallback');
  }

  if (!data || data.length === 0) {
    interval = config.FALLBACK_INTERVAL;
    klineUrl = config.EXCHANGE_BASE_URL + `/klines?symbol=${symbol}&interval=${interval}&startTime=${utcMs - 3600000}&endTime=${utcMs}&limit=1`;
    logv(2, `MEXC klines fallback URL (${interval}): ${klineUrl}`);
    klineRes = await fetchWithRetry(klineUrl, {}, verbose);
    logv(2, `MEXC klines response (fallback): ${klineRes ? 'received' : 'null'}`);

    if (klineRes) {
      logv(2, `MEXC klines (fallback) response ok: ${klineRes.ok}, status: ${klineRes.status}`);
      try {
        data = await klineRes.json();
        logv(2, `MEXC fallback ${interval} klines data length: ${JSON.stringify(data).length} chars`);
        if (data.length > 0) {
          logv(3, `MEXC fallback klines first candle: ${JSON.stringify(data[0])}`);
        }
      } catch (e) {
        logv(1, `MEXC fallback ${interval} klines JSON parse FAILED: ${e.message}`);
        data = null;
      }
    }
  }

  if (!data || data.length === 0) {
    logv(1, 'No klines data from MEXC after fallback attempt - returning null');
    return null;
  }

  const candle = data[0];
  logv(2, `MEXC final candle data: ${JSON.stringify(candle)}`);

  let price = target === 'low' ? parseFloat(candle[3]) : parseFloat(candle[2]);
  logv(2, `Extracted price from candle[${target === 'low' ? 3 : 2}]: ${price} (raw string: ${target === 'low' ? candle[3] : candle[2]})`);

  if (isNaN(price)) {
    logv(1, 'MEXC price parse FAILED - NaN from candle - returning null');
    return null;
  }

  if (useBTC) {
    logv(1, 'Using BTC pair - fetching BTC/USDT price');
    const btcPrice = await getBTCUSDTPrice(verbose);
    logv(1, `BTC/USDT price fetched: ${btcPrice}`);
    if (btcPrice === null) {
      logv(1, 'BTC price fetch FAILED - returning null');
      return null;
    }
    price *= btcPrice;
    logv(1, `BTC adjusted price: ${price} (BTC price was ${btcPrice})`);
  }

  logv(1, `MEXC final price returning: ${price}`);

  // Only cache if a cache was provided (test mode)
  if (providedCache) {
    providedCache.set(cacheKey, price);
    logv(1, `Cached price ${price} for key "${cacheKey}" in provided cache`);
  }

  return price;
}
