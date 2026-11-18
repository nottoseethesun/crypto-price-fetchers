# Crypto Price Fetchers

![Crypto Price Fetchers: a green-winged fairy in a sunlit forest holds out a glowing scroll that reads "Hex $0.042" above a rising price line, with gold coins in the air and a white city on the cliffs behind her.](./assets/images/fairy-sprite-price-fetcher_github-social-share-img.jpeg "Crypto Price Fetchers")

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

`fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.gs`,
with the price sources in `getCryptoPriceFromCentralizedExchange-sources.gs`
beside it, is a Google Apps Script that currently fetches the price only at
a point in time in
the past, although "the past" can be just one minute in the past.  It is limited
to tokens traded on the API of the Centralized Exchanges that it currently
supports and also, as a Google Apps Script, cannot handle more than 100 or
so calls at a time.

`fetch-from-centralized-exchange/crypto-price-filler/index.js` is like
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
- The api keys come from the repo's encrypted key file (see
  [Api keys](#api-keys)), not from the script. `crypto-price-fetchers.js`
  hands the DexTools or x1.ninja key to the script's config, which the
  script reads as it sends each request, and
  `getCryptoPriceFromCentralizedExchange.js` hands the CoinGecko key to the
  script as the Script Property it reads in Apps Script.
- The cache lasts while the script is open: for the command line, one run.
- The sheet's menu is not there.

### Install

Node 22 or later. From the repo's top folder:

```bash
npm ci
```

### Api keys

The keys the tools send (CoinGecko's, DexTools' and x1.ninja's, as the top
`config.json` lists them) are kept in `api-keys.json` at the repo's top,
which git ignores, encrypted with a password you choose, as LP Ranger keeps
its keys. To save them, from the repo's top folder:

```bash
npm run api-keys
```

It lists each key, saved or not, never showing its characters, and asks for
each one not saved: the key, then the password, twice the first time,
showing nothing of what is typed. Each key is saved only once its service
takes it; Enter alone skips one. `npm run api-keys -- set dextools`
replaces one.

To keep the password for a terminal, so the tools open their keys without
asking:

```bash
source ./unlock-api-keys.sh
```

It asks for the password once, checks that it opens the keys, and keeps it in
`API_KEYS_PASSWORD` until the terminal closes. Without it, each tool asks for
the password as it starts. The password is kept nowhere on disk, and the keys
only in memory, for one run. Without a saved CoinGecko key, the tools ask
CoinGecko without one, at its lower rate limit.

In Apps Script, the keys are not read from the file: the CoinGecko key is a
Script Property (see the `API KEY` section of the exchange script's header),
and the DexTools and x1.ninja keys are pasted into `crypto-price-fetchers.gs`.

The store itself is `api-key-store/`, a module any Node project can use:
see [its README](./api-key-store/README.md).

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
`openCentralizedExchangePrices({ apiKeys: { coingecko } })` sends a
CoinGecko key, such as the one `unlockProjectKeys` (`api-key-store/`)
opens. Other repos install this one to use the runner, as
`crypto-price-fetchers/apps-script-runner`, and the key store, as
`crypto-price-fetchers/api-key-store`.

## Install

For `./fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.gs`,
and all other scripts in other sub-directories here, see the
`README.md` in that directory.

For `./crypto-price-fetchers.gs`, see the file-header doc in that file.

## Usage

For `./fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.gs`,
and all other scripts in other sub-directories here, see the
`README.md` in that directory.

For `./crypto-price-fetchers.gs`, see the file-header doc in that file.

## Test

For `./fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.gs`,
and all other scripts in other sub-directories here, see the
`README.md` in that directory.

For `./crypto-price-fetchers.gs`, see the file-header doc in that file.

For everything else, from the repo's top folder, the one gate that must
pass before a commit, LP Ranger's: the lint, the tests of the runner, the
Node versions and the key store, crypto-price-filler's tests, and the
security audits:

```bash
npm ci
npm ci --prefix fetch-from-centralized-exchange/crypto-price-filler
npm run check
```

## Documentation

- [`docs/architecture.md`](docs/architecture.md): how the parts fit.
- [`docs/engineering.md`](docs/engineering.md): the files, the gates, the
  tests and CI.
- [`docs/npm-project-commands.md`](docs/npm-project-commands.md): every npm
  command.
