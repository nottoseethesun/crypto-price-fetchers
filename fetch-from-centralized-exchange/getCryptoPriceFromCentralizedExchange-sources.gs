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

/** The field of a kline candle, [open time, open, high, low, close, volume, ...], that each target reads */
const MEXC_CANDLE_FIELD = { high: 2, low: 3, close: 4 };

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

  const data = fetchMEXCKlineData(pairInfo.symbol, utcMs);
  if (!data) return null;

  return extractMEXCPrice(data, target, pairInfo.useBTC, utcMs);
}

/** Fetches MEXC exchange symbols list */
function fetchMEXCSymbols() {
  const url = CONFIG.EXCHANGE_BASE_URL + "/exchangeInfo";
  const label = "MEXC exchangeInfo";
  const body = jsonOf(fetchWithRetries(url, {}, label), label);
  return body === null ? null : body.symbols || [];
}

/** Finds USDT or BTC trading pair for token */
function findMEXCTradingPair(token, symbols) {
  const upperToken = token.toUpperCase();
  let symbol = null;
  let useBTC = false;

  for (const sym of symbols) {
    if (sym.baseAsset.toUpperCase() !== upperToken) continue;
    if (sym.quoteAsset === "USDT") {
      return { symbol: upperToken + "USDT", useBTC: false };
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

/** Fetches kline data, trying 1m then 60m interval */
function fetchMEXCKlineData(symbol, utcMs) {
  // Try 1-minute interval first
  let data = fetchKline(symbol, CONFIG.DEFAULT_INTERVAL, utcMs - 60000, utcMs);
  if (isValidKlineData(data, utcMs)) return data;

  // Fallback to 60-minute interval
  data = fetchKline(symbol, CONFIG.FALLBACK_INTERVAL, utcMs - 3600000, utcMs);
  return data && data.length > 0 ? data : null;
}

/** Fetches single kline candle */
function fetchKline(symbol, interval, startTime, endTime) {
  const url = `${CONFIG.EXCHANGE_BASE_URL}/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1`;
  const label = `MEXC ${interval} klines`;
  const data = jsonOf(fetchWithRetries(url, {}, label), label);
  return Array.isArray(data) ? data : null;
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

/** Reads the high, the low or the close of a kline candle */
function candlePrice(candle, target) {
  return parseFloat(candle[MEXC_CANDLE_FIELD[target]]);
}

/**
 * Extracts price from kline data. A BTC pair's price is converted to USD
 * with BTC/USDT's candle at the same time, never the current BTC price.
 */
function extractMEXCPrice(data, target, useBTC, utcMs) {
  let price = candlePrice(data[0], target);
  if (useBTC) {
    const btcData = fetchMEXCKlineData("BTCUSDT", utcMs);
    if (!btcData) return null;
    price *= candlePrice(btcData[0], target);
  }
  if (!Number.isFinite(price)) {
    Logger.log(`MEXC candle gave no ${target} price`);
    return null;
  }
  Logger.log(`MEXC final price: ${price} (${target})`);
  return price;
}

/** ============================================================================
 *                          COINGECKO
 * ========================================================================== */

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
 * window centred on the time, then returns the highest of the data points
 * for high, the lowest for low, or the one nearest the time for close.
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

/** The price a target reads from [time in ms, price] points: the highest, the lowest, or the one nearest the time for close */
function pickFromPoints(points, utcMs, target) {
  const values = points.map((point) => point[1]);
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
  const price = candle === undefined ? NaN : Number(candle[target]);
  if (
    candle === undefined ||
    candle[target] === null ||
    !Number.isFinite(price)
  ) {
    Logger.log(`CoinPaprika has no ${target} in a candle of ${day}`);
    return { price: null, askDayPrice: true };
  }
  return { price, askDayPrice: false };
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
