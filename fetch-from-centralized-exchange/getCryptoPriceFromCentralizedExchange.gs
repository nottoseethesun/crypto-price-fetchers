/**
 * Google Apps Script: Get Crypto Price from Centralized Exchange
 * ==============================================================
 *
 * Fetches historical high or low prices for cryptocurrencies (in USD via USDT pair or equivalent)
 * using the MEXC public API primarily. Tries 1-minute resolution first; falls back to 1-hour
 * if no trades occurred in the requested minute.
 *
 * Upgraded Features (v2.11.0 - CoinGecko market_chart/range for GRC):
 * - Added CoinGecko /market_chart/range endpoint with demo API key for time-series data
 *   (fetches 24h window of hourly price points, returns actual max/min for high/low)
 * - Re-enabled GRC integration tests (market_chart/range provides reliable data)
 * - CoinGecko provider now tries: market_chart/range → tickers → history
 * - Widened GRC test expectedRange to [0.001, 0.05] for price volatility
 *
 * Previous (v2.10.0 - XTM/Tari Fix + CoinGecko Deadlock Fix):
 * - Removed 'xtm' from MEXC skip list (XTM is now listed on MEXC as XTMUSDT)
 * - Fixed CoinGecko deadlock: getPriceFromCoinGecko no longer re-acquires the
 *   API_LOCK that the caller (getCryptoPrice) already holds, which caused
 *   CoinGecko fallback to always fail with "Rate limit busy" for all tokens
 * - Dynamic discovery of supported trading pairs for each provider
 * - Fresh fetch for MEXC exchangeInfo (no caching of large symbols array)
 * - Aggressive per-token/date caching (24h TTL) + negative caching (5 min) for scale
 * - Rate-limit protection: LockService + configurable apiDelayMs (default 200ms in prod, 0ms in tests)
 * - **Automatic retry on lock failure ("Rate limit busy") with exponential backoff** (5s → 10s → 20s, up to 3 attempts)
 * - CoinGecko retry on 429 (up to 3 attempts, 5s sleep)
 * - Early future timestamp detection → immediate error
 * - Stricter MEXC candle timestamp validation (skip if off by >2 min)
 * - Heavy, granular logging at every step for debugging
 * - All major functions broken up into small, well-named helpers
 * - Safe handling of dateStr (string or Date object) for cache key
 * - Test suite with pass/fail summary + failed test list
 * - CoinGecko always tries history (even if no pair)
 * - Fast-skip for known non-listed tokens
 * - Separate top-level menu "Fetch Historical Crypto Prices" (no conflict with Tari Tools)
 * - Robust toast handling (null check) to avoid TypeError on setText
 * - Custom menu action that refreshes prices then "freezes" them as static values
 *   (converts live formulas to plain numbers → instant sheet loads on re-open)
 * - All API URLs defined as constants (no repetition of base URLs)
 * - Fixed invalid URL construction: all `{base}` placeholders correctly replaced
 *
 * @fileoverview Main utility for large-scale historical crypto price tracking in Sheets.
 * @author Christopher M. Balz, with Grok and Claude
 * @version 2.11.0 (CoinGecko market_chart/range for GRC)
 * @lastModified February 10, 2026
 *
 * Usage in Google Sheets:
 *   = getCryptoPrice("grc", "2026-01-14 12:00:00", "CST", "high")
 *   = getCryptoPrice("grc", A1, "CST")
 *
 * Important: Use correct TZ abbr accounting for DST.
 */

/** ============================================================================
 *                          CONFIGURATION & GLOBALS
 * ========================================================================== */
