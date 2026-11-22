/**
 * Reads the lines crypto-price-filler prints, through its log's seam,
 * rather than by replacing console.log.
 * @module tests/helpers/log-lines
 *
 * What: `logLines` sends the lines of `utils/log.js`, `say`'s and
 * `logv`'s, to a vitest mock function for the rest of the test, and sends
 * them back to the console when the test ends, passed or failed.
 */

import { onTestFinished, vi } from "vitest";
import { setLogSinkForTests } from "../../utils/log.js";

/**
 * Sends the tool's lines to a mock function until the test ends.
 *
 * @returns {import('vitest').Mock} The mock, called with each line's words
 */
export function logLines() {
  const lines = vi.fn();
  setLogSinkForTests(lines);
  onTestFinished(() => setLogSinkForTests(null));
  return lines;
}
