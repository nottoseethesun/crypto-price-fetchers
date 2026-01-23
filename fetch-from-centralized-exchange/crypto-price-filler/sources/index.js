/**
 * Barrel file for price sources in Crypto Price Filler
 * @module sources
 * @description Re-exports all price fetching functions from individual source modules.
 * Allows importing multiple sources with a single line, e.g.:
 * import { getPriceFromMEXC, getPriceFromCoinGecko } from './sources';
 * 
 * @version 1.0.0
 * @author Christopher M. Balz with Grok and Claude.ai
 */

export { getPriceFromMEXC } from './mexc.js';
export { getPriceFromCoinGecko } from './coingecko.js';
export { getPriceFromCoinPaprika } from './coinpaprika.js';
export { getBTCUSDTPrice } from './utils/btc.js';
