/**
 * Google Apps Script: Get Crypto Price from Centralized Exchange
 * ==============================================================
 *
 * @fileoverview Fetches historical high or low cryptocurrency prices (USD)
 *   from centralized exchanges for use directly in Google Sheets.
 * @author Christopher M. Balz, with Grok and Claude
 * @version 2.15.0
 * @lastModified November 18, 2026
 *
 * OVERVIEW
 * --------
 * Custom Google Sheets function that returns the historical high or low USD
 * price for a cryptocurrency on a given date. Queries multiple exchange APIs
 * in sequence until a price is found.
 *
 * INSTALLATION
 * ------------
 * The script is in three files, to keep each under LP Ranger's 500 lines of
 * code. Apps Script loads every script file of a project into one global
 * scope, so they work as one.
 *
 * 1. Open Google Sheet -> Extensions -> Apps Script
 * 2. Paste this file's contents into the script file there
 * 3. Add a script file (Files, +, Script) named
 *    getCryptoPriceFromCentralizedExchange-sources, and paste
 *    getCryptoPriceFromCentralizedExchange-sources.gs into it: the price
 *    sources, MEXC, CoinGecko and CoinPaprika
 * 4. Optional: add getCryptoPriceFromCentralizedExchange-tests.gs the same
 *    way, to run the tests from the editor
 * 5. Save and refresh the sheet
 * 6. Optional: set the CoinGecko api key (see API KEY below)
 *
 * API KEY
 * -------
 * The CoinGecko demo api key is kept in the project's Script Properties,
 * never in this file, so the file is shared and committed without it. In
 * the Apps Script editor: Project Settings (the gear on the left) ->
 * Script Properties -> Add script property. Property: COINGECKO_API_KEY.
 * Value: the key. Then Save script properties.
 *
 * The script sends the key to CoinGecko in the x-cg-demo-api-key header,
 * never in a url, so no url the log quotes holds it. Without the property,
 * the script asks CoinGecko without a key, which CoinGecko answers at a
 * lower rate.
 *
 * USAGE
 * -----
 *   =getCryptoPrice(token, dateStr, tz, highOrLow)
 *
 * Parameters:
 *   token     - Ticker symbol, case-insensitive ("btc", "grc", "xmr", "xtm")
 *   dateStr   - "YYYY-MM-DD HH:MM:SS" (24-hour) or a cell reference
 *   tz        - Timezone abbreviation (see SUPPORTED TIMEZONES below)
 *   highOrLow - "high" or "low"; defaults to "high" if omitted (any value
 *               other than "low" is also treated as "high")
 *
 * Examples:
 *   =getCryptoPrice("btc", "2026-01-15 14:30:00", "CST", "high")
 *   =getCryptoPrice("grc", A1, "CST")
 *   =getCryptoPrice("xmr", A1, "UTC", "low")
 *
 * HIGH / LOW MODE
 * ---------------
 * Specifying "high" returns the highest price recorded during the relevant
 * time period, while "low" returns the lowest. This lets you bound a
 * transaction's value: use "high" for the best-case sale price and "low"
 * for the worst-case, or vice versa depending on perspective.
 *
 * The time period covered depends on which provider returns the data:
 *
 *   MEXC: Tries a 1-minute candle first (the single minute containing
 *     the requested timestamp). If no trades occurred in that minute, it
 *     falls back to a 60-minute candle. Returns the real OHLCV high or
 *     low from whichever candle matched. A coin MEXC trades only against
 *     BTC is priced in USD with BTC/USDT's candle at the same time.
 *
 *   CoinGecko market_chart/range: Fetches hourly data points over a
 *     24-hour window centered on the requested time (12 hours before to
 *     12 hours after), then returns Math.max (high) or Math.min (low)
 *     across all of those points.
 *
 *   CoinGecko history: This endpoint returns only the day's single
 *     price, with no time-range high/low data. A +/-1.5% spread is
 *     applied as an approximation (high = price * 1.015,
 *     low = price * 0.985).
 *
 *   CoinPaprika: Requests a 1-minute OHLCV candle ending at the
 *     requested timestamp. Returns the real high or low from that
 *     candle.
 *
 * DATA SOURCES (PROVIDER CHAIN)
 * -----------------------------
 * Providers are tried in order; the first successful result is returned:
 *
 *   1. MEXC       - Primary. Real OHLCV candles (1-minute, then 1-hour
 *                   fallback). Queries exchangeInfo to verify the trading
 *                   pair exists. Skip list: grc (not listed on MEXC).
 *
 *   2. CoinGecko  - Tries two sub-endpoints in order, both dated:
 *                   a) market_chart/range (24h window, hourly data points)
 *                   b) history (the price of the requested UTC day)
 *                   It never asks for the current price, which would put
 *                   today's price on a past date.
 *                   Both send the demo api key when the Script Property
 *                   COINGECKO_API_KEY holds one (see API KEY above).
 *                   Retries on 429 (rate limit) up to 3 times with 5s sleep.
 *
 *   3. CoinPaprika - OHLCV fallback. Skip list: grc-gridcoin (is_active is
 *                   false; free-tier OHLCV is limited to 24h).
 *
 * TOKEN MAPPINGS (TOKEN_TO_ID):
 *   Tokens not listed in TOKEN_TO_ID use the raw ticker as the CoinGecko /
 *   CoinPaprika ID. To add a new token, add an entry with its gecko and
 *   paprika IDs:
 *     'mytok': { gecko: 'mytoken-id', paprika: 'mytok-mytoken' }
 *   If the token is not on MEXC, add it to the skip set inside
 *   getPriceFromMEXC. Similarly for CoinPaprika in getPriceFromCoinPaprika.
 *
 * CONFIGURATION
 * -------------
 * All tuning is in the CONFIG object at the top of this file:
 *
 *   EXCHANGE_BASE_URL    - MEXC REST API base ("https://api.mexc.com/api/v3")
 *   QUOTE_CURRENCY       - Quote side of the pair ("USDT")
 *   DEFAULT_INTERVAL     - First kline resolution to try ("1m")
 *   FALLBACK_INTERVAL    - Second kline resolution ("60m")
 *
 *   TIMEZONE_OFFSETS     - Map of abbreviation to UTC offset in hours
 *                          (see SUPPORTED TIMEZONES)
 *
 *   CACHE_EXPIRY_SECONDS
 *     DAILY_PRICE        - TTL for successful price lookups (86400 = 24h)
 *     NEGATIVE_CACHE     - TTL for "no data" results (300 = 5min)
 *
 *   COINGECKO_BASE       - CoinGecko API v3 base URL
 *   COINGECKO_API_KEY_PROPERTY
 *                        - The Script Property holding the CoinGecko demo
 *                          api key ("COINGECKO_API_KEY"; see API KEY)
 *   COINGECKO_API_KEY_HEADER
 *                        - The header the key is sent in
 *                          ("x-cg-demo-api-key")
 *   COINPAPRIKA_BASE     - CoinPaprika API v1 base URL
 *
 *   Endpoint templates (use {base}, {id}, {date}, {from}, {to}, {start},
 *   {end} placeholders):
 *     COINGECKO_HISTORY_TEMPLATE
 *     COINGECKO_MARKET_CHART_RANGE_TEMPLATE
 *     COINPAPRIKA_TICKERS_TEMPLATE
 *     COINPAPRIKA_OHLCV_TEMPLATE
 *
 *   Rate-limit tuning:
 *     LOCK_WAIT_MS         - Lock acquisition timeout (2000ms)
 *     GENERAL_DELAY_MS     - Delay between API calls (200ms prod, 0ms test)
 *     MAX_LOCK_RETRIES     - Retry attempts on lock failure (3)
 *     LOCK_RETRY_BACKOFF   - Exponential backoff array [5000, 10000, 20000]
 *
 * SUPPORTED TIMEZONES
 * -------------------
 * UTC, GMT, EST, EDT, CST, CDT, MST, MDT, PST, PDT
 *
 * Use the correct abbreviation accounting for Daylight Saving Time
 * (e.g., CDT in summer, CST in winter for US Central). Any other value
 * shows a message in the cell instead of a price, so a misspelt zone is
 * never read as UTC. An empty one means UTC.
 *
 * TESTING
 * -------
 * In the Apps Script editor, select the "test" function from the function
 * dropdown and click Run. Results appear in the execution log.
 *
 * LIMITATIONS
 * -----------
 * Google Apps Script execution limits cap each run at roughly 100 API calls.
 * For larger batch jobs, use the Node.js CLI in crypto-price-filler/.
 */

