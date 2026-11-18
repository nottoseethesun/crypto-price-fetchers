/**
 * CoinGecko price fetching logic for crypto-price-filler.
 *
 * A row asks for the price at a past time, so only CoinGecko's dated
 * sources answer, in this order:
 *
 * 1. market_chart/range: CoinGecko's prices over the 24 hours around the
 *    time, from 12 hours before to 12 hours after, cut off at now; for a
 *    range that short, CoinGecko gives one price an hour. high is their
 *    highest, low their lowest, and close the price nearest the time.
 * 2. history: CoinGecko's one price for the UTC day of the time, as at
 *    00:00 UTC. A single price has no high or low, so it answers close
 *    only; for high or low the provider chain goes on to CoinPaprika's
 *    candles, which have them.
 *
 * The live tickers are never asked: they give today's price, whatever the
 * date of the row. The day asked of history is the UTC day, whatever the
 * computer's clock is set to.
 *
 * Each request carries the CoinGecko demo api key the run opened, in the
 * `x-cg-demo-api-key` header, when it opened one (`index.js`, through
 * `api-key-store/` at the repo's top); without one, CoinGecko is asked
 * without a key.
 *
 * Handles rate-limit retry (in `fetchWithRetry`) and verbose logging.
 *
 * @module coingecko
 * @version 1.2.0
 * @author Christopher M. Balz with Grok and Claude.ai
 */

import { fetchWithRetry } from "../utils/fetch.js";
import config from "../config.js";
import {
  COINGECKO_KEY_HEADER,
  getApiKey,
} from "../../../api-key-store/index.js";

/** Half the window of prices asked around the time, in milliseconds. */
const HALF_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * Builds the verbose logger.
 *
 * @param {boolean} verbose - Whether to log
 * @returns {function(number, string, ...*): void} The logger
 */
function makeLogger(verbose) {
  return (level, message, ...args) => {
    if (!verbose || level < 1) return;
    console.log(`[VERBOSE:${level}] ${message}`, ...args);
  };
}

/**
 * The UTC day of a time, as CoinGecko's history takes it: dd-mm-yyyy.
 *
 * @param {number} utcMs - The time, in UTC milliseconds
 * @returns {string} The day
 */
export function utcDay(utcMs) {
  const date = new Date(utcMs);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getUTCFullYear()}`;
}

/**
 * Picks the price for the target from CoinGecko's `[time, price]` pairs:
 * the highest for high, the lowest for low, the one nearest the time for
 * close.
 *
 * @param {Array<Array<number>>} prices - The pairs, times in UTC milliseconds
 * @param {number} utcMs - The time asked, in UTC milliseconds
 * @param {string} target - high, low or close
 * @returns {number|null} The price, or null when there are no prices or the target is unknown
 */
export function pickFromPrices(prices, utcMs, target) {
  const points = (Array.isArray(prices) ? prices : []).filter(
    (point) =>
      Array.isArray(point) &&
      typeof point[0] === "number" &&
      typeof point[1] === "number",
  );
  if (points.length === 0) return null;
  const values = points.map((point) => point[1]);
  if (target === "high") return Math.max(...values);
  if (target === "low") return Math.min(...values);
  if (target !== "close") return null;
  const nearest = points.reduce((best, point) =>
    Math.abs(point[0] - utcMs) < Math.abs(best[0] - utcMs) ? point : best,
  );
  return nearest[1];
}

/**
 * Reads a JSON answer from CoinGecko, or null when there is none.
 *
 * @param {string} url - The url
 * @param {Object} options - Fetch options, with the api key's header when there is a key
 * @param {boolean} verbose - Enable verbose logging
 * @param {function} logv - The logger
 * @returns {Promise<Object|null>} The answer, or null
 */
async function readJson(url, options, verbose, logv) {
  logv(2, `CoinGecko request: ${url}`);
  try {
    const response = await fetchWithRetry(url, options, verbose);
    if (response === null || response === undefined || !response.ok)
      return null;
    return await response.json();
  } catch (err) {
    logv(1, `CoinGecko request failed: ${err.message}`);
    return null;
  }
}

/**
 * Fills in a CoinGecko url template.
 *
 * @param {string} template - The template, with {base} and other placeholders
 * @param {Object<string, (string|number)>} values - The placeholders' values, by name
 * @returns {string} The url
 */
function urlFrom(template, values) {
  return Object.entries({ base: config.COINGECKO_BASE, ...values }).reduce(
    (url, [name, value]) => url.replace(`{${name}}`, String(value)),
    template,
  );
}

/**
 * Fetch price from CoinGecko for a given token and timestamp.
 * @param {string} token - Token symbol (for logging/fallback)
 * @param {number} utcMs - Unix timestamp in milliseconds
 * @param {string} target - 'high', 'low', or 'close'
 * @param {boolean} verbose - Enable verbose logging
 * @param {string} [coingeckoId=token.toLowerCase()] - Resolved CoinGecko ID
 * @returns {Promise<number|null>} Price in USD or null
 */
export async function getPriceFromCoinGecko(
  token,
  utcMs,
  target = "close",
  verbose = false,
  coingeckoId = token.toLowerCase(),
) {
  const logv = makeLogger(verbose);
  const key = getApiKey("coingecko");
  const options =
    key === null ? {} : { headers: { [COINGECKO_KEY_HEADER]: key } };

  const fromSec = Math.floor((utcMs - HALF_WINDOW_MS) / 1000);
  const toSec = Math.floor(Math.min(utcMs + HALF_WINDOW_MS, Date.now()) / 1000);
  const rangeUrl = urlFrom(config.COINGECKO_MARKET_CHART_RANGE_TEMPLATE, {
    id: coingeckoId,
    from: fromSec,
    to: toSec,
  });
  const range = await readJson(rangeUrl, options, verbose, logv);
  const rangePrice =
    range === null ? null : pickFromPrices(range.prices, utcMs, target);
  if (rangePrice !== null) {
    logv(
      1,
      `CoinGecko market_chart/range success - ${target} price: ${rangePrice}`,
    );
    return rangePrice;
  }

  if (target !== "close") {
    logv(
      1,
      `CoinGecko has no dated ${target} for ${coingeckoId} - the day's single price answers close only`,
    );
    return null;
  }

  // Rate limit before the next request (skipped in tests)
  const rateLimitMs =
    process.env.NODE_ENV === "test"
      ? 0
      : config.COINGECKO_RATE_LIMIT_MS || 2000;
  if (rateLimitMs > 0)
    await new Promise((resolve) => setTimeout(resolve, rateLimitMs));

  const historyUrl = urlFrom(config.COINGECKO_HISTORY_TEMPLATE, {
    id: coingeckoId,
    date: utcDay(utcMs),
  });
  const history = await readJson(historyUrl, options, verbose, logv);
  const dayPrice = history?.market_data?.current_price?.usd;
  if (typeof dayPrice === "number" && dayPrice > 0) {
    logv(
      1,
      `CoinGecko history success - price for ${utcDay(utcMs)}: ${dayPrice}`,
    );
    return dayPrice;
  }

  logv(1, `CoinGecko both dated sources failed for ${coingeckoId}`);
  return null;
}
