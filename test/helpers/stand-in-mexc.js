/**
 * How MEXC, an exchange, answers a request for candles, for the stand-ins
 * of the tests of the exchange script.
 * @module test/helpers/stand-in-mexc
 *
 * MEXC's candles open on their period's boundaries, a minute's at its
 * first second and an hour's at its first minute, one for each period it
 * keeps, whether or not anything traded in it. Asked for candles from a
 * start time to an end time, it gives those that open in that window, the
 * first of them when the request's limit is 1, and none when no candle
 * opens there: asked from 14:29:30 to 14:30:30 for minutes, it gives the
 * one that opens at 14:30; asked from 14:29:00 to 14:30:00, the one that
 * opens at 14:29. These helpers answer a request as MEXC does, for an
 * exchange that keeps a candle of every period.
 */

/** The length of each interval the exchange script asks for, in ms. */
const INTERVAL_MS = Object.freeze({ "1m": 60000, "60m": 3600000 });

/**
 * The time the first candle a klines request gets from MEXC opens at.
 *
 * @param {string} url - The request's url, with its interval, startTime and endTime
 * @returns {?number} The candle's open time, in ms, or null when no candle opens in the window
 * @throws {Error} When the url asks for an interval the stand-in does not know
 */
export function mexcCandleOpen(url) {
  const query = new URL(url).searchParams;
  const interval = query.get("interval");
  if (!Object.hasOwn(INTERVAL_MS, interval))
    throw new Error(`The stand-in MEXC knows no interval ${interval}`);
  const period = INTERVAL_MS[interval];
  const open = Math.ceil(Number(query.get("startTime")) / period) * period;
  return open <= Number(query.get("endTime")) ? open : null;
}

/**
 * The candles MEXC answers a klines request with, each period's candle
 * holding the same prices.
 *
 * @param {string} url - The request's url, with its interval, startTime and endTime
 * @param {string[]} prices - The candle's open, high, low, close and volume, as MEXC writes them
 * @returns {Array<Array>} The first candle that opens in the window, or none
 */
export function mexcKlines(url, prices) {
  const open = mexcCandleOpen(url);
  return open === null ? [] : [[open, ...prices]];
}
