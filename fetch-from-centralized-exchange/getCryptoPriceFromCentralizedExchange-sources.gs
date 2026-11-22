/**
 * getCryptoPriceFromCentralizedExchange-sources.gs: the price sources of
 * getCryptoPriceFromCentralizedExchange.gs: MEXC, a centralized exchange,
 * and CoinGecko and CoinPaprika, two services that gather the exchanges'
 * prices.
 *
 * The repo's build step, `npm run build apps-script` (npm is the package
 * manager of Node, the program that runs JavaScript outside a browser),
 * joins it with
 * getCryptoPriceFromCentralizedExchange.gs into the one file pasted into a
 * spreadsheet's project in Apps Script, Google's platform for scripts that
 * run inside its apps, such as Google Sheets, its spreadsheet app. Apps
 * Script loads every
 * script file of a project into one global scope, so these functions read
 * CONFIG and the cache declared there, and getCryptoPrice calls them. The
 * script is in three files to keep each under the 500 lines of code that
 * LP Ranger's rules allow (LP Ranger, the owner's bot that manages his 9mm
 * V3 liquidity positions, sets the repo's coding standards); its header,
 * in getCryptoPriceFromCentralizedExchange.gs, says what it does.
 *
 * Each source takes the time as UTC milliseconds and a target, "high",
 * "low" or "close", and returns the price in USD, or null when it has
 * none. crypto-price-filler, the repo's tool for whole CSV files, which
 * runs on Node, calls the three sources itself, through getCryptoPriceFromCentralizedExchange.js,
 * so they are its price sources too.
 *
 * @see https://github.com/nottoseethesun/crypto-price-fetchers
 */

// Declared in getCryptoPriceFromCentralizedExchange.gs, in the same project:
/* global CONFIG, getCachedResult, setCachedResult */

/** ============================================================================
 *                          REQUESTS
 * ========================================================================== */

/**
 * Asks a url, and asks it again after each wait in CONFIG.RETRY_DELAYS_MS
 * while the provider refuses it as one too many (status 429). Returns the
 * last response, whatever its status.
 */
function fetchWithRetries(url, headers, label) {
  const delays = CONFIG.RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: headers,
    });
    if (response.getResponseCode() !== 429 || attempt >= delays.length)
      return response;
    Logger.log(
      `${label} answered 429 - waiting ${delays[attempt]} ms (try ${attempt + 2} of ${delays.length + 1} next)`,
    );
    Utilities.sleep(delays[attempt]);
  }
}

/** The json body of a response with status 200, or null for any other status or a body that is not json */
function jsonOf(response, label) {
  const code = response.getResponseCode();
  if (code !== 200) {
    Logger.log(`${label} failed: HTTP ${code}`);
    return null;
  }
  try {
    return JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log(`${label} gave a body that is not json: ${e.message}`);
    return null;
  }
}

/** An api key set in CONFIG, trimmed, or null when none is set */
function configuredKey(key) {
  if (typeof key !== "string" || key.trim() === "") return null;
  return key.trim();
}

/** ============================================================================
 *                          MEXC
 * ========================================================================== */

/** The field of a kline candle, [open time, open, high, low, close, volume, ...], that each value reads */
const MEXC_CANDLE_FIELD = Object.freeze({
  high: 2,
  low: 3,
  close: 4,
  volume: 5,
});

/** A day, in ms */
const MEXC_DAY_MS = 86400000;

/** Monday 1970-01-05, 00:00 UTC, in ms: MEXC's weeks start on a Monday */
const MEXC_FIRST_MONDAY_MS = 4 * MEXC_DAY_MS;

/**
 * The windows the script asks MEXC for, from the minute up to the year,
 * each a period of UTC time: the interval of MEXC's candles that make it,
 * how many of them it takes, since MEXC serves no 2-hour or yearly candle,
 * and where the window that holds a time starts and ends.
 */
const MEXC_WINDOWS = Object.freeze([
  fixedWindow("minute", "1m", 1, 60000),
  fixedWindow("hour", "60m", 1, 3600000),
  fixedWindow("2 hours", "60m", 2, 7200000),
  fixedWindow("4 hours", "4h", 1, 14400000),
  fixedWindow("day", "1d", 1, MEXC_DAY_MS),
  { name: "week", interval: "1W", candles: 1, bounds: weekHolding },
  { name: "month", interval: "1M", candles: 1, bounds: monthHolding },
  { name: "year", interval: "1M", candles: 12, bounds: yearHolding },
]);

