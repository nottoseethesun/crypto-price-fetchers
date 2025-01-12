/**
 * Add this script as a Google Apps Script, via the Extensions menu on a Google Sheet.
 * Example usage in a Google Sheets cell:
 *
 *   = dexToolsGetTokenPrice("pulse", U2)
 *
 * Usage: Update API_KEY with the one you got from DexTools e.g. at https://developer.dextools.io/ , 
 *        and your SUBSCRIPTION_PLAN using for the value, DexTools categories e.g. "trial". 
 *
 * Data Refresh: Use the built-in Google Sheets Trigger, selecting "Time-based" and this function.
 *
 * Test: See the `test` function, below.
 *
 * @blockchain string E.g., "pulse", "ether", etc.  Full list in DexTools API doc.
 * @tokenAddress string E.g., (use no quotes): `0x51a05d2df463540c2176baddfa946faa0a3b5dc6`.
 */
function dexToolsGetTokenPrice(blockchain, tokenAddress) {
  const API_KEY = 'put-your-api-key-here';
  const SUBSCRIPTION_PLAN = 'trial'; // update with your subscription level

  const options = {
    method: 'GET',
    headers: {
      'x-api-key': API_KEY
    }
  };

  const url = `https://public-api.dextools.io/${SUBSCRIPTION_PLAN}/v2/token/${blockchain}/${tokenAddress}/price`;

  let price;
  try {
    // For normal web/node instead of Google Apps Script, make function async, use await in caller, and use notes below.
    const response = UrlFetchApp.fetch(url,options);    // Normal web is: an async function with: await fetch(url, options)
    const data = JSON.parse(response.getContentText()); // Normal web is: await response.json();
    console.log("Here is the data");
    console.log(data);
    price = data.data.price;

    return price;
  } catch (error) {
    console.error(error);
    return error;
  }
}

/**
 * To debug in Google Apps Script, select this function by the "Debug" command at top of screen.
 * Then run "Debug".
 */
function test() {
    dexToolsGetTokenPrice("pulse", "0x94534EeEe131840b1c0F61847c572228bdfDDE93");
}
