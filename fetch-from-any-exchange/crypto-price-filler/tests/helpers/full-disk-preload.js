/**
 * Makes each file a command line writes with Node's `fs.writeFile` or
 * `fs.writeFileSync` fail as on a full disk, for a test that runs the
 * command line in a child process with `node --import <this file>`.
 * @module tests/helpers/full-disk-preload
 *
 * Node's `fs.writeFile` and `fs.writeFileSync` open the file as they are
 * asked, which empties a file opened to be written over, as a full disk
 * leaves it, and then fail with ENOSPC, as the write does there. The
 * preload runs before the command line loads, so a package that keeps
 * `fs.writeFile` as it loads, as csv-writer does, keeps this one, and
 * `syncBuiltinESMExports` hands it to the modules that import it by name.
 */

import fs from "fs";
import { syncBuiltinESMExports } from "module";

/**
 * The error a write gets on a full disk.
 *
 * @param {string} file - The file written
 * @returns {Error} The error, with Node's code
 */
function noSpaceLeft(file) {
  return Object.assign(
    new Error(`ENOSPC: no space left on device, write '${file}'`),
    { code: "ENOSPC" },
  );
}

/**
 * Opens a file as a write would, closing it again.
 *
 * @param {string} file - The file
 * @param {Object|string} [options] - The write's options, whose flag says how it opens the file
 */
function openAsAsked(file, options) {
  const flag = typeof options === "object" ? options?.flag : undefined;
  fs.closeSync(fs.openSync(file, flag ?? "w"));
}

/*-
 *  TEST-ONLY global swap: the command lines, and csv-writer, which keeps
 *  `fs.writeFile` as it loads, write through Node's `fs` and offer no seam
 *  for it. This file runs only in a child process a test starts for one
 *  run of a command line, so the swap is never seen outside that process,
 *  and it ends with the process.
 */
fs.writeFileSync = (file, data, options) => {
  openAsAsked(file, options);
  throw noSpaceLeft(file);
};

fs.writeFile = (file, data, ...rest) => {
  const callback = rest.pop();
  try {
    openAsAsked(file, rest[0]);
  } catch (error) {
    callback(error);
    return;
  }
  callback(noSpaceLeft(file));
};

syncBuiltinESMExports();
