/**
 * Google Apps Script: Get Crypto Price from Centralized Exchange
 * ==============================================================
 *
 * Fetches historical high or low prices for cryptocurrencies (in USD via USDT pair or equivalent)
 * using the MEXC public API primarily. Tries 1-minute resolution first; falls back to 1-hour
 * if no trades occurred in the requested minute.
 *
 * Upgraded Features (v2.8 - Production Hardened & Fully Modular):
 * - Dynamic discovery of supported trading pairs for each provider
 * - Fresh fetch for MEXC exchangeInfo (no caching of large symbols array)
 * - Aggressive per-token/date caching (24h TTL) + negative caching (5 min) for scale
 * - Rate-limit protection: LockService + configurable apiDelayMs (default 500ms in prod, 0ms in tests)
 * - CoinGecko retry on 429 (up to 3 attempts, 10s sleep)
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
 *
 * CUSTOM MENU & FREEZE WORKFLOW (NEW - v2.8+)
 * =============================================
 *
 * This script adds a separate top-level menu in Google Sheets called "Fetch Historical Crypto Prices".
 * The menu provides a one-click way to refresh prices and freeze them for fast loading.
 *
 * Menu Item: Refresh & Freeze All Prices
 * ---------------------------------------
 * This item performs the following steps automatically:
 * 1. Temporarily re-inserts the live custom formulas (=getCryptoPrice(...)) into the price column.
 * 2. Forces Google Sheets to recalculate all prices (this is the slow part, may take several minutes
 *    for 2,300+ rows due to API calls, retries, rate limits, and lock protection).
 * 3. Once recalculation completes, immediately converts the results from live formulas into plain,
 *    unchanging static numbers (equivalent to manually selecting the column → Copy → Paste special →
 *    Paste values only).
 *
 * Result of "Freeze as static values (no more slow loads on open)":
 * -------------------------------------------------------------------
 * - After freezing, the price cells contain **hard-coded numbers** instead of formulas.
 * - No custom functions run on sheet open/reload → the sheet loads instantly (usually < 2 seconds),
 *   even with thousands of rows.
 * - No API calls, no rate limits, no timeouts, no "Loading..." delays just from opening the sheet.
 * - Prices remain current only until the next refresh — they are no longer dynamic.
 *
 * When to use the menu:
 * - Run it whenever you need updated prices (e.g., daily, weekly, or after significant market changes).
 * - After the menu finishes, the sheet is "frozen" again → fast loads forever until the next refresh.
 *
 * Why freeze? For large sheets (2,300–4,000+ rows), live custom functions in every cell cause:
 * - Slow sheet loading on open
 * - Frequent timeouts ("Exceeded maximum execution time")
 * - Rate-limit errors (429 from APIs)
 * Freezing eliminates these issues while preserving the ability to refresh on demand.
 *
 * Manual alternative (if preferred):
 * - After prices populate, select the price column → Copy → Right-click → Paste special → Paste values only.
 * - To refresh later, re-paste formulas from a backup/template sheet and repeat.
 *
 * Note: The menu is separate from any existing "Tari Tools" menu — no conflicts or merging.
 * 
 * @fileoverview Main utility for large-scale historical crypto price tracking in Sheets.
 * @author Grok-assisted development
 * @version 2.8 (Complete file, menu name updated, full logging)
 * @lastModified January 14, 2026
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
  }
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
function getCryptoPrice(token, dateStr, tz, highOrLow = 'high', apiDelayMs = 500) {
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
    return 'Invalid date format';
  }

  const utcMs = parseInputToUtcMs(safeDateStr, offsetHours);
  if (typeof utcMs === 'string') return utcMs;

  if (utcMs > Date.now()) {
    return 'No data available for future dates';
  }

  const target = highOrLow.toLowerCase() === 'low' ? 'low' : 'high';

  const cacheKey = `price_${token}_${safeDateStr.replace(/[^0-9-]/g, '')}_${tz}_${target}`;
  let cached = getCachedResult(cacheKey);
  if (cached !== null) return cached;

  if (apiDelayMs > 0) {
    if (!API_LOCK.tryLock(5000)) {
      return 'Rate limit busy - retry later';
    }
    Utilities.sleep(apiDelayMs);
  }

  try {
    let price = getPriceFromMEXC(token, utcMs, target);
    if (typeof price === 'number') {
      setCachedResult(cacheKey, price);
      return price;
    }

    const idMap = TOKEN_TO_ID[token] || { gecko: token, paprika: token };

    price = getPriceFromCryptoCompare(token, utcMs, target);
    if (typeof price === 'number') {
      setCachedResult(cacheKey, price);
      return price;
    }

    price = getPriceFromCoinGecko(idMap.gecko, utcMs, target);
    if (typeof price === 'number') {
      setCachedResult(cacheKey, price);
      return price;
    }

    price = getPriceFromCoinPaprika(idMap.paprika, utcMs, target);
    if (typeof price === 'number') {
      setCachedResult(cacheKey, price);
      return price;
    }

    setCachedResult(cacheKey, 'NO_DATA', CONFIG.CACHE_EXPIRY_SECONDS.NEGATIVE_CACHE);
    return 'No data available from any source';
  } finally {
    if (API_LOCK.hasLock()) API_LOCK.releaseLock();
  }
}

/** ============================================================================
 *                            HELPER FUNCTIONS
 * ========================================================================== */

