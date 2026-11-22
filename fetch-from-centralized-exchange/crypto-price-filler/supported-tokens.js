/**
 * The tokens crypto-price-filler prices, read from `supported-tokens.json`
 * in the tool's own folder, whichever folder the command runs in.
 * @module supported-tokens
 *
 * `index.js`, the command line's options in `commander.js`, and the price
 * lookup in `sources/price.js` each read the list here, so a run started
 * from the repo's top folder, or any other, finds it. The list is read with
 * `readSettingsFile` (`lib/settings-file.js`) and held to
 * `SUPPORTED_TOKENS_SCHEMA`, which names each fact a token may have, so a
 * misspelled fact or a value of the wrong kind stops the run, with every
 * problem listed.
 */

import path from "path";
import { fileURLToPath } from "url";
import { readSettingsFile } from "../../lib/settings-file.js";
import { KINDS } from "../../lib/settings-schema.js";

/** The path of `supported-tokens.json`, beside this file. */
export const SUPPORTED_TOKENS_PATH = fileURLToPath(
  new URL("./supported-tokens.json", import.meta.url),
);

/**
 * A token's facts: its name, its ids at CoinGecko and CoinPaprika and its
 * symbol at MEXC, null where a source does not list it, a note, and, for a
 * token that trades in a chain's pools, its contract, GeckoTerminal's id
 * for its network and Moralis's id for its chain, each null where that
 * service does not list the chain.
 */
const TOKEN_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["name", "coingecko_id", "coinpaprika_id", "mexc_symbol"],
  properties: {
    name: KINDS.text,
    coingecko_id: KINDS.textOrNone,
    coinpaprika_id: KINDS.textOrNone,
    mexc_symbol: KINDS.textOrNone,
    note: KINDS.text,
    contract: KINDS.address,
    geckoterminal_network: KINDS.textOrNone,
    moralis_chain: KINDS.textOrNone,
  },
  description: "a token's facts",
});

/**
 * The JSON Schema of `supported-tokens.json`: the tokens, by symbol, each
 * symbol in lower case, since the command line and the price lookup look a
 * token up by its symbol in lower case, whatever case it is typed in.
 */
export const SUPPORTED_TOKENS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["tokens"],
  properties: {
    tokens: {
      type: "object",
      propertyNames: {
        type: "string",
        pattern: "^[^A-Z]+$",
        description: "a symbol in lower case",
      },
      additionalProperties: TOKEN_SCHEMA,
      description: "the tokens, by their symbols in lower case",
    },
  },
});

/**
 * Reads `supported-tokens.json`, checked against `SUPPORTED_TOKENS_SCHEMA`.
 *
 * @param {string} [file=SUPPORTED_TOKENS_PATH] - The file to read, which a test names
 * @returns {{tokens: Object<string, Object>}} Its contents: each token's settings, by its lowercase symbol
 * @throws {Error} When the file is missing, cannot be read, is not JSON, or the schema finds a problem in it, every problem listed
 */
export function readSupportedTokens(file = SUPPORTED_TOKENS_PATH) {
  return readSettingsFile(file, {
    required: true,
    schema: SUPPORTED_TOKENS_SCHEMA,
    name: `crypto-price-filler/${path.basename(file)}`,
  });
}
