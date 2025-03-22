/**
 * Add this script as a Google Apps Script, via the Extensions menu on a Google Sheet.
 * Example usage in a Google Sheets cell, to pull a token price from the best liquidity pool (the API 
 * picks the liquidity pool):
 *
 *   = dexToolsGetTokenPrice("pulse", U2)
 *
 * In the example above, the blockchain is PulseChain (see the DexTools.io documentation for all the 
 * signifiers), and the variable`U2` refers to a Google Sheets data cell in Column "U", 
 * Row 2 that has the string value that is the token's Contract Address, such as e.g. 
 * (use no quote marks) `0x6B175474E89094C44Da98b954EedeAC495271d0F`.
 *
 * If for some reason the API is picking a liquidity pool that doesn't provide a representative token
 * price, then this tool supports optionally specifying the liquidity pool.  Example:
 * 
 *  = dexToolsGetTokenPrice("pulse", U50, {V50, 0})
 *
 * In the example above, everything is the same as in the first example given above, except that
 * we've added on an additional, optional parameter.  Due to the fact that, sadly, Google Sheets
 * only preserves the required data type here of Array if there are at least two items in the 
 * array declaration in the Google Sheet data cell, we have a second placeholder aka "dummy" parameter
 * of `0`.  The curly braces seen in the example are the array declaration brackets that Google
 * Sheets uses.  The variable `V50` refers to a Google Sheets data cell that holds the hash identifier
 * (which looks similar to a token's Contract Address) for the liquidity pool specified.  For example, 
 * that could be `0x2cc846fff0b08fb3bffad71f53a60b4b6e6d6482`.
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
dexToolsGetTokenPrice.API_KEY = 'Hmy2LRTNg12Zx5X69I45D5xJY4WOCAli1xOYcC1Y'; // Update with your api key
dexToolsGetTokenPrice.SUBSCRIPTION_PLAN = 'standard'; // Update with your subscription level
dexToolsGetTokenPrice.FETCH_INTERVAL_SECONDS = 3; // Used to avoid hitting API rate limits
dexToolsGetTokenPrice.API_HOST = "https://public-api.dextools.io";
dexToolsGetTokenPrice.API_VERSION = "v2"; // Will rarely change

// Program constants
dexToolsGetTokenPrice.MILLISECONDS_IN_SECOND = 1000;
dexToolsGetTokenPrice.INTERVAL_MS = dexToolsGetTokenPrice.FETCH_INTERVAL_SECONDS * 
  dexToolsGetTokenPrice.MILLISECONDS_IN_SECOND;
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
  const now = Date.now()
  const timeSinceLastRequestMS = now - dexToolsGetTokenPrice.dateLastRequestMS;
  if (timeSinceLastRequestMS >= dexToolsGetTokenPrice.INTERVAL_MS) {
    dexToolsGetTokenPrice.dateLastRequestMS = now;

    return dexToolsFetchTokenPrice(blockchain, address, !!poolAddress);
  } else {
    // For normal JavaScript/Node, restructure to use `setTimeout` and a closure instead of `Utilities.sleep`.
    Utilities.sleep(dexToolsGetTokenPrice.INTERVAL_MS);

    return dexToolsGetTokenPrice(blockchain, tokenAddress, poolAddresses);
  }
}

function dexToolsGetTokenFDV(blockchain, tokenAddress) {
  const now = Date.now()
  const timeSinceLastRequestMS = now - dexToolsGetTokenPrice.dateLastRequestMS;
  if (timeSinceLastRequestMS >= dexToolsGetTokenPrice.INTERVAL_MS) {
    dexToolsGetTokenPrice.dateLastRequestMS = now;

    return dexToolsFetchTokenInfo(blockchain, tokenAddress).fdv;
  } else {
    // For normal JavaScript/Node, restructure to use `setTimeout` and a closure instead of `Utilities.sleep`.
    Utilities.sleep(dexToolsGetTokenPrice.INTERVAL_MS);

    return dexToolsGetTokenFDV(blockchain, tokenAddress);
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

  const tokenOrPool = !!addressIsPool ? POOL : TOKEN;
  const url = `${cpf_getUrlFirstSection()}/${tokenOrPool}/${blockchain}/${address}/price`;

  let price;
  try {
    // For normal web/node instead of Google Apps Script, make function async, use await in caller, and use notes below.
    const response = UrlFetchApp.fetch(url, cpf_getOptionsConf());    // Normal web is: an async function with: await fetch(url, options)
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

function dexToolsFetchTokenInfo(blockchain, tokenAddress) {
  const url = `${cpf_getUrlFirstSection()}/${blockchain}/${tokenAddress}/info`;

  try {
    const response = UrlFetchApp.fetch(url, cpf_getOptionsConf()); // See comments in `dexToolsFetchTokenPrice`
    const data = JSON.parse(response.getContentText());

    return data.data;
  } catch (error) {
    console.error(error);
    return error;
  }
}

function cpf_getUrlFirstSection() {
  const firstPart = `${dexToolsGetTokenPrice.API_HOST}/${dexToolsGetTokenPrice.SUBSCRIPTION_PLAN}` +
    `/${dexToolsGetTokenPrice.API_VERSION}`;

  return firstPart;
}

function cpf_getOptionsConf() {
  const optionsConf = {
    method: 'GET',
    headers: {
      'x-api-key': dexToolsGetTokenPrice.API_KEY
    }
  };

  return optionsConf; 
}

/**
 * To debug in Google Apps Script, select this function by the "Debug" command at top of screen.
 * Then run "Debug".
 */
function cpf_test() {
    console.log("Test Results");
    console.log(dexToolsGetTokenPrice("pulse", "0xF84b84dAAce6Ac00DbBAed26CA32Ff3570Aaf66C"));
    console.log(dexToolsGetTokenFDV("pulse", "0xF84b84dAAce6Ac00DbBAed26CA32Ff3570Aaf66C"));
}