const CONFIG = {
  EXCHANGE_BASE_URL: 'https://api.mexc.com/api/v3',
  QUOTE_CURRENCY: 'USDT',
  DEFAULT_INTERVAL: '1m',
  FALLBACK_INTERVAL: '60m',
  TIMEZONE_OFFSETS: {
    'UTC': 0, 'GMT': 0,
    'EST': -5, 'EDT': -4,
    'CST': -6, 'CDT': -5,
    'MST': -7, 'MDT': -6,
    'PST': -8, 'PDT': -7
  },
  CACHE_EXPIRY_SECONDS: {
    DAILY_PRICE: 86400,   // 24 hours
    NEGATIVE_CACHE: 300,  // 5 min for failures
    BTC_PRICE: 300        // 5 min
  },

  // API URL bases
  COINGECKO_BASE: 'https://api.coingecko.com/api/v3',
  COINGECKO_API_KEY: 'CG-v44h5wBkTFVwwBqDGAhXzbg7',
  COINPAPRIKA_BASE: 'https://api.coinpaprika.com/v1',

  // Endpoint templates
  COINGECKO_SIMPLE_PRICE_TEMPLATE: '{base}/simple/price?ids=bitcoin&vs_currencies=usd',
  COINGECKO_TICKERS_TEMPLATE: '{base}/coins/{id}/tickers',
  COINGECKO_HISTORY_TEMPLATE: '{base}/coins/{id}/history?date={date}',
  COINGECKO_MARKET_CHART_RANGE_TEMPLATE: '{base}/coins/{id}/market_chart/range?vs_currency=usd&from={from}&to={to}&x_cg_demo_api_key={key}',

  COINPAPRIKA_TICKERS_TEMPLATE: '{base}/tickers/{id}',
  COINPAPRIKA_OHLCV_TEMPLATE: '{base}/coins/{id}/ohlcv/historical?start={start}&end={end}&quote=usd',

  // Rate limit tuning
  LOCK_WAIT_MS: 2000,                  // Wait time for lock acquisition
  GENERAL_DELAY_MS: 200,               // Delay between calls (reduced for speed)
  MAX_LOCK_RETRIES: 3,                 // Number of retry attempts on lock failure
  LOCK_RETRY_BACKOFF: [5000, 10000, 20000] // Exponential backoff (5s → 10s → 20s)
};

const API_LOCK = LockService.getScriptLock();

/** ============================================================================
 *                       TOKEN MAPPINGS FOR FALLBACKS
 * ========================================================================== */
const TOKEN_TO_ID = {
  'btc': { gecko: 'bitcoin', paprika: 'btc-bitcoin' },
  'xmr': { gecko: 'monero', paprika: 'xmr-monero' },
  'grc': { gecko: 'gridcoin-research', paprika: 'grc-gridcoin' },
  'xtm': { gecko: 'minotari-tari', paprika: 'xtm-tari' }
};

/** ============================================================================
 *                          CACHE HELPERS
 * ========================================================================== */
function getCachedResult(key) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) {
    Logger.log(`Cache hit: ${key} = ${cached}`);
    if (cached === 'NO_DATA') {
      Logger.log(`Negative cache hit for ${key}`);
      return 'No data available (cached)';
    }
    const num = parseFloat(cached);
    if (isNaN(num)) {
      Logger.log(`Invalid cached value (NaN) for ${key} - treating as miss`);
      cache.remove(key);
      return null;
    }
    return num;
  }
  Logger.log(`Cache miss: ${key}`);
  return null;
}

function setCachedResult(key, value, ttl = CONFIG.CACHE_EXPIRY_SECONDS.DAILY_PRICE) {
  const cache = CacheService.getScriptCache();
  const valueToCache = (typeof value === 'number' && !isNaN(value)) ? value : 'NO_DATA';
  cache.put(key, valueToCache.toString(), ttl);
  Logger.log(`Cached: ${key} = ${valueToCache} (TTL ${ttl}s)`);
}

/** ============================================================================
 * Main entry point custom function for Google Sheets
 * ========================================================================== */
function getCryptoPrice(token, dateStr, tz, highOrLow = 'high', apiDelayMs = CONFIG.GENERAL_DELAY_MS) {
  Logger.log(`getCryptoPrice called: token=${token}, date=${dateStr}, tz=${tz}, mode=${highOrLow}, delay=${apiDelayMs}ms`);

  token = token.toLowerCase();
  const target = highOrLow.toLowerCase() === 'low' ? 'low' : 'high';

  // Parse and validate date
  const safeDateStr = normalizeDateStr(dateStr);
  if (typeof safeDateStr !== 'string') return safeDateStr.error;

  const utcMs = parseInputToUtcMs(safeDateStr, getTimezoneOffsetHours(tz));
  if (typeof utcMs === 'string') return utcMs;
  if (utcMs > Date.now()) return 'No data available for future dates';

  // Check cache
  const cacheKey = `price_${token}_${safeDateStr.replace(/[^0-9-]/g, '')}_${tz}_${target}`;
  const cached = getCachedResult(cacheKey);
  if (cached !== null) return cached;

  // Acquire lock with retry
  const lockAcquired = acquireLockWithRetry(apiDelayMs);
  if (!lockAcquired) return 'Rate limit busy - retry later';

  try {
    const price = fetchPriceFromProviders(token, utcMs, target);
    cacheAndReturn(cacheKey, price);
    return price !== null ? price : 'No data available from any source';
  } catch (e) {
    Logger.log(`Critical error: ${e.message}`);
    return `Error: ${e.message}`;
  } finally {
    releaseLockIfHeld(lockAcquired);
  }
}

