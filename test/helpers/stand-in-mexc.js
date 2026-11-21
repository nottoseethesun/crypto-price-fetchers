/**
 * How MEXC, an exchange, answers a request for candles, for the stand-ins
 * of the tests of the exchange script.
 * @module test/helpers/stand-in-mexc
 *
 * MEXC's candles open on their period's boundaries, in UTC: a minute's at
 * its first second, an hour's at its first minute, 4 hours' at 00:00,
 * 04:00 and so on, a day's at 00:00, a week's on Monday at 00:00, and a
 * month's on its first day at 00:00. MEXC gives one for each period it
 * keeps, whether or not anything traded in it. Asked for candles from a
 * start time to an end time, it gives those that open in that window,
 * oldest first, as many as the request's limit, and none when no candle
 * opens there: asked from 14:29:30 to 14:30:30 for minutes, it gives the
 * one that opens at 14:30; asked from 14:29:00 to 14:30:00, the one that
 * opens at 14:29. These helpers answer a request as MEXC does.
 */

/** A day, in ms. */
const DAY_MS = 86400000;

/** Monday 1970-01-05, 00:00 UTC, in ms, where MEXC's weeks are counted from. */
const FIRST_MONDAY_MS = 4 * DAY_MS;

/** The length of each interval of a fixed length, in ms. */
const FIXED_MS = Object.freeze({
  "1m": 60000,
  "60m": 3600000,
  "4h": 14400000,
  "1d": DAY_MS,
});

/**
 * The first boundary of an interval's periods at or after a time.
 *
 * @param {string} interval - The interval, as MEXC names it
 * @param {number} ms - The time, in ms since 1970 UTC
 * @returns {number} The boundary, in ms
 * @throws {Error} When the stand-in does not know the interval
 */
function boundaryFrom(interval, ms) {
  if (Object.hasOwn(FIXED_MS, interval))
    return Math.ceil(ms / FIXED_MS[interval]) * FIXED_MS[interval];
  if (interval === "1W") {
    const weekMs = 7 * DAY_MS;
    return (
      FIRST_MONDAY_MS + Math.ceil((ms - FIRST_MONDAY_MS) / weekMs) * weekMs
    );
  }
  if (interval === "1M") {
    const date = new Date(ms);
    const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    return start === ms
      ? start
      : Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  }
  throw new Error(`The stand-in MEXC knows no interval ${interval}`);
}

/**
 * The open times of the candles a klines request gets from MEXC.
 *
 * @param {string} url - The request's url, with its interval, startTime, endTime and limit
 * @returns {Array<{open: number, end: number}>} Each candle's open time and the last millisecond of its period, oldest first
 */
export function mexcCandlePeriods(url) {
  const query = new URL(url).searchParams;
  const interval = query.get("interval");
  const endTime = Number(query.get("endTime"));
  const limit = Number(query.get("limit"));
  const periods = [];
  let open = boundaryFrom(interval, Number(query.get("startTime")));
  while (open <= endTime && periods.length < limit) {
    const next = boundaryFrom(interval, open + 1);
    periods.push({ open, end: next - 1 });
    open = next;
  }
  return periods;
}

/**
 * The time the first candle a klines request gets from MEXC opens at.
 *
 * @param {string} url - The request's url
 * @returns {?number} The candle's open time, in ms, or null when no candle opens in the window
 */
export function mexcCandleOpen(url) {
  const [first] = mexcCandlePeriods(url);
  return first === undefined ? null : first.open;
}

/**
 * The candles MEXC answers a klines request with.
 *
 * @param {string} url - The request's url
 * @param {(string[]|function(number, number, string): ?string[])} prices - Each candle's open, high, low, close and volume, as MEXC writes them; or a function of its open time, the last millisecond of its period and the interval, which gives them, or null for a period MEXC keeps no candle of
 * @returns {Array<Array>} The candles that open in the window, oldest first, up to the limit
 */
export function mexcKlines(url, prices) {
  const interval = new URL(url).searchParams.get("interval");
  const pricesOf =
    typeof prices === "function"
      ? prices
      : () => /** @type {string[]} */ (prices);
  return mexcCandlePeriods(url).flatMap(({ open, end }) => {
    const candle = pricesOf(open, end, interval);
    return candle === null ? [] : [[open, ...candle]];
  });
}
