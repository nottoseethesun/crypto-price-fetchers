/**
 * A stand-in GeckoTerminal for the tests of `dex-prices/geckoterminal.js`.
 * @module test/helpers/gecko-terminal-stand-in
 *
 * `standIn` gives the client's settings with a stand-in fetch
 * (`stand-in-web.js`) that answers as the test says, a budget record of
 * their own, and waits recorded rather than waited. `answerCandles`
 * answers a candle request as GeckoTerminal does, from candles a test
 * builds with `hourlyCandles`, and `paramsOf` reads a request's query.
 * Nothing outside the computer is asked.
 */

import {
  PUBLIC_HISTORY_SECONDS,
  TIMEFRAME_SECONDS,
  geckoTerminalSettings,
} from "../../dex-prices/geckoterminal.js";
import { standInFetch } from "./stand-in-web.js";

/** The stand-in api's address. */
export const API = "https://gecko.test/api/v2";

/** An hour, in seconds. */
export const HOUR = TIMEFRAME_SECONDS.hour;

/**
 * Settings that ask a stand-in GeckoTerminal, count requests in a budget
 * record of their own, and record the waits.
 *
 * @param {function(Object): *} answer - The stand-in's answer to a request
 * @returns {{settings: Object, fetch: Function, waits: number[]}} The settings, the fetch, and the waits
 */
export function standIn(answer) {
  const fetch = standInFetch(answer);
  const waits = [];
  const settings = geckoTerminalSettings({
    apiUrl: API,
    fetch,
    requestLog: [],
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  return { settings, fetch, waits };
}

/**
 * The query parameters of a request.
 *
 * @param {Object} request - The request the stand-in answered
 * @returns {URLSearchParams} Its parameters
 */
export function paramsOf(request) {
  return new URL(request.url).searchParams;
}

/**
 * A pool's candles as GeckoTerminal sends them, one an hour from a time,
 * each priced at its index plus one.
 *
 * @param {number} firstOpen - The first candle's open time, in unix seconds
 * @param {number} count - How many candles
 * @returns {Array<Array<number>>} The candles, oldest first
 */
export function hourlyCandles(firstOpen, count) {
  return Array.from({ length: count }, (_, index) => {
    const price = index + 1;
    return [
      firstOpen + index * HOUR,
      price,
      price + 0.5,
      price - 0.5,
      price,
      10,
    ];
  });
}

/**
 * Answers a candle request the way GeckoTerminal does: the newest `limit`
 * candles that opened before `before_timestamp`, newest first, and 401
 * for a before-time older than the public api's 180 days.
 *
 * @param {Array<Array<number>>} candles - The pool's candles, oldest first
 * @param {Object} request - The request
 * @returns {*} The answer
 */
export function answerCandles(candles, request) {
  const params = paramsOf(request);
  const before = Number(params.get("before_timestamp"));
  const now = Math.floor(Date.now() / 1000);
  if (before < now - PUBLIC_HISTORY_SECONDS) {
    return { status: 401, text: '{"errors":[{"status":"401"}]}' };
  }
  const limit = Number(params.get("limit"));
  const page = candles
    .filter(([open]) => open < before)
    .slice(-limit)
    .reverse();
  return {
    data: { attributes: { ohlcv_list: page } },
    meta: { base: { address: "0xbase" }, quote: { address: "0xquote" } },
  };
}
