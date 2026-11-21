/**
 * The tokens crypto-price-filler prices, read from `supported-tokens.json`
 * in the tool's own folder, whichever folder the command runs in.
 * @module supported-tokens
 *
 * `index.js`, the command line's options in `commander.js`, and the price
 * lookup in `sources/price.js` each read the list here, so a run started
 * from the repo's top folder, or any other, finds it.
 */

import fs from "fs";
import { fileURLToPath } from "url";

/** The path of `supported-tokens.json`, beside this file. */
export const SUPPORTED_TOKENS_PATH = fileURLToPath(
  new URL("./supported-tokens.json", import.meta.url),
);

/**
 * Reads `supported-tokens.json`.
 *
 * @returns {{tokens: Object<string, Object>}} Its contents: each token's settings, by its lowercase symbol
 */
export function readSupportedTokens() {
  return JSON.parse(fs.readFileSync(SUPPORTED_TOKENS_PATH, "utf8"));
}
