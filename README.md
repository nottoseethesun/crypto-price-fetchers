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
current price, and its fully diluted value. It asks DexTools, a service
that prices tokens from the pools of decentralized exchanges, so it covers
tokens on the chains DexTools lists, such as PulseChain, Ethereum and
Solana. For X1, which DexTools does not list, it asks x1.ninja, a service
that does the same for X1, instead.

`fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.gs`,
with its price sources in `getCryptoPriceFromCentralizedExchange-sources.gs`
beside it, is a Google Apps Script that gives a token's high, low or
closing price at a past time, as recent as a minute ago. It asks MEXC, a
centralized exchange, then CoinGecko, then CoinPaprika, two services that
gather the exchanges' prices, so it covers the tokens they price. Within
Apps Script's limits, it handles about 100 calls at a time.

`crypto-price-fetchers-menu.gs` adds the Crypto Price Fetchers menu to the
spreadsheet. Its items run the price cells again, clear cells stuck on
`#ERROR!` or on a busy message, replace past prices' formulas with their
numbers, and show Help:
how to use each function, made from the help section of each script's
header.

The build step puts these scripts in one file, with the saved api keys set
in it, for one paste into a spreadsheet (see
[Install in Google Sheets](#3-install-in-google-sheets)). It can add DEX
Screener's own Google Sheets functions, such as `DEX_SCREENER_PAIR_PROP`,
downloaded from DEX Screener's repo; this repo holds none of their code.

crypto-price-filler, `fetch-from-centralized-exchange/crypto-price-filler/index.js`,
does that job on a computer, for a CSV file of any length: it fills in the
price of each row. It asks the exchange script's own three price sources,
run under Node, and, for a token that trades in pools, Moralis and
GeckoTerminal first, two services that price a token from its chain's
pools (see [Tokens that trade in pools](#tokens-that-trade-in-pools)). It
runs outside Apps Script, so Apps Script's limits do not apply to it.

`crypto-price-fetchers.js` and
`fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js`
are the Node versions of the two Sheets scripts.

## Install

Step 1 installs Node and the packages, which every tool needs. Step 2
saves the api keys, each of them optional: with none saved, a tool asks
each service without a key, and gets what the table in step 2 says. Step 3
puts the Sheets scripts into a spreadsheet, as the one file the build step
gives.

### 1. Node and the packages

The tools need Node 22 or later. From the repo's top folder, install the
repo's packages, then crypto-price-filler's, which uses both:

```bash
npm ci
npm ci --prefix fetch-from-centralized-exchange/crypto-price-filler
```

### 2. The api keys

The keys the tools send are kept in `api-keys.json` at the repo's top,
which git ignores, encrypted with one password you choose, by this repo's
key store, `api-key-store/`, which keeps keys as LP Ranger, the owner's bot
that manages his 9mm V3 liquidity positions, keeps its own. The top
`config.json` lists the services they are for:

| Service     | What it prices                                                          | Without a key                      |
| ----------- | ----------------------------------------------------------------------- | ---------------------------------- |
| CoinGecko   | Past prices, for the exchange script and crypto-price-filler            | Asked without one, at a lower rate |
| CoinPaprika | Past prices, the same; a key is for one of its paid plans               | Its free server, with less history |
| Moralis     | Past prices of tokens that trade in pools, for crypto-price-filler      | Not asked                          |
| DexTools    | Current prices and fully diluted values, for `crypto-price-fetchers.gs` | No price: DexTools needs a key     |
| x1.ninja    | The same, on X1                                                         | No price: x1.ninja needs a key     |

`npm run api-keys` runs the key store's manager, `manage-api-keys.js`. To
save the keys, from the repo's top folder:

```bash
npm run api-keys
```

It lists each key, saved or not, never showing its characters, and asks for
each one not saved: the key, then the password, twice the first time,
showing nothing of what is typed. Each key is saved only once its service
takes it; Enter alone skips one. `npm run api-keys -- set coinpaprika`
replaces one.

To keep the password for a terminal, so the tools open their keys without
asking, run `unlock-api-keys.sh`, a script in the repo's top folder:

```bash
source ./unlock-api-keys.sh
```

It asks for the password once, checks that it opens the keys, and keeps it in
`API_KEYS_PASSWORD` until the terminal closes. Without it, each tool asks for
the password as it starts. The password is kept nowhere on disk, and the keys
only in memory, for one run.

The store itself is `api-key-store/`, a module any Node project can use:
see [its README](./api-key-store/README.md).

### 3. Install in Google Sheets

A spreadsheet runs its scripts from its Apps Script project, the code
Google keeps with the spreadsheet. Apps Script cannot read the key file,
and runs every script file of a project in one global scope, so the Sheets
scripts are pasted as one file, which this repo's build step, `build.js`
with `apps-script-build/`, makes with the saved keys set at its end. From
the repo's top folder:

```bash
npm run build apps-script
```

1. **DEX Screener's functions.** The build first asks whether to include
   DEX Screener's Google Sheets functions, such as
   `DEX_SCREENER_PAIR_PROP`. DEX Screener, a service that lists the pairs
   of decentralized exchanges with their prices, wrote them, and this repo
   holds none of their code. The build runs the audit that
   `npm run audit:dex-screener` runs, which downloads the code from DEX
   Screener's repo at the commit the question names and checks each file
   against its SHA-256, says the result, and compiles the checked files
   into the file. The step is optional: Enter, or y, includes them, and n
   leaves them out. If the build fails, run it again and answer n.
2. **The password.** The build opens the saved keys as the tools do, with
   the password `unlock-api-keys.sh` keeps, or else one it asks for.
3. **The clipboard.** The build puts the file on the clipboard and says how
   to paste it.
4. **Paste.** In the spreadsheet, open Extensions > Apps Script. Open the
   script file `crypto-price-fetchers`, or make it (Files, +, Script, named
   `crypto-price-fetchers`), select all of its text, paste over it, and
   save.
5. **Delete the files it replaces,** where the project has them from an
   earlier install: `getCryptoPriceFromCentralizedExchange`,
   `getCryptoPriceFromCentralizedExchange-sources`,
   `getCryptoPriceFromCentralizedExchange-tests`, and, when DEX Screener's
   functions went in, DEX Screener's own file. Each declares names the
   pasted file declares too: a project that declares a name twice with
   `const` stops with an error at every run, and of two functions with one
   name, the one that runs last replaces the other. Apps Script calls the
   one function named `onOpen` when the spreadsheet opens, so another
   script in the project that defines `onOpen` hides one of the two menus.
6. **Clear the clipboard.** Back in the terminal, press Enter.
7. **Reload the spreadsheet.** The Crypto Price Fetchers menu appears, and
   its Help item says how to use each function. The first item you choose
   asks you to approve what the script may do.

DEX Screener's own file sets an `onOpen` of its own as it runs. Of two
functions with one name, the one that runs last replaces the other, and
Google's documentation does not say in which order Apps Script runs a
project's files. So with DEX Screener's own file kept beside the pasted
one, either menu can be the one that appears. To have DEX Screener's
functions under the Crypto Price Fetchers menu, build with them included.

The clipboard is reached through the desktop's own tool: xclip or wl-copy
on Linux, pbcopy on macOS, clip on Windows. When none is installed, the
build offers to install one with `sudo apt install`, where it can, and runs
the install on a yes; sudo asks for your computer's password at its own
prompt. Declined, the build says first that your api keys will be written
to disk in the clear, then writes the file to
`build/apps-script/crypto-price-fetchers.gs`, which git ignores, readable
by you alone, and prints only its path. Delete it once it is pasted.

A copy with keys in it is for pasting into Apps Script only: never commit
or share it. A clipboard manager that keeps a history of what was copied
keeps the script too.

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
  step sets them in the file it gives for the sheet.
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

Three of the owner's projects install this repo from GitHub:
pulsechain-analytics, his tools for questions about PulseChain;
pulsechain-validator-analytics, for his PulseChain validators' withdrawal
addresses and payments; and x1-validator-analytics, for his X1
validator's rewards. A project that installs this repo names it with a
ref: `main` for its main branch, or `semver:*` for its latest release, the
highest version tag. The project's lockfile keeps the commit the ref
named when the lockfile was made, and `npm ci` installs that commit.

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

Once the one file the build step gives is pasted into a spreadsheet (see
[Install in Google Sheets](#3-install-in-google-sheets)), Crypto Price
Fetchers > Help, in the spreadsheet's menu bar, says how to call each
function from a cell. The page is made from the help section of each
script's header, so the headers say the same:

- `crypto-price-fetchers.gs`: `dexToolsGetTokenPrice` and
  `dexToolsGetTokenFDV`.
- `fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.gs`:
  `getCryptoPrice`; its folder's
  [README](fetch-from-centralized-exchange/README.md) covers it and
  crypto-price-filler.
- `crypto-price-fetchers-menu.gs`: the menu's items.

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