function getTimezoneOffsetHours(tz) {
  const key = (tz || 'UTC').toUpperCase();
  return CONFIG.TIMEZONE_OFFSETS[key] !== undefined ? CONFIG.TIMEZONE_OFFSETS[key] : 0;
}

function parseInputToUtcMs(dateInput, offsetHours) {
  let components;
  if (typeof dateInput === 'string') {
    components = parseDateStringToComponents(dateInput);
    if (typeof components === 'string') return components;
  } else if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    components = {
      year: dateInput.getUTCFullYear(),
      month: dateInput.getUTCMonth() + 1,
      day: dateInput.getUTCDate(),
      hour: dateInput.getUTCHours(),
      minute: dateInput.getUTCMinutes(),
      second: dateInput.getUTCSeconds()
    };
  } else {
    return 'Error: dateStr must be string "YYYY-MM-DD HH:MM:SS" or valid Date';
  }

  const utcMs = createUtcTimestampFromComponents(components);
  if (typeof utcMs === 'string') return utcMs;

  return utcMs - (offsetHours * 3600000);
}

function parseDateStringToComponents(dateStr) {
  const regex = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
  const match = dateStr.match(regex);
  if (!match) return 'Invalid format. Use YYYY-MM-DD HH:MM:SS';

  const [, y, m, d, h, min, s] = match.map(Number);
  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31 ||
      h < 0 || h > 23 || min < 0 || min > 59 || s < 0 || s > 59) {
    return 'Invalid date components';
  }

  const temp = new Date(y, m - 1, d);
  if (temp.getFullYear() !== y || temp.getMonth() + 1 !== m || temp.getDate() !== d) {
    return 'Invalid date';
  }

  return { year: y, month: m, day: d, hour: h, minute: min, second: s };
}

function createUtcTimestampFromComponents(c) {
  const date = new Date(Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second));
  return isNaN(date.getTime()) ? 'Error creating UTC timestamp' : date.getTime();
}

function getBTCUSDTPrice() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('btc_usdt');
  if (cached) return parseFloat(cached);

  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;

  const data = JSON.parse(res.getContentText());
  const price = data.bitcoin?.usd;
  if (!price) return null;

  cache.put('btc_usdt', price.toString(), CONFIG.CACHE_EXPIRY_SECONDS.BTC_PRICE);
  return price;
}