/**
 * A token's price at a time from MEXC: from the candles of the trading
 * pair MEXC lists for it against CONFIG.QUOTE_CURRENCY, USDT as written,
 * or else against BTC, whose price in that currency over the same window
 * then turns it into USD.
 *
 * @param {string} token - The token's symbol, such as "btc"
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @param {string} target - The price to give: "average", "high", "low" or "close"
 * @returns {?number} The price in USD, or null when MEXC lists no pair for the token or nothing traded in the year that holds the time
 */
function getPriceFromMEXC(token, utcMs, target) {
  Logger.log(`Trying MEXC for ${token}`);

  if (new Set(["grc"]).has(token.toLowerCase())) {
    Logger.log(`Skipping MEXC for known missing token: ${token}`);
    return null;
  }

  const symbols = fetchMEXCSymbols();
  if (!symbols) return null;

  const pairInfo = findMEXCTradingPair(token, symbols);
  if (!pairInfo) return null;

  const found = mexcPairPrice(pairInfo.symbol, utcMs, target);
  if (found === null) return null;

  let price = found.price;
  if (pairInfo.useBTC) {
    const btc = fetchWindowCandle(
      "BTC" + CONFIG.QUOTE_CURRENCY,
      found.window,
      utcMs,
    );
    if (btc === null) return null;
    price *= priceOf(btc, found.averaged ? "average" : target);
  }
  if (!Number.isFinite(price)) {
    Logger.log(`MEXC candle gave no ${target} price`);
    return null;
  }
  Logger.log(`MEXC final price: ${price} (${target}, ${found.window.name})`);
  return price;
}

/** Fetches MEXC exchange symbols list */
function fetchMEXCSymbols() {
  const url = CONFIG.EXCHANGE_BASE_URL + "/exchangeInfo";
  const label = "MEXC exchangeInfo";
  const body = jsonOf(fetchWithRetries(url, {}, label), label);
  return body === null ? null : (body.symbols ?? []);
}

