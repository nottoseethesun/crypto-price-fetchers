/**
 * Google Apps Script: Get Crypto Price from Centralized Exchange
 * ==============================================================
 *
 * @fileoverview Fetches historical high, low or closing cryptocurrency
 *   prices (USD) from centralized exchanges for use directly in Google
 *   Sheets, Google's spreadsheet app.
 * @author Christopher M. Balz, with Grok and Claude
 * @version 2.17.0
 * @lastModified November 20, 2026
 *
 * OVERVIEW
 * --------
 * A custom function for Google Sheets, written in Apps Script, Google's
 * platform for scripts that run inside its apps. It
 * returns the historical high, low or closing USD price for a
 * cryptocurrency at a given time, asking one source after another until
 * one has a price: MEXC, a centralized exchange, then CoinGecko and
 * CoinPaprika, two services that gather the exchanges' prices.
 * crypto-price-filler, the repo's tool for whole CSV files, which runs on
 * Node, the program that runs JavaScript outside a browser, asks these
 * same price sources through the repo's runner, so a fix here fixes both.
 *
 * INSTALLATION
 * ------------
 * The script is in three files, to keep each under the 500 lines of code
 * that LP Ranger's rules allow (LP Ranger, the owner's bot that manages his
 * 9mm V3 liquidity positions, sets the coding standards the repo follows): this one, getCryptoPriceFromCentralizedExchange-sources.gs, the
 * price sources, MEXC, CoinGecko and CoinPaprika, and
 * getCryptoPriceFromCentralizedExchange-tests.gs, the tests run from the
 * Apps Script editor. Apps Script runs every script file of a project in
 * one global scope, so the three work as one. The build step of the
 * crypto-price-fetchers repo, `npm run build apps-script` (npm, Node's
 * package manager, runs the repo's commands), joins them with
 * the repo's other Sheets scripts into the one file to paste into a
 * spreadsheet; the repo's README, under Install, says how.
 *
 * API KEYS
 * --------
 * This file, as committed, holds no api key: CONFIG.COINGECKO_API_KEY and
 * CONFIG.COINPAPRIKA_API_KEY are empty, and the script asks each service
 * without a key. The build step sets them at the end of the file it gives,
 * from the keys saved in the repo (`npm run api-keys`). Each key is
 * optional:
 *
 *   COINGECKO_API_KEY   - A CoinGecko demo api key, sent to CoinGecko in
 *                         the x-cg-demo-api-key header. Without it,
 *                         CoinGecko answers at a lower rate.
 *   COINPAPRIKA_API_KEY - A key for one of CoinPaprika's paid plans, sent
 *                         to CoinPaprika's paid server as the whole
 *                         Authorization header. Without it, the script
 *                         asks CoinPaprika's free server.
 *
 * A key goes only in a header, never in a url, so no url the log quotes
 * holds it.
 *
 * <!-- HELP START -->
 * ## Past prices: getCryptoPrice
 *
 * `getCryptoPrice(token, dateStr, tz, mode)` gives a coin's price in USD at
 * a past time: the highest, the lowest or the closing price of a short
 * period around that time, from centralized exchanges.
 *
 * - `token`: the coin's ticker symbol, in any case, such as `"btc"`,
 *   `"grc"`, `"xmr"` or `"xtm"`.
 * - `dateStr`: the time, written `"YYYY-MM-DD HH:MM:SS"` (24-hour), or a
 *   cell that holds a date and time.
 * - `tz`: the time zone of that time, by its abbreviation (see Time
 *   zones); left empty, UTC.
 * - `mode`: `"high"`, `"low"` or `"close"`; any other value, or none,
 *   means `"high"`.
 *
 * ```
 * =getCryptoPrice("btc", "2026-01-15 14:30:00", "CST", "high")
 * =getCryptoPrice("grc", A1, "CST")
 * =getCryptoPrice("xmr", A1, "UTC", "low")
 * =getCryptoPrice("xtm", A1, "UTC", "close")
 * ```
 *
 * A price for a time is kept for 24 hours, and "no data" for 5 minutes,
 * so a cell that runs again within that time gives the answer it gave
 * before. A past price does not change, so Refresh & freeze historical
 * prices, in the Crypto Price Fetchers menu, can replace these formulas
 * with their numbers.
 *
 * ### High, low and close
 *
 * Each source prices a period around the time. `"high"` gives the
 * highest price recorded in that period and `"low"` the lowest, which
 * bound what a trade at that time was worth. `"close"` gives the price at
 * the end of the period, the nearest to the time the source records. The
 * period depends on the source that answers:
 *
 * - MEXC, an exchange, asked first: the minute that holds the time, or, if
 *   no trade happened in that minute, the hour.
 * - CoinGecko, a service that gathers the exchanges' prices, asked next:
 *   24 hours of hourly prices, from 12 hours before the time to 12 hours
 *   after; for `"close"` only, the day's price at 00:00 UTC.
 * - CoinPaprika, a service like CoinGecko, asked last: the day, from 00:00
 *   to 23:59:59 UTC, that holds the time; for `"close"` only, when the day
 *   is older than the plan's candles reach, the day's price at 00:00 UTC.
 *
 * ### Time zones
 *
 * UTC, GMT, EST, EDT, CST, CDT, MST, MDT, PST and PDT. Use the one in force
 * at that time: CDT in summer and CST in winter for US Central time. Any
 * other value gives a message in the cell instead of a price, so a
 * misspelt zone is never read as UTC.
 *
 * ### Messages in the cell
 *
 * - `No data available from any source`: no source had a price for that
 *   coin at that time; `No data available (cached)` repeats that answer
 *   for 5 minutes.
 * - `No data available for future dates`: the time is after now.
 * - `Rate limit busy - retry later`: other cells kept the script busy;
 *   choose Clean up errors in the Crypto Price Fetchers menu, which runs
 *   the cell again.
 * - `Unknown time zone`, or `Invalid` with a part of the date: check
 *   `tz` or `dateStr`.
 * - `#ERROR!`: choose Clean up errors in the Crypto Price Fetchers menu.
 * <!-- HELP END -->
 *
 * HIGH, LOW AND CLOSE, BY SOURCE
 * ------------------------------
 * The help section above says what each mode gives. Each provider works it
 * out from its own data:
 *
 *   MEXC: Tries a 1-minute candle first (the single minute containing
 *     the requested timestamp). If no trades occurred in that minute, it
 *     falls back to a 60-minute candle. Returns the real OHLCV high, low
 *     or close of whichever candle matched. A coin MEXC trades only
 *     against BTC is priced in USD with BTC/USDT's candle at the same
 *     time.
 *
 *   CoinGecko market_chart/range: Fetches hourly data points over a
 *     24-hour window centered on the requested time (12 hours before to
 *     12 hours after): the highest of them for high, the lowest for low,
 *     and the one nearest the time for close.
 *
 *   CoinGecko history: The day's single price, recorded at 00:00 UTC.
 *     One price is not a range, so it answers close only; high and low go
 *     on to CoinPaprika.
 *
 *   CoinPaprika: The day's OHLCV candle (00:00 to 23:59:59 UTC) holding
 *     the requested time: its high, low or close. A plan reaches only so
 *     many days back for candles (the free plan, the last 24 hours). For
 *     an older day, close takes the day's price at 00:00 UTC instead, which
 *     the free plan has for the last 365 days; that one price answers close
 *     only.
 *
 * DATA SOURCES (PROVIDER CHAIN)
 * -----------------------------
 * Providers are tried in order; the first successful result is returned.
 * None asks for the current price, which would put today's price on a
 * past date. A request a provider refuses as one too many (status 429) is
 * sent again after each wait in RETRY_DELAYS_MS.
 *
 *   1. MEXC       - Primary. Real OHLCV candles (1-minute, then 1-hour
 *                   fallback). Queries exchangeInfo to verify the trading
 *                   pair exists. Skip list: grc (not listed on MEXC).
 *
 *   2. CoinGecko  - Tries two sub-endpoints in order, both dated:
 *                   a) market_chart/range (24h window, hourly data points)
 *                   b) history (the price of the requested UTC day), for
 *                      close only
 *                   Both send the demo api key when
 *                   CONFIG.COINGECKO_API_KEY holds one (see API KEYS
 *                   above).
 *
 *   3. CoinPaprika - The day's candle, then, for close, the day's price
 *                   (see above). With a key in CONFIG.COINPAPRIKA_API_KEY,
 *                   both are asked of the paid server with the key, and
 *                   reach as far back as the plan does.
 *                   Skip list: grc-gridcoin (is_active is false).
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
 *                          (see Time zones, in the help section above)
 *
 *   CACHE_EXPIRY_SECONDS
 *     DAILY_PRICE        - TTL for successful price lookups (86400 = 24h)
 *     NEGATIVE_CACHE     - TTL for "no data" results (300 = 5min)
 *
 *   COINGECKO_BASE       - CoinGecko API v3 base URL
 *   COINGECKO_API_KEY    - The CoinGecko demo api key; empty for none, as
 *                          committed (see API KEYS)
 *   COINGECKO_API_KEY_HEADER
 *                        - The header the key is sent in
 *                          ("x-cg-demo-api-key")
 *   COINPAPRIKA_BASE     - CoinPaprika API v1 base URL, the free server
 *   COINPAPRIKA_PRO_BASE - CoinPaprika's paid server, asked with a key
 *   COINPAPRIKA_API_KEY  - The CoinPaprika api key; empty for none, as
 *                          committed (see API KEYS)
 *   COINPAPRIKA_API_KEY_HEADER
 *                        - The header the key is sent in, as its whole
 *                          value ("Authorization")
 *
 *   Endpoint templates (use {base}, {id}, {date}, {from}, {to}, {start},
 *   {end} placeholders):
 *     COINGECKO_HISTORY_TEMPLATE
 *     COINGECKO_MARKET_CHART_RANGE_TEMPLATE
 *     COINPAPRIKA_OHLCV_TEMPLATE      - the day's candle
 *     COINPAPRIKA_DAY_PRICE_TEMPLATE  - the day's price at 00:00 UTC
 *
 *   RETRY_DELAYS_MS      - The waits, in milliseconds, before each new try
 *                          of a request refused with status 429
 *                          ([5000, 5000]: three tries in all)
 *
 *   Rate-limit tuning:
 *     LOCK_WAIT_MS         - Lock acquisition timeout (2000ms)
 *     GENERAL_DELAY_MS     - Delay between API calls (200ms prod, 0ms test)
 *     MAX_LOCK_RETRIES     - Retry attempts on lock failure (3)
 *     LOCK_RETRY_BACKOFF   - Exponential backoff array [5000, 10000, 20000]
 *   The tries and waits add up to 41 seconds, longer than the 30 seconds
 *   Google gives a custom function, so a cell that waits them all shows
 *   #ERROR! before the busy message: a known bug, in the repo's CLAUDE.md.
 *
 * TESTING
 * -------
 * The repo's tests run this file unchanged under Node. In the Apps Script
 * editor, select the "test" function from the function dropdown and click
 * Run. Results appear in the execution log.
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
  COINPAPRIKA_PRO_BASE: "https://api-pro.coinpaprika.com/v1",

  /*-
   *  The CoinGecko demo api key, sent in this header; empty for none. The
   *  build step sets it (see API KEYS), as the Node version does.
   */
  COINGECKO_API_KEY: "",
  COINGECKO_API_KEY_HEADER: "x-cg-demo-api-key",

  /*-
   *  The CoinPaprika paid-plan api key, sent as this header's whole
   *  value; empty for none. The build step sets it (see API KEYS).
   */
  COINPAPRIKA_API_KEY: "",
  COINPAPRIKA_API_KEY_HEADER: "Authorization",

  // Endpoint templates
  COINGECKO_HISTORY_TEMPLATE: "{base}/coins/{id}/history?date={date}",
  COINGECKO_MARKET_CHART_RANGE_TEMPLATE:
    "{base}/coins/{id}/market_chart/range?vs_currency=usd&from={from}&to={to}",

  COINPAPRIKA_OHLCV_TEMPLATE:
    "{base}/coins/{id}/ohlcv/historical?start={start}&end={end}&quote=usd",
  COINPAPRIKA_DAY_PRICE_TEMPLATE:
    "{base}/tickers/{id}/historical?start={date}&interval=1d&limit=1&quote=usd",

  // The waits before each new try of a request refused with status 429
  RETRY_DELAYS_MS: [5000, 5000],

  // Rate limit tuning
  LOCK_WAIT_MS: 2000, // Wait time for lock acquisition
  GENERAL_DELAY_MS: 200, // Delay between calls (reduced for speed)
  MAX_LOCK_RETRIES: 3, // Number of retry attempts on lock failure
  LOCK_RETRY_BACKOFF: [5000, 10000, 20000], // Exponential backoff (5s → 10s → 20s)
};

const API_LOCK = LockService.getScriptLock();

/**
 * What a cell shows when the call got no script lock in its tries. The
 * menu's Clean up errors runs again each cell that shows it.
 *
 * @type {string}
 */
const EXCHANGE_BUSY_MESSAGE = "Rate limit busy - retry later";

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
  mode = "high",
  apiDelayMs = CONFIG.GENERAL_DELAY_MS,
) {
  Logger.log(
    `getCryptoPrice called: token=${token}, date=${dateStr}, tz=${tz}, mode=${mode}, delay=${apiDelayMs}ms`,
  );

  token = token.toLowerCase();
  const target = priceTarget(mode);

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
  if (!lockAcquired) return EXCHANGE_BUSY_MESSAGE;

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

/** The price a mode asks for: "low" or "close" as named, in any letter case, and "high" for any other value */
function priceTarget(mode) {
  const named = String(mode).toLowerCase();
  return named === "low" || named === "close" ? named : "high";
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
