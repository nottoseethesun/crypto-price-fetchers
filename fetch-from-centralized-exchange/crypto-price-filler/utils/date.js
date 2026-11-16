/**
 * Date utility functions for Crypto Price Filler
 * @module utils/date
 * @description Time zones, and reading a row's date to UTC milliseconds.
 * Used by getCryptoPrice to convert local time inputs into UTC timestamps.
 *
 * A row's date is read in a time zone named in full, such as
 * America/Chicago, or UTC, as LP Ranger's bookkeeping report takes them:
 * the names Node's time zone database lists (`Intl.supportedValuesOf`),
 * and UTC, which that list leaves out. Each row gets the offset its zone
 * had at that moment, so a file that crosses a change to or from daylight
 * saving time is read right on both sides of it. An abbreviation such as
 * CDT is refused: it can name several clocks (CST is US Central, China and
 * Cuba Standard Time), and a fixed offset cannot follow daylight saving.
 * `Intl` itself would let some abbreviations through, the legacy EST among
 * them, so names are checked against the list, never against `Intl`.
 *
 * @version 1.1.0
 * @author Christopher M. Balz with Grok and Claude.ai
 */

import { DateTime } from 'luxon';

/**
 * Every time zone a row's date can be read in, sorted: the names Node's
 * time zone database lists, each a region such as America/Chicago, and UTC.
 *
 * @returns {string[]} The zones
 */
export function validTimeZones() {
  return [...Intl.supportedValuesOf('timeZone'), 'UTC'].sort();
}

/** Each valid time zone, by its name in lower case. */
const VALID_BY_LOWER_CASE = new Map(validTimeZones().map((zone) => [zone.toLowerCase(), zone]));

/**
 * A time zone's name as the list spells it, matched in any letter case.
 *
 * @param {string} name - The name given
 * @returns {string|null} The zone, or null when it is not on the list
 */
export function canonicalTimeZone(name) {
  if (typeof name !== 'string') return null;
  return VALID_BY_LOWER_CASE.get(name.trim().toLowerCase()) ?? null;
}

/**
 * Reads a date, written as the wall clock of a time zone, to UTC
 * milliseconds, with the offset the zone had at that moment.
 *
 * @param {string} dateStr - Date in format 'yyyy-MM-dd HH:mm:ss'
 * @param {string} timeZone - A zone from `validTimeZones`, such as 'America/Chicago' or 'UTC'
 * @param {boolean} [verbose=false] - Enable verbose logging
 * @returns {number|null} UTC milliseconds, or null if the date is empty or not in the format
 * @throws {Error} When the time zone is not one from `validTimeZones`
 */
export function parseInputToUtcMs(dateStr, timeZone, verbose = false) {
  const zone = canonicalTimeZone(timeZone);
  if (zone === null) {
    throw new Error(`Not a valid time zone: ${timeZone}. Use a full name such as America/Chicago, or UTC.`);
  }
  const safeStr = (dateStr ?? '').trim();
  if (safeStr === '') {
    if (verbose) console.log('[VERBOSE:1] Empty date string - returning null');
    return null;
  }
  const local = DateTime.fromFormat(safeStr, 'yyyy-MM-dd HH:mm:ss', { zone });
  if (!local.isValid) {
    if (verbose) console.log(`[VERBOSE:1] Invalid date format: "${safeStr}" - ${local.invalidExplanation || 'unknown reason'}`);
    return null;
  }
  if (verbose) console.log(`[VERBOSE:1] "${safeStr}" in ${zone} is ${local.toUTC().toISO()}`);
  return local.toMillis();
}