/** Finds the token's pair quoted in CONFIG.QUOTE_CURRENCY, or else in BTC */
function findMEXCTradingPair(token, symbols) {
  const upperToken = token.toUpperCase();
  let symbol = null;
  let useBTC = false;

  for (const sym of symbols) {
    if (sym.baseAsset.toUpperCase() !== upperToken) continue;
    if (sym.quoteAsset === CONFIG.QUOTE_CURRENCY) {
      return { symbol: upperToken + CONFIG.QUOTE_CURRENCY, useBTC: false };
    }
    if (sym.quoteAsset === "BTC") {
      symbol = upperToken + "BTC";
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

/**
 * A pair's price at a time from MEXC's candles. The window that holds the
 * time comes first: its minute, or, for a time older than the minute
 * candles MEXC keeps, about the last 30 days, its hour. When something
 * traded in it, it gives the target's price: the average of its high and
 * low, its high, its low or its close. When nothing traded in it, the
 * script goes up one window at a time, to the year, and the first in which
 * something traded gives the average of its high and low, whatever the
 * target. MEXC gives a candle for every period it keeps, one in which
 * nothing traded with volume 0.
 *
 * @param {string} symbol - The MEXC pair, such as XTMUSDT
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @param {string} target - The price to give: "average", "high", "low" or "close"
 * @return {?{window: Object, averaged: boolean, price: number}} The price, its window, and whether it is the average of the window's high and low; or null when nothing traded in the year that holds the time
 */
function mexcPairPrice(symbol, utcMs, target) {
  let level = 0;
  let candle = fetchWindowCandle(symbol, MEXC_WINDOWS[0], utcMs);
  if (candle === null) {
    level = 1;
    candle = fetchWindowCandle(symbol, MEXC_WINDOWS[1], utcMs);
  }
  if (candle !== null && candle.volume > 0) {
    const window = MEXC_WINDOWS[level];
    return {
      window,
      averaged: target === "average",
      price: priceOf(candle, target),
    };
  }
  for (level += 1; level < MEXC_WINDOWS.length; level++) {
    const window = MEXC_WINDOWS[level];
    candle = fetchWindowCandle(symbol, window, utcMs);
    if (candle !== null && candle.volume > 0) {
      return { window, averaged: true, price: priceOf(candle, "average") };
    }
  }
  Logger.log(
    `MEXC: nothing traded in ${symbol} in the year that holds the time`,
  );
  return null;
}

/** A candle's price for a target: the average of its high and low, or its high, its low or its close */
function priceOf(candle, target) {
  return target === "average" ? (candle.high + candle.low) / 2 : candle[target];
}

/**
 * The candle of a window that holds a time. MEXC's candles open on their
 * period's boundaries, and MEXC gives the candles that open in the window
 * asked, oldest first, as many as the request's limit, so asked for the
 * window from its first millisecond to its last, it gives the window's
 * own candles. The 2 hours join their two hour candles, and the year its
 * twelve month candles: the highest high, the lowest low, the last close
 * and the volumes summed.
 *
 * @param {string} symbol - The MEXC pair
 * @param {Object} window - One of MEXC_WINDOWS
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @return {?{high: number, low: number, close: number, volume: number}} The candle, or null when MEXC keeps none of the window
 */
function fetchWindowCandle(symbol, window, utcMs) {
  const { start, end } = window.bounds(utcMs);
  const candles = fetchKlines(
    symbol,
    window.interval,
    start,
    end,
    window.candles,
  );
  if (candles === null || candles.length === 0) {
    Logger.log(
      `MEXC keeps no candle of the ${window.name} that holds the time`,
    );
    return null;
  }
  const values = (name) =>
    candles.map((candle) => Number(candle[MEXC_CANDLE_FIELD[name]]));
  return {
    high: Math.max(...values("high")),
    low: Math.min(...values("low")),
    close: values("close")[candles.length - 1],
    volume: values("volume").reduce((sum, volume) => sum + volume, 0),
  };
}

/** Fetches a pair's candles of an interval that open from startTime to endTime, at most limit of them */
function fetchKlines(symbol, interval, startTime, endTime, limit) {
  const url = `${CONFIG.EXCHANGE_BASE_URL}/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`;
  const label = `MEXC ${interval} klines`;
  const data = jsonOf(fetchWithRetries(url, {}, label), label);
  return Array.isArray(data) ? data : null;
}

/** A window of a fixed length, which starts at a whole number of its lengths since 1970 UTC */
function fixedWindow(name, interval, candles, lengthMs) {
  const bounds = (utcMs) => {
    const start = Math.floor(utcMs / lengthMs) * lengthMs;
    return { start, end: start + lengthMs - 1 };
  };
  return { name, interval, candles, bounds };
}

/** The week, from Monday 00:00 UTC, that holds a time */
function weekHolding(utcMs) {
  const weekMs = 7 * MEXC_DAY_MS;
  const start =
    MEXC_FIRST_MONDAY_MS +
    Math.floor((utcMs - MEXC_FIRST_MONDAY_MS) / weekMs) * weekMs;
  return { start, end: start + weekMs - 1 };
}

/** The month, UTC, that holds a time */
function monthHolding(utcMs) {
  const date = new Date(utcMs);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    start: Date.UTC(year, month, 1),
    end: Date.UTC(year, month + 1, 1) - 1,
  };
}

/** The year, UTC, that holds a time */
function yearHolding(utcMs) {
  const year = new Date(utcMs).getUTCFullYear();
  return { start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1) - 1 };
}

/** ============================================================================
 *                          COINGECKO
 * ========================================================================== */

/**
 * A token's price at a time from CoinGecko: from its market chart over a
 * window centred on the time, or else, for close alone, from the day's
 * single price; each answer, or the lack of one, is cached.
 *
 * @param {string} id - The token's CoinGecko id, such as "bitcoin"
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @param {string} target - The price to give: "average", "high", "low" or "close"
 * @returns {?number} The price in USD, or null when CoinGecko has none for the time and target
 */
function getPriceFromCoinGecko(id, utcMs, target) {
  Logger.log(`Trying CoinGecko for ${id} at ${new Date(utcMs).toISOString()}`);

  // Note: No separate lock here — in the sheet, the caller (getCryptoPrice) already holds the API_LOCK.
  // Acquiring it again would deadlock since GAS LockService is not re-entrant.

  const dateStr = Utilities.formatDate(new Date(utcMs), "UTC", "dd-MM-yyyy");

  /*-
   *  1) Try market_chart/range with its own cache, kept for the time
   *  asked: its window is centred on that time, so two times of one day
   *  differ.
   */
  const rangeCacheKey = `gecko_range_${id}_${Math.floor(utcMs / 1000)}_${target}`;
  const rangeCached = getCachedResult(rangeCacheKey);
  if (typeof rangeCached === "number") return rangeCached;

  if (typeof rangeCached !== "string") {
    const rangePrice = tryCoinGeckoMarketChartRange(id, utcMs, target);
    if (rangePrice !== null) {
      Logger.log(
        `CoinGecko market_chart/range success: ${rangePrice} USD (${target})`,
      );
      setCachedResult(rangeCacheKey, rangePrice);
      return rangePrice;
    }
    setCachedResult(
      rangeCacheKey,
      "NO_DATA",
      CONFIG.CACHE_EXPIRY_SECONDS.NEGATIVE_CACHE,
    );
  }

  /*-
   *  2) Fall back to the day's price (history) with its own cache. One
   *  price is not a range, so it answers close only. Never the current
   *  price (tickers): that would put today's price on a past date.
   */
  if (target !== "close") {
    Logger.log(
      `CoinGecko has no dated ${target} for ${id}: the day's single price answers close only`,
    );
    return null;
  }
  const dailyCacheKey = `gecko_daily_${id}_${dateStr}`;
  const dailyCached = getCachedResult(dailyCacheKey);
  if (typeof dailyCached === "number") return dailyCached;
  if (typeof dailyCached === "string") return null;

  const price = tryCoinGeckoHistory(id, dateStr);
  if (price !== null) {
    Logger.log(`CoinGecko history success: ${price} USD for ${dateStr}`);
    setCachedResult(dailyCacheKey, price);
    return price;
  }

  setCachedResult(
    dailyCacheKey,
    "NO_DATA",
    CONFIG.CACHE_EXPIRY_SECONDS.NEGATIVE_CACHE,
  );
  return null;
}

/**
 * Fetches time-series prices from CoinGecko market_chart/range for a 24h
 * window centred on the time, then returns the average of the highest and
 * the lowest of the data points for average, the highest for high, the
 * lowest for low, or the one nearest the time for close.
 * Returns null on failure.
 */
function tryCoinGeckoMarketChartRange(id, utcMs, target) {
  const fromSec = Math.floor((utcMs - 43200000) / 1000); // 12h before
  const nowSec = Math.floor(Date.now() / 1000);
  const toSec = Math.min(Math.floor((utcMs + 43200000) / 1000), nowSec);

  const url = CONFIG.COINGECKO_MARKET_CHART_RANGE_TEMPLATE.replace(
    "{base}",
    CONFIG.COINGECKO_BASE,
  )
    .replace("{id}", id)
    .replace("{from}", fromSec)
    .replace("{to}", toSec);

  const label = "CoinGecko market_chart/range";
  const body = jsonOf(fetchWithRetries(url, coinGeckoHeaders(), label), label);
  if (body === null) return null;

  const points = (Array.isArray(body.prices) ? body.prices : []).filter(
    (point) =>
      Array.isArray(point) &&
      typeof point[0] === "number" &&
      typeof point[1] === "number",
  );
  if (points.length === 0) {
    Logger.log("CoinGecko market_chart/range: No price data points");
    return null;
  }

  Logger.log(`CoinGecko market_chart/range: ${points.length} data points`);
  return pickFromPoints(points, utcMs, target);
}

/** The price a target reads from [time in ms, price] points: the average of the highest and the lowest, the highest, the lowest, or the one nearest the time for close */
function pickFromPoints(points, utcMs, target) {
  const values = points.map((point) => point[1]);
  if (target === "average")
    return (Math.max(...values) + Math.min(...values)) / 2;
  if (target === "high") return Math.max(...values);
  if (target === "low") return Math.min(...values);
  if (target !== "close") return null;
  const nearest = points.reduce((best, point) =>
    Math.abs(point[0] - utcMs) < Math.abs(best[0] - utcMs) ? point : best,
  );
  return nearest[1];
}

/** The day's price from CoinGecko's history, which names it market_data.current_price: the price on the date asked, not today's */
function tryCoinGeckoHistory(id, dateStr) {
  const url = CONFIG.COINGECKO_HISTORY_TEMPLATE.replace(
    "{base}",
    CONFIG.COINGECKO_BASE,
  )
    .replace("{id}", id)
    .replace("{date}", dateStr);

  const label = "CoinGecko history";
  const body = jsonOf(fetchWithRetries(url, coinGeckoHeaders(), label), label);
  if (body === null) return null;

  const price = body.market_data?.current_price?.usd;
  return typeof price === "number" && price > 0 ? price : null;
}

/**
 * The headers of a request to CoinGecko: the demo api key's, when CONFIG
 * sets a key, else none.
 */
function coinGeckoHeaders() {
  const key = configuredKey(CONFIG.COINGECKO_API_KEY);
  return key === null ? {} : { [CONFIG.COINGECKO_API_KEY_HEADER]: key };
}

/** ============================================================================
 *                          COINPAPRIKA
 * ========================================================================== */

/**
 * A token's price on a day from CoinPaprika: from the day's candle, or
 * else, for close alone, from the day's single price.
 *
 * @param {string} id - The token's CoinPaprika id, such as "btc-bitcoin"
 * @param {number} utcMs - The time, in ms since 1970 UTC, whose UTC day is asked
 * @param {string} target - The price to give: "average", "high", "low" or "close"
 * @returns {?number} The price in USD, or null when CoinPaprika has none for the day and target
 */
function getPriceFromCoinPaprika(id, utcMs, target) {
  Logger.log("Trying CoinPaprika for " + id);

  if (new Set(["grc-gridcoin"]).has(id)) {
    Logger.log(`Skipping CoinPaprika for inactive token: ${id}`);
    return null;
  }

  const access = coinPaprikaAccess();
  const day = Utilities.formatDate(new Date(utcMs), "UTC", "yyyy-MM-dd");
  const fromCandle = coinPaprikaCandlePrice(access, id, day, target);
  if (fromCandle.price !== null) {
    Logger.log(`CoinPaprika final price: ${fromCandle.price} (${target})`);
    return fromCandle.price;
  }
  if (!fromCandle.askDayPrice) return null;
  if (target !== "close") {
    Logger.log(
      `CoinPaprika's price for ${day} is one price, which answers close only, not ${target}`,
    );
    return null;
  }

  const price = coinPaprikaDayPrice(access, id, day);
  if (price !== null) {
    Logger.log(`CoinPaprika price for ${day} at 00:00 UTC: ${price}`);
  }
  return price;
}

/**
 * Where CoinPaprika is asked: its paid server, with the api key as the
 * whole Authorization header, when CONFIG sets a key; else its free
 * server, with no key.
 */
function coinPaprikaAccess() {
  const key = configuredKey(CONFIG.COINPAPRIKA_API_KEY);
  if (key === null) return { base: CONFIG.COINPAPRIKA_BASE, headers: {} };
  return {
    base: CONFIG.COINPAPRIKA_PRO_BASE,
    headers: { [CONFIG.COINPAPRIKA_API_KEY_HEADER]: key },
  };
}

/**
 * Reads the target's price from the day's candle (00:00 to 23:59:59 UTC).
 * Returns { price } from the candle, or price null with askDayPrice true
 * when the day's price may still answer: the plan does not reach the day
 * (status 402), or the day has no candle with the price. askDayPrice is
 * false when CoinPaprika answers otherwise: an id it does not know, a key
 * it refuses, an error.
 */
function coinPaprikaCandlePrice(access, id, day, target) {
  const url = CONFIG.COINPAPRIKA_OHLCV_TEMPLATE.replace("{base}", access.base)
    .replace("{id}", id)
    .replace("{start}", day)
    .replace("{end}", day);
  const label = "CoinPaprika OHLCV";
  const response = fetchWithRetries(url, access.headers, label);
  if (response.getResponseCode() === 402) {
    Logger.log(`CoinPaprika's plan does not reach the candle of ${day}`);
    return { price: null, askDayPrice: true };
  }
  const body = jsonOf(response, label);
  if (body === null) return { price: null, askDayPrice: false };

  const candle = (Array.isArray(body) ? body : []).find(
    (entry) =>
      typeof entry.time_open === "string" &&
      entry.time_open.slice(0, 10) === day,
  );
  const price = candle === undefined ? NaN : paprikaCandlePrice(candle, target);
  if (!Number.isFinite(price)) {
    Logger.log(`CoinPaprika has no ${target} in a candle of ${day}`);
    return { price: null, askDayPrice: true };
  }
  return { price, askDayPrice: false };
}

/** A CoinPaprika candle's price for a target: the average of its high and low, or its high, its low or its close; NaN for a price it leaves out */
function paprikaCandlePrice(candle, target) {
  const number = (value) =>
    value === null || value === undefined ? NaN : Number(value);
  if (target === "average")
    return (number(candle.high) + number(candle.low)) / 2;
  return number(candle[target]);
}

/** The day's price, which CoinPaprika records at 00:00 UTC, or null when it has none */
function coinPaprikaDayPrice(access, id, day) {
  const url = CONFIG.COINPAPRIKA_DAY_PRICE_TEMPLATE.replace(
    "{base}",
    access.base,
  )
    .replace("{id}", id)
    .replace("{date}", day);
  const label = "CoinPaprika day price";
  const body = jsonOf(fetchWithRetries(url, access.headers, label), label);
  if (body === null) return null;

  const tick = (Array.isArray(body) ? body : []).find(
    (entry) =>
      typeof entry.timestamp === "string" &&
      entry.timestamp.slice(0, 10) === day,
  );
  const price = tick === undefined ? NaN : Number(tick.price);
  if (!Number.isFinite(price) || price <= 0) {
    Logger.log(`CoinPaprika has no price for ${day}`);
    return null;
  }
  return price;
}