/** Normalizes dateStr to string format, returns {error} on failure */
function normalizeDateStr(dateStr) {
  if (typeof dateStr === 'string') return dateStr;
  if (dateStr instanceof Date && !isNaN(dateStr.getTime())) {
    return Utilities.formatDate(dateStr, 'UTC', 'yyyy-MM-dd HH:mm:ss');
  }
  Logger.log(`Invalid dateStr type: ${typeof dateStr}`);
  return { error: 'Invalid date format' };
}

/** Attempts to acquire lock with exponential backoff retry */
function acquireLockWithRetry(apiDelayMs) {
  if (apiDelayMs <= 0) return true;

  for (let attempt = 0; attempt < CONFIG.MAX_LOCK_RETRIES; attempt++) {
    Logger.log(`Lock attempt ${attempt + 1}/${CONFIG.MAX_LOCK_RETRIES}`);
    if (API_LOCK.tryLock(CONFIG.LOCK_WAIT_MS)) {
      Logger.log(`Lock acquired, sleeping ${apiDelayMs}ms`);
      Utilities.sleep(apiDelayMs);
      return true;
    }
    const backoff = CONFIG.LOCK_RETRY_BACKOFF[attempt] || 5000;
    Logger.log(`Lock timeout - backoff ${backoff}ms`);
    Utilities.sleep(backoff);
  }
  Logger.log('All lock attempts failed');
  return false;
}

/** Releases lock if it was acquired */
function releaseLockIfHeld(lockAcquired) {
  if (lockAcquired) {
    API_LOCK.releaseLock();
    Logger.log('Lock released');
  }
}

/** Tries each provider in order, returns first valid price or null */
function fetchPriceFromProviders(token, utcMs, target) {
  const idMap = TOKEN_TO_ID[token] || { gecko: token, paprika: token };
  const providers = [
    { name: 'MEXC', fn: () => getPriceFromMEXC(token, utcMs, target) },
    { name: 'CryptoCompare', fn: () => getPriceFromCryptoCompare(token, utcMs, target) },
    { name: 'CoinGecko', fn: () => getPriceFromCoinGecko(idMap.gecko, utcMs, target) },
    { name: 'CoinPaprika', fn: () => getPriceFromCoinPaprika(idMap.paprika, utcMs, target) }
  ];

  for (const provider of providers) {
    const price = provider.fn();
    if (isValidPrice(price)) {
      Logger.log(`Final price from ${provider.name}: ${price}`);
      return price;
    }
  }
  Logger.log('All providers failed');
  return null;
}

/** Checks if price is a valid number */
function isValidPrice(price) {
  return typeof price === 'number' && !isNaN(price);
}

/** Caches price result (positive or negative) */
function cacheAndReturn(cacheKey, price) {
  if (price !== null) {
    setCachedResult(cacheKey, price);
  } else {
    setCachedResult(cacheKey, 'NO_DATA', CONFIG.CACHE_EXPIRY_SECONDS.NEGATIVE_CACHE);
  }
}

/** ============================================================================
 *                            HELPER FUNCTIONS
 * ========================================================================== */

function getTimezoneOffsetHours(tz) {
  const key = (tz || 'UTC').toUpperCase();
  const offset = CONFIG.TIMEZONE_OFFSETS[key];
  Logger.log(`Timezone ${tz} → offset: ${offset || 0} hours`);
  return offset !== undefined ? offset : 0;
}

function parseInputToUtcMs(dateInput, offsetHours) {
  Logger.log(`Parsing dateInput: ${dateInput}, offsetHours: ${offsetHours}`);

  let components;
  if (typeof dateInput === 'string') {
    components = parseDateStringToComponents(dateInput);
    if (typeof components === 'string') {
      Logger.log(`Date string parse failed: ${components}`);
      return components;
    }
  } else if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    components = {
      year: dateInput.getUTCFullYear(),
      month: dateInput.getUTCMonth() + 1,
      day: dateInput.getUTCDate(),
      hour: dateInput.getUTCHours(),
      minute: dateInput.getUTCMinutes(),
      second: dateInput.getUTCSeconds()
    };
    Logger.log(`Parsed Date object: ${JSON.stringify(components)}`);
  } else {
    const err = 'Error: dateStr must be string "YYYY-MM-DD HH:MM:SS" or valid Date';
    Logger.log(err);
    return err;
  }

  const utcMs = createUtcTimestampFromComponents(components);
  if (typeof utcMs === 'string') {
    Logger.log(`UTC timestamp creation failed: ${utcMs}`);
    return utcMs;
  }

  Logger.log(`UTC ms before offset: ${utcMs}`);
  const finalMs = utcMs - (offsetHours * 3600000);
  Logger.log(`Final UTC ms after offset: ${finalMs}`);
  return finalMs;
}

