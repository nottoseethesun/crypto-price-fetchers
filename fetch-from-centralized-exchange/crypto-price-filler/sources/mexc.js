/**
 * MEXC price fetching module for Crypto Price Filler
 * @module sources/mexc
 * @description Primary price source using MEXC API (exchangeInfo + klines).
 * Handles symbol lookup, 1m/60m klines, BTC pair adjustment, and 429 retry.
 *
 * A kline (candle) is `[openTime, open, high, low, close, volume, ...]`;
 * the price returned is the candle's field for the target asked: high, low
 * or close. A coin MEXC trades only against BTC is priced in USD with
 * BTC/USDT's candle at the same time and the same target, never with the
 * current BTC price, which would put today's price on a past date.
 *
 * @version 1.1.0
 * @author Christopher M. Balz with Grok and Claude.ai
 */

import { fetchWithRetry } from "../utils/fetch.js";
import config from "../config.js";

/** Where each price target sits in a MEXC kline. */
const CANDLE_FIELD = Object.freeze({ high: 2, low: 3, close: 4 });

/** How far a 1-minute candle may open from the time asked and still count, in milliseconds. */
const MAX_CANDLE_DISTANCE_MS = 120000;

/** Tokens MEXC does not list. */
const SKIP_TOKENS = new Set(["grc"]);

/**
 * Builds the verbose logger.
 *
 * @param {boolean} verbose - Whether to log
 * @returns {function(number, string, ...*): void} The logger
 */
function makeLogger(verbose) {
  return (level, message, ...args) => {
    if (!verbose || level < 1) return;
    console.log(`[VERBOSE:${level}] ${message}`, ...args);
  };
}

/**
 * The cache key of a price: token, UTC time as YYYYMMDDHHMMSS, and target.
 *
 * @param {string} token - Token symbol
 * @param {number} utcMs - Time in UTC milliseconds
 * @param {string} target - Price target
 * @returns {string} The key
 */
function cacheKeyOf(token, utcMs, target) {
  const dateNumeric = new Date(utcMs)
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, "");
  return `price_${token.toLowerCase()}_${dateNumeric}_UTC_${target}`;
}

/**
 * Waits out a backoff before the next attempt.
 *
 * @param {number} attempt - The attempt just made, from 1
 * @returns {Promise<void>} Settles when the wait is over
 */
