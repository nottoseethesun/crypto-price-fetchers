/**
 * Google Apps Script: Get Crypto Price from Centralized Exchange
 * ==============================================================
 *
 * Fetches historical high or low prices for cryptocurrencies (in USD via USDT pair or equivalent)
 * using the MEXC public API primarily. Tries 1-minute resolution first; falls back to 1-hour
 * if no trades occurred in the requested minute.
 *
 * Upgraded Features (v2.10.0 - XTM/Tari Fix + CoinGecko Deadlock Fix):
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
 * @version 2.10.0 (XTM/Tari fix, CoinGecko deadlock fix)
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
  COINPAPRIKA_BASE: 'https://api.coinpaprika.com/v1',

  // Endpoint templates
  COINGECKO_SIMPLE_PRICE_TEMPLATE: '{base}/simple/price?ids=bitcoin&vs_currencies=usd',
  COINGECKO_TICKERS_TEMPLATE: '{base}/coins/{id}/tickers',
  COINGECKO_HISTORY_TEMPLATE: '{base}/coins/{id}/history?date={date}',

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
  const offsetHours = getTimezoneOffsetHours(tz);

  // Safely handle dateStr
  let safeDateStr;
  if (typeof dateStr === 'string') {
    safeDateStr = dateStr;
  } else if (dateStr instanceof Date && !isNaN(dateStr.getTime())) {
    safeDateStr = Utilities.formatDate(dateStr, 'UTC', 'yyyy-MM-dd HH:mm:ss');
  } else {
    Logger.log(`Invalid dateStr type: ${typeof dateStr}, value: ${dateStr}`);
    return 'Invalid date format';
  }

  const utcMs = parseInputToUtcMs(safeDateStr, offsetHours);
  if (typeof utcMs === 'string') {
    Logger.log(`Parse error: ${utcMs}`);
    return utcMs;
  }

  if (utcMs > Date.now()) {
    Logger.log(`Future timestamp detected (${new Date(utcMs).toISOString()})`);
    return 'No data available for future dates';
  }

  const target = highOrLow.toLowerCase() === 'low' ? 'low' : 'high';

  const cacheKey = `price_${token}_${safeDateStr.replace(/[^0-9-]/g, '')}_${tz}_${target}`;
  Logger.log(`Generated cache key: ${cacheKey}`);
  let cached = getCachedResult(cacheKey);
  if (cached !== null) {
    Logger.log(`Returning cached result: ${cached}`);
    return cached;
  }

  // Rate-limit protection with automatic retry on lock failure
  let lockAcquired = false;
  let retryDelay = 0;

  for (let attempt = 0; attempt < CONFIG.MAX_LOCK_RETRIES; attempt++) {
    if (apiDelayMs > 0) {
      Logger.log(`Lock attempt ${attempt + 1}/${CONFIG.MAX_LOCK_RETRIES} (delay so far: ${retryDelay}ms)`);
      if (API_LOCK.tryLock(CONFIG.LOCK_WAIT_MS)) {
        lockAcquired = true;
        Logger.log(`Lock acquired on attempt ${attempt + 1}, sleeping ${apiDelayMs}ms`);
        Utilities.sleep(apiDelayMs);
        break;
      }
      // Backoff increases with each failed attempt
      retryDelay = CONFIG.LOCK_RETRY_BACKOFF[attempt] || 5000;
      Logger.log(`Lock timeout on attempt ${attempt + 1} - backoff ${retryDelay}ms`);
      Utilities.sleep(retryDelay);
    } else {
      lockAcquired = true;
      break;
    }
  }

  if (!lockAcquired && apiDelayMs > 0) {
    Logger.log('All lock attempts failed after retries');
    return 'Rate limit busy - retry later';
  }

  try {
    Logger.log('Starting provider chain');
    let price = getPriceFromMEXC(token, utcMs, target);
    if (typeof price === 'number' && !isNaN(price)) {
      setCachedResult(cacheKey, price);
      Logger.log(`Final price from MEXC: ${price}`);
      return price;
    }

    const idMap = TOKEN_TO_ID[token] || { gecko: token, paprika: token };
    Logger.log(`Using ID map: ${JSON.stringify(idMap)}`);

    price = getPriceFromCryptoCompare(token, utcMs, target);
    if (typeof price === 'number' && !isNaN(price)) {
      setCachedResult(cacheKey, price);
      Logger.log(`Final price from CryptoCompare: ${price}`);
      return price;
    }

    price = getPriceFromCoinGecko(idMap.gecko, utcMs, target);
    if (typeof price === 'number' && !isNaN(price)) {
      setCachedResult(cacheKey, price);
      Logger.log(`Final price from CoinGecko: ${price}`);
      return price;
    }

    price = getPriceFromCoinPaprika(idMap.paprika, utcMs, target);
    if (typeof price === 'number' && !isNaN(price)) {
      setCachedResult(cacheKey, price);
      Logger.log(`Final price from CoinPaprika: ${price}`);
      return price;
    }

    Logger.log('All providers failed - caching NO_DATA');
    setCachedResult(cacheKey, 'NO_DATA', CONFIG.CACHE_EXPIRY_SECONDS.NEGATIVE_CACHE);
    return 'No data available from any source';
  } catch (e) {
    Logger.log(`Critical error in getCryptoPrice: ${e.message} - stack: ${e.stack}`);
    return `Error: ${e.message}`;
  } finally {
    if (lockAcquired) {
      API_LOCK.releaseLock();
      Logger.log('Lock released');
    }
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
    const err = 'Invalid format. Use exactly YYYY-MM-DD HH:MM:SS (24-hour)';
    Logger.log(err);
    return err;
  }

  const [, yStr, mStr, dStr, hStr, minStr, sStr] = match;
  const year   = parseInt(yStr, 10);
  const month  = parseInt(mStr, 10);
  const day    = parseInt(dStr, 10);
  const hour   = parseInt(hStr, 10);
  const minute = parseInt(minStr, 10);
  const second = parseInt(sStr, 10);

  if (year < 1970 || year > 2100) return 'Invalid year (1970–2100)';
  if (month < 1 || month > 12)    return 'Invalid month (01–12)';
  if (day < 1 || day > 31)        return 'Invalid day (01–31)';
  if (hour < 0 || hour > 23)      return 'Invalid hour (00–23)';
  if (minute < 0 || minute > 59)  return 'Invalid minute (00–59)';
  if (second < 0 || second > 59)  return 'Invalid second (00–59)';

  const tempDate = new Date(year, month - 1, day);
  if (tempDate.getFullYear() !== year || tempDate.getMonth() + 1 !== month || tempDate.getDate() !== day) {
    return 'Invalid date (e.g., Feb 30 does not exist)';
  }

  const components = { year, month, day, hour, minute, second };
  Logger.log(`Parsed components: ${JSON.stringify(components)}`);
  return components;
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

  const skipTokens = new Set(['grc']);
  if (skipTokens.has(token)) {
    Logger.log(`Skipping MEXC for known missing token: ${token}`);
    return null;
  }

  const url = CONFIG.EXCHANGE_BASE_URL + '/exchangeInfo';
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    Logger.log(`MEXC exchangeInfo failed: HTTP ${response.getResponseCode()}`);
    return null;
  }

  const symbols = JSON.parse(response.getContentText()).symbols || [];
  const upperToken = token.toUpperCase();
  let symbol = null;
  let useBTC = false;

  for (const sym of symbols) {
    if (sym.baseAsset.toUpperCase() === upperToken) {
      if (sym.quoteAsset === 'USDT') {
        symbol = upperToken + 'USDT';
        break;
      } else if (sym.quoteAsset === 'BTC') {
        symbol = upperToken + 'BTC';
        useBTC = true;
      }
    }
  }

  if (!symbol) {
    Logger.log(`MEXC: No supported pair for ${token}`);
    return null;
  }

  Logger.log(`MEXC using symbol: ${symbol} (useBTC: ${useBTC})`);

  let interval = CONFIG.DEFAULT_INTERVAL;
  let klineUrl = CONFIG.EXCHANGE_BASE_URL + `/klines?symbol=${symbol}&interval=${interval}&startTime=${utcMs - 60000}&endTime=${utcMs}&limit=1`;
  let klineRes = UrlFetchApp.fetch(klineUrl, { muteHttpExceptions: true });
  let data = klineRes.getResponseCode() === 200 ? JSON.parse(klineRes.getContentText()) : null;

  if (data && data.length > 0) {
    const candleTime = data[0][0];
    if (Math.abs(candleTime - utcMs) > 120000) {
      Logger.log(`Warning: MEXC candle time ${new Date(candleTime).toISOString()} too far from requested ${new Date(utcMs).toISOString()} - skipping`);
      data = null;
    }
  }

  if (!data || data.length === 0) {
    interval = CONFIG.FALLBACK_INTERVAL;
    klineUrl = CONFIG.EXCHANGE_BASE_URL + `/klines?symbol=${symbol}&interval=${interval}&startTime=${utcMs - 3600000}&endTime=${utcMs}&limit=1`;
    klineRes = UrlFetchApp.fetch(klineUrl, { muteHttpExceptions: true });
    data = klineRes.getResponseCode() === 200 ? JSON.parse(klineRes.getContentText()) : null;
  }

  if (!data || data.length === 0) return null;

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

  let price = null;
  const dateStr = Utilities.formatDate(new Date(utcMs), 'UTC', 'dd-MM-yyyy');

  // Check cache first (may return number for hit, string for negative cache, or null for miss)
  const cached = getCachedResult(`gecko_daily_${id}_${dateStr}`);
  if (typeof cached === 'number') return applySpread(cached, target);
  if (typeof cached === 'string') return null;  // Negative cache hit - skip to next provider

  // Note: No separate lock here — the caller (getCryptoPrice) already holds the API_LOCK.
  // Acquiring it again would deadlock since GAS LockService is not re-entrant.

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
    setCachedResult(`gecko_daily_${id}_${dateStr}`, price);
    return applySpread(price, target);
  }

  setCachedResult(`gecko_daily_${id}_${dateStr}`, 'NO_DATA');
  return null;
}

function tryCoinGeckoTickers(id) {
  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    const tickersUrl = CONFIG.COINGECKO_TICKERS_TEMPLATE
      .replace('{base}', CONFIG.COINGECKO_BASE)
      .replace('{id}', id);
    const tickersRes = UrlFetchApp.fetch(tickersUrl, { muteHttpExceptions: true });

    if (tickersRes.getResponseCode() === 429) {
      Logger.log(`CoinGecko 429 on tickers - sleeping 5s (attempt ${attempts}/3)`);
      Utilities.sleep(5000); // Reduced from 10s
      continue;
    }

    if (tickersRes.getResponseCode() === 200) {
      const data = JSON.parse(tickersRes.getContentText());
      const tickers = data.tickers || [];
      let maxVol = 0;
      let selPrice = null;
      for (const t of tickers) {
        if (!t.is_stale && t.volume > maxVol && t.converted_last?.usd) {
          maxVol = t.volume;
          selPrice = t.converted_last.usd;
        }
      }
      return selPrice;
    } else {
      Logger.log(`CoinGecko tickers failed: HTTP ${tickersRes.getResponseCode()}`);
    }
  }
  return null;
}

function tryCoinGeckoHistory(id, dateStr) {
  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    const histUrl = CONFIG.COINGECKO_HISTORY_TEMPLATE
      .replace('{base}', CONFIG.COINGECKO_BASE)
      .replace('{id}', id)
      .replace('{date}', dateStr);
    const histRes = UrlFetchApp.fetch(histUrl, { muteHttpExceptions: true });

    if (histRes.getResponseCode() === 429) {
      Logger.log(`CoinGecko 429 on history - sleeping 5s (attempt ${attempts}/3)`);
      Utilities.sleep(5000); // Reduced from 10s
      continue;
    }

    if (histRes.getResponseCode() === 200) {
      const data = JSON.parse(histRes.getContentText());
      const price = data.market_data?.current_price?.usd;
      if (price) return price;
    } else {
      Logger.log(`CoinGecko history failed: HTTP ${histRes.getResponseCode()}`);
    }
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
  console.log("Script version: v2.10.0 (XTM fix + CoinGecko deadlock fix)");
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
    // { name: "GRC - Recent price (high)", token: "grc", dateStr: "2026-02-08 12:00:00", tz: "CST", highOrLow: "high", expectedRange: [0.005, 0.02] },
    // { name: "GRC - Recent price (low)", token: "grc", dateStr: "2026-02-08 12:00:00", tz: "CST", highOrLow: "low", expectedRange: [0.005, 0.02] },
    { name: "XTM - Recent price (high)", token: "xtm", dateStr: "2026-02-08 12:00:00", tz: "CST", highOrLow: "high", expectedRange: [0.001, 0.1] },
    { name: "XTM - Recent price (low)", token: "xtm", dateStr: "2026-02-08 12:00:00", tz: "CST", highOrLow: "low", expectedRange: [0.001, 0.1] },
    { name: "XMR - Older date (high)", token: "xmr", dateStr: "2025-12-01 14:30:00", tz: "UTC", highOrLow: "high", expectedRange: [380, 450] },
    { name: "BTC - New Year 2026 (high)", token: "btc", dateStr: "2026-01-01 00:00:00", tz: "UTC", highOrLow: "high", expectedRange: [85000, 100000] },
    { name: "Invalid token", token: "zzzzzzfake", dateStr: "2026-02-08 12:00:00", tz: "CST", highOrLow: "high", expectedRange: null },
    { name: "Future date", token: "grc", dateStr: "2026-12-31 23:59:59", tz: "CST", highOrLow: "high", expectedRange: null }
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