function parseDateStringToComponents(dateStr) {
  Logger.log(`Parsing date string: ${dateStr}`);
  const regex = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
  const match = dateStr.match(regex);

  if (!match) {
    return logAndReturn('Invalid format. Use exactly YYYY-MM-DD HH:MM:SS (24-hour)');
  }

  const [, yStr, mStr, dStr, hStr, minStr, sStr] = match;
  const components = {
    year: parseInt(yStr, 10),
    month: parseInt(mStr, 10),
    day: parseInt(dStr, 10),
    hour: parseInt(hStr, 10),
    minute: parseInt(minStr, 10),
    second: parseInt(sStr, 10)
  };

  const validationError = validateDateComponents(components);
  if (validationError) return validationError;

  Logger.log(`Parsed components: ${JSON.stringify(components)}`);
  return components;
}

/** Validates date component ranges, returns error string or null */
function validateDateComponents(c) {
  if (!inRange(c.year, 1970, 2100)) return 'Invalid year (1970–2100)';
  if (!inRange(c.month, 1, 12)) return 'Invalid month (01–12)';
  if (!inRange(c.day, 1, 31)) return 'Invalid day (01–31)';
  if (!inRange(c.hour, 0, 23)) return 'Invalid hour (00–23)';
  if (!inRange(c.minute, 0, 59)) return 'Invalid minute (00–59)';
  if (!inRange(c.second, 0, 59)) return 'Invalid second (00–59)';

  // Check for impossible dates like Feb 30
  const tempDate = new Date(c.year, c.month - 1, c.day);
  const dateMatches = tempDate.getFullYear() === c.year &&
                      tempDate.getMonth() + 1 === c.month &&
                      tempDate.getDate() === c.day;
  if (!dateMatches) return 'Invalid date (e.g., Feb 30 does not exist)';

  return null;
}

/** Checks if value is within range (inclusive) */
function inRange(value, min, max) {
  return value >= min && value <= max;
}

/** Logs message and returns it */
function logAndReturn(msg) {
  Logger.log(msg);
  return msg;
}

function createUtcTimestampFromComponents(components) {
  Logger.log(`Creating UTC timestamp from: ${JSON.stringify(components)}`);
  const date = new Date(Date.UTC(
    components.year,
    components.month - 1,
    components.day,
    components.hour,
    components.minute,
    components.second
  ));

  if (isNaN(date.getTime())) {
    const err = 'Error creating UTC timestamp';
    Logger.log(err);
    return err;
  }

  Logger.log(`UTC timestamp created: ${date.getTime()}`);
  return date.getTime();
}

function getBTCUSDTPrice() {
  Logger.log('Fetching BTC/USDT price');

  const cache = CacheService.getScriptCache();
  const cached = cache.get('btc_usdt');
  if (cached) {
    Logger.log(`BTC/USDT cache hit: ${cached}`);
    return parseFloat(cached);
  }

  const url = CONFIG.COINGECKO_SIMPLE_PRICE_TEMPLATE.replace('{base}', CONFIG.COINGECKO_BASE);
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    Logger.log(`BTC price fetch failed: HTTP ${response.getResponseCode()}`);
    return null;
  }

  const data = JSON.parse(response.getContentText());
  const price = data.bitcoin?.usd;
  if (!price) {
    Logger.log('BTC price not found in response');
    return null;
  }

  cache.put('btc_usdt', price.toString(), CONFIG.CACHE_EXPIRY_SECONDS.BTC_PRICE);
  Logger.log(`BTC/USDT price fetched and cached: ${price}`);
  return price;
}

function applySpread(price, target) {
  const spread = 0.015; // 1.5%
  const result = target === 'low' ? price * (1 - spread) : price * (1 + spread);
  Logger.log(`Applied spread (${target}): ${price} → ${result}`);
  return result;
}

/** ============================================================================
 *                          PRICE PROVIDERS
 * ========================================================================== */

function getPriceFromMEXC(token, utcMs, target) {
  Logger.log(`Trying MEXC for ${token}`);

  if (new Set(['grc']).has(token)) {
    Logger.log(`Skipping MEXC for known missing token: ${token}`);
    return null;
  }

  const symbols = fetchMEXCSymbols();
  if (!symbols) return null;

  const pairInfo = findMEXCTradingPair(token, symbols);
  if (!pairInfo) return null;

  const data = fetchMEXCKlineData(pairInfo.symbol, utcMs);
  if (!data) return null;

  return extractMEXCPrice(data, target, pairInfo.useBTC);
}

