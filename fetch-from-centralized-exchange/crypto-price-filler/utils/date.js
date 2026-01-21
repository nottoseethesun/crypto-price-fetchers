// utils/date.js
import { DateTime } from 'luxon';
import config from '../config.json' assert { type: 'json' };

/**
 * Get hours offset for a given timezone abbreviation
 * @param {string} tz - Timezone abbreviation (e.g. 'UTC', 'CDT')
 * @returns {number} Hours offset from UTC
 */
export function getTimezoneOffsetHours(tz) {
  return config.TIMEZONE_OFFSETS[tz?.toUpperCase()] || 0;
}

/**
 * Parse input date string to UTC milliseconds, respecting timezone offset
 * @param {string} dateStr - Date in 'yyyy-MM-dd HH:mm:ss' format
 * @param {number} offsetHours - Hours offset from UTC
 * @param {boolean} verbose - Whether to log verbose messages
 * @returns {number|null} UTC milliseconds or null if invalid
 */
export function parseInputToUtcMs(dateStr, offsetHours, verbose = false) {
  // Local logv helper (same signature as in index.js)
  const logv = (shouldLog, level, message, ...args) => {
    if (!shouldLog || level < 1) return;
    console.log(`[VERBOSE:${level}] ${message}`, ...args);
  };

  logv(verbose, 2, `parseInputToUtcMs called with "${dateStr}", offset: ${offsetHours}`);

  const zone = `UTC${offsetHours >= 0 ? '+' : ''}${offsetHours}`;
  const dt = DateTime.fromFormat(dateStr, 'yyyy-MM-dd HH:mm:ss', { zone });

  if (!dt.isValid) {
    logv(verbose, 2, 'Luxon parsing FAILED, falling back to new Date()');
    const fallback = new Date(dateStr);
    if (isNaN(fallback.getTime())) {
      logv(verbose, 2, 'Fallback new Date() also FAILED - returning null');
      return null;
    }
    const utcMs = fallback.getTime() + (offsetHours * 3600000);
    logv(verbose, 2, `Fallback new Date() SUCCEEDED, UTC ms: ${utcMs} (${new Date(utcMs).toISOString()})`);
    return utcMs;
  }

  const utcMs = dt.toUTC().toMillis();
  logv(verbose, 2, `Luxon parsing SUCCEEDED, UTC ms: ${utcMs} (${dt.toUTC().toISO()})`);
  return utcMs;
}
