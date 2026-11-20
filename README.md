# Crypto Price Fetchers

![A green fairy with translucent emerald wings, a leafy crown, and a flowing green dress hovers in a misty ancient forest, reaching toward a glowing parchment scroll that displays “HEX $0.042” along with a rising chart and interconnected crypto symbols. Soft golden light rays filter through the trees while a Rivendell-inspired castle and floating coins appear in the background.](./assets/images/fairy-sprite-price-fetcher_github-social-share-img_1280-640.jpeg "Crypto Price Fetchers")

[![Lint (JS+Apps Script+MD)](https://img.shields.io/github/actions/workflow/status/nottoseethesun/crypto-price-fetchers/ci.yml?branch=main&label=lint)](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/ci.yml)
[![Tests (Node 22/24)](https://img.shields.io/github/actions/workflow/status/nottoseethesun/crypto-price-fetchers/ci.yml?branch=main&label=tests)](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/ci.yml)
[![Security Audit](https://img.shields.io/github/actions/workflow/status/nottoseethesun/crypto-price-fetchers/security-audit.yml?branch=main&label=security)](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/security-audit.yml)

## Overview

Scripts that fetch crypto token prices in USD: the price now, and the
price at a past time, down to the minute.

There are far more crypto tokens than most price-tracking services cover,
so those services have no price for many of them. These scripts ask where
such tokens trade: the centralized exchanges that list them, and, for a
token that trades in a blockchain's pools, the services that price those
pools.

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
beside it, is a Google Apps Script that gives a token's high, low or
closing price at a past time, as recent as a minute ago. It asks MEXC,
then CoinGecko, then CoinPaprika, so it covers the tokens they price.
Within Apps Script's limits, it handles about 100 calls at a time.

`fetch-from-centralized-exchange/crypto-price-filler/index.js` does that
job on a computer, for a CSV file of any length: it fills in the price of
each row. It asks the exchange script's own three price sources, run under
Node, and, for a token that trades in pools, Moralis and GeckoTerminal
first (see [Tokens that trade in pools](#tokens-that-trade-in-pools)). It
runs outside Apps Script, so Apps Script's limits do not apply to it.

`crypto-price-fetchers.js` and
`fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js`
are the Node versions of the two Sheets scripts.

## Install

Every step after the first is optional. The tools run without api keys,
with what each service gives without one (the table in step 2 says what),
and a Sheets script needs the build step only to carry keys.

### 1. Node and the packages

The tools need Node 22 or later. From the repo's top folder, install the
repo's packages, then crypto-price-filler's, which uses both:

```bash
npm ci
npm ci --prefix fetch-from-centralized-exchange/crypto-price-filler
```

### 2. The api keys

The keys the tools send are kept in `api-keys.json` at the repo's top,
which git ignores, encrypted with one password you choose, as LP Ranger
keeps its keys. The top `config.json` lists the services they are for:

| Service     | What it prices                                                          | Without a key                      |
| ----------- | ----------------------------------------------------------------------- | ---------------------------------- |
| CoinGecko   | Past prices, for the exchange script and crypto-price-filler            | Asked without one, at a lower rate |
| CoinPaprika | Past prices, the same; a key is for one of its paid plans               | Its free server, with less history |
| Moralis     | Past prices of tokens that trade in pools, for crypto-price-filler      | Not asked                          |
| DexTools    | Current prices and fully diluted values, for `crypto-price-fetchers.gs` | No price: DexTools needs a key     |
| x1.ninja    | The same, on X1                                                         | No price: x1.ninja needs a key     |

To save them, from the repo's top folder:

```bash
npm run api-keys
```

It lists each key, saved or not, never showing its characters, and asks for
each one not saved: the key, then the password, twice the first time,
showing nothing of what is typed. Each key is saved only once its service
takes it; Enter alone skips one. `npm run api-keys -- set coinpaprika`
replaces one.

To keep the password for a terminal, so the tools open their keys without
asking:

```bash
source ./unlock-api-keys.sh
```

It asks for the password once, checks that it opens the keys, and keeps it in
`API_KEYS_PASSWORD` until the terminal closes. Without it, each tool asks for
the password as it starts. The password is kept nowhere on disk, and the keys
only in memory, for one run.

The store itself is `api-key-store/`, a module any Node project can use:
see [its README](./api-key-store/README.md).

### 3. The Sheets scripts, with their keys

A Sheets script runs in Google's Apps Script, which cannot read the key
file, so the keys go into the script you paste. The build step writes them
in, so no key is typed into a script by hand:

```bash
npm run build apps-script
```

It opens the keys as the tools do, then puts each script file on the
clipboard in turn, the keys and the values of the `config.json` its Node
version reads set at the end of the script's first file. For each one it
says where to paste it: in the spreadsheet, Extensions > Apps Script, the
script file of that name. It waits for Enter between files, and clears the
clipboard after the last. `npm run build apps-script crypto-price-fetchers`
gives one script only.

The clipboard is reached through the desktop's own tool: xclip or wl-copy
on Linux, pbcopy on macOS, clip on Windows. When none is installed, the
build offers to install one with `sudo apt install`, where it can, and runs
the install on a yes; sudo asks for your computer's password at its own
prompt. Declined, the build says first that your api keys will be written
to disk in the clear, then writes each file to `build/apps-script/`, which
git ignores, readable by you alone, and prints only their paths. Delete
them once they are pasted.

A copy with keys in it is for pasting into Apps Script only: never commit
or share it. A clipboard manager that keeps a history of what was copied
keeps the scripts too.

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
  [The api keys](#2-the-api-keys)), not from the script. Each Node version
  sets them in the script's config as it opens the script, as the build
  step sets them in the copy it gives for the sheet.
- The cache lasts while the script is open: for the command line, one run.
- The sheet's menu is not there.

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
`openCentralizedExchangePrices({ apiKeys: { coingecko, coinpaprika } })`
sends the keys given, such as those `unlockProjectKeys` (`api-key-store/`)
opens. `openCentralizedExchangeSources` opens the script's three price
sources instead, each taking an id, a time in UTC milliseconds and a
target, as crypto-price-filler asks them.

## Tokens that trade in pools

A token that trades in a blockchain's pools, such as HEX on PulseChain, is
priced by the services that read those pools, in LP Ranger's order:
Moralis first, which gives the price at the block the chain had at the
time, when a Moralis key is saved; then GeckoTerminal, which gives the
candle of the pool it ranks deepest among those that traded in the last
day, for the last 180 days. Their clients are in `dex-prices/`, with the
one loop that sends a request again when a service refuses it as one too
many, which every client shares.

crypto-price-filler prices such a token this way, and falls back to
CoinGecko and CoinPaprika. Other repos install this one to use the
clients, as `crypto-price-fetchers/dex-prices/geckoterminal`,
`crypto-price-fetchers/dex-prices/moralis` and
`crypto-price-fetchers/dex-prices/web-request`, alongside the runner, as
`crypto-price-fetchers/apps-script-runner`, and the key store, as
`crypto-price-fetchers/api-key-store`.

## Projects that install this one

A project that installs this repo from GitHub names it with a ref: `main`
for its main branch, or `semver:*` for its latest release, the highest
version tag. The project's lockfile keeps the commit the ref named when the
lockfile was made, and `npm ci` installs that commit.

This repo's bin, `github-project-deps`, sets every dependency a project
installs from GitHub to one of the two, and makes the project's lockfiles
again, so the newest commit of main, or the newest release, is installed.
A project runs it as `npm run github-project-deps -- main` or
`npm run github-project-deps -- release`; `--help` says more.
[Which version they install](docs/architecture.md#which-version-they-install)
explains how it works.

## Summ CSV files

Summ, the crypto tax service, imports a CSV file in its own layout and
takes what the file says as written. `summ-csv/` writes those files: it
checks every row, such as one token per row and a contract address on
every token, and writes nothing while any row breaks a rule. From the
repo's top folder:

```bash
npm run summ-csv -- --rows rows.json --template advanced-template-reference.csv --out missing.csv
```

A program imports `writeSummCsv` from `crypto-price-fetchers/summ-csv`
instead. [Its README](./summ-csv/README.md) gives the rules and the form of
a row.

## Usage in Google Sheets

Each Sheets script is pasted into a sheet's Apps Script project, best as
the build step gives it (see
[The Sheets scripts, with their keys](#3-the-sheets-scripts-with-their-keys)).
Its own documentation says how to call it from a cell:

- `crypto-price-fetchers.gs`: the header of that file.
- The exchange script and crypto-price-filler:
  [`fetch-from-centralized-exchange/README.md`](fetch-from-centralized-exchange/README.md).

## Test

The repo's tests run on a computer, before every commit, in one gate,
LP Ranger's: the lint, the tests of the runner, the Node versions, the
build step, the price clients, the key store, the versions tool and the
Summ CSV writer, crypto-price-filler's tests, and the security audits. From the repo's top folder:

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
