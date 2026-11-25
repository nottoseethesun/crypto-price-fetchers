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
 * runs on Node, calls the three sources itself, through bin/end-user/getCryptoPriceFromCentralizedExchange.js,
 * so they are its price sources too.
 *
 * @see https://github.com/nottoseethesun/crypto-price-fetchers
 */

// Declared in getCryptoPriceFromCentralizedExchange.gs, in the same project:
/* global CONFIG, CALL, callHasTimeFor, getCachedResult, setCachedResult, waitInCall, mexcWindowOver, coinGeckoWindowEndMs, coinGeckoServesDayEnd, coinPaprikaDayEndMs, coinPaprikaCanGive */

/** ============================================================================
 *                          REQUESTS
 * ========================================================================== */

/**
 * Asks a url, and asks it again after each wait in CONFIG.RETRY_DELAYS_MS
 * while the provider refuses it as one too many (status 429), within the
 * time the call has left (callHasTimeFor). Returns the last response,
 * whatever its status; or null when the request got no response at all,
 * for which UrlFetchApp.fetch throws, as on a timeout, a refused
 * connection or Apps Script's own quota of requests, or the call had no
 * time left to send it. A refusal as one too many still there after the
 * last try, or one the call has no time left to wait out, an answer with a
 * server error (5xx) or a request timeout (408), a request with no
 * response, and a request it has no time to send are counted as cut short
 * (CALL.cutRequests): the source then answers nothing, which is no answer
 * to keep, since none of them says whether it has a price.
 */
function fetchWithRetries(url, headers, label) {
  const delays = CONFIG.RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    if (!callHasTimeFor(0)) {
      Logger.log(`${label}: the call has used its time, so it is not sent`);
      CALL.cutRequests += 1;
      return null;
    }
    let response;
    try {
      response = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: headers,
      });
    } catch (e) {
      Logger.log(`${label} got no response: ${e.message}`);
      CALL.cutRequests += 1;
      return null;
    }
    const code = response.getResponseCode();
    if (code >= 500 || code === 408) {
      Logger.log(`${label} answered ${code}, which says nothing of its data`);
      CALL.cutRequests += 1;
      return response;
    }
    if (code !== 429) return response;
    if (attempt >= delays.length || !callHasTimeFor(delays[attempt])) {
      Logger.log(
        attempt >= delays.length
          ? `${label} answered 429 to every try`
          : `${label} answered 429, and the call has no time left to wait`,
      );
      CALL.cutRequests += 1;
      return response;
    }
    Logger.log(
      `${label} answered 429 - waiting ${delays[attempt]} ms (try ${attempt + 2} of ${delays.length + 1} next)`,
    );
    waitInCall(delays[attempt]);
  }
}

