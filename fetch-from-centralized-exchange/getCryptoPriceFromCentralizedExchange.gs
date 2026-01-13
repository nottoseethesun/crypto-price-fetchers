/**
 * Google Apps Script: Get Crypto Price from Centralized Exchange
 * ==============================================================
 *
 * Fetches historical high or low prices for cryptocurrencies (in USD via USDT pair)
 * using the MEXC public API. Tries 1-minute resolution first; falls back to 1-hour
 * if no trades occurred in the requested minute.
 *
 * Features:
 * - Minute-level resolution when available → highest high or lowest low of that minute
 * - Automatic fallback to hourly candle → highest high or lowest low of the containing hour
 * - Timezone-aware input (user specifies correct abbreviation for the date, e.g. CST/CDT)
 * - Handles string "YYYY-MM-DD HH:MM:SS" or Date object input
 * - Prices always returned in **USD** (via USDT stablecoin pair)
 *
 * @fileoverview Main utility for retrieving historical crypto prices in Google Sheets.
 * @author Grok-assisted development
 * @version 1.2 (with fallback + CONFIG + testing)
 * @lastModified January 2026
 *
 * Usage in Google Sheets (recommended patterns; #3 is probably what you want):
 *
 * 1. Basic usage (string input, defaults to high):
 *    = getCryptoPrice("xmr", "2025-12-09 22:46:02", "CST")
 *
 * 2. Specify low price:
 *    = getCryptoPrice("xmr", "2025-12-09 22:46:02", "CST", "low")
 *
 * 3. If date is already a Date cell (Sheets may pass Date object):
 *    = getCryptoPrice("xmr", A1, "CST")
 * 
 * Note: If you have a problem with #3 above, you can fall back to this:
 *    Fallback: Use cell reference safely (force string format):
 *        = getCryptoPrice("xtm", TEXT(A1, "yyyy-mm-dd hh:mm:ss"), "PDT", "high")
 *
 * Important timezone notes:
 * - Use the **correct abbreviation for the date** (account for DST):
 *   - Before Nov 2, 2025 (Central) → CDT (-5)
 *   - After Nov 2, 2025 → CST (-6)
 *   - Same logic applies to EDT/EST, PDT/PST, etc.
 * - Unrecognized timezones default to UTC (0 offset)
 *
 * Error returns:
 * - String messages like "No 1m data available..." or "API error (HTTP 400): ..."
 * - Function returns number on success, string on failure
 *
 * Configuration:
 * All major settings are in the CONFIG object at the top of this file.
 * Change exchange, base quote, intervals, etc. there if desired.
 *
 * Testing:
 * - Open Script editor → Run → testGetCryptoPrice
 * - Results appear in View → Logs (Logger)
 * - Adjust test cases in the function as needed
 */

/** ============================================================================
 *                          CONFIGURATION
 * ========================================================================== */
const CONFIG = {
  EXCHANGE_BASE_URL: 'https://api.mexc.com/api/v3',
  QUOTE_CURRENCY: 'USDT',                // All prices in this quote (≈ USD)
  DEFAULT_INTERVAL: '1m',                // First attempt
  FALLBACK_INTERVAL: '60m',              // Used when no data in primary interval
  SUPPORTED_INTERVALS: ['1m', '60m'],    // Can be extended
  TIMEZONE_OFFSETS: {
    'UTC': 0, 'GMT': 0,
    'EST': -5, 'EDT': -4,
    'CST': -6, 'CDT': -5,
    'MST': -7, 'MDT': -6,
    'PST': -8, 'PDT': -7
    // Add more as needed: 'AKST': -9, 'HST': -10, 'CET': 1, 'CEST': 2, etc.
  }
};


/** ============================================================================
 * Main entry point custom function for Google Sheets
 * ========================================================================== */
/**
 * Fetches the high or low price of a cryptocurrency for a specific date/time.
 *
 * IMPORTANT: All prices returned are in **USD** (priced in USDT, a 1:1 USD-pegged stablecoin).
 * Represents the value of 1 token (e.g., 1 XMR or 1 XTM) in USDT/USD.
 *
 * Tries 1-minute resolution first → falls back to 1-hour if no trades in that minute.
 * For minute: exact minute high/low.
 * For hour fallback: highest high (for 'high') or lowest low (for 'low') in the containing hour.
 *
 * @param {string} token - Token symbol (e.g., 'xmr', 'xtm')
 * @param {string|Date} dateStr - Date/time as "YYYY-MM-DD HH:MM:SS" or Date object
 * @param {string} tz - Timezone abbr (e.g., 'CDT','CST','PDT','PST','EDT','EST'). Defaults to 'UTC'
 * @param {string} [highOrLow='high'] - 'high' (default) or 'low'
 * @return {number|string} Price in USD (via USDT), or error message
 * @customfunction
 */
