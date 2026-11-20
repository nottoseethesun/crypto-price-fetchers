/**
 * The verbose log of crypto-price-filler.
 * @module utils/log
 *
 * What: `logv` prints a line marked with its level, `[VERBOSE:1] ...`,
 * only when the run is verbose (`--verbose`, or `VERBOSE=1`) and the level
 * is one or more.
 *
 * Fit: every module of the tool that logs imports it, so the tool keeps
 * one copy of it.
 */

/**
 * Verbosity-aware logger function.
 * @param {boolean} shouldLog - Whether logging is enabled
 * @param {number} level - Log level (1 = basic, 2+ = more detail)
 * @param {string} message - Message to log
 * @param {...*} args - Additional arguments to log
 */
export function logv(shouldLog, level, message, ...args) {
  if (!shouldLog || level < 1) return;
  console.log(`[VERBOSE:${level}] ${message}`, ...args);
}
