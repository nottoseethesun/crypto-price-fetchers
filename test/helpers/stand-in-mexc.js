/**
 * How MEXC, an exchange, answers a request for candles, for the stand-ins
 * of the tests of the exchange script.
 * @module test/helpers/stand-in-mexc
 *
 * MEXC's candles open on their period's boundaries: a minute's at its
 * first second, an hour's at its first minute. Asked for candles from a
 * start time to an end time, it gives those that open in that window,
 * the first of them when the request's limit is 1, and none when no
 * candle opens there. Asked from 14:29:30 to 14:30:30 for minutes, it
 * gives the one that opens at 14:30; asked from 14:29:00 to 14:30:00, the
 * one that opens at 14:29. `mexcCandleOpen` gives the time the candle a
 * request gets opens at, so a stand-in answers as MEXC does.
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
