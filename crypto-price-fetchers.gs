/**
 * See the README.md file for installation and usage instructions. 
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

// - - - Public Functions

/**
 * Gets the price of a token, in $usd.
 * 
 * @blockchain string E.g., "pulse", "ether", etc.  Full list in DexTools API doc.
 * @tokenAddress string E.g., (use no quotes):
 *               `0x51a05d2df463540c2176baddfa946faa0a3b5dc6`.
 * @poolAddresses Array<Array<string>> OPTIONAL Use this when you want to specify 
 *                the liquidity pool to pull the price from.
 *                From Google Sheets, just do: `{v18, 0}` where v18
 *                is a cell holding the hash that identifies the liquidity pool.  Note:
 *                The last item, '0', must be there because without a second value,
 *                sadly, no array is passed; instead, a string is passed, which this
 *                function doesn't handle.  Currently only supports a single pool.
 * @return number The token price, in $usd
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

/**
 * Gets the Fully Diluted Value of a token, in $usd.
 * 
 * @blockchain string E.g., "pulse", "ether", etc.  Full list in DexTools API doc.
 * @tokenAddress string E.g., (use no quotes):
 *               `0x51a05d2df463540c2176baddfa946faa0a3b5dc6`.
 * @return number Fully Diluted Value of a token, in $usd
 */ 
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

// - - - "Private" Functions.  These are support/detail functions and can be considered "private" functions.

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
  const TOKEN_SEGMENT = "token"
  const url = `${cpf_getUrlFirstSection()}/${TOKEN_SEGMENT}/${blockchain}/${tokenAddress}/info`;

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
