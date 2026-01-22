/**
 * Date utility functions for Crypto Price Filler
 * @module utils/date
 * @description Handles timezone offsets and date parsing to UTC milliseconds.
 * Used by getCryptoPrice to convert local time inputs into UTC timestamps.
 * 
 * @version 1.0.0
 * @author Christopher M. Balz with Grok
 */

import { DateTime } from 'luxon';

/**
 * Returns the UTC offset in hours for a given timezone abbreviation.
 * @param {string} tz - Timezone abbreviation (e.g. 'CDT', 'UTC', 'PST')
 * @returns {number} Offset in hours (positive or negative). Defaults to 0 if unknown.
 */
export function getTimezoneOffsetHours(tz) {
  const knownOffsets = {
    'UTC': 0,
    'GMT': 0,
    'EST': -5,
    'EDT': -4,
    'CST': -6,
    'CDT': -5,
    'MST': -7,
    'MDT': -6,
    'PST': -8,
    'PDT': -7
  };
  return knownOffsets[tz?.toUpperCase()] ?? 0;
}

/**
 * Parses a date string with timezone offset into UTC milliseconds.
 * Parses as naive UTC to completely ignore system timezone (e.g., CST/CDT),
 * then applies the provided offset manually to get true UTC.
 * 
 * @param {string} dateStr - Date in format 'yyyy-MM-dd HH:mm:ss'
 * @param {number} offsetHours - Local offset from UTC (negative for west of UTC, e.g. -5 for CDT)
 * @param {boolean} [verbose=false] - Enable verbose logging
 * @returns {number|null} UTC milliseconds or null if invalid/empty
 */
export function parseInputToUtcMs(dateStr, offsetHours, verbose = false) {
  const logv = (level, message, ...args) => {
    if (!verbose || level < 1) return;
    console.log(`[VERBOSE:${level}] ${message}`, ...args);
  };

  logv(1, `parseInputToUtcMs called with dateStr="${dateStr}", offsetHours=${offsetHours}`);

  let safeStr = (dateStr ?? '').trim();
  logv(2, `Input string after trim: "${safeStr}" (length ${safeStr.length})`);

  if (!safeStr) {
    logv(1, 'Empty date string - returning null');
    return null;
  }

  // Parse as naive UTC to prevent system timezone shift
  const naiveDt = DateTime.fromFormat(safeStr, 'yyyy-MM-dd HH:mm:ss', { zone: 'utc' });
  if (!naiveDt.isValid) {
    logv(1, `Invalid date format: "${safeStr}" - ${naiveDt.invalidExplanation || 'unknown reason'}`);
    return null;
  }

  logv(2, `Parsed naive UTC DateTime object details:`);
  logv(2, `  - isValid: ${naiveDt.isValid}`);
  logv(2, `  - year: ${naiveDt.year}, month: ${naiveDt.month}, day: ${naiveDt.day}`);
  logv(2, `  - hour: ${naiveDt.hour}, minute: ${naiveDt.minute}, second: ${naiveDt.second}, millisecond: ${naiveDt.millisecond}`);
  logv(2, `  - offset: ${naiveDt.offset}, zoneName: ${naiveDt.zoneName}`);
  logv(2, `  - toISO(): ${naiveDt.toISO()}`);
  logv(2, `  - toMillis(): ${naiveDt.toMillis()}`);

  // Apply offset: UTC = naive - offset (negative offset → add hours)
  const utcDt = naiveDt.minus({ hours: offsetHours });

  logv(2, `After offset adjustment (minus ${offsetHours} hours):`);
  logv(2, `  - isValid: ${utcDt.isValid}`);
  logv(2, `  - year: ${utcDt.year}, month: ${utcDt.month}, day: ${utcDt.day}`);
  logv(2, `  - hour: ${utcDt.hour}, minute: ${utcDt.minute}, second: ${utcDt.second}, millisecond: ${utcDt.millisecond}`);
  logv(2, `  - offset: ${utcDt.offset}, zoneName: ${utcDt.zoneName}`);
  logv(2, `  - toISO(): ${utcDt.toISO()}`);
  logv(2, `  - toMillis(): ${utcDt.toMillis()}`);

  const ms = utcDt.toMillis();

  logv(1, `Final UTC ms: ${ms} (${utcDt.toISO()})`);

  return ms;
}
