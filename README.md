# Crypto Price Fetchers

## Overview

A collection of scripts useful for fetching the current price and also the price at
a point in time in the past (can even be one minute in the past) of various
crypto tokens.

The need for this arises out of the proliferation of crypto tokens, such that
most tracking services simply cannot fetch the price of many of the great tokens out
there.

Each Google Sheets script here (`.gs`) has a Node version beside it, with the
same name ending in `.js`, for Node programs and the command line. The Node
version runs the same `.gs` file, unchanged, so the two always give the same
answers, and a fix to the script is a fix to both. See
[Node versions of the Sheets scripts](#node-versions-of-the-sheets-scripts)
below.

### Options

`crypto-price-fetchers.gs` is a Google Apps Script that fetches only the current
price, and is limited to tokens that are based on smart-contract technology,
such as in PulseChain, Ethereum, and Solana. The X1 blockchain is supported
here as well, in addition to the blockchains that DexTools already covers — X1
calls are routed through the x1.ninja API since DexTools does not list X1 yet.
See the file's header documentation for details.

`fetch-from-centralized-exchage/getCryptoPriceFromCentralizedExchange.gs` is
a Google Apps Script currently fetches the price only at a point in time in
the past, although "the past" can be just one minute in the past.  It is limited
to tokens traded on the API of the Centralized Exchanges that it currently
supports and also, as a Google Apps Script, cannot handle more than 100 or
so calls at a time.

`fetch-from-centralized-exchage/crypto-price-filler/index.js` is like
`getCryptoPriceFromCentralizedExchange.gs` but, as a NodeJS script, can
handle any load in terms of numbers of price points to fetch.

`crypto-price-fetchers.js` and
`fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js`
are the Node versions of the two Sheets scripts.

## Node versions of the Sheets scripts

A Node version answers as its Sheets function does, because it runs the
Sheets script itself. The runner in `apps-script-runner/` loads the `.gs`
file under Node in a worker thread and supplies the Apps Script services the
script calls: web requests, cache, lock, script properties, sleep, date
formatting and logs.

What differs from the sheet:

- It runs on your computer, so there is no 30-second limit per call and no
  daily cap on web requests.
- Keys come from `config.json` beside the Node version, which git ignores,
  instead of from the script. Copy `config-example.json` beside it to
  `config.json` and fill it in. A key the script reads as it sends each
  request takes effect this way; a value the script works out as it loads,
  such as a url, keeps the value written in the script.
- The cache lasts while the script is open: for the command line, one run.
- The sheet's menu is not there.

### Install

Node 22 or later. From the repo's top folder:

```bash
npm ci
```

### Command line

```bash
node crypto-price-fetchers.js price ether 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
node crypto-price-fetchers.js fdv x1 So11111111111111111111111111111111111111112 --pool CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR
node fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js xtm "2026-01-15 14:30:00" --tz CST --mode low
```

Each prints the number, with exit code 0, or the script's message on
stderr, with exit code 1. `--help` lists the options, `--config <file>`
reads another config file, and `--verbose` shows the script's log on stderr.

### From Node

```js
import { openCentralizedExchangePrices } from './fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js';

const prices = await openCentralizedExchangePrices();
const high = await prices.getCryptoPrice('xtm', '2026-01-15 14:30:00', 'CST', 'high');
await prices.close();
```

The functions take the Sheets arguments and return what the cell would show.
Other repos install this one to use the runner, as
`crypto-price-fetchers/apps-script-runner`.

## Install

For `./fetch-from-centralized-exchage/getCryptoPriceFromCentralizedExchange.gs`,
and all other scripts in other sub-directories here, see the
`README.md` in that directory.

For `./crypto-price-fetchers.gs`, see the file-header doc in that file.

## Usage

For `./fetch-from-centralized-exchage/getCryptoPriceFromCentralizedExchange.gs`,
and all other scripts in other sub-directories here, see the
`README.md` in that directory.

For `./crypto-price-fetchers.gs`, see the file-header doc in that file.

## Test

For `./fetch-from-centralized-exchage/getCryptoPriceFromCentralizedExchange.gs`,
and all other scripts in other sub-directories here, see the
`README.md` in that directory.

For `./crypto-price-fetchers.gs`, see the file-header doc in that file.

For the runner and the Node versions, from the repo's top folder:

```bash
npm ci
npm run lint
npm test
```
