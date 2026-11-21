/**
 * Reads a day of the calendar written YYYY-MM-DD, as a command line takes
 * the first or last day of a range: the start of that day in UTC.
 * @module lib/calendar-day
 *
 * What: `dayStartSeconds` gives the seconds since 1970 at the start of the
 * day, in UTC, or null for text that is no day of the calendar written
 * that way.
 *
 * How: JavaScript's `Date` reads a day the calendar does not have, such as
 * 2026-02-30, as a later one, 2 March. So the day read is written back in
 * the same form and compared with the text: a day the calendar does not
 * have comes back as another, and is refused.
 *
 * Fit: the command lines of this repo and of the projects that install it
 * check their days with it, as `crypto-price-fetchers/lib/calendar-day`.
 */

/**
 * The start of a day in UTC.
 *
 * @param {*} day - The day, written YYYY-MM-DD, such as 2026-11-01
 * @returns {?number} The seconds since 1970 at the day's start, in UTC, or
 *   null when the text is no day of the calendar written that way
 */
export function dayStartSeconds(day) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const milliseconds = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(milliseconds)) return null;
  const written = new Date(milliseconds).toISOString().slice(0, 10);
  return written === day ? milliseconds / 1000 : null;
}
