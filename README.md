# Crypto Price Fetchers

![A green fairy with translucent emerald wings, a leafy crown, and a flowing green dress hovers in a misty ancient forest, reaching toward a glowing parchment scroll that displays “HEX $0.042” along with a rising chart and interconnected crypto symbols. Soft golden light rays filter through the trees while a Rivendell-inspired castle and floating coins appear in the background.](./assets/images/fairy-sprite-price-fetcher_github-social-share-img_1280-640.jpeg "Crypto Price Fetchers")

[![Lint (JS+Apps Script+MD)](https://img.shields.io/github/actions/workflow/status/nottoseethesun/crypto-price-fetchers/ci.yml?branch=main&label=lint)](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/ci.yml)
[![Tests (Node 24/26)](https://img.shields.io/github/actions/workflow/status/nottoseethesun/crypto-price-fetchers/ci.yml?branch=main&label=tests)](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/ci.yml)
[![Security Audit](https://img.shields.io/github/actions/workflow/status/nottoseethesun/crypto-price-fetchers/security-audit.yml?branch=main&label=security)](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/security-audit.yml)

## Overview

Scripts that fetch crypto token prices in USD: the price now, and the
price at a past time, down to the minute.

There are far more crypto tokens than most price-tracking services cover,
so those services have no price for many of them. These scripts ask where
such tokens trade: the centralized exchanges that list them, and, for a
token that trades in a blockchain's pools, the services that price those
pools.

The scripts run in Google Sheets, Google's spreadsheet app, as Apps
Script, Google's platform for scripts that run inside its apps: a cell
calls a script's function as it calls a built-in one. Each Google Sheets
script here (`.gs`) that gives a price has a Node version beside it, with
the same name ending in `.js`, for programs and the command line on a
computer, where Node, the program that runs JavaScript outside a browser,
runs it. The
Node version runs the same `.gs` file, unchanged, so the two give the same
answers, and a fix to the script is a fix to both
([Node Versions of the Sheets Scripts](#node-versions-of-the-sheets-scripts)).

The repo also holds code that the other projects of its owner,
nottoseethesun on GitHub, install from it: the key store, which keeps api
keys encrypted; the Summ CSV writer, which writes the CSV files that Summ,
his crypto tax calculator, imports; and the tool that sets which version
of this repo a project installs ([Development](#development)).

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
beside it, is the exchange script: a Google Apps Script that gives a
token's price at a past time, as recent as a minute ago: by default the average of the high and
the low of a period around that time, or else its high, low or close. It
asks MEXC, a centralized exchange, then CoinGecko, then CoinPaprika, two
services that gather the exchanges' prices, so it covers the tokens they
price.

`crypto-price-fetchers-menu.gs` adds the Crypto Price Fetchers menu to the
spreadsheet. Its items run the price cells again, clear cells stuck on
`#ERROR!` or on a busy message, replace past prices' formulas with their
numbers, and show Help: how to use each function, made from the help
section of each script's header.

The build step, `npm run build apps-script`, puts these scripts in one
file, with the saved api keys set in it, for one paste into a spreadsheet
([Install in Google Sheets](#3-install-in-google-sheets)). It can add the
Google Sheets functions of DEX Screener, a service that lists the pairs of
decentralized exchanges with their prices, such as
`DEX_SCREENER_PAIR_PROP`, downloaded from DEX Screener's repo; this repo
holds none of their code.

A spreadsheet's scripts run within
[Apps Script's quotas](https://developers.google.com/apps-script/guides/services/quotas):
Google stops a cell's call after 30 seconds, runs at most 30 calls of one
person at once, and lets one person's scripts make 20,000 web requests a
day, or 100,000 with a Google Workspace account. crypto-price-filler,
`fetch-from-centralized-exchange/crypto-price-filler/index.js`, prices
past times on a computer, where none of those limits apply: it prices
each row of a CSV file of any length. It asks the exchange
script's own three price sources, run under Node, and, for a token that
trades in pools, Moralis and GeckoTerminal first, two services that price
a token from its chain's pools
([Tokens That Trade in Pools](#tokens-that-trade-in-pools)).

`crypto-price-fetchers.js` and
`fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js`
are the Node versions of the two Sheets scripts that give a price; the
menu has none.

## Table of Contents

- [Overview](#overview)
  - [The Scripts](#the-scripts)
- [Disclaimer](#disclaimer)
- [Screenshot](#screenshot)
- [Prerequisites](#prerequisites)
- [Install](#install)
  - [1. Node and the Packages](#1-node-and-the-packages)
  - [2. The Api Keys](#2-the-api-keys)
  - [3. Install in Google Sheets](#3-install-in-google-sheets)
- [Optional: Verify Download](#optional-verify-download)
- [Update](#update)
- [Uninstall](#uninstall)
- [Usage](#usage)
  - [In Google Sheets](#in-google-sheets)
    - [A Price Now: dexToolsGetTokenPrice and dexToolsGetTokenFDV](#a-price-now-dextoolsgettokenprice-and-dextoolsgettokenfdv)
    - [A Past Price: getCryptoPrice](#a-past-price-getcryptoprice)
    - [The Menu](#the-menu)
    - [DEX Screener's Functions](#dex-screeners-functions)
  - [A Price Now at the Terminal: crypto-price-fetchers.js](#a-price-now-at-the-terminal-crypto-price-fetchersjs)
  - [A Past Price at the Terminal: getCryptoPriceFromCentralizedExchange.js](#a-past-price-at-the-terminal-getcryptopricefromcentralizedexchangejs)
  - [A CSV File's Prices: crypto-price-filler](#a-csv-files-prices-crypto-price-filler)
  - [Empty Prices in a Filled CSV File: backfill.js](#empty-prices-in-a-filled-csv-file-backfilljs)
  - [The Sheets File: the Build](#the-sheets-file-the-build)
  - [The Api Keys: the Key Manager](#the-api-keys-the-key-manager)
  - [The Password for a Terminal: unlock-api-keys.sh](#the-password-for-a-terminal-unlock-api-keyssh)
  - [CSV Files for Summ: summ-csv](#csv-files-for-summ-summ-csv)
  - [Versions of This Repo in Other Projects: github-project-deps](#versions-of-this-repo-in-other-projects-github-project-deps)
- [Configure](#configure)
- [Lint & Test](#lint--test)
- [Private Key Security](#private-key-security)
- [Development](#development)
  - [Node Versions of the Sheets Scripts](#node-versions-of-the-sheets-scripts)
    - [From Node](#from-node)
  - [Tokens That Trade in Pools](#tokens-that-trade-in-pools)
  - [Projects That Install This One](#projects-that-install-this-one)
  - [Architecture and Engineering References](#architecture-and-engineering-references)
- [License](#license)
- [Road Map](#road-map)
  - [Known Bugs](#known-bugs)
- [Donations](#donations)
- [Contributing](#contributing)

---

## Disclaimer

USE AT YOUR OWN RISK: this software is provided "as is", without warranty
of any kind, as its [license](LICENSE) says. It has not been formally audited and may contain
bugs. The prices it gives come from outside services, which can be wrong,
late or missing for a token: check a price before you rely on it, for your
taxes or for anything else.

---

## Screenshot

A sheet of payouts of XTM, the coin of the Tari network, each priced in
USD at its date and time. Its "$usd price" column holds
`=getCryptoPrice("xtm", C2, "UTC")` and the like: the price at the time in
the same row of column C, read in UTC. The picture shows the menu under
its earlier name, Fetch Historical Crypto Prices, at the end of the menu
bar; it is now Crypto Price Fetchers.

![A Google Sheet of XTM payouts, each priced in USD by =getCryptoPrice at the payout's date and time](fetch-from-centralized-exchange/readme-images/google-sheets-example.png)

---

## Prerequisites

- A terminal. `unlock-api-keys.sh`, the script that keeps the key store's
  password for a terminal, runs in bash or zsh.
- Node 24 or later, from [nodejs.org](https://nodejs.org/), with npm, the
  package manager that comes with it, which installs a project's packages
  and runs the commands its `package.json` names. The repo is tested on
  Node 24 and 26.
- git, the version-control program, to clone the repo from GitHub, the
  website that hosts it.
- For the Sheets scripts: a Google account and a spreadsheet in Google
  Sheets. A clipboard tool, which the build puts the built file on, saves
  a step: without one, the build writes the file to disk
  ([Install in Google Sheets](#3-install-in-google-sheets) names the tools).
- Optional: an api key for each service that takes one
  ([The Api Keys](#2-the-api-keys)).

---

## Install

Step 1 installs the packages, which every tool needs. Step 2 saves the api
keys, each of them optional: with none saved, a tool asks each service
without a key, and gets what the table in step 2 says. Step 3 puts the
Sheets scripts into a spreadsheet, as the one file the build step gives.

### 1. Node and the Packages

Clone the repo, then, from its top folder, install the top folder's
packages, then those of crypto-price-filler, which has a package of its
own and uses the top folder's too. npm installs the packages each
folder's `package.json` lists, at the versions its `package-lock.json`
keeps:

```bash
git clone https://github.com/nottoseethesun/crypto-price-fetchers.git
cd crypto-price-fetchers
npm ci
npm ci --prefix fetch-from-centralized-exchange/crypto-price-filler
```

### 2. The Api Keys

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
each one not saved: the key, then the password, showing nothing of what is
typed. The password is typed twice while no key is saved, once after
that, and not at all when `unlock-api-keys.sh` kept it. Each key is saved only once its service
takes it; Enter alone skips one.
[The Api Keys: the Key Manager](#the-api-keys-the-key-manager) shows its
other uses, and
[The Password for a Terminal](#the-password-for-a-terminal-unlock-api-keyssh)
how to type the password once per terminal. The store itself is a module
any Node project can use: see [its README](./api-key-store/README.md).

### 3. Install in Google Sheets

A spreadsheet runs its scripts from its Apps Script project, the code
Google keeps with the spreadsheet. Apps Script cannot read the key file,
so the keys must be written into the script itself. It also runs every
script file of a project in one global scope, as if the files were one,
so the scripts lose nothing by being joined. So this repo's build step,
`build.js` with `apps-script-build/`, joins them into one file, with the
saved keys set at its end, which goes in with one paste. From the repo's
top folder:

```bash
npm run build apps-script
```

Before its first question, the build reads the config.json each script's
Node version reads, `config.json` at the repo's top and
`fetch-from-centralized-exchange/config.json`, and checks it as that Node
version does: it stops, listing every problem, when a file sets a field
the script does not take or a value of the wrong kind
([Configure](#configure)).

1. **DEX Screener's functions.** The build first asks whether to include
   DEX Screener's Google Sheets functions, such as
   `DEX_SCREENER_PAIR_PROP`. DEX Screener wrote them, and this repo holds
   none of their code. Before it uses that code, the build checks that
   each file is the one this repo pinned: it downloads the files from DEX
   Screener's repo at the commit the question names, compares each file's
   SHA-256, a fingerprint of its contents, with the one written in this
   repo, and says the result; `npm run audit:dex-screener` runs the same
   check on its own. Then it compiles the checked files into the file. The
   step is optional: Enter, or y, includes them, and n leaves them out. If
   the build fails, run it again and answer n.
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

DEX Screener's own file sets an `onOpen` of its own as it runs, and
Google's documentation does not say in which order Apps Script runs a
project's files. So with DEX Screener's own file kept beside the pasted
one, either menu can be the one that appears, as step 5 says. To have DEX Screener's
functions under the Crypto Price Fetchers menu, build with them included.

The clipboard is reached through the desktop's own tool: wl-copy, xclip or
xsel on Linux, pbcopy on macOS, clip on Windows. When none is installed,
on Linux with apt and a desktop session open, the build offers to install
one with `sudo apt install`, and runs the install on a yes; sudo asks for
your computer's password at its own prompt. Declined, or with no tool to
offer, the build says first that your api keys will be written to disk in
the clear, then writes the file to
`build/apps-script/crypto-price-fetchers.gs`, which git ignores, readable
by you alone, and prints its path and how to paste it, never its text.
Delete it once it is pasted.

A copy with keys in it is for pasting into Apps Script only: never commit
or share it. A clipboard manager that keeps a history of what was copied
keeps the script too.

---

## Optional: Verify Download

Shows that your clone is at the commit GitHub has, and that the packages
npm installed are the ones the lockfiles name.

git names each commit by a hash of its files and its history, so a
commit's name changes when any of its files does, and two clones at
commits of the same name hold the same files. From the repo's top folder,
these print the commit you have and the commit GitHub has for `main`; the
same 40 characters in both mean you hold the code GitHub holds:

```bash
git rev-parse HEAD
git ls-remote https://github.com/nottoseethesun/crypto-price-fetchers.git main
```

A release is a version tag, such as `1.3.0`: `git rev-list -n 1 1.3.0`
prints the commit it names.

`npm ci` checks every package it downloads against the hash
`package-lock.json` keeps for it, its `integrity`, and stops when one
differs. Two more downloads are checked against SHA-256 hashes this repo
pins: the files of DEX Screener's functions, by the build and by
`npm run audit:dex-screener`, and actionlint, the checker of GitHub
Actions workflow files, by `run-actionlint`, the repo's bin that runs it
in the lint.

---

## Update

From the repo's top folder, take the newest commit of `main`, then install
the packages its lockfiles name:

```bash
git pull
npm ci
npm ci --prefix fetch-from-centralized-exchange/crypto-price-filler
```

The api keys, in `api-keys.json`, and your settings in the config.json
files git ignores stay as they are. The top `config.json` is a file git
keeps: when you changed it and a newer commit changes it too, `git pull`
stops rather than write over your change, and `git stash`, then
`git pull`, then `git stash pop` carries your change across. A spreadsheet keeps the scripts as
they were pasted: to update them, run the build again and paste the new
file over the old one, as in
[Install in Google Sheets](#3-install-in-google-sheets). A project that
installs this repo takes its newest commit with
`npm run github-project-deps -- main`
([Versions of This Repo in Other Projects](#versions-of-this-repo-in-other-projects-github-project-deps)).

---

## Uninstall

1. In each spreadsheet that has the scripts, open Extensions > Apps
   Script, delete the script file `crypto-price-fetchers`, which holds your
   api keys, and reload the spreadsheet: the Crypto Price Fetchers menu is
   gone. The script also kept the time of its last DexTools call as a
   script property, `lastDexToolsCall`, which Project Settings > Script
   Properties lists and can delete.
2. In each terminal where `unlock-api-keys.sh` kept the password, run
   `unset API_KEYS_PASSWORD`, or close the terminal.
3. From the folder that holds it, delete the repo's folder, which holds
   `api-keys.json`:

   ```bash
   rm -rf crypto-price-fetchers
   ```

4. A clipboard manager that keeps a history of what was copied keeps the
   built file, with its keys: delete it from that history. To retire the
   keys themselves, revoke them at each service.

---

## Usage

Each sub-section below covers one tool you run on its own, with examples.
Each command line run with node or npm answers `--help` with its options,
more examples and its exit codes, and [`docs/project-commands.md`](docs/project-commands.md)
lists every command with its flags. Run the commands from the repo's top
folder unless a sub-section says otherwise.

### In Google Sheets

Once the one file the build gives is pasted into a spreadsheet
([Install in Google Sheets](#3-install-in-google-sheets)), a cell calls a
function by name, as it calls a built-in one. Crypto Price Fetchers >
Help, in the spreadsheet's menu bar, shows each function's full help,
made from the help section of each script's header.

#### A Price Now: dexToolsGetTokenPrice and dexToolsGetTokenFDV

`dexToolsGetTokenPrice(chain, tokenAddress, [pool], [seconds])` gives a
token's price in USD now, and
`dexToolsGetTokenFDV(chain, tokenAddress, [pool], [seconds])` its fully
diluted value (FDV): its price times its total supply. Both ask DexTools,
or x1.ninja for X1.

- `chain` names the chain as DexTools names it, in lower case, such as
  `ether` for Ethereum, `pulse`, `bsc` or `solana`; or `x1`.
- `pool` names one pool, written as its address and a 0 in double braces:
  `{{"<pool-address>", 0}}`. X1 needs it, since x1.ninja answers only for
  a pool. Elsewhere the price function prices the token in that pool, and
  the FDV function does not read it, since DexTools' FDV belongs to the
  token.
- `seconds`, a whole number from 1 to 21600, is how long a number above 0
  is kept, so a cell that runs again within that time gives the same
  number; without it, `CACHE_SECONDS`, 300 seconds as the script is
  written ([Configure](#configure)).

USDC's price on Ethereum, about 1.00:

```text
=dexToolsGetTokenPrice("ether", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
```

A token's FDV on PulseChain:

```text
=dexToolsGetTokenFDV("pulse", "0xF84b84dAAce6Ac00DbBAed26CA32Ff3570Aaf66C")
```

Wrapped XNT's price on X1, in its pool with USDC.X, kept for 10 minutes:

```text
=dexToolsGetTokenPrice("x1", "So11111111111111111111111111111111111111112", {{"CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR", 0}}, 600)
```

A cell shows 0 when the service has no data for the token or pool, or
answered with an error, so that the sheet's sums keep working;
`⌛ Rate limit / busy – retry soon` when other cells kept the script busy
for longer than it waits for them; `⚠️ API error – check logs` when the
request failed in a way the script does not handle; and a message naming
the rule when `seconds` is another value, in which case the script asks
nothing.

#### A Past Price: getCryptoPrice

`getCryptoPrice(token, dateStr, tz, mode)` gives a coin's price in USD at
a past time, from MEXC, then CoinGecko, then CoinPaprika. Each source
prices a period that holds the time. MEXC's is the minute, for a time in
about the last 30 days, else the hour; when nothing traded in it, the
script widens it a step at a time, up to the year. When MEXC keeps no
candle of that hour, as for a time before it listed the coin, CoinGecko
answers. CoinGecko's is the 24
hours from 12 hours before the time to 12 after, and CoinPaprika's the
day, in UTC.

- `token` is the coin's ticker symbol, such as `"btc"` or `"xmr"`.
- `dateStr` is the time, written `"YYYY-MM-DD HH:MM:SS"` on a 24-hour
  clock, or a cell that holds a date and time.
- `tz` is the time zone of that time, by its abbreviation: UTC, GMT, EST,
  EDT, CST, CDT, MST, MDT, PST or PDT, as the script is written; left
  empty, UTC.
- `mode` is `"average"`, the average of the period's highest and lowest
  price, unless it is `"high"`, `"low"` or `"close"`, the price at the
  period's end.

Bitcoin's highest price in the period around 14:30, US Central time, on
15 January 2026:

```text
=getCryptoPrice("btc", "2026-01-15 14:30:00", "CST", "high")
```

XTM's average price at the time in cell C2, read in UTC, as in the
[Screenshot](#screenshot):

```text
=getCryptoPrice("xtm", C2, "UTC")
```

Monero's lowest price at the time in cell A1:

```text
=getCryptoPrice("xmr", A1, "UTC", "low")
```

A cell shows a message instead of a price when no source has one for that
coin at that time, when the time is in the future, when other cells kept
the script busy, or when it cannot read `tz` or `dateStr`; Help lists
each message.

#### The Menu

The Crypto Price Fetchers menu, in the spreadsheet's menu bar, runs the
price cells again:

- Clean up errors runs again every cell that calls one of the functions
  above, or a DEX Screener function, and shows `#ERROR!` or a busy
  message.
- Refresh runs again every cell that asks for a price now, or a DEX
  Screener function.
- Refresh & freeze historical prices (this tab) runs again every cell of
  the tab you are on that calls `getCryptoPrice`, then replaces each
  formula that gave a number with that number, since a past price does
  not change.
- Help shows how to use each function.

#### DEX Screener's Functions

When the build included them, DEX Screener's own functions are in the
sheet too, and Help describes them. A pair's price in USD, from DEX
Screener's listing of a pair on PulseChain:

```text
=DEX_SCREENER_PAIR_PROP("pulsechain", "<pair-address>", "priceUsd")
```

DEX Screener gives `priceUsd` as text, which `SUM` skips; `VALUE()` turns
it into a number.
[DEX Screener's repo](https://github.com/dexscreener/google-sheets)
documents the functions.

### A Price Now at the Terminal: crypto-price-fetchers.js

`crypto-price-fetchers.js` runs `crypto-price-fetchers.gs` under Node and
prints what its cell would show: `price` gives a token's price in USD now,
and `fdv` its fully diluted value. It sends DexTools' key, or x1.ninja's
for X1, opened with the password `unlock-api-keys.sh` keeps, or else one it
asks for.

USDC's price on Ethereum, from the pools DexTools picks:

```bash
node crypto-price-fetchers.js price ether 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
```

Wrapped XNT's price on X1, in its pool with USDC.X, which X1 needs:

```bash
node crypto-price-fetchers.js price x1 So11111111111111111111111111111111111111112 --pool CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR
```

A token's fully diluted value on PulseChain, with the script's log, which
shows what DexTools answered, on stderr:

```bash
node crypto-price-fetchers.js fdv pulse 0xF84b84dAAce6Ac00DbBAed26CA32Ff3570Aaf66C --verbose
```

It prints the number, with exit code 0, or the script's message on stderr,
with exit code 1. A 0 is the script's answer when the service has no data
for the token or answered with an error, as it gives a cell.

### A Past Price at the Terminal: getCryptoPriceFromCentralizedExchange.js

`getCryptoPriceFromCentralizedExchange.js` runs the exchange script under
Node and prints what `getCryptoPrice` would show in a cell. `--tz` names
the time zone of the time, UTC unless given, and `--mode` the price:
`average`, unless given, `high`, `low` or `close`. It sends the CoinGecko
and CoinPaprika keys when they are saved.

Bitcoin's average price in the period around 14:30 UTC on 15 January
2026:

```bash
node fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js btc "2026-01-15 14:30:00"
```

Gridcoin's close at a time given in US Central time:

```bash
node fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js grc "2026-01-15 08:30:00" --tz CST --mode close
```

Monero's low, with the script's log on stderr, which shows the service
that answered:

```bash
node fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js xmr "2026-01-15 14:30:00" --mode low --verbose
```

It prints the number, with exit code 0, or the script's message on stderr,
with exit code 1.

### A CSV File's Prices: crypto-price-filler

crypto-price-filler prices each row of a CSV file whose `date (UTC)`
column holds times written `yyyy-MM-dd HH:mm:ss`, and writes the file
again, by default to `output.csv`, with three columns added: `$usd price`,
by default the close of the period that holds the row's time;
`$usd amount`, the row's amount at that price; and `grand total ($usd)`.
A row no service priced gets `Error` in `$usd price`: `--backfill-highest`
or `--backfill-lowest` fills it in the same run, or `backfill.js`
afterwards. `--token` must be one of the tokens its
`supported-tokens.json` lists. With api keys saved, a run asks for the
key store's password, unless `unlock-api-keys.sh` kept it. It reads its
own files from its folder, so it runs from any folder, and takes the
paths `--input` and `--output` name from the folder it runs in; the
examples run in its folder, whose packages install step 1 installed.
[Its README](fetch-from-centralized-exchange/crypto-price-filler/README.md)
covers its settings and the tokens it knows.

Gridcoin's close at each row's time, read in UTC, written to
`output.csv`:

```bash
cd fetch-from-centralized-exchange/crypto-price-filler
node index.js --token=grc --input=mining.csv
```

XTM's high at each row's time, the times read in US Central time, written
to `prices.csv`, with each step logged:

```bash
node index.js --token=xtm --input=input.csv --output=prices.csv --mode=high --tz=America/Chicago --verbose
```

Gridcoin's close at each row's time, then, for each row no service
priced, the higher of the prices of the nearest priced rows before and
after it:

```bash
node index.js --token=grc --input=mining.csv --backfill-highest
```

`npm start -- <options>` in that folder runs the same command line.

### Empty Prices in a Filled CSV File: backfill.js

`backfill.js`, in crypto-price-filler's folder, fills the prices
crypto-price-filler could not give, in a file it wrote, asking no
service: each row with `Error` takes the price of the nearest priced row
before or after it, the higher of the two with `--backfill-highest` and
the lower with `--backfill-lowest`. The rows that hold no data, a "Total"
row, a row with no date and the rows after the last date, have a blank
price, which backfill leaves as it is, so they stay out of the grand
total.

`output.csv` filled in place with the higher price, a figure that does
not understate a value for taxes:

```bash
cd fetch-from-centralized-exchange/crypto-price-filler
node backfill.js --input=output.csv --backfill-highest
```

`budget.csv` written with the lower price, a figure that does not
overstate income:

```bash
node backfill.js --input=output.csv --output=budget.csv --backfill-lowest
```

### The Sheets File: the Build

`npm run build apps-script` gives the Sheets scripts as one file, with the
saved keys set in it, on the clipboard;
[Install in Google Sheets](#3-install-in-google-sheets) walks through its
questions and the paste.

The file, built with the password typed when the build asks for it:

```bash
npm run build apps-script
```

The same, with the password kept for the terminal first, so the build
does not ask for it:

```bash
source ./unlock-api-keys.sh
npm run build apps-script
```

### The Api Keys: the Key Manager

`npm run api-keys` runs the key manager, which lists each key the top
`config.json` names, saved or not, never showing its characters.

Each key, saved or not, with a question for each one not saved:

```bash
npm run api-keys
```

DexTools' saved key replaced, as after DexTools issues a new one:

```bash
npm run api-keys -- set dextools
```

Whether the password kept for the terminal opens every saved key, by its
exit code, 0 when it does:

```bash
npm run api-keys -- check-password
```

### The Password for a Terminal: unlock-api-keys.sh

`unlock-api-keys.sh` asks for the key store's password, showing nothing of
what is typed, checks that it opens the keys saved, and keeps it for the
terminal in `API_KEYS_PASSWORD`, so the tools open their keys without
asking. It runs with `source`, since a script run as a program cannot set
anything in the terminal that started it.

From the repo's top folder:

```bash
source ./unlock-api-keys.sh
```

From any other folder, by the script's path:

```bash
source /path/to/crypto-price-fetchers/unlock-api-keys.sh
```

Closing the terminal forgets the password, as does:

```bash
unset API_KEYS_PASSWORD
```

### CSV Files for Summ: summ-csv

Summ imports a CSV file in its own layout and takes what the file says as
written. `npm run summ-csv` runs this repo's Summ CSV writer, `summ-csv/`,
which checks every row, such as one token per row, and a contract address
on every token but a blockchain's own coin, and writes nothing while any
row breaks a rule. It reads
the rows from a JSON file and the header from your copy of Summ's csv
template, a file of one line.

`missing.csv` written from `rows.json`, or every problem listed and
nothing written:

```bash
npm run summ-csv -- --rows rows.json --template advanced-template-reference.csv --out missing.csv
```

The same, writing over a `missing.csv` already there:

```bash
npm run summ-csv -- --rows rows.json --template advanced-template-reference.csv --out missing.csv --replace
```

A program imports `writeSummCsv` from `crypto-price-fetchers/summ-csv`
instead. [Its README](./summ-csv/README.md) gives the rules and the form of
a row.

### Versions of This Repo in Other Projects: github-project-deps

A project that installs this repo from GitHub names it with a ref: `#main`
for its main branch, or `#semver:*` for its latest release, the highest
version tag. This repo's bin `github-project-deps`, the versions tool,
sets every dependency the project installs from GitHub to one of the two,
and makes the project's lockfiles again. A project runs it from its own
top folder.

Every such dependency set to follow `main`, and its newest commit
installed:

```bash
npm run github-project-deps -- main
```

Every such dependency set to its latest release:

```bash
npm run github-project-deps -- release
```

No release can be installed yet: every release of this repo, the newest
being 1.3.0, came before its `package.json`, so `release` fails, and the
tool puts the project's files back as they were. It works once a release
with a `package.json` is tagged.

---

## Configure

The tools run as they come; a settings file changes how one runs. Each
file is JSON, checked against its JSON Schema, a description of the keys
the file may hold and the kind of value each takes, before the tool takes
any setting: a key the tool does not read, or a value of the wrong kind,
stops the run, with every problem listed, one line each.

| File | Read by | Holds |
| ---- | ------- | ----- |
| `config.json`, at the repo's top | the key store, `crypto-price-fetchers.js` and the build | `apiKeys`, the services whose keys the project keeps; and, when you add it, `DEXTOOLS_CONFIG`, with `CACHE_SECONDS`, how long a price above 0 is kept, from 1 to 21600 seconds, and `LOCK_WAIT_MS`, how long a call waits for the script's lock, in milliseconds |
| `fetch-from-centralized-exchange/config.json`, which git ignores | `getCryptoPriceFromCentralizedExchange.js` and the build | fields of the exchange script's `CONFIG`, such as `QUOTE_CURRENCY`, `USDT` or `USDC`, the stablecoin of the MEXC pairs it asks |
| `fetch-from-centralized-exchange/crypto-price-filler/config.json`, which git ignores | crypto-price-filler | the settings that differ from its committed `config-example.json` |
| `fetch-from-centralized-exchange/crypto-price-filler/supported-tokens.json` | crypto-price-filler | the tokens `--token` takes, each with its ids at CoinGecko and CoinPaprika and its symbol at MEXC and, for a token that trades in pools, its contract and its chain's ids at GeckoTerminal and Moralis |
| `summ-csv/settings.json` | the Summ CSV writer | each chain's facts: its own coin and the forms of its hashes and addresses |

The build writes the values of the first two files into the Sheets file,
so a spreadsheet runs on the settings the Node versions run on. The header
of each script describes its settings, and
[Settings Files](docs/architecture.md#settings-files) explains the
schemas.

---

## Lint & Test

The gate, LP Ranger's, runs the lint, the tests and the security audits,
and must pass before every commit and push. The lint runs ESLint, which
checks JavaScript against rules; markdownlint, which checks the form of
Markdown files; the check of Prettier, a program that formats code;
actionlint; and knip, which finds files nothing uses. From the repo's top
folder, after install step 1:

```bash
npm run lint          # the linters above
npm test              # the top folder's tests, on Node's test runner
npm run test:filler   # crypto-price-filler's tests
npm run check         # the whole gate, as CI runs it
```

The tests ask no outside service: the scripts' web requests go to
stand-ins on the computer. The Sheets scripts also hold tests that run
only in Apps Script, by hand:
[How the Sheets scripts are tested](docs/engineering.md#how-the-sheets-scripts-gs-are-tested)
sets the two kinds apart.

---

## Private Key Security

No tool here holds a wallet's private key or seed phrase: the tools read
prices and write files.

The api keys are kept in `api-keys.json`, which git ignores, each
encrypted by AES-256-GCM with a key made from your password by
PBKDF2-SHA512 at 600,000 rounds, as LP Ranger keeps its keys. The password
is kept nowhere on disk: `unlock-api-keys.sh` keeps it in the terminal's
environment, and each tool holds the keys only in memory, for one run. No
tool prints a key's characters.

The one copy of the keys outside that file is the one the build sets in
the Sheets file, in the clear, since Apps Script cannot read the key file.
It goes to the clipboard, which the build clears once you press Enter,
or, with no clipboard tool, to `build/apps-script/`, readable by you
alone. Never commit or share that file, and delete it once it is pasted.

**A lost password cannot be recovered**, and the keys saved with it cannot
be opened: delete `api-keys.json` and save each key again with
`npm run api-keys`, under a new password.

---

## Development

The repo follows the coding standards of LP Ranger: its `CLAUDE.md` and
everything under its `docs/claude/`.

### Node Versions of the Sheets Scripts

A Node version lets a Node program or the command line call a Sheets
function, and get what its cell would show. It runs the Sheets script
itself. The runner in `apps-script-runner/` loads the `.gs` file under
Node, and supplies the Apps Script services the script calls: web
requests, cache, lock, script properties, sleep, date formatting and logs.
It runs the script in a worker thread, a second thread of JavaScript that
Node runs beside the main one, so the script can wait for each web
request as it does in Apps Script ([why](docs/architecture.md#the-runner)).

What differs from the sheet:

- It runs on your computer, so there is no 30-second limit per call and no
  daily cap on web requests.
- The api keys come from the repo's encrypted key file
  ([The Api Keys](#2-the-api-keys)), not from the script. Each Node
  version sets them in the script's config as it opens the script, as the
  build step sets them in the file it gives for the sheet.
- The cache lasts while the script is open: for the command line, one run.
- The sheet's menu is not there.

Each Node version reads `config.json` beside it when it is there, the
repo's top one for `crypto-price-fetchers.js`, and sets its values in the
script's config objects, as the build sets them for the sheet
([Configure](#configure)). The file may set only the fields its Node
version's `CONFIG_SCHEMAS` names: those the script reads each time it is
called, each of its kind of value, which leaves out the api keys.

#### From Node

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

### Tokens That Trade in Pools

A token that trades in a blockchain's pools, such as HEX on PulseChain, is
priced by the services that read those pools, in LP Ranger's order:
Moralis first, which gives the price at the block the chain had at the
time, when a Moralis key is saved; then GeckoTerminal, for the last 180
days, from the candles of one pool: of the first pools GeckoTerminal
lists for the token, the deepest that traded in the last day. Their clients are in `dex-prices/`, with the
one loop that sends a request again when a service refuses it as one too
many, which every client shares.

crypto-price-filler prices such a token this way, and falls back to the
exchange script's three sources: MEXC, then CoinGecko, then CoinPaprika.
Other repos install this one to use the clients, as
`crypto-price-fetchers/dex-prices/geckoterminal`,
`crypto-price-fetchers/dex-prices/moralis`,
`crypto-price-fetchers/dex-prices/dextools` and
`crypto-price-fetchers/dex-prices/web-request`, alongside the runner, as
`crypto-price-fetchers/apps-script-runner`, and the key store, as
`crypto-price-fetchers/api-key-store`.

### Projects That Install This One

Three of the owner's projects install this repo from GitHub:
pulsechain-analytics, his tools for questions about PulseChain;
pulsechain-validator-analytics, for his PulseChain validators' withdrawal
addresses and payments; and x1-validator-analytics, for his X1
validator's rewards. Each project's lockfile keeps the commit its ref
named when the lockfile was made, and `npm ci` installs that commit;
[the versions tool](#versions-of-this-repo-in-other-projects-github-project-deps)
moves it, and
[Which version they install](docs/architecture.md#which-version-they-install)
explains how.

The projects also take their checks from here. Their lint runs this repo's
bin `run-actionlint`, which runs actionlint from its author's release and
refuses the archive unless its SHA-256 is the one this repo pins, and
`no-or-default`, this repo's ESLint rule against a default made with
`||`; their security lint runs `no-secret-logging`, its rule against
printing a name that may hold a secret. Their tests hold
each command line's help to the owner's rule, and their tracked files to
his rules on addresses and docs, with
`crypto-price-fetchers/lib/command-line-help` and
`crypto-price-fetchers/lib/repo-checks`.

### Architecture and Engineering References

The `docs/` folder holds three references:

- [`docs/architecture.md`](docs/architecture.md): how the parts fit.
- [`docs/engineering.md`](docs/engineering.md): the files, the gates, the
  tests and CI: the checks GitHub runs, through its GitHub Actions
  service, at each push.
- [`docs/project-commands.md`](docs/project-commands.md): every command,
  with its flags and an example.

---

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for
the full text.

---

## Road Map

Have no expectation that these items will be done. They are listed for
future focus.

### Known Bugs

Google stops a cell's call after 30 seconds, and the cell shows
`#ERROR!`. The script's lock makes the calls of many cells take turns, and
three of the functions can wait for it longer than that, so a busy sheet can
show `#ERROR!` where the script would have given its busy message. The
menu's Clean up errors runs such a cell again.

| Function | Its longest wait for the lock |
| -------- | ----------------------------- |
| `dexToolsGetTokenPrice` and `dexToolsGetTokenFDV` | 120 seconds, `DEXTOOLS_CONFIG.LOCK_WAIT_MS` |
| `getCryptoPrice` | 41 seconds: 3 tries of 2 seconds each, the failed tries followed by waits of 5, 10 and 20 seconds |

---

## Donations

The owner takes donations for his projects at the address in
[LP Ranger's Donations](https://github.com/nottoseethesun/lp-ranger#donations).

---

## Contributing

Bug reports and ideas for new features and improvements are welcome, in
the [Issues](https://github.com/nottoseethesun/crypto-price-fetchers/issues)
tab. A bug report is most useful with the command or the cell's formula
you ran, and what it gave. A change must pass `npm run check`
([Lint & Test](#lint--test)).