function backoff(attempt) {
  const ms = config.RETRY_BACKOFF_MS[attempt - 1] || 5000;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches MEXC's list of trading pairs, retrying on no response or a 429.
 *
 * @param {boolean} verbose - Enable verbose logging
 * @param {function} logv - The logger
 * @returns {Promise<Array<Object>|null>} The pairs, or null when MEXC gives none
 */
async function fetchSymbols(verbose, logv) {
  const url = config.EXCHANGE_BASE_URL + "/exchangeInfo";
  for (let attempt = 1; attempt <= config.MAX_RETRIES; attempt++) {
    logv(1, `Attempt ${attempt}/${config.MAX_RETRIES} fetching exchangeInfo`);
    const res = await fetchWithRetry(url, {}, verbose);
    if (res === null || res === undefined || res.status === 429) {
      logv(
        1,
        `exchangeInfo gave ${res ? "a 429" : "no response"} on attempt ${attempt} - retrying`,
      );
      await backoff(attempt);
      continue;
    }
    if (!res.ok) {
      logv(1, `exchangeInfo failed with status ${res.status} - giving up`);
      return null;
    }
    try {
      return (await res.json()).symbols || [];
    } catch (e) {
      logv(1, `MEXC exchangeInfo JSON parse FAILED: ${e.message}`);
      return null;
    }
  }
  logv(1, "All exchangeInfo retries failed - returning null");
  return null;
}

/**
 * Finds the token's USDT pair, or else its BTC pair.
 *
 * @param {Array<Object>} symbols - MEXC's pairs
 * @param {string} token - Token symbol
 * @returns {{symbol: string, useBTC: boolean}|null} The pair, or null when MEXC has neither
 */
function findPair(symbols, token) {
  const upperToken = token.toUpperCase();
  let btcPair = null;
  for (const sym of symbols) {
    if (sym.baseAsset !== upperToken) continue;
    if (sym.quoteAsset === "USDT")
      return { symbol: upperToken + "USDT", useBTC: false };
    if (sym.quoteAsset === "BTC")
      btcPair = { symbol: upperToken + "BTC", useBTC: true };
  }
  return btcPair;
}

/**
 * Fetches the one kline of an interval that ends at the time asked.
 *
 * @param {string} symbol - The pair, such as XTMUSDT
 * @param {string} interval - The interval, such as 1m
 * @param {number} spanMs - The interval's length in milliseconds
 * @param {number} utcMs - The time asked, in UTC milliseconds
 * @param {boolean} verbose - Enable verbose logging
 * @param {function} logv - The logger
 * @returns {Promise<Array|null>} The kline, or null when there is none
 */
async function fetchKline(symbol, interval, spanMs, utcMs, verbose, logv) {
  const url =
    config.EXCHANGE_BASE_URL +
    `/klines?symbol=${symbol}&interval=${interval}&startTime=${utcMs - spanMs}&endTime=${utcMs}&limit=1`;
  logv(2, `MEXC klines URL (${interval}): ${url}`);
  const res = await fetchWithRetry(url, {}, verbose);
  if (res === null || res === undefined) return null;
  try {
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch (e) {
    logv(1, `MEXC ${interval} klines JSON parse FAILED: ${e.message}`);
    return null;
  }
}

/**
 * Fetches the candle for the time asked: the 1-minute candle that opens
 * within two minutes of it, or else the 60-minute candle that ends at it.
 *
 * @param {string} symbol - The pair
 * @param {number} utcMs - The time asked, in UTC milliseconds
 * @param {boolean} verbose - Enable verbose logging
 * @param {function} logv - The logger
 * @returns {Promise<Array|null>} The candle, or null when MEXC has none
 */
async function fetchCandle(symbol, utcMs, verbose, logv) {
  const minute = await fetchKline(
    symbol,
    config.DEFAULT_INTERVAL,
    60000,
    utcMs,
    verbose,
    logv,
  );
  if (minute !== null && Math.abs(minute[0] - utcMs) <= MAX_CANDLE_DISTANCE_MS)
    return minute;
  logv(
    1,
    `No 1m candle for ${symbol} near the time asked - trying ${config.FALLBACK_INTERVAL}`,
  );
  return fetchKline(
    symbol,
    config.FALLBACK_INTERVAL,
    3600000,
    utcMs,
    verbose,
    logv,
  );
}

/**
 * Reads a candle's price for the target.
 *
 * @param {Array} candle - The candle
 * @param {string} target - high, low or close
 * @returns {number|null} The price, or null when it is not a number
 */
function candlePrice(candle, target) {
  const price = parseFloat(candle[CANDLE_FIELD[target]]);
  return Number.isNaN(price) ? null : price;
}

/**
 * Prices the token from its pair's candle, in USD.
 *
 * @param {{symbol: string, useBTC: boolean}} pair - The pair
 * @param {number} utcMs - The time asked, in UTC milliseconds
 * @param {string} target - high, low or close
 * @param {boolean} verbose - Enable verbose logging
 * @param {function} logv - The logger
 * @returns {Promise<number|null>} The price, or null when MEXC cannot give it
 */
async function priceFromPair(pair, utcMs, target, verbose, logv) {
  const candle = await fetchCandle(pair.symbol, utcMs, verbose, logv);
  if (candle === null) {
    logv(1, `No klines data from MEXC for ${pair.symbol} - returning null`);
    return null;
  }
  const price = candlePrice(candle, target);
  if (price === null || !pair.useBTC) return price;
  const btcCandle = await fetchCandle("BTCUSDT", utcMs, verbose, logv);
  const btcPrice = btcCandle === null ? null : candlePrice(btcCandle, target);
  if (btcPrice === null) {
    logv(1, "No BTC/USDT candle for the time asked - returning null");
    return null;
  }
  logv(1, `BTC pair: ${price} BTC at ${btcPrice} USD`);
  return price * btcPrice;
}

/**
 * Fetches a token's historical high, low or close price from MEXC.
 * @param {string} token - Token symbol (e.g. 'xtm')
 * @param {number} utcMs - Target time in UTC milliseconds
 * @param {'high'|'low'|'close'} target - Which price to return
 * @param {boolean} [verbose=false] - Enable verbose logging
 * @param {Map<string, number>} [providedCache=null] - Optional cache Map for testing (if null, no cache used)
 * @returns {Promise<number|null>} Price in USD or null if failed
 */
export async function getPriceFromMEXC(
  token,
  utcMs,
  target,
  verbose = false,
  providedCache = null,
) {
  const logv = makeLogger(verbose);
  logv(
    1,
    `getPriceFromMEXC called with token=${token}, utcMs=${utcMs}, target=${target}`,
  );
  if (SKIP_TOKENS.has(token.toLowerCase())) {
    logv(1, `Token ${token} skipped for MEXC`);
    return null;
  }
  if (CANDLE_FIELD[target] === undefined) {
    logv(1, `Unknown price target "${target}" - returning null`);
    return null;
  }
  const cacheKey = cacheKeyOf(token, utcMs, target);
  if (providedCache && providedCache.has(cacheKey)) {
    logv(1, `Cache HIT for key "${cacheKey}"`);
    return providedCache.get(cacheKey);
  }
  const symbols = await fetchSymbols(verbose, logv);
  if (symbols === null) return null;
  const pair = findPair(symbols, token);
  if (pair === null) {
    logv(1, `No matching symbol found for ${token} in MEXC - returning null`);
    return null;
  }
  logv(1, `Using symbol: ${pair.symbol} (BTC pair: ${pair.useBTC})`);
  const price = await priceFromPair(pair, utcMs, target, verbose, logv);
  if (price === null) return null;
  logv(1, `MEXC final price returning: ${price}`);
  if (providedCache) providedCache.set(cacheKey, price);
  return price;
}
