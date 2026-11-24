/**
 * Checks the option that names a file a command line will read, as
 * commander parses it.
 * @module lib/file-to-read
 *
 * What: a file an option names that is not there stops a run only once
 * the run comes to read it, with Node's error, which names the file but
 * not the option. `fileToReadArgument`, given to commander as the
 * option's parser, refuses such a mistake at once, with commander's
 * `InvalidArgumentError`, so commander names the option: an empty name,
 * as a shell gives for a variable that is not set, and a path at which
 * no file is, a folder among them.
 *
 * Fit: summ-csv's `--rows` and `--template`, and the Node versions'
 * `--config`, take it; the projects that install this repo call it as
 * `crypto-price-fetchers/lib/file-to-read`: pulsechain-analytics' Summ
 * sweep, for each page `--summ-results` names.
 */

import fs from "node:fs";
import path from "node:path";
import { InvalidArgumentError } from "commander";

/**
 * Reads the option of a file to read: a path at which a file is.
 *
 * @param {string} value - The option's text
 * @returns {string} The path, as given
 * @throws {InvalidArgumentError} When it is empty, or no file is at the
 *   path
 */
export function fileToReadArgument(value) {
  if (value === "") throw new InvalidArgumentError("It names no file.");
  if (!fs.existsSync(value) || !fs.statSync(value).isFile())
    throw new InvalidArgumentError(`No file is at ${path.resolve(value)}.`);
  return value;
}