// Declared in getCryptoPriceFromCentralizedExchange-sources.gs, in the same
// project:
/* global getPriceFromMEXC, getPriceFromCoinGecko, getPriceFromCoinPaprika */

/** ============================================================================
 *                          CONFIGURATION & GLOBALS
 * ========================================================================== */
const CONFIG = {
  EXCHANGE_BASE_URL: "https://api.mexc.com/api/v3",
  QUOTE_CURRENCY: "USDT",
  DEFAULT_INTERVAL: "1m",
  FALLBACK_INTERVAL: "60m",
  TIMEZONE_OFFSETS: {
    UTC: 0,
    GMT: 0,
    EST: -5,
    EDT: -4,
    CST: -6,
    CDT: -5,
    MST: -7,
    MDT: -6,
    PST: -8,
    PDT: -7,
  },
  CACHE_EXPIRY_SECONDS: {
    DAILY_PRICE: 86400, // 24 hours
    NEGATIVE_CACHE: 300, // 5 min for failures
  },

  // API URL bases
  COINGECKO_BASE: "https://api.coingecko.com/api/v3",
  COINPAPRIKA_BASE: "https://api.coinpaprika.com/v1",

  // The CoinGecko demo api key: read from this Script Property, sent in this header
  COINGECKO_API_KEY_PROPERTY: "COINGECKO_API_KEY",
  COINGECKO_API_KEY_HEADER: "x-cg-demo-api-key",

  // Endpoint templates
  COINGECKO_HISTORY_TEMPLATE: "{base}/coins/{id}/history?date={date}",
  COINGECKO_MARKET_CHART_RANGE_TEMPLATE:
    "{base}/coins/{id}/market_chart/range?vs_currency=usd&from={from}&to={to}",

  COINPAPRIKA_TICKERS_TEMPLATE: "{base}/tickers/{id}",
  COINPAPRIKA_OHLCV_TEMPLATE:
    "{base}/coins/{id}/ohlcv/historical?start={start}&end={end}&quote=usd",

  // Rate limit tuning
  LOCK_WAIT_MS: 2000, // Wait time for lock acquisition
  GENERAL_DELAY_MS: 200, // Delay between calls (reduced for speed)
  MAX_LOCK_RETRIES: 3, // Number of retry attempts on lock failure
  LOCK_RETRY_BACKOFF: [5000, 10000, 20000], // Exponential backoff (5s → 10s → 20s)
};

