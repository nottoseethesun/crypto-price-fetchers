# crypto-price-fetchers — System Architecture

crypto-price-fetchers prices crypto tokens that Google Sheets cannot price
by itself, in USD: the price now, from a pool on a decentralized exchange,
and the price at a past minute, from centralized exchanges and, for a token
that trades in pools, from the services that price those pools. It does so
in Google Sheets, as Apps Script, and on a computer, as Node programs that
run the same scripts. Three other projects of the owner's build on it:
pulsechain-analytics, his tools for questions about PulseChain;
pulsechain-validator-analytics, for his PulseChain validators' withdrawal
addresses and payments; and x1-validator-analytics, for his X1
validator's rewards.

Two companion references sit alongside this one:

- [`docs/engineering.md`](engineering.md): the files on disk, the gates,
  the tests and CI.
- [`docs/npm-project-commands.md`](npm-project-commands.md): every npm
  command and its flags.

---

## Table of Contents

- [The Parts](#the-parts)
- [The Sheets Scripts](#the-sheets-scripts)
- [The Runner](#the-runner)
- [The Node Versions](#the-node-versions)
- [The Build Step](#the-build-step)
- [crypto-price-filler](#crypto-price-filler)
- [Prices of Tokens That Trade in Pools](#prices-of-tokens-that-trade-in-pools)
- [The Key Store](#the-key-store)
- [The Summ CSV Writer](#the-summ-csv-writer)
- [Projects That Use This One](#projects-that-use-this-one)
- [Technology Choices](#technology-choices)

---

## The Parts

The Sheets scripts do the pricing. The other parts run the scripts on a
computer, price a whole CSV file, keep the api keys, stop a key from being
printed, choose which version of this repo the projects that use it
install, and write the CSV files the owner imports into Summ, the crypto
tax calculator he keeps his books in. The key store and the price
clients' order follow LP Ranger, the owner's bot that manages his 9mm V3
liquidity positions.

| Part | Where | What it is |
| ---- | ----- | ---------- |
| The Sheets scripts | `crypto-price-fetchers.gs`, `fetch-from-centralized-exchange/*.gs` | Apps Script functions a sheet's cells call. |
| The runner | `apps-script-runner/` | Runs a Sheets script under Node, unchanged. |
| The Node versions | `crypto-price-fetchers.js`, `fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js` | Each Sheets script as a Node module and a command line, through the runner. |
| The build step | `build.js`, `apps-script-build/` | Gives each Sheets script with the saved api keys set in it, on the clipboard, for pasting into Apps Script. |
| crypto-price-filler | `fetch-from-centralized-exchange/crypto-price-filler/` | A Node tool that fills a CSV's price columns, row by row, from the pools' price services and the exchange script's sources. A package of its own. |
| The price clients | `dex-prices/` | Moralis and GeckoTerminal, which price a token from a blockchain's pools, and the one loop that sends a refused request again. |
| The key store | `api-key-store/`, `manage-api-keys.js`, `unlock-api-keys.sh` | Api keys kept encrypted with a password: LP Ranger's design, as a module. |
| The security lint's rule | `eslint-rules/no-secret-logging.js` | Refuses printing a name that may hold a secret. |
| The versions tool | `github-project-deps.js`, `github-project-deps/` | The bin `github-project-deps`, which sets a project's dependencies from GitHub to their projects' main branch or latest release. |
| The Summ CSV writer | `summ-csv.js`, `summ-csv/` | Writes the CSV files the owner imports into Summ, once every row has passed its rules: `npm run summ-csv`, the bin `summ-csv`, and `writeSummCsv` for a program. |
| The shared helpers | `lib/` | Code more than one part uses: `messageOf`, which gives the message of something thrown, for the runner, the key store, the build step, the versions tool and the Summ CSV writer's command line. The package exports it as `crypto-price-fetchers/lib/message-of`, for the projects that install this repo. |

---

## The Sheets Scripts

A Sheets script is Google Apps Script: JavaScript that runs on Google's
servers, inside a spreadsheet, where a cell calls one of its functions.

`crypto-price-fetchers.gs` gives a token's current price and its fully
diluted value, from DexTools, a service that prices tokens from the pools
of decentralized exchanges, for the chains DexTools covers, and from
x1.ninja, which does the same for X1, which DexTools does not list. A cell
names the chain and the token, or a pool.

`getCryptoPriceFromCentralizedExchange.gs` gives a token's price at a past
minute: the candle's high, low or close, from MEXC, a centralized
exchange, first, then CoinGecko, then CoinPaprika, two services that
gather the exchanges' prices. Apps Script runs the calls of many cells at
the same time. The script's lock makes those calls take turns at the
services, and its cache answers a question already asked without asking
again. So a sheet full of cells keeps within the services' rate limits.
The script is
in three files, which Apps Script loads into one scope: the function and
its settings, the price sources (`-sources.gs`), and the tests run from the
editor (`-tests.gs`). Each file names what it uses from the others in a
`/* global */` comment, for the lint. How both scripts are tested is in
[`docs/engineering.md`](engineering.md#how-the-sheets-scripts-gs-are-tested).

The owner pastes the scripts into Apps Script, as the build step gives
them; the repo is where they change.

---

## The Runner

The runner runs a Sheets script under Node, unchanged, so a Node program
can call the script's functions and get what a cell would show. A script
reaches the world only through Apps Script's services. So the runner gives
it Node versions of the ones it calls: web requests, cache, lock, script
properties, sleep, date formatting and logs (`apps-script-services.js`).

Web requests need more than a stand-in service. In Apps Script,
`UrlFetchApp.fetch` holds the script until the response arrives, then
returns it. In Node, `fetch` returns a promise, and the response arrives
only after the running code has finished. A script's code cannot finish
without its response, so the script cannot run on the thread that does
the request. The runner therefore loads the script in a worker thread of
its own. The worker blocks on each web request while the caller's thread
does it, with the caller's `fetch`, and wakes with the response
(`run-apps-script.js`, `script-worker.js`). The caller's thread never
blocks, so a program that uses the runner goes on with its other work.

A script of several files loads as Apps Script loads them: every file is
compiled first, so one that does not compile stops the load before any
runs, then each runs, in order, in one scope (`load-apps-script.js`).

The runner also lays a config over the script's config objects, such as an
api key the script reads from `CONFIG` (`config-file.js`), sets Script
Properties the script reads, and makes a command line of a script's
functions (`command-line.js`). Tests can run a script in their own thread
instead, with stand-in services (`loadAppsScript`), as
[`docs/engineering.md`](engineering.md#the-node-tests) describes.

---

## The Node Versions

A Node version opens its Sheets script through the runner and exports its
functions, which take the Sheets arguments and return what the cell would
show. It never copies the script's logic: a fix in the `.gs` fixes both.

What differs from the sheet: there is no 30-second limit per call and no
daily cap on requests; the cache lasts while the script is open; and the
api keys come from the key store, not the script. Each Node version lays
the keys it opens over the script's config: `crypto-price-fetchers.js`
opens only the key its call needs, DexTools' or x1.ninja's, for
`CONFIG.API_KEY` or `X1_CONFIG.API_KEY`;
`getCryptoPriceFromCentralizedExchange.js` opens CoinGecko's and
CoinPaprika's, for `CONFIG.COINGECKO_API_KEY` and
`CONFIG.COINPAPRIKA_API_KEY`. Its `openCentralizedExchangeSources` opens
the script's three price sources rather than its Sheets function, for
crypto-price-filler.

---

## The Build Step

Apps Script cannot read the key file, so a key reaches a sheet only inside
the script pasted there. `npm run build apps-script` writes it in, so no
key is typed into a script by hand (`apps-script-build/`).

- Each Node version exports a build spec, `APPS_SCRIPT_BUILD`: the
  script's files, in Apps Script's order, the services whose keys it
  sends, and the function that lays the keys over its config.
- The build opens the keys as the programs do (`unlockProjectKeys`), and
  sets, as the last statements of each script's first file, the values
  the Node version would set: those of the config.json it reads, with the
  keys laid over them. It first loads the script with the runner and
  applies the values, so a field the script lacks stops the build, as it
  stops the Node version (`built-script.js`).
- It puts each file on the clipboard in turn, through the desktop's tool
  (`clipboard.js`), says where to paste it, waits for Enter, and clears
  the clipboard after the last. With no tool installed, it offers to
  install one with `sudo apt install`; declined, it warns that the keys go
  to disk in the clear, then writes the files to `build/apps-script/`,
  which git ignores, readable by the owner alone.

No line it prints holds a key.

---

## crypto-price-filler

The filler reads a CSV of timestamps and writes it out with each row's
price, for as many rows as the file holds, asking its sources in turn
(`sources/price.js`), with a cache of answers (`utils/cache.js`):

1. For a token whose entry in `supported-tokens.json` names its contract
   and chains, the pool sources: Moralis (`sources/moralis.js`), when a
   Moralis key is saved, then GeckoTerminal (`sources/geckoterminal.js`),
   through the price clients (see
   [Prices of Tokens That Trade in Pools](#prices-of-tokens-that-trade-in-pools)).
2. For every token, MEXC, CoinGecko and CoinPaprika: the exchange
   script's own sources, which the filler runs in a worker through the
   script's Node version (`sources/exchange.js`), opened at the first
   price asked and closed at the end of the run.

As it starts, it opens the CoinGecko, CoinPaprika and Moralis keys from the
key store, each one saved. `backfill.js` fills the empty prices of a file
already written.

Its settings are `config-example.json`, committed, with its own
`config.json`, which git ignores, laid over them. The exchange sources run
on the script's own `CONFIG`.

---

## Prices of Tokens That Trade in Pools

A token that trades in a blockchain's pools has a price wherever it
trades, and the services that read the pools give it. `dex-prices/` holds
their clients, asked in LP Ranger's order:

- Moralis (`moralis.js`) gives the token's price at a block: the block the
  chain had at a time, then the price there. It needs a key, and gives one
  price, with no high or low.
- GeckoTerminal (`geckoterminal.js`) gives a pool's candles. The pool is
  the one LP Ranger picks: of the first pools GeckoTerminal ranks for the
  token, the deepest that traded in the last day and holds the token on
  one of its sides. Its public api serves the last 180 days, and takes
  about thirty requests a minute, so the client keeps every caller in the
  process within one budget of twenty a minute.
- Every request goes through `web-request.js`, the one loop that sends a
  request again after each wait while a service refuses it as one too
  many (status 429).

crypto-price-filler's pool sources use these clients, and other repos
install them from this one.

---

## The Key Store

An api key must not be committed, and should not sit on disk in plain
text. The key store keeps a project's keys encrypted, with one password the
owner types.

A project lists the services whose keys its programs send in its top
`config.json`, under `apiKeys`. The keys are kept in `api-keys.json` beside
it, which git ignores, each encrypted by AES-256-GCM with a key made from
one password by PBKDF2-SHA512 at 600,000 rounds: LP Ranger's format, so
each opens a file the other wrote.

- `npm run api-keys`, the key manager (`key-manager.js`), lists the keys,
  saved or not, never showing a key's characters, and saves each key typed
  once its service takes it (`services.js` holds each service's check).
- `source ./unlock-api-keys.sh`, a script in the repo's top folder, asks
  for the password once, checks that it opens the keys saved, and keeps it
  for that terminal in `API_KEYS_PASSWORD`.
- A program calls `unlockProjectKeys` as it starts. It opens the keys it
  uses with that password, or asks for one, has each service check its key,
  and keeps the keys in memory for the run (`key-holder.js`). A key a
  service refuses stops the run with a message that says how to save a new
  one.

The password is kept nowhere on disk, and the plain keys only in memory.

---

## The Summ CSV Writer

Summ, the crypto tax service, imports a CSV file in its own layout and
takes whatever the file says, so a token named wrongly, an amount rounded
or gas put on two rows reaches the books as written. The owner's rule is
that every such file is made by one utility, `summ-csv/`, which checks
every row first and writes nothing while any row breaks a rule. Its README,
[`summ-csv/README.md`](../summ-csv/README.md), lists the rules and the
form of a row.

The utility works in three steps, each in a module of its own:

1. **The header.** The owner keeps Summ's header in a template file of one
   line, sixteen columns: Summ's fifteen and the token's contract address.
   `columns.js` reads it and gives the key a row holds each column's value
   under, in the header's order, and refuses a header that lacks a column,
   names one twice, or names one Summ's import does not have.
2. **The rules.** `rules.js` checks each row: its shape, the columns every
   row fills, one token per row, the forms of times and amounts, gas in the
   chain's own coin, and, for a row on a blockchain, the forms of its hash
   and addresses and a contract address on every token. A chain's facts,
   its own coin and those forms, come from `settings.json`, by Summ's name
   for the chain, so a chain is added there, with no change to the code. A
   last rule reads the cells that would be written and refuses a
   transaction's gas on a second row.
3. **The cells.** `values.js` writes each value as text at the file's edge,
   as LP Ranger's rule for numbers asks: an amount, kept by a program as a
   whole number of the token's smallest units and its decimals, as plain
   decimal text cut by the text alone, never through a JavaScript number;
   a time as Summ's `YYYY-MM-DD HH:MM:SS`; and, on a chain whose hashes
   and addresses are hex, each in lower case, as the files Summ has
   already taken from the owner are written.

`index.js` puts the steps together, as `summCsvText` and `writeSummCsv`,
and writes over an existing file only when the call says so, through a
file beside it that is then renamed. `command-line.js` reads rows from a
JSON file for `npm run summ-csv` and the bin `summ-csv`. A project that
installs this repo imports `crypto-price-fetchers/summ-csv` to write such
a file from its own code.

---

## Projects That Use This One

Three of the owner's projects install this repo from GitHub, as a
dependency their `npm install` installs:

- pulsechain-analytics, his tools for questions about PulseChain, runs a
  Sheets script of its own, `fetch-amount-of-token-transferred.gs`,
  through the runner, and calls nothing in this repo's Sheets scripts. Its
  ratio chart asks GeckoTerminal through the GeckoTerminal client, and its
  Summ sweep writes its CSV through the Summ CSV writer.
- pulsechain-validator-analytics, for his PulseChain validators'
  withdrawal addresses and payments, sends no key today, and keeps the key
  store ready.
- x1-validator-analytics, for his X1 validator's rewards, prices each
  reward through the GeckoTerminal client.

All three use the key store, run `no-secret-logging` in their security
lint, keep a copy of `unlock-api-keys.sh`, which their tests hold to this
one, and run the versions tool.

### Which Version They Install

A dependency installed from GitHub names its repo and a ref:
`github:nottoseethesun/crypto-price-fetchers#main` names this repo's main
branch, and `#semver:*` its latest release, the highest version tag. When
npm makes a project's lockfile, it installs the commit the ref names at
that moment, and the lockfile keeps that commit, which `npm ci` installs
until the lockfile is made again. So a change here reaches a project once
its lockfile is made again at a commit that has the change.

The bin `github-project-deps` (`github-project-deps.js`,
`github-project-deps/`) makes it again: a project runs it as
`npm run github-project-deps -- main` or `-- release`. It sets every
dependency the project installs from GitHub to the mode's ref, in each
package.json the project's git keeps. Then, in each of those folders, it
makes the lockfile again as LP Ranger makes one for a change of
dependency: it deletes package-lock.json, then node_modules, and runs
`npm install`. When an install fails, as it does for a release whose top
folder has no package.json, such as this repo's 1.3.0, every package.json
and package-lock.json goes back to what it held, and node_modules is
installed again from them. The projects follow main, and the tool is
optional: a project's committed lockfile already names a commit of this
repo, which `npm ci` installs.

### What Installing It Runs

npm runs the `prepare` script of a package installed from git in each
project that installs it, after installing that package's development
packages. So this repo has no `prepare`, `install` or `postinstall`
script: installing it from GitHub runs nothing, and installs none of its
development packages.

---

## Technology Choices

- **Node 22 or later**, ES modules, Node's own test runner for the runner,
  the Node versions and the key store; vitest for crypto-price-filler,
  whose tests are written for it.
- **commander** for every command line.
- **Node's `crypto`** for the key store: no package between the password
  and the cipher.
- **Worker threads and `Atomics.wait`** for the runner, rather than a
  package such as synckit. synckit does the waited-for work in a worker of
  its own, and a function cannot be passed to another thread. Doing the
  request on the caller's thread lets a caller hand in its own `fetch`, as
  the tests do.