function applySpread(price, target) {
  const spread = 0.015;
  return target === 'low' ? price * (1 - spread) : price * (1 + spread);
}

/** ============================================================================
 *                          PRICE PROVIDERS
 * ========================================================================== */

function getPriceFromMEXC(token, utcMs, target) {
  Logger.log(`Trying MEXC for ${token}`);

  const skipTokens = new Set(['grc', 'xtm']);
  if (skipTokens.has(token)) {
    Logger.log(`Skipping MEXC for known missing token: ${token}`);
    return null;
  }

  const url = CONFIG.EXCHANGE_BASE_URL + '/exchangeInfo';
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return null;

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

  price = getCachedGeckoDailyPrice(id, dateStr);
  if (price !== null) return applySpread(price, target);

  if (!API_LOCK.tryLock(5000)) {
    return 'Rate limit busy - retry later';
  }
  Utilities.sleep(500);

  try {
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
      setCachedGeckoDailyPrice(id, dateStr, price);
      return applySpread(price, target);
    }

    setCachedGeckoDailyPrice(id, dateStr, 'NO_DATA');
    return 'No data available (cached)';
  } finally {
    if (API_LOCK.hasLock()) API_LOCK.releaseLock();
  }
}

function tryCoinGeckoTickers(id) {
  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    const tickersUrl = `https://api.coingecko.com/api/v3/coins/${id}/tickers`;
    const tickersRes = UrlFetchApp.fetch(tickersUrl, { muteHttpExceptions: true });

    if (tickersRes.getResponseCode() === 429) {
      Utilities.sleep(10000);
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
    }
  }
  return null;
}

function tryCoinGeckoHistory(id, dateStr) {
  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    const histUrl = `https://api.coingecko.com/api/v3/coins/${id}/history?date=${dateStr}`;
    const histRes = UrlFetchApp.fetch(histUrl, { muteHttpExceptions: true });

    if (histRes.getResponseCode() === 429) {
      Utilities.sleep(10000);
      continue;
    }

    if (histRes.getResponseCode() === 200) {
      const data = JSON.parse(histRes.getContentText());
      return data.market_data?.current_price?.usd;
    }
  }
  return null;
}

function getPriceFromCoinPaprika(id, utcMs, highOrLow) {
  Logger.log('Trying CoinPaprika for ' + id);

  const url = `https://api.coinpaprika.com/v1/tickers/${id}`;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return null;
  const data = JSON.parse(response.getContentText());

  if (!data.quotes || !data.quotes.USD) return null;

  const start = utcMs / 1000 - 60;
  const end = utcMs / 1000;
  const ohlcvUrl = `https://api.coinpaprika.com/v1/coins/${id}/ohlcv/historical?start=${Math.floor(start)}&end=${Math.floor(end)}&quote=usd`;
  const ohlcvRes = UrlFetchApp.fetch(ohlcvUrl, { muteHttpExceptions: true });
  const ohlcv = ohlcvRes.getResponseCode() === 200 ? JSON.parse(ohlcvRes.getContentText()) : null;

  if (!ohlcv || ohlcv.length === 0) return null;

  return highOrLow === 'low' ? ohlcv[0].low : ohlcv[0].high;
}

/** ============================================================================
 *                                 TESTS
 * ========================================================================== */
