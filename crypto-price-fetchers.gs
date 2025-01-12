/**
 * Add this script as a Google Apps Script, via the Extensions menu on a Google Sheet.
 * Example usage in a Google Sheets cell (use no quotes): `= dexToolsGetTokenPrice("pulse", U2)`.
 *
 * Data Refresh: Use the built-in Google Sheets Trigger, selecting "Time-based" and this function.
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

async function test() {
    const price = await dexToolsGetTokenPrice("pulse", "0x94534EeEe131840b1c0F61847c572228bdfDDE93");
    console.log("Price: " + price);
}

/*
test();
*/

