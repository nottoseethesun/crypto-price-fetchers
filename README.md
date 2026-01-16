# Crypto Price Fetchers

## Overview

A collection of scripts useful for fetching the current price and also the price at
a point in time in the past (can even be one minute in the past) of various
crypto tokens.

The need for this arises out of the proliferation of crypto tokens, such that
most tracking services simply cannot fetch the price of many of the great tokens out
there.

Note that for the files that are for Google Sheets, Google Sheets does not use the
now-standard `fetch` API.  So, to convert these scripts to work under Web or NodeJS,
you will need to use `fetch` with `async` and `await` as per normal for those platforms.

### Options

`crypto-price-fetchers.gs` currently fetches only the current price, and is limited to
tokens that are based on smart-contract technology, such as in PulseChain, Ethereum,
and Solana.

`fetch-from-centralized-exchage/getCryptoPriceFromCentralizedExchange.gs` currently
fetches the price only at a point in time in the past, although "the past"
can be just one minute in the past.  It is limited to tokens traded on the
API of the Centralized Exchanges that it currently supports and also, as a Google
Apps Script, cannot handle more than 100 or so calls at a time.

`fetch-from-centralized-exchage/crypto-price-filler/index.js` is like
`getCryptoPriceFromCentralizedExchange.gs` but can handle any load in terms of
numbers of price points to fetch.

## Install

Note: For `fetch-from-centralized-exchage/getCryptoPriceFromCentralizedExchange.gs`,
and all other scripts in other sub-directories here, see the
`README.md` in that directory.

Add the script `./crypto-price-fetchers.gs` as a Google Apps Script, via the "Extensions"
menu on a Google Sheet: To do this, first start at the "Extensions" menu at the
top-mid-center of your Google Sheet. Then click on the "Apps Script" menu option.
From there, click on the big "+" button at top left, to add a file.  Then, copy all of
the file contents of `./crypto-price-fetchers.gs` onto your clipboard, and next,
paste the file contents right in the Google Apps Script new file text editor.

Then, update the value of the program constant `API_KEY` with the your API Key
that you got from DexTools e.g. at <https://developer.dextools.io/> .

Next, do the same for `SUBSCRIPTION_PLAN` using for the value, DexTools subscription
plan categories e.g. "trial" or "standard".  Finally for the remaining settable
values, look under the heading "User-settable Values" in the program code.
Set any of those that you want to customize to your desired values.

Next, use the built-in Google Sheets Trigger feature, so that your prices and
other values, such as Fully Diluted Value, get updated on a regular basis.  You'll
now do this for both functions, `dexToolsGetTokenPrice`, `dexToolsGetTokenFDV`,
starting with `dexToolsGetTokenPrice` (although it could be either one to start).
To do this, on the right-hand vertical tab menu, hover over the alarm clock icon and
select "Triggers".  On the bottom right of the screen, click the "Add Trigger" button.
The settings in the dialog should be all defaults except: The function you want
to run (to start, `dexToolsGetTokenPrice`), event source (should be "Time-driven"),
type of time-based trigger ("Minutes timer"), and minute interval
("Every 10 minutes").  Click "Save" on the dialog and then, do the same for the
function, `dexToolsGetTokenFDV`.

Now, you're good to go: You may proceed to the "Usage" instructions below.

## Usage

The functions are used inside of Google Sheets cells.

### dexToolsGetTokenPrice

#### Option 1 of 2: Let the API Pick Best Liquidity Pool

This function pulls a token price from either the liquidity pool that the API determines
is best, or from the liquidity pool specified in an optional parameter described below.

Example usage in a Google Sheets cell, to pull a token price from the liquidity pool that
the API determines is best:

```javascript
    = dexToolsGetTokenPrice("pulse", U2)
```

In the example above, the blockchain is PulseChain (see the DexTools.io documentation
for all the signifiers), and the variable`U2` refers to a Google Sheets data cell in
Column "U", Row 2 that has the string value that is the token's Contract Address, such
as e.g. (use no quote marks) `0x6B175474E89094C44Da98b954EedeAC495271d0F`.

#### Option 2 of 2: Specify the Liquidity Pool

If for some reason the API is picking a liquidity pool that doesn't provide a
representative token price, then this tool supports optionally specifying the
liquidity pool.  Example:

```javascript
    = dexToolsGetTokenPrice("pulse", U50, {V50, 0})
```

In the example above, everything is the same as in the first example given above, except
that we've added on an additional, optional parameter.  Due to the fact that, sadly,
Google Sheets only preserves the required data type here of Array if there are at least
two items in the array declaration in the Google Sheet data cell, we have a second
placeholder aka "dummy" parameter of `0`.  The curly braces seen in the example are
the array declaration brackets that Google Sheets uses.  The variable `V50`
refers to a Google Sheets data cell that holds the hash identifier (which looks
similar to a token's Contract Address) for the liquidity pool specified.  For example,
that could be `0x2cc846fff0b08fb3bffad71f53a60b4b6e6d6482`.

### dexToolsGetTokenFDV

This function pulls the Fully Diluted Value of the token.  Refer to the usage instructions
for `dexToolsGetTokenPrice` above for details (note that `dexToolsGetTokenFDV` does not
support specifying a liquidity pool).

## Test

Select the `test` function in the Google Apps Script editor, and click "Debug".  Test should run without error.
