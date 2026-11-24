/**
 * Checks the option that names a file a command line will write, as
 * commander parses it.
 * @module lib/file-to-write
 *
 * What: a run that writes a file only at its end can spend its time,
 * and its requests to a service, before a mistake in the file's name
 * stops it. `fileToWriteArgument`, given to commander as the option's
 * parser, refuses such a mistake at once, with commander's
 * `InvalidArgumentError`, so commander names the option: an empty name,
 * as a shell gives for a variable that is not set; a file in a folder
 * that does not exist; a folder; and a file in a folder that exists but
 * takes no new file, which `newFileRefusal` (`lib/new-file.js`) tells by
 * making one there and removing it.
 *
 * Fit: summ-csv's `--out`, crypto-price-filler's `--output` and its
 * backfill's `--output` take it; the projects that install this repo call
 * it as `crypto-price-fetchers/lib/file-to-write`: pulsechain-analytics'
 * Summ sweep, for its `--out` and `--report`, and x1-validator-analytics'
 * script, for its `--output`, before it asks the chain anything.
 */

import fs from "node:fs";
import path from "node:path";
import { InvalidArgumentError } from "commander";
import { newFileRefusal } from "./new-file.js";

/**
 * Reads the option of a file to write: a path that is no folder, in a
 * folder that exists and takes a new file.
 *
 * @param {string} value - The option's text
 * @returns {string} The path, as given
 * @throws {InvalidArgumentError} When it is empty, its folder does not
 *   exist or takes no new file, or it is a folder
 */
export function fileToWriteArgument(value) {
  if (value === "") throw new InvalidArgumentError("It names no file.");
  const folder = path.dirname(path.resolve(value));
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory())
    throw new InvalidArgumentError(`Its folder, ${folder}, does not exist.`);
  if (fs.existsSync(value) && fs.statSync(value).isDirectory())
    throw new InvalidArgumentError("It is a folder, not a file.");
  const refusal = newFileRefusal(folder);
  if (refusal !== null)
    throw new InvalidArgumentError(
      `Its folder, ${folder}, takes no new file (${refusal}).`,
    );
  return value;
}
