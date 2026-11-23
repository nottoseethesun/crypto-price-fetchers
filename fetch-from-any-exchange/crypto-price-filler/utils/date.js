/**
 * Date utility functions for Crypto Price Filler
 * @module utils/date
 * @description Time zones, and reading a row's date to UTC milliseconds.
 * Used by getCryptoPrice to convert local time inputs into UTC timestamps.
 *
 * A row's date is read in a time zone named in full, such as
 * America/Chicago, or UTC, as LP Ranger's bookkeeping report takes them:
 * the names Node's time zone database lists (`Intl.supportedValuesOf`),
 * and UTC, which that list leaves out. The list keeps the older names of
 * zones since renamed, such as Asia/Calcutta, so a region's current name,
 * such as Asia/Kolkata, is taken as the zone `Intl` resolves it to, when
 * that zone is on the list. Each row gets the offset its zone
 * had at that moment, so a file that crosses a change to or from daylight
 * saving time is read right on both sides of it. An abbreviation such as
 * CDT is refused: it can name several clocks (CST is US Central, China and
 * Cuba Standard Time), and a fixed offset cannot follow daylight saving.
 * `Intl` itself would let some abbreviations through, the legacy EST among
 * them, so a name is taken only when it, or, for a name with a slash, the
 * zone `Intl` resolves it to, is on the list.
 *
 * @version 1.1.0
 * @author Christopher M. Balz with Grok and Claude.ai
 */

import { DateTime } from "luxon";
import { logv } from "./log.js";

/**
 * Every time zone a row's date can be read in, sorted: the names Node's
 * time zone database lists, each a region such as America/Chicago, and UTC.
 *
 * @returns {string[]} The zones
 */
export function validTimeZones() {
  return [...Intl.supportedValuesOf("timeZone"), "UTC"].sort();
}

/** Each valid time zone, by its name in lower case. */
const VALID_BY_LOWER_CASE = new Map(
  validTimeZones().map((zone) => [zone.toLowerCase(), zone]),
);

/**
 * A time zone's name as the list spells it, matched in any letter case, or the listed zone a region's current name resolves to.
 *
 * @param {string} name - The name given
 * @returns {string|null} The zone, or null when it is not on the list
 */
export function canonicalTimeZone(name) {
  if (typeof name !== "string") return null;
  const given = name.trim();
  return VALID_BY_LOWER_CASE.get(given.toLowerCase()) ?? renamedZoneOf(given);
}

/**
 * The listed zone a region's current name resolves to, such as
 * Asia/Calcutta for Asia/Kolkata: a name with a slash, which no
 * abbreviation has, that `Intl` reads, resolving to a zone on the list.
 *
 * @param {string} name - The name given, trimmed
 * @returns {string|null} The zone, or null
 */
function renamedZoneOf(name) {
  if (!name.includes("/")) return null;
  let resolved;
  try {
    resolved = new Intl.DateTimeFormat("en-US", {
      timeZone: name,
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  return VALID_BY_LOWER_CASE.get(resolved.toLowerCase()) ?? null;
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
    throw new Error(
      `Not a valid time zone: ${timeZone}. Use a full name such as America/Chicago, or UTC.`,
    );
  }
  const safeStr = (dateStr ?? "").trim();
  if (safeStr === "") {
    logv(verbose, 1, "Empty date string - returning null");
    return null;
  }
  const local = DateTime.fromFormat(safeStr, "yyyy-MM-dd HH:mm:ss", { zone });
  if (!local.isValid) {
    logv(
      verbose,
      1,
      `Invalid date format: "${safeStr}" - ${local.invalidExplanation ?? "unknown reason"}`,
    );
    return null;
  }
  logv(verbose, 1, `"${safeStr}" in ${zone} is ${local.toUTC().toISO()}`);
  return local.toMillis();
}
