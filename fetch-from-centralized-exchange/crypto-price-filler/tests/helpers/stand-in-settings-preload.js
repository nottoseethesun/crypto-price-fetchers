/**
 * Preload that lets a test run the Node tool's real command line, `index.js`,
 * in a child process with a settings file or a token list of the test's own.
 * @module tests/helpers/stand-in-settings-preload
 *
 * The tool reads `config.json`, the owner's own settings, and
 * `supported-tokens.json` beside its own files, whichever folder it runs in,
 * so a test cannot hand it either by writing a file. A test starts
 * `node --import <this file> index.js ...`, with the text of either file in
 * the environment variable `STAND_IN_FILLER_CONFIG` or
 * `STAND_IN_FILLER_TOKENS`; this file makes the tool's read of that file
 * give the text, so a test never writes the owner's `config.json`.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/** crypto-price-filler's folder. */
const FILLER_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Each file the test stands in for, by its path, with the text it gives. */
const STAND_INS = new Map(
  [
    ["config.json", process.env.STAND_IN_FILLER_CONFIG],
    ["supported-tokens.json", process.env.STAND_IN_FILLER_TOKENS],
  ]
    .filter(([, text]) => text !== undefined)
    .map(([name, text]) => [path.join(FILLER_DIR, name), text]),
);

const readFileSync = fs.readFileSync;

/*-
 *  TEST-ONLY swap: the tool reads both files with `fs.readFileSync`, at
 *  paths fixed beside its own files, and offers no seam for them. This
 *  file runs only in a child process a test starts for one run of the
 *  command line, so the swap is never seen outside that process, and it
 *  ends with the process.
 */
fs.readFileSync = (file, ...rest) => {
  const asPath = file instanceof URL ? fileURLToPath(file) : String(file);
  const text = STAND_INS.get(path.resolve(asPath));
  return text ?? readFileSync(file, ...rest);
};
