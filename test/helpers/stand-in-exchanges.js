/**
 * How MEXC, an exchange, and CoinGecko and CoinPaprika, two services that
 * gather the exchanges' prices, answer the exchange script's requests in
 * the tests of its Node version: the roots of their apis, the time the
 * tests ask about, and stand-in answers for a stand-in fetch
 * (`stand-in-web.js`), each for one case, such as MEXC listing no pair and
 * CoinGecko's Pro api pricing the time.
 * @module test/helpers/stand-in-exchanges
 */

import { mexcKlines } from "./stand-in-mexc.js";

export const MEXC = "https://api.mexc.com/api/v3";
export const COINGECKO = "https://api.coingecko.com/api/v3";
export const COINGECKO_PRO = "https://pro-api.coingecko.com/api/v3";
export const COINPAPRIKA_PRO = "https://api-pro.coinpaprika.com/v1";

/** 12:30 UTC on 2025-06-15, the time the tests ask about. */
export const ROW_UTC_MS = Date.UTC(2025, 5, 15, 12, 30, 0);
export const ROW_TIME = "2025-06-15 12:30:00";

/**
 * Answers as MEXC does for XTM, a pair it lists: the candle of the minute
 * asked (`helpers/stand-in-mexc.js`), with open 1.00, high 1.50, low 0.80
 * and close 1.10.
 *
 * @param {{url: string}} request - The request
 * @returns {Object|Array|null} The json body, or null for a 404
 */
export function answerMexcCandle({ url }) {
  if (url === `${MEXC}/exchangeInfo`)
    return {
      symbols: [{ symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" }],
    };
  if (url.startsWith(`${MEXC}/klines?symbol=XTMUSDT&interval=1m&`)) {
    return mexcKlines(url, ["1.00", "1.50", "0.80", "1.10", "10"]);
  }
  return null;
}

/**
 * Answers for when MEXC lists no XTM pair and CoinGecko's hourly prices
 * around the time are 2.00 and 2.50. CoinGecko's ping takes the key
 * `gecko-key` alone.
 *
 * @param {{url: string, headers: Object<string, string>}} request - The request
 * @returns {*} The response (`standInFetch`)
 */
export function answerCoinGeckoRange({ url, headers }) {
  if (url === `${MEXC}/exchangeInfo`) return { symbols: [] };
  if (url === `${COINGECKO}/ping`) {
    return headers["x-cg-demo-api-key"] === "gecko-key"
      ? { gecko_says: "(V3) To the Moon!" }
      : { status: 401, text: "{}" };
  }
  if (url.startsWith(`${COINGECKO}/coins/minotari/market_chart/range?`)) {
    return {
      prices: [
        [ROW_UTC_MS - 3600000, 2.0],
        [ROW_UTC_MS + 3600000, 2.5],
      ],
    };
  }
  return null;
}

/**
 * Answers for when MEXC lists no XTM pair and CoinGecko's Pro api, asked
 * with the paid plan's key `gecko-key` in its header, gives hourly prices
 * around the time of 2.00 and 2.50; its public api answers nothing.
 *
 * @param {{url: string, headers: Object<string, string>}} request - The request
 * @returns {*} The response (`standInFetch`)
 */
export function answerCoinGeckoProRange({ url, headers }) {
  if (url === `${MEXC}/exchangeInfo`) return { symbols: [] };
  if (!url.startsWith(COINGECKO_PRO)) return null;
  if (headers["x-cg-pro-api-key"] !== "gecko-key")
    return { status: 401, text: "{}" };
  if (url.startsWith(`${COINGECKO_PRO}/coins/minotari/market_chart/range?`)) {
    return {
      prices: [
        [ROW_UTC_MS - 3600000, 2.0],
        [ROW_UTC_MS + 3600000, 2.5],
      ],
    };
  }
  return null;
}

/**
 * Answers for when MEXC lists no XTM pair, CoinGecko has no hourly prices,
 * and only CoinPaprika's paid server, asked with the key `paprika-key`,
 * gives XTM's candle of 2025-06-15, with high 2.50. The paid server's key
 * facts take that key alone.
 *
 * @param {{url: string, headers: Object<string, string>}} request - The request
 * @returns {*} The response (`standInFetch`)
 */
export function answerPaprikaPaid({ url, headers }) {
  if (url === `${MEXC}/exchangeInfo`) return { symbols: [] };
  if (url.startsWith(`${COINGECKO}/coins/minotari/market_chart/range?`))
    return { prices: [] };
  if (!url.startsWith(COINPAPRIKA_PRO)) return null;
  if (headers.authorization !== "paprika-key")
    return { status: 403, text: "{}" };
  if (url === `${COINPAPRIKA_PRO}/key/info`) return { plan: "starter" };
  if (url.startsWith(`${COINPAPRIKA_PRO}/coins/xtm-tari/ohlcv/historical?`)) {
    return [
      {
        time_open: "2025-06-15T00:00:00Z",
        time_close: "2025-06-15T23:59:59Z",
        high: 2.5,
        low: 2.0,
        close: 2.2,
      },
    ];
  }
  return null;
}

/**
 * The CoinGecko key each request to CoinGecko carried, by its path.
 *
 * @param {function} fetch - The stand-in fetch
 * @returns {Array<Array<string>>} Each request's path and key (null when it had none)
 */
export function coinGeckoKeysSent(fetch) {
  return fetch.requests
    .filter((request) => request.url.startsWith(COINGECKO))
    .map((request) => [
      new URL(request.url).pathname,
      request.headers["x-cg-demo-api-key"] ?? null,
    ]);
}
