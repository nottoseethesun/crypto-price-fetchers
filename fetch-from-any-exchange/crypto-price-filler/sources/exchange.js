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
 * `checkExchangeSettings` checks the script's `config.json`, which the
 * script reads only when it opens, at the first price, so a run checks it
 * before its first row.
 *
 * How: the script runs unchanged in a worker thread, through the repo's
 * runner, opened by its Node version (`openCentralizedExchangeSources` in
 * `bin/end-user/getCryptoPriceFromCentralizedExchange.js`, at the repo's top). It is opened once, at
 * the first price asked, with the CoinGecko and CoinPaprika keys the run
 * opened (`../../../api-key-store/`), which the Node version hands the
 * script as `CONFIG.COINGECKO_API_KEY` and `CONFIG.COINPAPRIKA_API_KEY`.
 * With verbose on, each line the script logs is printed.
 *
 * Fit: `price.js` asks these after the pool sources. The script's header
 * says how each source prices a time; a fix to a source goes in the
 * script, where it reaches the sheet and this tool alike.
 */

import {
  openCentralizedExchangeSources,
  readCentralizedExchangeConfig,
} from "../../../bin/end-user/getCryptoPriceFromCentralizedExchange.js";
import { getApiKey } from "../../../api-key-store/index.js";
import { logv } from "../utils/log.js";

/** The script as it opens, from the first price asked; null until then, and once closed. */
let opening = null;

/**
 * Prints a line the script logged, marked as the script's, in the verbose
 * log's second level.
 * @param {{text: string}} line - The line
 */
function printScriptLine({ text }) {
  logv(true, 2, `[Sheets script] ${text}`);
}

/**
 * Checks the exchange script's `config.json` against its schemas, as the
 * script's opening does: a run calls it before its first row, since the
 * script opens only at the first price, and a source that fails is
 * passed over on every row.
 *
 * @throws {Error} When the file cannot be read, is not JSON, or has a problem the schemas find, every problem listed
 */
export function checkExchangeSettings() {
  readCentralizedExchangeConfig();
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
