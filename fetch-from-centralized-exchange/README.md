# Fetch Crypto Price from Centralized Exchange

## Overview

**USE AT YOUR OWN RISK: SEE LICENSE FILE IN PARENT DIRECTORY.**

This directory contains utilities for fetching historical
cryptocurrency prices in USD. They are built for tokens that trade
on centralized exchanges (CEXs), such as Bitcoin (BTC), Monero (XMR)
and Tari (XTM), and crypto-price-filler, the tool here that fills a CSV's
price columns on Node, the program that runs JavaScript outside a browser,
prices tokens that trade in a blockchain's pools as well.

A token that trades only on centralized exchanges has no pool, so its
price has to come from an exchange's API, or from a service that
gathers the exchanges' prices: the API of MEXC, an exchange, first, then
those of CoinGecko and CoinPaprika, two such services. A token that
trades in pools, such as HEX on PulseChain, is priced from the pools:
crypto-price-filler asks Moralis and GeckoTerminal, two services that
price a token from its chain's pools, for it before those three.

## Tools

This directory contains two tools for different uses, and a Node
version of the first. The first runs in Google Sheets, Google's
spreadsheet app, as Apps Script, Google's platform for scripts that run
inside its apps:

| Tool | Use | Limits |
| ---- | --- | ------ |
| **The Sheets script**, `src/getCryptoPriceFromCentralizedExchange.gs`, at the repo's top | A price in a spreadsheet's cell | Google stops a cell's call after 30 seconds, and runs at most 30 calls of one person at once. |
| **crypto-price-filler**, `crypto-price-filler/`, started by `bin/crypto-price-filler.js` at the repo's top | Every row of a CSV file, in one run | None of Apps Script's. |
| **The Sheets script's Node version**, `bin/getCryptoPriceFromCentralizedExchange.js`, at the repo's top | One price, from the command line or a Node program | None of Apps Script's; a call keeps to the 25 seconds the script allows a cell. |

---

### 1. Google Apps Script (`getCryptoPriceFromCentralizedExchange.gs`)

A custom `=getCryptoPrice()` function for Google Sheets, which gives
the average of the high and the low, by default, or the high, the low or
the close, of the period around a time. It asks
MEXC for the price first, then CoinGecko, then CoinPaprika. It caches
each answer, and its lock makes the calls of many cells take turns,
so a sheet stays within each service's rate limit.

The script is in three files, in the repo's `src/`, which work as one,
since Apps Script runs every script file of a project in one global
scope:

- [`getCryptoPriceFromCentralizedExchange.gs`](../src/getCryptoPriceFromCentralizedExchange.gs):
  `=getCryptoPrice()`, its settings and the cache.
- [`getCryptoPriceFromCentralizedExchange-sources.gs`](../src/getCryptoPriceFromCentralizedExchange-sources.gs):
  the price sources.
- [`getCryptoPriceFromCentralizedExchange-tests.gs`](../src/getCryptoPriceFromCentralizedExchange-tests.gs):
  the tests to run from the Apps Script editor.

The repo's build step, `npm run build apps-script` (npm, Node's package
manager, runs the commands the repo's `package.json` names), puts the
three files, with the repo's other Sheets scripts and the Crypto Price
Fetchers menu, which runs a spreadsheet's price cells again, in one file
to paste into a spreadsheet, with the CoinGecko and
CoinPaprika keys saved in the repo set at its end: see
[Install in Google Sheets](../README.md#3-install-in-google-sheets) in the
repo's README. Without saved keys, the script asks both services without
a key. The menu's Refresh & freeze historical prices item runs a tab's
`getCryptoPrice` cells again and keeps each price as a number.

The help section of the header of
[`getCryptoPriceFromCentralizedExchange.gs`](../src/getCryptoPriceFromCentralizedExchange.gs),
which the spreadsheet shows under Crypto Price Fetchers > Help, says how
to call the function; the rest of the header covers its settings and
data sources.

---

### 2. Node.js CLI (`crypto-price-filler/`)

A command-line tool for batch processing CSV files with thousands of
timestamps. For a token that trades in pools, it asks Moralis and
GeckoTerminal first; for every token, it then asks MEXC, CoinGecko and
CoinPaprika through the Apps Script's own price sources, run unchanged
under Node, so the sheet and the tool price alike.

The repo's `bin/crypto-price-filler.js` starts it. For detailed
documentation, see the file header in
[`crypto-price-filler/index.js`](./crypto-price-filler/index.js)
and
[`crypto-price-filler/README.md`](./crypto-price-filler/README.md).
It sends the CoinGecko, CoinPaprika and Moralis keys saved, encrypted, in
the repo's key file: see [The api keys](../README.md#2-the-api-keys) in
the repo's README.

---

### 3. Node version of the Apps Script (`bin/getCryptoPriceFromCentralizedExchange.js`)

The repo's `bin/getCryptoPriceFromCentralizedExchange.js` runs
`src/getCryptoPriceFromCentralizedExchange.gs` itself, unchanged, under
Node, so it answers as `=getCryptoPrice()` does, from a Node program or the
command line, run from the repo's top folder:

```bash
node bin/getCryptoPriceFromCentralizedExchange.js xtm "2026-01-15 14:30:00" --tz CST --mode low
```

It sends the CoinGecko and CoinPaprika keys saved, encrypted, in the
repo's key file ([The api keys](../README.md#2-the-api-keys)), asking for
its password first. The rest is in the
[repo's README](../README.md#node-versions-of-the-sheets-scripts), and the
file header in
[`getCryptoPriceFromCentralizedExchange.js`](../bin/getCryptoPriceFromCentralizedExchange.js)
says what differs from the sheet.

---

## Sample Output

A sheet of XTM payouts. Its "$usd price" column holds
`=getCryptoPrice("xtm", C2, "UTC")` and the like, which price each payout
at its date and time:

![A Google Sheet of XTM payouts, each priced in USD by =getCryptoPrice at the payout's date and time](./readme-images/google-sheets-example.png)

## Supported Tokens

Each tool keeps its own list of the ids each service knows a token by:

- **The Apps Script:** the `TOKEN_TO_ID` constant in
  `src/getCryptoPriceFromCentralizedExchange.gs`
- **crypto-price-filler:** `supported-tokens.json`, which also names a
  pool token's contract and chains

Current tokens: BTC, XMR, GRC, XTM (and any token listed on MEXC) in the
Apps Script; BTC, GRC, XTM, XTZ and HEX on PulseChain (`phex`) in
crypto-price-filler.

## Contributing

Contributions are welcome: fork the repo on GitHub, the website that
hosts it, and open a pull request.

**Requirements:**

- All tests must pass
- Each function's cyclomatic complexity is at most 17, as the lint checks
- New features should include tests

## Authors

Christopher M. Balz, with Grok and Claude
