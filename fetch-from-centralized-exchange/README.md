# Fetch Crypto Price from Centralized Exchange

## Overview

**USE AT YOUR OWN RISK: SEE LICENSE FILE IN PARENT DIRECTORY.**

This directory contains utilities for fetching historical
cryptocurrency prices in USD. They are built for tokens that trade
on centralized exchanges (CEXs), such as Bitcoin (BTC), Monero (XMR)
and Tari (XTM), and crypto-price-filler, the Node tool here that fills a
CSV's price columns, prices tokens that trade in a blockchain's pools as
well.

A token that trades only on centralized exchanges has no pool, so its
price has to come from an exchange's API, or from a service that
gathers the exchanges' prices: the API of MEXC, an exchange, first, then
those of CoinGecko and CoinPaprika, two such services. A token that
trades in pools, such as HEX on PulseChain, is priced from the pools:
crypto-price-filler asks Moralis and GeckoTerminal, two services that
price a token from its chain's pools, for it before those three.

## Tools

This directory contains two tools for different uses, and a Node
version of the first:

| Tool                                | Use Case                          | Capacity              |
| ----------------------------------- | --------------------------------- | --------------------- |
| **Google Apps Script**              | Google Sheets                     | ~100 calls per run    |
| **Node.js CLI**                     | Batch processing CSVs             | Thousands of rows     |
| **Node version of the Apps Script** | Node programs and one-off lookups | No Apps Script limits |

---

### 1. Google Apps Script (`getCryptoPriceFromCentralizedExchange.gs`)

A custom `=getCryptoPrice()` function for Google Sheets, which gives
the high, the low or the close of the period around a time. It asks
MEXC for the price first, then CoinGecko, then CoinPaprika. It caches
each answer, and its lock makes the calls of many cells take turns,
so a sheet stays within each service's rate limit.

The script is in three files, each pasted into a script file of its own in
Apps Script, which loads a project's script files into one scope:

- [`getCryptoPriceFromCentralizedExchange.gs`](./getCryptoPriceFromCentralizedExchange.gs):
  `=getCryptoPrice()`, its settings, the cache and the menu.
- [`getCryptoPriceFromCentralizedExchange-sources.gs`](./getCryptoPriceFromCentralizedExchange-sources.gs):
  the price sources.
- [`getCryptoPriceFromCentralizedExchange-tests.gs`](./getCryptoPriceFromCentralizedExchange-tests.gs):
  the tests to run from the Apps Script editor, which the sheet does not
  need.

The repo's build step, `npm run build apps-script`, gives the three files
one at a time on the clipboard, with the CoinGecko and CoinPaprika keys
saved in the repo set at the end of the first, and says where to paste
each: see [Install](../README.md#3-the-sheets-scripts-with-their-keys) in
the repo's README. Pasted as committed, the script asks both services
without a key.

For detailed usage, configuration, and data-source documentation, see the
file header in
[`getCryptoPriceFromCentralizedExchange.gs`](./getCryptoPriceFromCentralizedExchange.gs).

---

### 2. Node.js CLI (`crypto-price-filler/`)

A command-line tool for batch processing CSV files with thousands of
timestamps. For a token that trades in pools, it asks Moralis and
GeckoTerminal first; for every token, it then asks MEXC, CoinGecko and
CoinPaprika through the Apps Script's own price sources, run unchanged
under Node, so the sheet and the tool price alike.

For detailed documentation, see the file header in
[`crypto-price-filler/index.js`](./crypto-price-filler/index.js)
and
[`crypto-price-filler/README.md`](./crypto-price-filler/README.md).
It sends the CoinGecko, CoinPaprika and Moralis keys saved, encrypted, in
the repo's key file: see [The api keys](../README.md#2-the-api-keys) in
the repo's README.

---

### 3. Node version of the Apps Script (`getCryptoPriceFromCentralizedExchange.js`)

Runs `getCryptoPriceFromCentralizedExchange.gs` itself, unchanged, under
Node, so it answers as `=getCryptoPrice()` does, from a Node program or the
command line:

```bash
node getCryptoPriceFromCentralizedExchange.js xtm "2026-01-15 14:30:00" --tz CST --mode low
```

It sends the CoinGecko and CoinPaprika keys saved, encrypted, in the
repo's key file ([The api keys](../README.md#2-the-api-keys)), asking for
its password first. The rest is in the
[repo's README](../README.md#node-versions-of-the-sheets-scripts), and the
file header in
[`getCryptoPriceFromCentralizedExchange.js`](./getCryptoPriceFromCentralizedExchange.js)
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
  `getCryptoPriceFromCentralizedExchange.gs`
- **crypto-price-filler:** `supported-tokens.json`, which also names a
  pool token's contract and chains

Current tokens: BTC, XMR, GRC, XTM (and any token listed on MEXC) in the
Apps Script; BTC, GRC, XTM, XTZ and HEX on PulseChain (`phex`) in
crypto-price-filler.

## Contributing

Contributions are welcome: fork the repo on GitHub and open a
pull request.

**Requirements:**

- All tests must pass
- Code must maintain low cyclomatic complexity (~17 max)
- New features should include tests

## Authors

Christopher M. Balz, with Grok and Claude