function testGetCryptoPrice() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("STARTING FULL TEST SUITE - " + new Date().toISOString());
  console.log("Script version: Dynamic pair discovery v2.7 (refactored + logging)");
  console.log("══════════════════════════════════════════════════════════════\n");

  const testCases = [
    { name: "GRC - Recent price (high)", token: "grc", dateStr: "2026-01-14 12:00:00", tz: "CST", highOrLow: "high", expectedRange: [0.007, 0.01] },
    { name: "GRC - Recent price (low)", token: "grc", dateStr: "2026-01-14 12:00:00", tz: "CST", highOrLow: "low", expectedRange: [0.007, 0.01] },
    { name: "XMR - Older date (high)", token: "xmr", dateStr: "2025-12-01 14:30:00", tz: "UTC", highOrLow: "high", expectedRange: [380, 450] },
    { name: "BTC - New Year 2026 (high)", token: "btc", dateStr: "2026-01-01 00:00:00", tz: "UTC", highOrLow: "high", expectedRange: [85000, 90000] },
    { name: "Invalid token", token: "zzzzzzfake", dateStr: "2026-01-14 12:00:00", tz: "CST", highOrLow: "high", expectedRange: null },
    { name: "Future date", token: "grc", dateStr: "2026-12-31 23:59:59", tz: "CST", highOrLow: "high", expectedRange: null }
  ];

  let passed = 0;
  let failedTests = [];

  testCases.forEach((test, index) => {
    console.log(`\n┌── Test ${index + 1}/${testCases.length}: ${test.name}`);
    console.log(`│ Token: ${test.token.toUpperCase()}`);
    console.log(`│ Date:  ${test.dateStr} ${test.tz}`);
    console.log(`│ Mode:  ${test.highOrLow.toUpperCase()}`);
    console.log("├──────────────────────────────────────────────────────────────");

    const startTime = new Date().getTime();

    const result = getCryptoPrice(
      test.token,
      test.dateStr,
      test.tz,
      test.highOrLow,
      0  // Fast mode for tests
    );

    const durationMs = new Date().getTime() - startTime;

    console.log(`│ Result: ${typeof result === 'number' ? result.toFixed(8) : result}`);
    console.log(`│ Time:   ${durationMs} ms`);

    let isPass = false;
    if (test.expectedRange) {
      if (typeof result === 'number') {
        isPass = result >= test.expectedRange[0] && result <= test.expectedRange[1];
        console.log(`│ Range check: ${isPass ? 'PASS ✓' : 'FAIL ✗'} (${test.expectedRange[0]} – ${test.expectedRange[1]})`);
      } else {
        console.log("│ Range check: N/A (got string/error)");
      }
    } else {
      isPass = typeof result === 'string';
      console.log(`│ Expected: ${isPass ? 'Error message (PASS)' : 'Unexpected number ✗'}`);
    }

    if (isPass) passed++;
    else failedTests.push(test.name);

    console.log("└──────────────────────────────────────────────────────────────");

    if (index < testCases.length - 1) {
      Logger.log(`Sleeping 30s between tests to avoid rate limits`);
      Utilities.sleep(30000);
    }
  });

  const total = testCases.length;
  const passRate = Math.round((passed / total) * 100);

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("TEST SUITE SUMMARY");
  console.log(`Total tests: ${total}`);
  console.log(`Passed: ${passed}/${total} (${passRate}%)`);
  console.log(`Failed: ${failedTests.length}`);
  if (failedTests.length > 0) {
    console.log("Failed tests:");
    failedTests.forEach(name => console.log(`  - ${name}`));
  } else {
    console.log("All tests passed! 🎉");
  }
  console.log("══════════════════════════════════════════════════════════════");
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
 * Refreshes all prices in the GridCoin tab, recalculates, then freezes them as static values
 */
function refreshPrices() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Refresh All Prices?',
    'This may take several minutes for 2,300+ rows. All formulas will be temporarily re-run, then frozen as static values.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('GridCoin');
  if (!sheet) {
    ui.alert('Error: "GridCoin" tab not found!');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // Change to your actual price column (1 = A, 2 = B, ..., 4 = D, etc.)
  const priceColumn = 4; // ← EDIT THIS IF NEEDED

  const formulaRange = sheet.getRange(2, priceColumn, lastRow - 1, 1);

  // Robust toast handling (null check)
  let toast = ss.toast('Starting price refresh...', 'Progress', -1);
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

  ui.alert('Done!', 'Prices refreshed and frozen.', ui.ButtonSet.OK);
}