const API_LOCK = LockService.getScriptLock();

/** ============================================================================
 *                       TOKEN MAPPINGS FOR FALLBACKS
 * ========================================================================== */
const TOKEN_TO_ID = {
  btc: { gecko: "bitcoin", paprika: "btc-bitcoin" },
  xmr: { gecko: "monero", paprika: "xmr-monero" },
  grc: { gecko: "gridcoin-research", paprika: "grc-gridcoin" },
  xtm: { gecko: "minotari", paprika: "xtm-tari" },
};

/** ============================================================================
 *                          CACHE HELPERS
 * ========================================================================== */
function getCachedResult(key) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) {
    Logger.log(`Cache hit: ${key} = ${cached}`);
    if (cached === "NO_DATA") {
      Logger.log(`Negative cache hit for ${key}`);
      return "No data available (cached)";
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

function setCachedResult(
  key,
  value,
  ttl = CONFIG.CACHE_EXPIRY_SECONDS.DAILY_PRICE,
) {
  const cache = CacheService.getScriptCache();
  const valueToCache =
    typeof value === "number" && !isNaN(value) ? value : "NO_DATA";
  cache.put(key, valueToCache.toString(), ttl);
  Logger.log(`Cached: ${key} = ${valueToCache} (TTL ${ttl}s)`);
}

/** ============================================================================
 * Main entry point custom function for Google Sheets
 * ========================================================================== */
function getCryptoPrice(
  token,
  dateStr,
  tz,
  highOrLow = "high",
  apiDelayMs = CONFIG.GENERAL_DELAY_MS,
) {
  Logger.log(
    `getCryptoPrice called: token=${token}, date=${dateStr}, tz=${tz}, mode=${highOrLow}, delay=${apiDelayMs}ms`,
  );

  token = token.toLowerCase();
  const target = highOrLow.toLowerCase() === "low" ? "low" : "high";

  // Parse and validate date
  const safeDateStr = normalizeDateStr(dateStr);
  if (typeof safeDateStr !== "string") return safeDateStr.error;

  const offsetHours = getTimezoneOffsetHours(tz);
  if (offsetHours === null) {
    return `Unknown time zone "${tz}": use one of ${Object.keys(CONFIG.TIMEZONE_OFFSETS).join(", ")}`;
  }

  const utcMs = parseInputToUtcMs(safeDateStr, offsetHours);
  if (typeof utcMs === "string") return utcMs;
  if (utcMs > Date.now()) return "No data available for future dates";

  // Check cache
  const cacheKey = `price_${token}_${safeDateStr.replace(/[^0-9-]/g, "")}_${tz}_${target}`;
  const cached = getCachedResult(cacheKey);
  if (cached !== null) return cached;

  // Acquire lock with retry
  const lockAcquired = acquireLockWithRetry(apiDelayMs);
  if (!lockAcquired) return "Rate limit busy - retry later";

  try {
    const price = fetchPriceFromProviders(token, utcMs, target);
    cacheAndReturn(cacheKey, price);
    return price !== null ? price : "No data available from any source";
  } catch (e) {
    Logger.log(`Critical error: ${e.message}`);
    return `Error: ${e.message}`;
  } finally {
    releaseLockIfHeld(lockAcquired);
  }
}

/** Normalizes dateStr to string format, returns {error} on failure */
function normalizeDateStr(dateStr) {
  if (typeof dateStr === "string") return dateStr;
  if (dateStr instanceof Date && !isNaN(dateStr.getTime())) {
    return Utilities.formatDate(dateStr, "UTC", "yyyy-MM-dd HH:mm:ss");
  }
  Logger.log(`Invalid dateStr type: ${typeof dateStr}`);
  return { error: "Invalid date format" };
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
  Logger.log("All lock attempts failed");
  return false;
}

/** Releases lock if it was acquired */
function releaseLockIfHeld(lockAcquired) {
  if (lockAcquired) {
    API_LOCK.releaseLock();
    Logger.log("Lock released");
  }
}

/** Tries each provider in order, returns first valid price or null */
function fetchPriceFromProviders(token, utcMs, target) {
  const idMap = TOKEN_TO_ID[token] || { gecko: token, paprika: token };
  const providers = [
    { name: "MEXC", fn: () => getPriceFromMEXC(token, utcMs, target) },
    {
      name: "CoinGecko",
      fn: () => getPriceFromCoinGecko(idMap.gecko, utcMs, target),
    },
    {
      name: "CoinPaprika",
      fn: () => getPriceFromCoinPaprika(idMap.paprika, utcMs, target),
    },
  ];

  for (const provider of providers) {
    const price = provider.fn();
    if (isValidPrice(price)) {
      Logger.log(`Final price from ${provider.name}: ${price}`);
      return price;
    }
  }
  Logger.log("All providers failed");
  return null;
}

/** Checks if price is a valid number */
function isValidPrice(price) {
  return typeof price === "number" && !isNaN(price);
}

/** Caches price result (positive or negative) */
function cacheAndReturn(cacheKey, price) {
  if (price !== null) {
    setCachedResult(cacheKey, price);
  } else {
    setCachedResult(
      cacheKey,
      "NO_DATA",
      CONFIG.CACHE_EXPIRY_SECONDS.NEGATIVE_CACHE,
    );
  }
}

/** ============================================================================
 *                            HELPER FUNCTIONS
 * ========================================================================== */

/** The UTC offset in hours of a time zone abbreviation; UTC when none is given; null when the abbreviation is unknown */
function getTimezoneOffsetHours(tz) {
  const key = String(tz || "UTC")
    .trim()
    .toUpperCase();
  const offset = CONFIG.TIMEZONE_OFFSETS[key];
  if (offset === undefined) {
    Logger.log(`Unknown time zone: ${tz}`);
    return null;
  }
  Logger.log(`Timezone ${tz} → offset: ${offset} hours`);
  return offset;
}

function parseInputToUtcMs(dateInput, offsetHours) {
  Logger.log(`Parsing dateInput: ${dateInput}, offsetHours: ${offsetHours}`);

  let components;
  if (typeof dateInput === "string") {
    components = parseDateStringToComponents(dateInput);
    if (typeof components === "string") {
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
      second: dateInput.getUTCSeconds(),
    };
    Logger.log(`Parsed Date object: ${JSON.stringify(components)}`);
  } else {
    const err =
      'Error: dateStr must be string "YYYY-MM-DD HH:MM:SS" or valid Date';
    Logger.log(err);
    return err;
  }

  const utcMs = createUtcTimestampFromComponents(components);
  if (typeof utcMs === "string") {
    Logger.log(`UTC timestamp creation failed: ${utcMs}`);
    return utcMs;
  }

  Logger.log(`UTC ms before offset: ${utcMs}`);
  const finalMs = utcMs - offsetHours * 3600000;
  Logger.log(`Final UTC ms after offset: ${finalMs}`);
  return finalMs;
}

function parseDateStringToComponents(dateStr) {
  Logger.log(`Parsing date string: ${dateStr}`);
  const regex = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
  const match = dateStr.match(regex);

  if (!match) {
    return logAndReturn(
      "Invalid format. Use exactly YYYY-MM-DD HH:MM:SS (24-hour)",
    );
  }

  const [, yStr, mStr, dStr, hStr, minStr, sStr] = match;
  const components = {
    year: parseInt(yStr, 10),
    month: parseInt(mStr, 10),
    day: parseInt(dStr, 10),
    hour: parseInt(hStr, 10),
    minute: parseInt(minStr, 10),
    second: parseInt(sStr, 10),
  };

  const validationError = validateDateComponents(components);
  if (validationError) return validationError;

  Logger.log(`Parsed components: ${JSON.stringify(components)}`);
  return components;
}

/** Validates date component ranges, returns error string or null */
function validateDateComponents(c) {
  if (!inRange(c.year, 1970, 2100)) return "Invalid year (1970–2100)";
  if (!inRange(c.month, 1, 12)) return "Invalid month (01–12)";
  if (!inRange(c.day, 1, 31)) return "Invalid day (01–31)";
  if (!inRange(c.hour, 0, 23)) return "Invalid hour (00–23)";
  if (!inRange(c.minute, 0, 59)) return "Invalid minute (00–59)";
  if (!inRange(c.second, 0, 59)) return "Invalid second (00–59)";

  // Check for impossible dates like Feb 30
  const tempDate = new Date(c.year, c.month - 1, c.day);
  const dateMatches =
    tempDate.getFullYear() === c.year &&
    tempDate.getMonth() + 1 === c.month &&
    tempDate.getDate() === c.day;
  if (!dateMatches) return "Invalid date (e.g., Feb 30 does not exist)";

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
  const date = new Date(
    Date.UTC(
      components.year,
      components.month - 1,
      components.day,
      components.hour,
      components.minute,
      components.second,
    ),
  );

  if (isNaN(date.getTime())) {
    const err = "Error creating UTC timestamp";
    Logger.log(err);
    return err;
  }

  Logger.log(`UTC timestamp created: ${date.getTime()}`);
  return date.getTime();
}

function applySpread(price, target) {
  const spread = 0.015; // 1.5%
  const result = target === "low" ? price * (1 - spread) : price * (1 + spread);
  Logger.log(`Applied spread (${target}): ${price} → ${result}`);
  return result;
}

/** ============================================================================
 *                          SEPARATE CUSTOM MENU
 * ========================================================================== */
/**
 * Creates a separate top-level menu "Fetch Historical Crypto Prices" (does not merge with Tari Tools)
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("Fetch Historical Crypto Prices")
    .addItem("Refresh & Freeze All Prices", "refreshPrices")
    .addToUi();
}

/**
 * Refreshes all prices in the currently active sheet, recalculates, then freezes them as static values.
 * Works on whichever tab is active when the menu item is clicked (no hard-coded tab name dependency).
 */
function refreshPrices() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    "Refresh All Prices?",
    "This may take several minutes for large sheets. All formulas in the current sheet will be temporarily re-run, then frozen as static values.\n\nContinue?",
    ui.ButtonSet.YES_NO,
  );

  if (response !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = SpreadsheetApp.getActiveSheet(); // Always use the currently active tab
  if (!sheet) {
    ui.alert("Error: No active sheet found!");
    return;
  }

  const sheetName = sheet.getName();
  Logger.log(`Refreshing prices on active sheet: ${sheetName}`);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    ui.alert("No data rows to refresh on this sheet.");
    return;
  }

  // Change to your actual price column (1 = A, 2 = B, ..., 4 = D, etc.)
  const priceColumn = 4; // ← EDIT THIS IF NEEDED

  const formulaRange = sheet.getRange(2, priceColumn, lastRow - 1, 1);

  // Robust toast handling (null check)
  const toast = ss.toast(
    `Starting refresh on "${sheetName}"...`,
    "Progress",
    -1,
  );
  if (toast === null) {
    Logger.log("Toast creation failed - skipping progress updates");
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
      toast.setText(
        "Refresh complete! Prices are now frozen as static values.",
      );
    } catch (e) {
      Logger.log(`Toast update failed: ${e.message}`);
    }
  }

  ui.alert(
    "Done!",
    `Prices on sheet "${sheetName}" refreshed and frozen.`,
    ui.ButtonSet.OK,
  );
}
