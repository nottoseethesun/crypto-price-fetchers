/**
 * The verbose log of crypto-price-filler, and the lines every run prints.
 * @module utils/log
 *
 * What: `logv` prints a line marked with its level, `[VERBOSE:1] ...`,
 * only when the run is verbose (`--verbose`, or `VERBOSE=1`) and the level
 * is one or more; `say` prints a line every run prints, such as what it
 * wrote.
 *
 * How: both print through one sink, the console's log, unless a test sets
 * another with `setLogSinkForTests`, so a test reads the lines without
 * replacing console.log, which LP Ranger's rules keep tests from doing
 * where a seam can be had.
 *
 * Fit: every module of the tool that logs imports it, so the tool keeps
 * one copy of it.
 */

/**
 * Prints a line's words on the console.
 *
 * @param {...*} words - The words
 */
function toConsole(...words) {
  console.log(...words);
}

/** Where the lines go: the console, or a test's own sink. */
let sink = toConsole;

/**
 * Prints a line every run prints.
 *
 * @param {string} message - The line
 * @param {...*} args - Additional arguments to print
 */
export function say(message, ...args) {
  sink(message, ...args);
}

/**
 * Verbosity-aware logger function.
 * @param {boolean} shouldLog - Whether logging is enabled
 * @param {number} level - Log level (1 = basic, 2+ = more detail)
 * @param {string} message - Message to log
 * @param {...*} args - Additional arguments to log
 */
export function logv(shouldLog, level, message, ...args) {
  if (!shouldLog || level < 1) return;
  sink(`[VERBOSE:${level}] ${message}`, ...args);
}

/**
 * Sends the log's lines to a function of a test's own, or, given null,
 * back to the console: the seam the tests read the lines through.
 *
 * @param {?function(...*): void} testSink - Takes each line's words, or null for the console
 */
export function setLogSinkForTests(testSink) {
  sink = testSink ?? toConsole;
}