function getCryptoPrice(token, dateStr, tz, highOrLow = 'high') {
  const offsetHours = getTimezoneOffsetHours(tz);
  const utcMs = parseInputToUtcMs(dateStr, offsetHours);
  
  if (typeof utcMs === 'string') return utcMs; // error message
  
  const symbol = token.toUpperCase() + CONFIG.QUOTE_CURRENCY;
  const target = highOrLow.toLowerCase() === 'low' ? 'low' : 'high';
  
  // Try primary interval first
  let result = fetchCandlePrice(symbol, utcMs, CONFIG.DEFAULT_INTERVAL, target);
  if (typeof result === 'number') return result;
  
  // Fallback
  return fetchCandlePrice(symbol, utcMs, CONFIG.FALLBACK_INTERVAL, target);
}


/** ============================================================================
 *                            Helper Functions
 * ========================================================================== */

/**
 * Maps timezone abbreviation to UTC offset in hours.
 * @param {string} tz - Timezone abbreviation (case-insensitive)
 * @returns {number} Offset in hours (0 if unrecognized)
 */
function getTimezoneOffsetHours(tz) {
  const key = (tz || 'UTC').toUpperCase();
  return CONFIG.TIMEZONE_OFFSETS[key] !== undefined ? CONFIG.TIMEZONE_OFFSETS[key] : 0;
}

/**
 * Parses input date/time (string or Date) into UTC milliseconds, applying timezone offset.
 * For strings: performs strict parsing and validation.
 * @param {string|Date} dateInput - Date string "YYYY-MM-DD HH:MM:SS" or Date object
 * @param {number} offsetHours - Timezone offset in hours to apply
 * @returns {number|string} UTC timestamp in milliseconds, or error message string
 */
function parseInputToUtcMs(dateInput, offsetHours) {
  let components;

  if (typeof dateInput === 'string') {
    components = parseDateStringToComponents(dateInput);
    if (typeof components === 'string') return components; // error
  } 
  else if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    components = {
      year: dateInput.getUTCFullYear(),
      month: dateInput.getUTCMonth() + 1,
      day: dateInput.getUTCDate(),
      hour: dateInput.getUTCHours(),
      minute: dateInput.getUTCMinutes(),
      second: dateInput.getUTCSeconds()
    };
  } 
  else {
    return 'Error: dateStr must be string "YYYY-MM-DD HH:MM:SS" or valid Date';
  }

  const utcMs = createUtcTimestampFromComponents(components);
  if (typeof utcMs === 'string') return utcMs; // error

  const offsetMs = offsetHours * 3600000;
  return utcMs - offsetMs; // Apply timezone offset to get true UTC
}

/**
 * Parses a date-time string in strict "YYYY-MM-DD HH:MM:SS" format
 * and returns validated numeric components or an error message.
 * @param {string} dateStr - Date string to parse
 * @returns {Object|string} {year, month, day, hour, minute, second} or error message
 */
function parseDateStringToComponents(dateStr) {
  const regex = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
  const match = dateStr.match(regex);

  if (!match) {
    return 'Invalid format. Use exactly YYYY-MM-DD HH:MM:SS (24-hour)';
  }

  const [, yStr, mStr, dStr, hStr, minStr, sStr] = match;
  const year   = parseInt(yStr, 10);
  const month  = parseInt(mStr, 10);
  const day    = parseInt(dStr, 10);
  const hour   = parseInt(hStr, 10);
  const minute = parseInt(minStr, 10);
  const second = parseInt(sStr, 10);

  // Range validation
  if (year < 1970 || year > 2100) return 'Invalid year (must be 1970–2100)';
  if (month < 1 || month > 12)    return 'Invalid month (must be 01–12)';
  if (day < 1 || day > 31)        return 'Invalid day (must be 01–31)';
  if (hour < 0 || hour > 23)      return 'Invalid hour (must be 00–23)';
  if (minute < 0 || minute > 59)  return 'Invalid minute (must be 00–59)';
  if (second < 0 || second > 59)  return 'Invalid second (must be 00–59)';

  // Validate actual date existence (handles Feb 29/30, Apr 31, etc.)
  const tempDate = new Date(year, month - 1, day);
  if (tempDate.getFullYear() !== year ||
      tempDate.getMonth() + 1 !== month ||
      tempDate.getDate() !== day) {
    return 'Invalid date (day does not exist in this month)';
  }

  return { year, month, day, hour, minute, second };
}

