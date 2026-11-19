# crypto-price-fetchers — System Architecture

crypto-price-fetchers prices crypto tokens that Google Sheets cannot price
by itself: the price now, from a pool on a decentralized exchange, and the
price at a past minute, from centralized exchanges. It does so in Google
Sheets, as Apps Script, and on a computer, as Node programs that run the
same scripts. Two other projects build on it: pulsechain-analytics and
x1-validator-analytics.

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
- [crypto-price-filler](#crypto-price-filler)
- [The Key Store](#the-key-store)
- [Projects That Use This One](#projects-that-use-this-one)
- [Technology Choices](#technology-choices)

---

## The Parts

The Sheets scripts do the pricing. The other parts run the scripts on a
computer, price a whole CSV file, keep the api keys, and stop a key from
being printed.

| Part | Where | What it is |
| ---- | ----- | ---------- |
| The Sheets scripts | `crypto-price-fetchers.gs`, `fetch-from-centralized-exchange/*.gs` | Apps Script functions a sheet's cells call. |
| The runner | `apps-script-runner/` | Runs a Sheets script under Node, unchanged. |
| The Node versions | `crypto-price-fetchers.js`, `fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js` | Each Sheets script as a Node module and a command line, through the runner. |
| crypto-price-filler | `fetch-from-centralized-exchange/crypto-price-filler/` | A Node tool that fills a CSV's price columns, row by row, from the centralized exchanges. A package of its own. |
| The key store | `api-key-store/`, `manage-api-keys.js`, `unlock-api-keys.sh` | Api keys kept encrypted with a password: LP Ranger's design, as a module. |
| The security lint's rule | `eslint-rules/no-secret-logging.js` | Refuses printing a name that may hold a secret. |

---

## The Sheets Scripts

A Sheets script is Google Apps Script: JavaScript that runs on Google's
servers, inside a spreadsheet, where a cell calls one of its functions.

`crypto-price-fetchers.gs` gives a token's current price and its fully
diluted value, from DexTools for the chains DexTools covers, and from
x1.ninja for X1, which DexTools does not list. A cell names the chain and the
token, or a pool.

`getCryptoPriceFromCentralizedExchange.gs` gives a token's price at a past
minute: the candle's high, low or close, from MEXC first, then CoinGecko,
then CoinPaprika. Apps Script runs the calls of many cells at the same
time. The script's lock makes those calls take turns at the services, and
its cache answers a question already asked without asking again. So a
sheet full of cells keeps within the services' rate limits. The script is
in three files, which Apps Script loads into one scope: the function and
its settings, the price sources (`-sources.gs`), and the tests run from the
editor (`-tests.gs`). Each file names what it uses from the others in a
`/* global */` comment, for the lint. How both scripts are tested is in
[`docs/engineering.md`](engineering.md#how-the-sheets-scripts-gs-are-tested).

The owner pastes the scripts into Apps Script; the repo is where they change.

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
api keys come from the key store, not the script. `crypto-price-fetchers.js`
opens only the key its call needs, DexTools' or x1.ninja's, and lays it over
`CONFIG.API_KEY` or `X1_CONFIG.API_KEY`;
`getCryptoPriceFromCentralizedExchange.js` hands CoinGecko's to the script
as the Script Property `COINGECKO_API_KEY`, as Apps Script would.

---

## crypto-price-filler

The filler reads a CSV of timestamps and writes it out with each row's
price, for as many rows as the file holds. Its sources (`sources/`) ask
MEXC, CoinGecko and CoinPaprika in turn, through one http layer that
retries after a rate limit (`utils/fetch.js`), with a cache of answers
(`utils/cache.js`). As it starts, it opens the CoinGecko key from the key
store; without one, it asks CoinGecko without a key, at its lower rate
limit. `backfill.js` fills the empty prices of a file already written.

Its settings are `config-example.json`, committed, with its own
`config.json`, which git ignores, laid over them.

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
- `source ./unlock-api-keys.sh` asks for the password once, checks that it
  opens the keys saved, and keeps it for that terminal in
  `API_KEYS_PASSWORD`.
- A program calls `unlockProjectKeys` as it starts. It opens the keys it
  uses with that password, or asks for one, has each service check its key,
  and keeps the keys in memory for the run (`key-holder.js`). A key a
  service refuses stops the run with a message that says how to save a new
  one.

The password is kept nowhere on disk, and the plain keys only in memory.

---

## Projects That Use This One

pulsechain-analytics and x1-validator-analytics install this repo from
GitHub, pinned to a commit, as a dependency their `npm install` installs.
Both use the key store, run `no-secret-logging` in their security lint, and
keep a copy of `unlock-api-keys.sh`, which their tests hold to this one.
pulsechain-analytics also runs a Sheets script of its own,
`fetch-amount-of-token-transferred.gs`, through the runner; it calls
nothing in this repo's Sheets scripts. A change here reaches them when they
move the pin.

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
