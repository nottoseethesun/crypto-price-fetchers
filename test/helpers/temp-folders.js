/**
 * Temp folders for the tests, removed once a test file has run.
 * @module test/helpers/temp-folders
 *
 * A test's files go in a temp folder of its own, never in the repo or in
 * the owner's files. `makeTempFolder` makes one and remembers it;
 * `removeTempFolders`, which each test file runs in an `after` hook,
 * removes every one it made.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The folders made and not yet removed. */
const made = [];

/**
 * Makes a temp folder, which `removeTempFolders` removes.
 *
 * @param {string} purpose - A word for what it holds, put in its name
 * @returns {string} The folder
 */
export function makeTempFolder(purpose) {
  const folder = fs.mkdtempSync(
    path.join(os.tmpdir(), `crypto-price-fetchers-test-${purpose}-`),
  );
  made.push(folder);
  return folder;
}

/** Removes every temp folder `makeTempFolder` made. */
export function removeTempFolders() {
  for (const folder of made.splice(0))
    fs.rmSync(folder, { recursive: true, force: true });
}
