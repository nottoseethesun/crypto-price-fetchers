/**
 * getCryptoPriceFromCentralizedExchange-sources.gs: the price sources of
 * getCryptoPriceFromCentralizedExchange.gs, MEXC, CoinGecko and CoinPaprika.
 *
 * Paste it into the same Apps Script project as
 * getCryptoPriceFromCentralizedExchange.gs, as a script file of its own:
 * Apps Script loads every script file of a project into one global scope,
 * so these functions read CONFIG, the cache and the date helpers declared
 * there, and getCryptoPrice calls them. The script is in three files to keep
 * each under LP Ranger's 500 lines of code; its header, in
 * getCryptoPriceFromCentralizedExchange.gs, says what it does.
 *
 * @see https://github.com/nottoseethesun/crypto-price-fetchers
 */

// Declared in getCryptoPriceFromCentralizedExchange.gs, in the same project:
/* global CONFIG, getCachedResult, setCachedResult, applySpread */

/** ============================================================================
 *                          PRICE PROVIDERS
 * ========================================================================== */

function getPriceFromMEXC(token, utcMs, target) {
  Logger.log(`Trying MEXC for ${token}`);

  if (new Set(["grc"]).has(token)) {
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
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  return res.getResponseCode() === 200
    ? JSON.parse(res.getContentText())
    : null;
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

/** Reads the high or the low of a kline candle */
function candlePrice(candle, target) {
  return target === "low" ? parseFloat(candle[3]) : parseFloat(candle[2]);
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
  Logger.log(`MEXC final price: ${price} (${target})`);
  return price;
}

function getPriceFromCoinGecko(id, utcMs, target) {
  Logger.log(`Trying CoinGecko for ${id} at ${new Date(utcMs).toISOString()}`);

  // Note: No separate lock here — the caller (getCryptoPrice) already holds the API_LOCK.
  // Acquiring it again would deadlock since GAS LockService is not re-entrant.

  const dateStr = Utilities.formatDate(new Date(utcMs), "UTC", "dd-MM-yyyy");

  // 1) Try market_chart/range with its own cache (independent of history)
  const rangeCacheKey = `gecko_range_${id}_${dateStr}_${target}`;
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

  // 2) Fall back to the day's price (history) with its own cache. Never the
  //    current price (tickers): that would put today's price on a past date.
  const dailyCacheKey = `gecko_daily_${id}_${dateStr}`;
  const dailyCached = getCachedResult(dailyCacheKey);
  if (typeof dailyCached === "number") return applySpread(dailyCached, target);
  if (typeof dailyCached === "string") return null;

  const price = tryCoinGeckoHistory(id, dateStr);
  if (price !== null) {
    Logger.log(`CoinGecko history success: ${price} USD for ${dateStr}`);
  }

  if (price !== null) {
    setCachedResult(dailyCacheKey, price);
    return applySpread(price, target);
  }

  setCachedResult(
    dailyCacheKey,
    "NO_DATA",
    CONFIG.CACHE_EXPIRY_SECONDS.NEGATIVE_CACHE,
  );
  return null;
}

/**
 * Fetches time-series prices from CoinGecko market_chart/range for a 24h window,
 * then returns the max (high) or min (low) from actual data points.
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

  const response = fetchWithRateLimitRetry(url, "market_chart/range");
  if (!response) return null;

  const prices = JSON.parse(response).prices;
  if (!prices || prices.length === 0) {
    Logger.log("CoinGecko market_chart/range: No price data points");
    return null;
  }

  Logger.log(`CoinGecko market_chart/range: ${prices.length} data points`);
  const values = prices.map((p) => p[1]);
  return target === "low" ? Math.min(...values) : Math.max(...values);
}

function tryCoinGeckoHistory(id, dateStr) {
  const url = CONFIG.COINGECKO_HISTORY_TEMPLATE.replace(
    "{base}",
    CONFIG.COINGECKO_BASE,
  )
    .replace("{id}", id)
    .replace("{date}", dateStr);

  const response = fetchWithRateLimitRetry(url, "history");
  if (!response) return null;

  const data = JSON.parse(response);
  return data.market_data?.current_price?.usd || null;
}

/**
 * The headers of a request to CoinGecko: the demo api key's, when the
 * Script Property holds a key, else none.
 */
function coinGeckoHeaders() {
  const key = PropertiesService.getScriptProperties().getProperty(
    CONFIG.COINGECKO_API_KEY_PROPERTY,
  );
  if (key === null || key.trim() === "") return {};
  return { [CONFIG.COINGECKO_API_KEY_HEADER]: key.trim() };
}

/** Fetches a CoinGecko URL, with the api key's header, retrying on 429 rate limit (up to 3 attempts) */
function fetchWithRateLimitRetry(url, label) {
  const headers = coinGeckoHeaders();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: headers,
    });
    const code = res.getResponseCode();

    if (code === 200) return res.getContentText();
    if (code === 429) {
      Logger.log(
        `CoinGecko 429 on ${label} - sleeping 5s (attempt ${attempt}/3)`,
      );
      Utilities.sleep(5000);
      continue;
    }
    Logger.log(`CoinGecko ${label} failed: HTTP ${code}`);
    return null;
  }
  return null;
}

function getPriceFromCoinPaprika(id, utcMs, highOrLow) {
  Logger.log("Trying CoinPaprika for " + id);

  if (new Set(["grc-gridcoin"]).has(id)) {
    Logger.log(`Skipping CoinPaprika for inactive token: ${id}`);
    return null;
  }

  const tickersUrl = CONFIG.COINPAPRIKA_TICKERS_TEMPLATE.replace(
    "{base}",
    CONFIG.COINPAPRIKA_BASE,
  ).replace("{id}", id);
  const response = UrlFetchApp.fetch(tickersUrl, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return null;
  const data = JSON.parse(response.getContentText());

  if (!data.quotes || !data.quotes.USD) return null;

  const start = utcMs / 1000 - 60;
  const end = utcMs / 1000;
  const ohlcvUrl = CONFIG.COINPAPRIKA_OHLCV_TEMPLATE.replace(
    "{base}",
    CONFIG.COINPAPRIKA_BASE,
  )
    .replace("{id}", id)
    .replace("{start}", Math.floor(start))
    .replace("{end}", Math.floor(end));
  const ohlcvRes = UrlFetchApp.fetch(ohlcvUrl, { muteHttpExceptions: true });
  if (ohlcvRes.getResponseCode() !== 200) return null;
  const ohlcv = JSON.parse(ohlcvRes.getContentText());

  if (!ohlcv || ohlcv.length === 0) return null;

  const price =
    highOrLow === "low" ? parseFloat(ohlcv[0].low) : parseFloat(ohlcv[0].high);
  Logger.log(`CoinPaprika final price: ${price} (${highOrLow})`);
  return price;
}
