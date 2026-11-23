/**
 * Whether a folder takes a new file, for a command line that checks the
 * folders of the files it will write before it asks a service anything.
 * @module lib/new-file
 *
 * What: a folder can exist and still refuse a new file: its user may not
 * write to it, its disk may be mounted read-only, or it may be one of the
 * system's own folders, such as Linux's /proc, which holds no file a
 * program makes. Only a write tells: Node's check of a folder's modes,
 * `fs.accessSync` with `W_OK`, passes /proc for root, whom no mode stops,
 * though a new file there fails. So `newFileRefusal` makes a file of its
 * own in the folder, under a name no other file has, and removes it at
 * once.
 *
 * Fit: the projects that install this repo call it as
 * `crypto-price-fetchers/lib/new-file`: pulsechain-analytics' Summ sweep
 * and x1-validator-analytics' script, for the folder of each file they
 * write.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Why a folder refuses a new file.
 *
 * @param {string} folder - The folder
 * @returns {?string} The system's code for the refusal, such as `EACCES`,
 *   `EROFS` or `ENOENT`, or null when the folder takes a new file
 */
export function newFileRefusal(folder) {
  const file = path.join(folder, `.new-file-${randomUUID()}`);
  try {
    fs.closeSync(fs.openSync(file, "wx"));
  } catch (thrown) {
    return thrown.code;
  }
  fs.rmSync(file);
  return null;
}
