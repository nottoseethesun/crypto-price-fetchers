/**
 * GeckoTerminal as a price source of crypto-price-filler: a token that
 * trades in pools, priced from the candle that holds a row's time.
 * @module geckoterminal
 *
 * What: `getPriceFromGeckoTerminal` gives the high, low or close, in USD,
 * of the candle that holds the row's time: the minute's candle, or the
 * hour's when nothing traded in that minute, as the MEXC source reads its
 * candles. GeckoTerminal's public api serves the last 180 days only, so an
 * older time gets null, and the provider chain asks CoinGecko.
 *
 * How: the pool is the one LP Ranger would read the token's price from:
 * of the first `GECKOTERMINAL_TOP_POOLS_CONSIDERED` pools GeckoTerminal
 * ranks for the token (`config-example.json`), the deepest that traded
 * over the last day and holds the token on one of its sides. The pool and
 * the token's side of it are looked up once a run and kept in the run's
 * cache (`utils/cache.js`), under a key that leads with the chain. A
 * period's candle is asked as the newest candle of that side that opened
 * before the period ended, and taken only if it opened when the period
 * began, since GeckoTerminal makes no candle for a period with no trade.
 * Every request goes through the shared GeckoTerminal client
 * (`dex-prices/geckoterminal.js`, at the repo's top), which keeps the
 * process within GeckoTerminal's budget of requests. An error is logged
 * when verbose and answered with null.
 *
 * Fit: `sources/price.js` asks it after Moralis (`sources/moralis.js`) for
 * a token that names its contract and GeckoTerminal's id for its chain in
 * `supported-tokens.json`, and before the exchange sources.
 *
 * @version 1.0.0
 * @author Christopher M. Balz with Claude
 */

import {
  TIMEFRAME_SECONDS,
  bestPool,
  candleAt,
  candlePage,
  candlePrice,
  geckoTerminalSettings,
  tokenPools,
} from "../../../dex-prices/geckoterminal.js";
import config from "../config.js";
import { getCache, setCache } from "../utils/cache.js";

/** The timeframes whose candles price a time, in the order asked. */
const TIMEFRAMES = Object.freeze(["minute", "hour"]);

/**
 * Logs a message when verbose, at a level of one or more.
 *
 * @param {boolean} shouldLog - Whether to log
 * @param {number} level - The message's level
 * @param {string} message - The message
 */
function logv(shouldLog, level, message) {
  if (!shouldLog || level < 1) return;
  console.log(`[VERBOSE:${level}] ${message}`);
}

/**
 * The pool to read a token's price from, and the token's side of it, from
 * the run's cache or, the first time, from GeckoTerminal.
 *
 * @param {import('./moralis.js').PoolToken} token - The token
 * @param {Object} settings - How to ask GeckoTerminal (`geckoTerminalSettings`)
 * @returns {Promise<{address: string, side: string}|null>} The pool's address and the token's side, or null when no pool qualifies
 */
async function poolFor(token, settings) {
  const cacheKey = `${token.network}_geckoterminal_pool_${token.contract.toLowerCase()}`;
  const cached = getCache(cacheKey);
  if (cached !== undefined) return cached;
  const pools = await tokenPools(
    { network: token.network, token: token.contract },
    settings,
  );
  const best = bestPool(pools, config.GECKOTERMINAL_TOP_POOLS_CONSIDERED);
  const pool =
    best === null ? null : { address: best.address, side: best.side };
  setCache(cacheKey, pool);
  return pool;
}

/**
 * Prices a token at a time from the GeckoTerminal candle that holds it.
 *
 * @param {import('./moralis.js').PoolToken} token - The token
 * @param {number} utcMs - The time, in UTC milliseconds
 * @param {string} [target='close'] - 'high', 'low' or 'close'
 * @param {boolean} [verbose=false] - Whether to log
 * @returns {Promise<number|null>} The price in USD, or null when GeckoTerminal cannot give it
 */
export async function getPriceFromGeckoTerminal(
  token,
  utcMs,
  target = "close",
  verbose = false,
) {
  const settings = geckoTerminalSettings();
  const seconds = Math.floor(utcMs / 1000);
  try {
    const pool = await poolFor(token, settings);
    if (pool === null) {
      logv(
        verbose,
        1,
        `GeckoTerminal has no trading pool for ${token.contract}`,
      );
      return null;
    }
    for (const timeframe of TIMEFRAMES) {
      const step = TIMEFRAME_SECONDS[timeframe];
      const page = await candlePage(
        {
          network: token.network,
          pool: pool.address,
          timeframe,
          token: pool.side,
          beforeSeconds: seconds - (seconds % step) + step,
          limit: 1,
        },
        settings,
      );
      if (page.outOfReach) {
        logv(verbose, 1, "GeckoTerminal serves the last 180 days only");
        return null;
      }
      const candle = candleAt(page.candles, seconds, timeframe);
      if (candle !== null) return candlePrice(candle, target);
    }
    logv(verbose, 1, `GeckoTerminal has no candle for ${token.contract} then`);
    return null;
  } catch (err) {
    logv(verbose, 1, `GeckoTerminal failed: ${err.message}`);
    return null;
  }
}
