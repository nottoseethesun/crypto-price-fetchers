/**
 * Moralis as a price source of crypto-price-filler: a token that trades in
 * pools, priced at a row's time, when the owner has saved a Moralis key.
 * @module moralis
 *
 * What: `getPriceFromMoralis` gives a token's USD price at the block its
 * chain had at the row's time. Moralis gives one price for a block, with
 * no high or low, so it answers the close only; for a high or a low it
 * gives null, and the provider chain asks GeckoTerminal, whose candles
 * have them.
 *
 * How: the shared Moralis client (`dex-prices/moralis.js`, at the repo's
 * top) is asked for the block, then for the price at that block, with the
 * Moralis key the run opened from the key store (`api-key-store/`).
 * Without a saved key, Moralis is not asked. An error, a refused key among
 * them, is logged when verbose and answered with null.
 *
 * Fit: `sources/price.js` asks it first for a token that names its
 * contract and Moralis's id for its chain in `supported-tokens.json`, as
 * LP Ranger asks Moralis first for a past price when a key exists, then
 * GeckoTerminal (`sources/geckoterminal.js`) for what it does not answer.
 *
 * @version 1.0.0
 * @author Christopher M. Balz with Claude
 */

import {
  blockAt,
  moralisSettings,
  priceAtBlock,
} from "../../../dex-prices/moralis.js";
import { getApiKey } from "../../../api-key-store/index.js";

/**
 * Logs a message when verbose, at a level of one or more.
 *
 * @param {boolean} shouldLog - Whether to log
 * @param {number} level - The message's level
 * @param {string} message - The message
 */
function logv(shouldLog, level, message) {
  if (!shouldLog || level < 1) return;
  console.log(`[VERBOSE:${level}] ${message}`);
}

/**
 * A token that trades in pools, as `supported-tokens.json` names it.
 *
 * @typedef {Object} PoolToken
 * @property {string} contract - The token's contract address
 * @property {(string|null)} network - GeckoTerminal's id for its chain, such as 'pulsechain', or null
 * @property {(string|null)} moralisChain - Moralis's id for its chain, such as '0x171', or null
 */

/**
 * Prices a token at a time from Moralis, at the block its chain had then.
 *
 * @param {PoolToken} token - The token
 * @param {number} utcMs - The time, in UTC milliseconds
 * @param {string} [target='close'] - 'high', 'low' or 'close'
 * @param {boolean} [verbose=false] - Whether to log
 * @returns {Promise<number|null>} The price in USD, or null when Moralis cannot give it
 */
export async function getPriceFromMoralis(
  token,
  utcMs,
  target = "close",
  verbose = false,
) {
  if (target !== "close") {
    logv(verbose, 1, `Moralis skipped: a block's price has no ${target}`);
    return null;
  }
  const key = getApiKey("moralis");
  if (key === null) {
    logv(verbose, 1, "Moralis skipped: no Moralis key saved");
    return null;
  }
  const settings = moralisSettings();
  try {
    const block = await blockAt(
      { chain: token.moralisChain, seconds: Math.floor(utcMs / 1000) },
      key,
      settings,
    );
    if (block === null) return null;
    return await priceAtBlock(
      { chain: token.moralisChain, token: token.contract, block },
      key,
      settings,
    );
  } catch (err) {
    logv(verbose, 1, `Moralis failed: ${err.message}`);
    return null;
  }
}