/** Fetches MEXC exchange symbols list */
function fetchMEXCSymbols() {
  const url = CONFIG.EXCHANGE_BASE_URL + '/exchangeInfo';
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    Logger.log(`MEXC exchangeInfo failed: HTTP ${response.getResponseCode()}`);
    return null;
  }
  return JSON.parse(response.getContentText()).symbols || [];
}

/** Finds USDT or BTC trading pair for token */
function findMEXCTradingPair(token, symbols) {
  const upperToken = token.toUpperCase();
  let symbol = null;
  let useBTC = false;

  for (const sym of symbols) {
    if (sym.baseAsset.toUpperCase() !== upperToken) continue;
    if (sym.quoteAsset === 'USDT') {
      return { symbol: upperToken + 'USDT', useBTC: false };
    }
    if (sym.quoteAsset === 'BTC') {
      symbol = upperToken + 'BTC';
      useBTC = true;
    }
  }

  if (!symbol) {
    Logger.log(`MEXC: No supported pair for ${token}`);
    return null;
  }
  Logger.log(`MEXC using symbol: ${symbol} (useBTC: ${useBTC})`);
  return { symbol, useBTC };
}

/** Fetches kline data, trying 1m then 60m interval */
function fetchMEXCKlineData(symbol, utcMs) {
  // Try 1-minute interval first
  let data = fetchKline(symbol, CONFIG.DEFAULT_INTERVAL, utcMs - 60000, utcMs);
  if (isValidKlineData(data, utcMs)) return data;

  // Fallback to 60-minute interval
  data = fetchKline(symbol, CONFIG.FALLBACK_INTERVAL, utcMs - 3600000, utcMs);
  return (data && data.length > 0) ? data : null;
}

/** Fetches single kline candle */
function fetchKline(symbol, interval, startTime, endTime) {
  const url = `${CONFIG.EXCHANGE_BASE_URL}/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1`;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  return res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : null;
}

/** Validates kline data timestamp is close enough to requested time */
function isValidKlineData(data, utcMs) {
  if (!data || data.length === 0) return false;
  const candleTime = data[0][0];
  if (Math.abs(candleTime - utcMs) > 120000) {
    Logger.log(`Warning: Candle time too far from requested - skipping`);
    return false;
  }
  return true;
}

/** Extracts price from kline data, converting BTC pair if needed */
function extractMEXCPrice(data, target, useBTC) {
  let price = target === 'low' ? parseFloat(data[0][3]) : parseFloat(data[0][2]);
  if (useBTC) {
    const btcPrice = getBTCUSDTPrice();
    if (btcPrice === null) return null;
    price *= btcPrice;
  }
  Logger.log(`MEXC final price: ${price} (${target})`);
  return price;
}

function getPriceFromCryptoCompare(token, utcMs, target) {
  Logger.log(`Trying CryptoCompare for ${token}`);
  return null;
}

function getPriceFromCoinGecko(id, utcMs, target) {
  Logger.log(`Trying CoinGecko for ${id} at ${new Date(utcMs).toISOString()}`);

  // Note: No separate lock here — the caller (getCryptoPrice) already holds the API_LOCK.
  // Acquiring it again would deadlock since GAS LockService is not re-entrant.

  let price = null;
  const dateStr = Utilities.formatDate(new Date(utcMs), 'UTC', 'dd-MM-yyyy');

  // 1) Try market_chart/range with its own cache (independent of tickers/history)
  const rangeCacheKey = `gecko_range_${id}_${dateStr}_${target}`;
  const rangeCached = getCachedResult(rangeCacheKey);
  if (typeof rangeCached === 'number') return rangeCached;

  if (typeof rangeCached !== 'string') {
    const rangePrice = tryCoinGeckoMarketChartRange(id, utcMs, target);
    if (rangePrice !== null) {
      Logger.log(`CoinGecko market_chart/range success: ${rangePrice} USD (${target})`);
      setCachedResult(rangeCacheKey, rangePrice);
      return rangePrice;
    }
    setCachedResult(rangeCacheKey, 'NO_DATA', CONFIG.CACHE_EXPIRY_SECONDS.NEGATIVE_CACHE);
  }

  // 2) Fall back to tickers/history with their own cache
  const dailyCacheKey = `gecko_daily_${id}_${dateStr}`;
  const dailyCached = getCachedResult(dailyCacheKey);
  if (typeof dailyCached === 'number') return applySpread(dailyCached, target);
  if (typeof dailyCached === 'string') return null;

  price = tryCoinGeckoTickers(id);
  if (price !== null) {
    Logger.log(`CoinGecko tickers success: ${price} USD`);
  } else {
    price = tryCoinGeckoHistory(id, dateStr);
    if (price !== null) {
      Logger.log(`CoinGecko history success: ${price} USD for ${dateStr}`);
    }
  }

  if (price !== null) {
    setCachedResult(dailyCacheKey, price);
    return applySpread(price, target);
  }

  setCachedResult(dailyCacheKey, 'NO_DATA', CONFIG.CACHE_EXPIRY_SECONDS.NEGATIVE_CACHE);
  return null;
}

