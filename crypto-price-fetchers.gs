/**
 * Add this script as a Google Apps Script, via the Extensions menu on a Google Sheet.
 */

function dexToolsGetTokenPrice(blockchain, tokenAddress) {
  const API_KEY = “put-your”-api-key-here;
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

