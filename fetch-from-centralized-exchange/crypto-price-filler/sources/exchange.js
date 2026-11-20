/**
 * The centralized exchanges' price sources for crypto-price-filler: MEXC,
 * CoinGecko and CoinPaprika, as the Sheets script
 * getCryptoPriceFromCentralizedExchange asks them.
 * @module sources/exchange
 *
 * What: `exchangeSources` gives the Sheets script's three price sources,
 * `getPriceFromMEXC`, `getPriceFromCoinGecko` and `getPriceFromCoinPaprika`,
 * as async calls. Each takes an id (the ticker for MEXC, the coin's id at
 * CoinGecko or CoinPaprika), the time in UTC milliseconds and "high", "low"
 * or "close", and gives the price in USD, or null when it has none.
 * `closeExchangeSources` closes them once the run is done.
 *
 * How: the script runs unchanged in a worker thread, through the repo's
 * runner, opened by its Node version (`openCentralizedExchangeSources` in
 * `../../getCryptoPriceFromCentralizedExchange.js`). It is opened once, at
 * the first price asked, with the CoinGecko and CoinPaprika keys the run
 * opened (`../../../api-key-store/`), which the script reads as its Script
 * Properties. With verbose on, each line the script logs is printed.
 *
 * Fit: `price.js` asks these after the pool sources. The script's header
 * says how each source prices a time; a fix to a source goes in the
 * script, where it reaches the sheet and this tool alike.
 */

import { openCentralizedExchangeSources } from "../../getCryptoPriceFromCentralizedExchange.js";
import { getApiKey } from "../../../api-key-store/index.js";

/** The script as it opens, from the first price asked; null until then, and once closed. */
let opening = null;

/**
 * Prints a line the script logged, marked as the script's.
 * @param {{text: string}} line - The line
 */
function printScriptLine({ text }) {
  console.log(`[VERBOSE:2] [Sheets script] ${text}`);
}

/**
 * Gives the Sheets script's price sources, opening the script at the
 * first call.
 * @param {boolean} [verbose=false] - Print the lines the script logs; the first call decides
 * @returns {Promise<{getPriceFromMEXC: function(string, number, string): Promise<?number>, getPriceFromCoinGecko: function(string, number, string): Promise<?number>, getPriceFromCoinPaprika: function(string, number, string): Promise<?number>, close: function(): Promise<void>}>} The sources
 */
export function exchangeSources(verbose = false) {
  if (opening === null) {
    opening = openCentralizedExchangeSources({
      apiKeys: {
        coingecko: getApiKey("coingecko"),
        coinpaprika: getApiKey("coinpaprika"),
      },
      onLog: verbose ? printScriptLine : null,
    });
  }
  return opening;
}

/**
 * Closes the script's worker, when the script was opened; a price asked
 * after this opens it again.
 * @returns {Promise<void>} Settles once it is closed
 */
export async function closeExchangeSources() {
  if (opening === null) return;
  const opened = opening;
  opening = null;
  const sources = await opened.catch(() => null);
  if (sources !== null) await sources.close();
}