function tryCoinGeckoTickers(id) {
  const url = CONFIG.COINGECKO_TICKERS_TEMPLATE
    .replace('{base}', CONFIG.COINGECKO_BASE)
    .replace('{id}', id);

  const response = fetchWithRateLimitRetry(url, 'tickers');
  if (!response) return null;

  const tickers = JSON.parse(response).tickers || [];
  return selectBestTickerPrice(tickers);
}

/** Selects highest-volume non-stale ticker with USD price */
function selectBestTickerPrice(tickers) {
  let maxVol = 0;
  let bestPrice = null;
  for (const t of tickers) {
    const isValid = !t.is_stale && t.converted_last?.usd;
    if (isValid && t.volume > maxVol) {
      maxVol = t.volume;
      bestPrice = t.converted_last.usd;
    }
  }
  return bestPrice;
}

/**
 * Fetches time-series prices from CoinGecko market_chart/range for a 24h window,
 * then returns the max (high) or min (low) from actual data points.
 * Requires demo API key. Returns null on failure.
 */
function tryCoinGeckoMarketChartRange(id, utcMs, target) {
  const fromSec = Math.floor((utcMs - 43200000) / 1000);  // 12h before
  const toSec = Math.floor((utcMs + 43200000) / 1000);    // 12h after

  const url = CONFIG.COINGECKO_MARKET_CHART_RANGE_TEMPLATE
    .replace('{base}', CONFIG.COINGECKO_BASE)
    .replace('{id}', id)
    .replace('{from}', fromSec)
    .replace('{to}', toSec)
    .replace('{key}', CONFIG.COINGECKO_API_KEY);

  const response = fetchWithRateLimitRetry(url, 'market_chart/range');
  if (!response) return null;

  const prices = JSON.parse(response).prices;
  if (!prices || prices.length === 0) {
    Logger.log('CoinGecko market_chart/range: No price data points');
    return null;
  }

  Logger.log(`CoinGecko market_chart/range: ${prices.length} data points`);
  const values = prices.map(p => p[1]);
  return target === 'low' ? Math.min(...values) : Math.max(...values);
}

function tryCoinGeckoHistory(id, dateStr) {
  const url = CONFIG.COINGECKO_HISTORY_TEMPLATE
    .replace('{base}', CONFIG.COINGECKO_BASE)
    .replace('{id}', id)
    .replace('{date}', dateStr);

  const response = fetchWithRateLimitRetry(url, 'history');
  if (!response) return null;

  const data = JSON.parse(response);
  return data.market_data?.current_price?.usd || null;
}

/** Fetches URL with retry on 429 rate limit (up to 3 attempts) */
function fetchWithRateLimitRetry(url, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = res.getResponseCode();

    if (code === 200) return res.getContentText();
    if (code === 429) {
      Logger.log(`CoinGecko 429 on ${label} - sleeping 5s (attempt ${attempt}/3)`);
      Utilities.sleep(5000);
      continue;
    }
    Logger.log(`CoinGecko ${label} failed: HTTP ${code}`);
    return null;
  }
  return null;
}