/**
 * Creates a UTC timestamp (ms) from validated date components.
 * @param {{year:number, month:number, day:number, hour:number, minute:number, second:number}} components
 * @returns {number|string} Milliseconds since epoch (UTC), or error message
 */
function createUtcTimestampFromComponents(components) {
  const { year, month, day, hour, minute, second } = components;
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/**
 * Fetches candle data and returns the desired extreme price (high or low).
 * @param {string} symbol - Trading pair symbol
 * @param {number} utcMs - Target UTC timestamp
 * @param {string} interval - '1m' or '60m'
 * @param {'high'|'low'} target - Which extreme to return
 * @returns {number|string} Price or error message
 */
function fetchCandlePrice(symbol, utcMs, interval, target) {
  const msPerInterval = interval === '1m' ? 60000 : 3600000;
  const startMs = Math.floor(utcMs / msPerInterval) * msPerInterval;
  const endMs = startMs + msPerInterval - 1;

  const url = `${CONFIG.EXCHANGE_BASE_URL}/klines?symbol=${symbol}&interval=${interval}&startTime=${startMs}&endTime=${endMs}&limit=10`;

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = response.getResponseCode();

    if (code !== 200) {
      return `API error (HTTP ${code}): ${response.getContentText().substring(0, 100)}`;
    }

    const data = JSON.parse(response.getContentText());

    if (!Array.isArray(data) || data.length === 0) {
      return `No ${interval} data available around this time (check token/pair liquidity or date)`;
    }

    let extreme = target === 'low' ? Infinity : -Infinity;

    data.forEach(candle => {
      const val = target === 'low' ? parseFloat(candle[3]) : parseFloat(candle[2]);
      if (target === 'low' && val < extreme) extreme = val;
      if (target === 'high' && val > extreme) extreme = val;
    });

    return extreme === Infinity || extreme === -Infinity ? 'No valid price found' : extreme;
  } catch (e) {
    return 'Fetch error: ' + e.message;
  }
}


/** ============================================================================
 *                               TESTING
 * ========================================================================== */

/**
 * Improved test runner for getCryptoPrice()
 * - Clearly marks PASS / FAIL for each test
 * - Validates expected result type (number = success, string = expected error)
 * - Logs detailed outcome
 * 
 * Run this from the script editor: select testGetCryptoPrice → Run
 * Results appear in View → Logs
 */
function testGetCryptoPrice() {
  const tests = [
    {
      desc: "Monero - Dec 2025 CST (should return a valid price)",
      args: ["xmr", "2025-12-09 22:46:02", "CST", "high"],
      expect: "number"
    },
    {
      desc: "Tari - recent-ish time, low price",
      args: ["xtm", "2025-11-15 14:30:00", "UTC", "low"],
      expect: "number"
    },
    {
      desc: "Invalid date format (should fail with error message)",
      args: ["xmr", "2025-13-01 25:00:00", "CST"],
      expect: "string"
    },
    {
      desc: "Future time (should fail with no data message)",
      args: ["xmr", "2026-06-01 12:00:00", "UTC"],
      expect: "string"
    }
  ];

  Logger.log("=== getCryptoPrice() Test Suite Started ===\n");

  let passed = 0;
  let failed = 0;

  tests.forEach((test, i) => {
    const testNum = i + 1;
    Logger.log(`Test ${testNum}: ${test.desc}`);
    Logger.log(`   Input: getCryptoPrice(${test.args.map(a => JSON.stringify(a)).join(", ")})`);

    try {
      const result = getCryptoPrice(...test.args);
      const resultType = typeof result;

      const isPass = (test.expect === "number" && resultType === "number") ||
                     (test.expect === "string" && resultType === "string");

      if (isPass) {
        passed++;
        Logger.log(`   → PASS: Returned ${resultType} → ${result}`);
      } else {
        failed++;
        Logger.log(`   → FAIL: Expected ${test.expect}, got ${resultType} → ${result}`);
      }
    } catch (err) {
      failed++;
      Logger.log(`   → FAIL: Unexpected runtime error → ${err.message}`);
    }

    Logger.log("---");
  });

  Logger.log(`\nTest Summary: ${passed} PASSED / ${failed} FAILED / ${tests.length} TOTAL`);
  Logger.log("Tests complete.");
}