/** The json body of a response with status 200, or null for any other status, a body that is not json, or no response */
function jsonOf(response, label) {
  if (response === null) return null;
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
 * @returns {?number} The price in USD, or null when MEXC lists no pair for the token, keeps no candle that can price the time (as before it listed the pair), the window that would price it is not over, or nothing traded in the year that holds the time
 */
function getPriceFromMEXC(token, utcMs, target) {
  Logger.log(`Trying MEXC for ${token}`);

  if (mexcSkips(token)) {
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

/**
 * Whether the script asks MEXC nothing for a token: GridCoin, which MEXC
 * does not list.
 *
 * @param {string} token - The token's symbol, such as "btc"
 * @returns {boolean} Whether MEXC is skipped for it
 */
function mexcSkips(token) {
  return new Set(["grc"]).has(token.toLowerCase());
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
 * nothing traded with volume 0. A window not yet over holds only the
 * trades made so far, so its prices can still change: the script asks for
 * none (mexcWindowOver), and MEXC gives no price.
 * The larger windows may hold only trades from after the time when the
 * time comes before the pair's first trade, which happens only on the day
 * MEXC listed the pair, or before it; a candle of the day before shows the
 * pair traded before that day. So for a recent time whose minute MEXC
 * gives no candle of, as for a minute before the first trade, a minute it
 * let go at the start of the days it keeps minute candles, or a failed
 * request, the script asks for the day before: with a candle, it asks for
 * the hour; with none, the time comes before the first trade, and MEXC
 * gives no price. When MEXC gives no candle of the hour, the day before
 * decides the same way: with a candle, the hour is older than the hour
 * candles MEXC keeps, or its request failed, and the script goes up from
 * the 2 hours; with none, MEXC gives no price. When the request for the
 * day before fails, the script cannot tell whether the time comes before
 * the first trade, and MEXC gives no price. A failed request for a larger
 * window, in which something traded before the time, leaves the script to
 * go on up.
 *
 * @param {string} symbol - The MEXC pair, such as XTMUSDT
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @param {string} target - The price to give: "average", "high", "low" or "close"
 * @return {?{window: Object, averaged: boolean, price: number}} The price, its window, and whether it is the average of the window's high and low; or null when the script asks for the day before, as above, and MEXC gives no candle of it or fails the request, or MEXC gives no candle of the day that holds the time, the window it would ask for is not over, or nothing traded in the year that holds it
 */
function mexcPairPrice(symbol, utcMs, target) {
  let dayBefore;
  /** Whether MEXC gives a candle of the day before, asked once. */
  const keptDayBefore = () => {
    if (dayBefore === undefined) dayBefore = mexcKeptDayBefore(symbol, utcMs);
    return dayBefore;
  };
  /** Logs why MEXC gives no price, as the day before decided, and says so. */
  const noPriceFor = (what) => {
    Logger.log(
      dayBefore === false
        ? `MEXC: no candle of ${symbol} for the ${what} that holds the time, nor for the day before, so the time comes before the pair's first trade, and MEXC gives no price for it`
        : `MEXC: no candle of ${symbol} for the ${what} that holds the time, and the request for the day before failed, so the script cannot tell whether the time comes before the pair's first trade, and MEXC gives no price for it`,
    );
    return null;
  };
  let level = 0;
  if (!mexcWindowOver(MEXC_WINDOWS[0], utcMs)) return null;
  let candle = fetchWindowCandle(symbol, MEXC_WINDOWS[0], utcMs);
  if (candle === null) {
    if (Date.now() - utcMs <= MEXC_MINUTES_KEPT_MS && keptDayBefore() !== true)
      return noPriceFor("minute");
    level = 1;
    if (!mexcWindowOver(MEXC_WINDOWS[1], utcMs)) return null;
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
  if (candle === null && keptDayBefore() !== true) return noPriceFor("hour");
  for (level += 1; level < MEXC_WINDOWS.length; level++) {
    const window = MEXC_WINDOWS[level];
    if (!mexcWindowOver(window, utcMs)) return null;
    const candles = fetchWindowCandles(symbol, window, utcMs);
    candle = joinedCandle(candles);
    if (candle !== null && candle.volume > 0) {
      return { window, averaged: true, price: priceOf(candle, "average") };
    }
    if (candles !== null && candles.length === 0 && window.name === "day") {
      Logger.log(
        `MEXC: no candle of ${symbol} for the day that holds the time, so MEXC gives no price for it`,
      );
      return null;
    }
  }
  Logger.log(
    `MEXC: nothing traded in ${symbol} in the year that holds the time`,
  );
  return null;
}

/** How long MEXC keeps a pair's minute candles: about 30 days, and a day more. */
const MEXC_MINUTES_KEPT_MS = 31 * MEXC_DAY_MS;

/**
 * Whether MEXC keeps a candle of a pair for the day before the one that
 * holds a time, as it does once the pair traded before that day.
 *
 * @param {string} symbol - The MEXC pair
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @return {?boolean} Whether MEXC gives a candle of the day before, or null when the request fails
 */
function mexcKeptDayBefore(symbol, utcMs) {
  const day = MEXC_WINDOWS.find((window) => window.name === "day");
  const { start, end } = day.bounds(utcMs - MEXC_DAY_MS);
  const candles = fetchKlines(symbol, day.interval, start, end, day.candles);
  return candles === null ? null : candles.length > 0;
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
 * @return {?{high: number, low: number, close: number, volume: number}} The candle, or null when MEXC keeps none of the window or the request fails
 */
function fetchWindowCandle(symbol, window, utcMs) {
  return joinedCandle(fetchWindowCandles(symbol, window, utcMs));
}

/**
 * The candles of a window that holds a time, as MEXC answers for it:
 * none when it keeps none of the window, and null when the request
 * fails, which says nothing of the candles MEXC keeps.
 *
 * @param {string} symbol - The MEXC pair
 * @param {Object} window - One of MEXC_WINDOWS
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @return {?Array<Array>} The candles, oldest first, or null when the request fails
 */
function fetchWindowCandles(symbol, window, utcMs) {
  const { start, end } = window.bounds(utcMs);
  const candles = fetchKlines(
    symbol,
    window.interval,
    start,
    end,
    window.candles,
  );
  if (candles !== null && candles.length === 0) {
    Logger.log(
      `MEXC keeps no candle of the ${window.name} that holds the time`,
    );
  }
  return candles;
}

/**
 * A window's candles joined into one: the highest high, the lowest low,
 * the last close and the volumes summed.
 *
 * @param {?Array<Array>} candles - The candles, oldest first, or null when the request failed
 * @return {?{high: number, low: number, close: number, volume: number}} The candle, or null when there is none
 */
function joinedCandle(candles) {
  if (candles === null || candles.length === 0) return null;
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
 * window centred on the time, or else, for close alone, from its single
 * price of the next day, at 00:00 UTC, which ends the time's UTC day, once
 * CoinGecko serves it (coinGeckoServesDayEnd). Each answer is cached, and
 * so is the lack of one, unless
 * the request was cut short (CALL.cutRequests): a request with no answer,
 * or one not sent, is no sign that CoinGecko has none. While the window
 * is not over (`coinGeckoWindowEndMs`), it asks nothing and gives null,
 * since a price from part of the window could still change.
 *
 * @param {string} id - The token's CoinGecko id, such as "bitcoin"
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @param {string} target - The price to give: "average", "high", "low" or "close"
 * @returns {?number} The price in USD, or null when CoinGecko has none for the time and target, the window around the time is not over yet, or, for close from the next day's price, CoinGecko does not serve that price yet
 */
function getPriceFromCoinGecko(id, utcMs, target) {
  Logger.log(`Trying CoinGecko for ${id} at ${new Date(utcMs).toISOString()}`);
  if (Date.now() < coinGeckoWindowEndMs(utcMs)) {
    Logger.log(
      `CoinGecko: the 24 hours around the time end at ${new Date(coinGeckoWindowEndMs(utcMs)).toISOString()}, after now, so it gives no price yet`,
    );
    return null;
  }

  /*-
   *  No lock of its own: in the sheet, the caller, getCryptoPrice, holds
   *  the script lock. The lock keeps no count, so asking for it again has
   *  no effect, and releasing it here would end the caller's hold too.
   */

  const nextDay = new Date(utcMs + 86400000);
  const dateStr = Utilities.formatDate(nextDay, "UTC", "dd-MM-yyyy");

  /*-
   *  1) Try market_chart/range with its own cache, kept for the time
   *  asked: its window is centred on that time, so two times of one day
   *  differ.
   */
  const rangeCacheKey = `gecko_range_${id}_${Math.floor(utcMs / 1000)}_${target}`;
  const rangeCached = getCachedResult(rangeCacheKey);
  if (typeof rangeCached === "number") return rangeCached;

  if (typeof rangeCached !== "string") {
    const cutBeforeRange = CALL.cutRequests;
    const rangePrice = tryCoinGeckoMarketChartRange(id, utcMs, target);
    if (rangePrice !== null) {
      Logger.log(
        `CoinGecko market_chart/range success: ${rangePrice} USD (${target})`,
      );
      setCachedResult(rangeCacheKey, rangePrice);
      return rangePrice;
    }
    keepNoData(rangeCacheKey, cutBeforeRange);
  }

  /*-
   *  2) Fall back to a day's price (history) with its own cache: that of
   *  the day after the time's, recorded at 00:00 UTC, which ends the
   *  time's day, as a close does, so the date asked is the next day's, on
   *  purpose. One price is not a range, so it answers close only. Never
   *  the current price (tickers): that would put today's price on a past
   *  date.
   */
  if (target !== "close") {
    Logger.log(
      `CoinGecko has no dated ${target} for ${id}: the day's single price answers close only`,
    );
    return null;
  }
  if (!coinGeckoServesDayEnd(utcMs)) return null;
  const dailyCacheKey = `gecko_daily_${id}_${dateStr}`;
  const dailyCached = getCachedResult(dailyCacheKey);
  if (typeof dailyCached === "number") return dailyCached;
  if (typeof dailyCached === "string") return null;

  const cutBeforeDay = CALL.cutRequests;
  const price = tryCoinGeckoHistory(id, dateStr);
  if (price !== null) {
    Logger.log(`CoinGecko history success: ${price} USD for ${dateStr}`);
    setCachedResult(dailyCacheKey, price);
    return price;
  }

  keepNoData(dailyCacheKey, cutBeforeDay);
  return null;
}

/**
 * Keeps CoinGecko's lack of an answer for a key, for NEGATIVE_CACHE
 * seconds, unless the request asked for it was cut short, whose silence is
 * no answer.
 *
 * @param {string} key - The cache key
 * @param {number} cutBefore - CALL.cutRequests as the request was sent
 */
function keepNoData(key, cutBefore) {
  if (CALL.cutRequests > cutBefore) {
    Logger.log(
      `CoinGecko: its request was cut short, so its lack of an answer is not kept (${key})`,
    );
    return;
  }
  setCachedResult(key, "NO_DATA", CONFIG.CACHE_EXPIRY_SECONDS.NEGATIVE_CACHE);
}

/**
 * CoinGecko's hourly prices of a coin between two times, from
 * market_chart/range, as [time in ms, price] points.
 *
 * @param {string} id - The coin's CoinGecko id, such as "bitcoin"
 * @param {number} fromSec - The first time, in unix seconds
 * @param {number} toSec - The last time, in unix seconds
 * @returns {?Array<Array<number>>} The points, none when CoinGecko has none; null when the request failed, as for an id CoinGecko does not know, or was cut short
 */
function coinGeckoRangePoints(id, fromSec, toSec) {
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

  return (Array.isArray(body.prices) ? body.prices : []).filter(
    (point) =>
      Array.isArray(point) &&
      typeof point[0] === "number" &&
      typeof point[1] === "number",
  );
}

/**
 * Whether CoinGecko has prices of a coin in the part of a time's window
 * already over, from 12 hours before the time to now, which tells a coin
 * it prices from a ticker no coin has, for a time whose window is not
 * over (`fetchPriceFromProviders`). A request cut short counts in
 * CALL.cutRequests, as every request does.
 *
 * @param {string} id - The coin's CoinGecko id, such as "bitcoin"
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @returns {boolean} Whether it has any
 */
function coinGeckoHasPricesSoFar(id, utcMs) {
  const points = coinGeckoRangePoints(
    id,
    Math.floor((utcMs - 43200000) / 1000),
    Math.floor(Date.now() / 1000),
  );
  return points !== null && points.length > 0;
}

/**
 * Fetches time-series prices from CoinGecko market_chart/range for a 24h
 * window centred on the time, then returns the average of the highest and
 * the lowest of the data points for average, the highest for high, the
 * lowest for low, or the one nearest the time for close.
 * Returns null on failure.
 */
function tryCoinGeckoMarketChartRange(id, utcMs, target) {
  const points = coinGeckoRangePoints(
    id,
    Math.floor((utcMs - 43200000) / 1000), // 12h before
    Math.floor(coinGeckoWindowEndMs(utcMs) / 1000), // 12h after
  );
  if (points === null) return null;
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
 * Whether the script asks CoinPaprika nothing for a token: GridCoin, which
 * CoinPaprika lists as inactive (`is_active` false), with no price.
 *
 * @param {string} id - The token's CoinPaprika id, such as "btc-bitcoin"
 * @returns {boolean} Whether CoinPaprika is skipped for it
 */
function coinPaprikaSkips(id) {
  return new Set(["grc-gridcoin"]).has(id);
}

/**
 * A token's price on a day from CoinPaprika: from the day's candle, or
 * else, for close alone, from its price at 00:00 UTC the next day, which
 * ends the day. While the UTC day
 * that holds the time is not over (`coinPaprikaDayEndMs`), it asks
 * nothing and gives null, since the day's candle can still change; nor,
 * without a key, for an average, a high or a low (`coinPaprikaCanGive`).
 *
 * @param {string} id - The token's CoinPaprika id, such as "btc-bitcoin"
 * @param {number} utcMs - The time, in ms since 1970 UTC, whose UTC day is asked
 * @param {string} target - The price to give: "average", "high", "low" or "close"
 * @returns {?number} The price in USD, or null when CoinPaprika has none for the day and target, or the day is not over yet
 */
function getPriceFromCoinPaprika(id, utcMs, target) {
  Logger.log("Trying CoinPaprika for " + id);
  if (!coinPaprikaCanGive(target)) {
    Logger.log(
      `CoinPaprika: without a key it gives a day's close alone, not ${target}`,
    );
    return null;
  }
  if (Date.now() < coinPaprikaDayEndMs(utcMs)) {
    Logger.log(
      `CoinPaprika: the UTC day of the time ends at ${new Date(coinPaprikaDayEndMs(utcMs)).toISOString()}, after now, so it gives no price yet`,
    );
    return null;
  }

  if (coinPaprikaSkips(id)) {
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

  /*-
   *  A day's close is its price at its end, 24:00 UTC, which is 00:00 UTC
   *  of the next day, so the date asked here is the day after the time's,
   *  on purpose. CoinPaprika's free server, asked without a key, keeps a
   *  candle only for the 24 hours after the candle begins, so it holds no
   *  candle of a day already over, but it keeps each day's price at 00:00
   *  UTC for 365 days: the next day's gives a past day's close without a
   *  key, and, beyond a paid plan's candles, with one.
   */
  const nextDay = Utilities.formatDate(
    new Date(utcMs + 86400000),
    "UTC",
    "yyyy-MM-dd",
  );
  const price = coinPaprikaDayPrice(access, id, nextDay);
  if (price !== null) {
    Logger.log(
      `CoinPaprika's close of ${day}: its price at 00:00 UTC on ${nextDay}, ${price}`,
    );
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
 * when the price at 00:00 UTC the next day, which ends the day, may still
 * answer close: the plan does not reach the day
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
  if (response === null) return { price: null, askDayPrice: false };
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