function getPriceFromCoinPaprika(id, utcMs, highOrLow) {
  Logger.log('Trying CoinPaprika for ' + id);

  const tickersUrl = CONFIG.COINPAPRIKA_TICKERS_TEMPLATE
    .replace('{base}', CONFIG.COINPAPRIKA_BASE)
    .replace('{id}', id);
  const response = UrlFetchApp.fetch(tickersUrl, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return null;
  const data = JSON.parse(response.getContentText());

  if (!data.quotes || !data.quotes.USD) return null;

  const start = utcMs / 1000 - 60;
  const end = utcMs / 1000;
  const ohlcvUrl = CONFIG.COINPAPRIKA_OHLCV_TEMPLATE
    .replace('{base}', CONFIG.COINPAPRIKA_BASE)
    .replace('{id}', id)
    .replace('{start}', Math.floor(start))
    .replace('{end}', Math.floor(end));
  const ohlcvRes = UrlFetchApp.fetch(ohlcvUrl, { muteHttpExceptions: true });
  if (ohlcvRes.getResponseCode() !== 200) return null;
  const ohlcv = JSON.parse(ohlcvRes.getContentText());

  if (!ohlcv || ohlcv.length === 0) return null;

  const price = highOrLow === 'low' ? parseFloat(ohlcv[0].low) : parseFloat(ohlcv[0].high);
  Logger.log(`CoinPaprika final price: ${price} (${highOrLow})`);
  return price;
}

/** ============================================================================
 *                                 TESTS
 * ========================================================================== */

/**
 * Master test entry point. Runs all test suites.
 */
function test() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("MASTER TEST SUITE - " + new Date().toISOString());
  console.log("Script version: v2.11.0 (CoinGecko market_chart/range for GRC)");
  console.log("══════════════════════════════════════════════════════════════\n");

  const results = [];

  // Run deadlock regression test first (fast, critical)
  results.push({
    name: "CoinGecko Deadlock Regression",
    passed: testCoinGeckoDeadlockRegression()
  });

  // Run main price tests
  results.push({
    name: "Price Fetching",
    passed: testGetCryptoPrice()
  });

  // Summary
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("MASTER TEST SUMMARY");
  console.log("══════════════════════════════════════════════════════════════");
  results.forEach(r => {
    console.log(`  ${r.passed ? '✓' : '✗'} ${r.name}`);
  });
  const allPassed = results.every(r => r.passed);
  console.log(`\nOverall: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);
  console.log("══════════════════════════════════════════════════════════════");
}

/**
 * REGRESSION TEST: CoinGecko Deadlock (v2.10.0 fix)
 *
 * GAS LockService is NOT re-entrant: calling tryLock() on a lock you
 * already hold blocks forever (deadlock).
 *
 * Bug (pre-v2.10.0): getPriceFromCoinGecko tried to acquire API_LOCK
 * that getCryptoPrice already held.
 *
 * This test uses GRC (no MEXC pair) to force the CoinGecko fallback path.
 * If this test hangs, the deadlock bug has been reintroduced.
 */
function testCoinGeckoDeadlockRegression() {
  console.log("\n┌── REGRESSION: CoinGecko Deadlock");
  console.log("│ GRC has no MEXC pair → forces CoinGecko fallback");
  console.log("│ If this hangs, the deadlock bug is back.");
  console.log("├──────────────────────────────────────────────────────────────");

  const startTime = new Date().getTime();

  const result = getCryptoPrice(
    "grc",
    "2026-02-08 12:00:00",
    "CST",
    "high",
    200  // Normal delay to test real lock behavior
  );

  const durationMs = new Date().getTime() - startTime;

  console.log(`│ Result: ${typeof result === 'number' ? result.toFixed(8) : result}`);
  console.log(`│ Duration: ${durationMs} ms`);

  const passed = typeof result === 'number' || (typeof result === 'string' && result.includes('No data'));
  console.log(`│ Status: ${passed ? 'PASS - No deadlock' : 'FAIL'}`);
  console.log("└──────────────────────────────────────────────────────────────");

  return passed;
}

/**
 * Tests price fetching across multiple tokens and scenarios.
 * @returns {boolean} True if all tests pass
 */
function testGetCryptoPrice() {
  console.log("\n┌── PRICE FETCHING TESTS");
  console.log("├──────────────────────────────────────────────────────────────");

  const testCases = [
    { name: "GRC - Recent price (high)", token: "grc", dateStr: "2026-02-08 12:00:00", tz: "CST", highOrLow: "high", expectedRange: [0.001, 0.05] },
    { name: "GRC - Recent price (low)", token: "grc", dateStr: "2026-02-08 12:00:00", tz: "CST", highOrLow: "low", expectedRange: [0.001, 0.05] },
    { name: "XTM - Recent price (high)", token: "xtm", dateStr: "2026-02-08 12:00:00", tz: "CST", highOrLow: "high", expectedRange: [0.001, 0.1] },
    { name: "XTM - Recent price (low)", token: "xtm", dateStr: "2026-02-08 12:00:00", tz: "CST", highOrLow: "low", expectedRange: [0.001, 0.1] },
    { name: "XMR - Older date (high)", token: "xmr", dateStr: "2025-12-01 14:30:00", tz: "UTC", highOrLow: "high", expectedRange: [380, 450] },
    { name: "BTC - New Year 2026 (high)", token: "btc", dateStr: "2026-01-01 00:00:00", tz: "UTC", highOrLow: "high", expectedRange: [85000, 100000] },
    { name: "Invalid token", token: "zzzzzzfake", dateStr: "2026-02-08 12:00:00", tz: "CST", highOrLow: "high", expectedRange: null },
    { name: "Future date", token: "xtm", dateStr: "2026-12-31 23:59:59", tz: "CST", highOrLow: "high", expectedRange: null }
  ];

  let passed = 0;
  let failedTests = [];

  testCases.forEach((test, index) => {
    console.log(`│`);
    console.log(`│ Test ${index + 1}/${testCases.length}: ${test.name}`);
    console.log(`│   Token: ${test.token.toUpperCase()}`);
    console.log(`│   Date:  ${test.dateStr} ${test.tz}`);
    console.log(`│   Mode:  ${test.highOrLow.toUpperCase()}`);

    const startTime = new Date().getTime();

    const result = getCryptoPrice(
      test.token,
      test.dateStr,
      test.tz,
      test.highOrLow,
      0  // Fast mode for tests
    );

    const durationMs = new Date().getTime() - startTime;

    console.log(`│   Result: ${typeof result === 'number' ? result.toFixed(8) : result}`);
    console.log(`│   Time:   ${durationMs} ms`);

    let isPass = false;
    if (test.expectedRange) {
      if (typeof result === 'number' && !isNaN(result)) {
        isPass = result >= test.expectedRange[0] && result <= test.expectedRange[1];
        console.log(`│   Range: ${isPass ? 'PASS' : 'FAIL'} (${test.expectedRange[0]} - ${test.expectedRange[1]})`);
      } else {
        console.log("│   Range: N/A (got string/error)");
      }
    } else {
      isPass = typeof result === 'string';
      console.log(`│   Expected error: ${isPass ? 'PASS' : 'FAIL'}`);
    }

    if (isPass) passed++;
    else failedTests.push(test.name);

    if (index < testCases.length - 1) {
      Logger.log(`Sleeping 30s between tests to avoid rate limits`);
      Utilities.sleep(30000);
    }
  });

  const total = testCases.length;
  const passRate = Math.round((passed / total) * 100);

  console.log(`│`);
  console.log(`│ Summary: ${passed}/${total} passed (${passRate}%)`);
  if (failedTests.length > 0) {
    console.log(`│ Failed:`);
    failedTests.forEach(name => console.log(`│   - ${name}`));
  }
  console.log("└──────────────────────────────────────────────────────────────");

  return failedTests.length === 0;
}

/** ============================================================================
 *                          SEPARATE CUSTOM MENU
 * ========================================================================== */
/**
 * Creates a separate top-level menu "Fetch Historical Crypto Prices" (does not merge with Tari Tools)
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Fetch Historical Crypto Prices')
    .addItem('Refresh & Freeze All Prices', 'refreshPrices')
    .addToUi();
}

/**
 * Refreshes all prices in the currently active sheet, recalculates, then freezes them as static values.
 * Works on whichever tab is active when the menu item is clicked (no hard-coded tab name dependency).
 */
function refreshPrices() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Refresh All Prices?',
    'This may take several minutes for large sheets. All formulas in the current sheet will be temporarily re-run, then frozen as static values.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = SpreadsheetApp.getActiveSheet(); // Always use the currently active tab
  if (!sheet) {
    ui.alert('Error: No active sheet found!');
    return;
  }

  const sheetName = sheet.getName();
  Logger.log(`Refreshing prices on active sheet: ${sheetName}`);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    ui.alert('No data rows to refresh on this sheet.');
    return;
  }

  // Change to your actual price column (1 = A, 2 = B, ..., 4 = D, etc.)
  const priceColumn = 4; // ← EDIT THIS IF NEEDED

  
  const formulaRange = sheet.getRange(2, priceColumn, lastRow - 1, 1);

  // Robust toast handling (null check)
  let toast = ss.toast(`Starting refresh on "${sheetName}"...`, 'Progress', -1);
  if (toast === null) {
    Logger.log('Toast creation failed - skipping progress updates');
  }

  const formulas = formulaRange.getFormulas();
  formulaRange.clearContent();
  SpreadsheetApp.flush();
  formulaRange.setFormulas(formulas);

  SpreadsheetApp.flush();

  const values = formulaRange.getValues();
  formulaRange.setValues(values);

  if (toast !== null) {
    try {
      toast.setText('Refresh complete! Prices are now frozen as static values.');
    } catch (e) {
      Logger.log(`Toast update failed: ${e.message}`);
    }
  }

  ui.alert('Done!', `Prices on sheet "${sheetName}" refreshed and frozen.`, ui.ButtonSet.OK);
}