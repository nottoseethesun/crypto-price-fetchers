/**
 * Add this script as a Google Apps Script, via the Extensions menu on a Google Sheet.
 * Example usage in a Google Sheets cell:
 *
 *   = dexToolsGetTokenPrice("pulse", U2)
 *
 * Usage: Update API_KEY with the one you got from DexTools e.g. at https://developer.dextools.io/ , 
 *        and your SUBSCRIPTION_PLAN using for the value, DexTools categories e.g. "trial". 
 *        Also, set the other remaining variables under the heading below, "User-settable Values",
 *        to your desired values.
 *
 * Data Refresh: Use the built-in Google Sheets Trigger, selecting "Time-based" and this function.
 *
 * Test: See the `test` function, below.
 */

/**
 * User-settable Values
 */
dexToolsGetTokenPrice.API_KEY = 'put-your-api-key-here'; // Update with your api key
dexToolsGetTokenPrice.SUBSCRIPTION_PLAN = 'standard'; // Update with your subscription level
dexToolsGetTokenPrice.FETCH_INTERVAL_SECONDS = 4; // Used to avoid hitting API rate limits

// Program constants
dexToolsGetTokenPrice.MILLISECONDS_IN_SECOND = 1000;
dexToolsGetTokenPrice.dateLastRequestMS = 0;

/**
 * @blockchain string E.g., "pulse", "ether", etc.  Full list in DexTools API doc.
 * @tokenAddress string E.g., (use no quotes): `0x51a05d2df463540c2176baddfa946faa0a3b5dc6`.
 * @poolAddresses Array<Array<string>> OPTIONAL From Google Sheets, just do: `{v18, 0}` where v18
 *                is a cell holding the hash that identifies the liquidity pool.  Note: The
 *                last item, '0', must be there because without a second value, sadly, no array is passed;
 *                instead, a string is passed, which this function doesn't handle.
 *                Use this if the price should be pulled from specific pool(s)
 *                Currently only supports a single pool.
 */
function dexToolsGetTokenPrice(blockchain, tokenAddress, poolAddresses) {
  const poolAddress = !!poolAddresses && poolAddresses[0].length > 0 ? poolAddresses[0][0] : "";
  const address = !!poolAddress ? poolAddress : tokenAddress
  const intervalMS = dexToolsGetTokenPrice.FETCH_INTERVAL_SECONDS * 
    dexToolsGetTokenPrice.MILLISECONDS_IN_SECOND;
  const now = Date.now()
  const timeSinceLastRequestMS = now - dexToolsGetTokenPrice.dateLastRequestMS;
  if (timeSinceLastRequestMS >= intervalMS) {
    dexToolsGetTokenPrice.dateLastRequestMS = now;

    return dexToolsFetchTokenPrice(blockchain, address, !!poolAddress);
  } else {
    // For normal JavaScript/Node, restructure to use `setTimeout` and a closure instead of `Utilities.sleep`.
    Utilities.sleep(intervalMS);

    return dexToolsGetTokenPrice(blockchain, tokenAddress, poolAddresses);
  }
}


/**
 * @blockchain string E.g., "pulse", "ether", etc.  Full list in DexTools API doc.
 * @tokenAddress string E.g., (use no quotes): `0x51a05d2df463540c2176baddfa946faa0a3b5dc6`.
 *                pick the best pool. 
 */
function dexToolsFetchTokenPrice(blockchain, address, addressIsPool) {
  const POOL = "pool";
  const TOKEN = "token";

  const options = {
    method: 'GET',
    headers: {
      'x-api-key': dexToolsGetTokenPrice.API_KEY
    }
  };

  const tokenOrPool = !!addressIsPool ? POOL : TOKEN;
    const url = `https://public-api.dextools.io/${dexToolsGetTokenPrice.SUBSCRIPTION_PLAN}` +
    `/v2/${tokenOrPool}/${blockchain}/${address}/price`;

  let price;
  try {
    // For normal web/node instead of Google Apps Script, make function async, use await in caller, and use notes below.
    const response = UrlFetchApp.fetch(url,options);    // Normal web is: an async function with: await fetch(url, options)
    const data = JSON.parse(response.getContentText()); // Normal web is: await response.json();
    price = data.data.price;

    return price;
  } catch (error) {
    // const stringedError = ContentService.createTextOutput(JSON.stringify(error)).getContent();
    // const errMsg = `DexScreener API Error: ${stringedError}`;
    // console.error(errMsg);
    // return errMsg;
    console.error(error);
    return error;
  }
}

/**
 * To debug in Google Apps Script, select this function by the "Debug" command at top of screen.
 * Then run "Debug".
 */
function test() {
    console.log("Test Results");
    console.log(dexToolsGetTokenPrice("pulse", "0x94534EeEe131840b1c0F61847c572228bdfDDE93"));
}
