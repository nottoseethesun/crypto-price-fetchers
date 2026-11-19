# Crypto Price Fetchers

![Crypto Price Fetchers: a green-winged fairy in a sunlit forest holds out a glowing scroll that reads "Hex $0.042" above a rising price line, with gold coins in the air and a white city on the cliffs behind her.](./assets/images/fairy-sprite-price-fetcher_github-social-share-img.jpeg "Crypto Price Fetchers")

[![Lint (JS+Apps Script+MD)](https://img.shields.io/github/actions/workflow/status/nottoseethesun/crypto-price-fetchers/ci.yml?branch=main&label=lint)](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/ci.yml)
[![Tests (Node 22/24)](https://img.shields.io/github/actions/workflow/status/nottoseethesun/crypto-price-fetchers/ci.yml?branch=main&label=tests)](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/ci.yml)
[![Security Audit](https://img.shields.io/github/actions/workflow/status/nottoseethesun/crypto-price-fetchers/security-audit.yml?branch=main&label=security)](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/security-audit.yml)

## Overview

Scripts that fetch crypto token prices: the price now, and the price at a
past time, down to the minute.

There are far more crypto tokens than most price-tracking services cover,
so those services have no price for many of them. These scripts ask the
exchanges where such tokens trade.

Each Google Sheets script here (`.gs`) has a Node version beside it, with the
same name ending in `.js`, for Node programs and the command line. The Node
version runs the same `.gs` file, unchanged, so the two always give the same
answers, and a fix to the script is a fix to both. See
[Node versions of the Sheets scripts](#node-versions-of-the-sheets-scripts)
below.

### The Scripts

Each script fits one need: the price now or at a past time, in a sheet or
on a computer.

`crypto-price-fetchers.gs` is a Google Apps Script that gives a token's
current price, and its fully diluted value. It asks DexTools, so it covers
tokens on the chains DexTools lists, such as PulseChain, Ethereum and
Solana. For X1, which DexTools does not list, it asks x1.ninja instead. The
file's header says how to use it.

`fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.gs`,
with its price sources in `getCryptoPriceFromCentralizedExchange-sources.gs`
beside it, is a Google Apps Script that gives a token's price at a past
time, as recent as a minute ago. It asks the centralized exchanges it
supports, so it covers the tokens they trade. Within Apps Script's limits,
it handles about 100 calls at a time.

`fetch-from-centralized-exchange/crypto-price-filler/index.js` does the
same job on a computer, for a CSV file of any length: it fills in the
price of each row. It runs outside Apps Script, so Apps Script's limits do
not apply to it.

`crypto-price-fetchers.js` and
`fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js`
are the Node versions of the two Sheets scripts.

## Node versions of the Sheets scripts

A Node version lets a Node program or the command line call a Sheets
function, and get what its cell would show. It runs the Sheets script
itself. The runner in `apps-script-runner/` loads the `.gs` file under
Node, and supplies the Apps Script services the script calls: web
requests, cache, lock, script properties, sleep, date formatting and logs.
It runs the script in a worker thread, so the script can wait for each web
request as it does in Apps Script ([why](docs/architecture.md#the-runner)).

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

The Node versions need Node 22 or later, and the repo's packages. From the
repo's top folder:

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

Each Node version is also a command line. These ask for USDC's price on
Ethereum, a token's fully diluted value on X1 from one pool, and XTM's low
at a past minute:

```bash
node crypto-price-fetchers.js price ether 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
node crypto-price-fetchers.js fdv x1 So11111111111111111111111111111111111111112 --pool CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR
node fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js xtm "2026-01-15 14:30:00" --tz CST --mode low
```

Each prints the number, with exit code 0, or the script's message on
stderr, with exit code 1. `--help` lists the options, `--config <file>`
reads another config file, and `--verbose` shows the script's log on stderr.

### From Node

A Node program imports a Node version, opens it once, and calls its
functions:

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

## Install and Usage in Google Sheets

Each Sheets script is pasted into a sheet's Apps Script project. Its own
documentation says how to install it, set its keys and call it from a cell:

- `crypto-price-fetchers.gs`: the header of that file.
- The exchange script and crypto-price-filler:
  [`fetch-from-centralized-exchange/README.md`](fetch-from-centralized-exchange/README.md).

## Test

The repo's tests run on a computer, before every commit, in one gate,
LP Ranger's: the lint, the tests of the runner, the Node versions and the
key store, crypto-price-filler's tests, and the security audits. From the
repo's top folder:

```bash
npm ci
npm ci --prefix fetch-from-centralized-exchange/crypto-price-filler
npm run check
```

The Sheets scripts also hold tests that run only in Apps Script, by hand.
[How the Sheets scripts are tested](docs/engineering.md#how-the-sheets-scripts-gs-are-tested)
sets the two kinds apart.

## Documentation

The `docs/` folder holds three references:

- [`docs/architecture.md`](docs/architecture.md): how the parts fit.
- [`docs/engineering.md`](docs/engineering.md): the files, the gates, the
  tests and CI.
- [`docs/npm-project-commands.md`](docs/npm-project-commands.md): every npm
  command.
