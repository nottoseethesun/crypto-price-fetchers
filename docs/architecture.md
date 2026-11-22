# crypto-price-fetchers — System Architecture

crypto-price-fetchers prices crypto tokens that Google Sheets, Google's
spreadsheet app, cannot price by itself, in USD: the price now, from a pool on a decentralized exchange,
and the price at a past minute, from centralized exchanges and, for a token
that trades in pools, from the services that price those pools. It does so
in Google Sheets, as Apps Script, Google's platform for scripts that run
inside its apps, and on a computer, as programs that run the same scripts
on Node, the program that runs JavaScript outside a browser. Three other projects of the owner's build on it:
pulsechain-analytics, his tools for questions about PulseChain;
pulsechain-validator-analytics, for his PulseChain validators' withdrawal
addresses and payments; and x1-validator-analytics, for his X1
validator's rewards.

Two companion references sit alongside this one:

- [`docs/engineering.md`](engineering.md): the files on disk, the gates,
  the tests and CI, the checks GitHub, the website that hosts the repo,
  runs at each push.
- [`docs/project-commands.md`](project-commands.md): every command,
  those the repo's `package.json` gives npm, Node's package manager, to run
  and those run with `node` or `source`, with its flags.

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
- [Settings Files](#settings-files)
- [Projects That Use This One](#projects-that-use-this-one)
- [Technology Choices](#technology-choices)

---

## The Parts

The Sheets scripts do the pricing. The other parts run the scripts on a
computer, price a whole CSV file, keep the api keys, stop a key from being
printed, choose which version of this repo the projects that use it
install, and write the CSV files the owner imports into Summ, the crypto
tax calculator he keeps his books in. The key store, which keeps the api
keys encrypted, and the order in which the price clients ask the services
that price pools follow LP Ranger, the owner's bot that manages his 9mm V3
liquidity positions.

The programs a reader runs from a terminal are in `bin/`. Each of the two
price tools has a folder of its own at the repo's top, which holds its
Sheets scripts, in its `src/`, its README and its settings:
`crypto-price-fetchers/`, a token's price now, and
`fetch-from-centralized-exchange/`, a token's price at a past time, with
crypto-price-filler's package. The top `src/` holds the menu, the build's
tools are in `build/tools/`, the install of the operating system's
programs the tools use in `install/`, and the code the programs share in
folders of its own; the file the build writes when there is no clipboard
goes to `dist/apps-script/`, which git ignores.

A tool that reads the owner's own files, crypto-price-filler or the Summ
CSV writer, takes them from its folder's `input/`, and writes its results
in its folder's `output/`, in a folder for each kind of file, such as
`output/csv/`. Those files hold the owner's data, and the repo is public,
so git keeps each of those folders by its `.gitkeep`, an empty file, and
ignores everything else in it, and so do the format check and the secret
scan. A file a tool writes when no option names one goes in its own
`output/` folder, wherever the tool runs: crypto-price-filler's default is
`output/csv/output.csv` in its folder.

| Part | Where | What it is |
| ---- | ----- | ---------- |
| The Sheets scripts | `crypto-price-fetchers/src/crypto-price-fetchers.gs`, `fetch-from-centralized-exchange/src/getCryptoPriceFromCentralizedExchange*.gs`, `src/crypto-price-fetchers-menu.gs` | Apps Script functions a sheet's cells call, and the menu that runs them again and shows their help. |
| The runner | `apps-script-runner/` | Runs a Sheets script under Node, unchanged. |
| The Node versions | `bin/crypto-price-fetchers.js`, `bin/getCryptoPriceFromCentralizedExchange.js` | Each Sheets script as a Node module and a command line, through the runner. |
| The build step | `build/tools/build.js`, `build/tools/apps-script-build/`, `build/tools/audit-dex-screener.js` | Joins the Sheets scripts, and DEX Screener's functions when asked, into one file with the saved api keys set at its end, on the clipboard, for one paste into Apps Script; and audits DEX Screener's files. |
| The install of the operating system's programs | `install/install-os-dependencies.js`, `install/os-dependencies.js` | `npm run os-dependencies`: says which of the programs the tools use from the computer's operating system, rather than from npm, is installed, today the build's clipboard tool, and installs what is missing: with Homebrew, the package manager for macOS and Linux, or, without it, it recommends Homebrew and offers apt, the package manager of Debian and Ubuntu. The build offers the same install when it finds no clipboard tool. |
| crypto-price-filler | `fetch-from-centralized-exchange/crypto-price-filler/`, started by `bin/crypto-price-filler.js` and `bin/backfill.js` | A Node tool that fills a CSV's price columns, row by row, from the pools' price services and the exchange script's sources. A package of its own. |
| The price clients | `dex-prices/` | Moralis, GeckoTerminal and DexTools, which price a token from a blockchain's pools, and the one loop that sends a refused request again. |
| The key store | `api-key-store/`, `bin/manage-api-keys.js`, `bin/unlock-api-keys.sh` | Api keys kept encrypted with a password: LP Ranger's design, as a module. |
| The lint rules | `eslint-rules/` | `no-secret-logging.js`, the security lint's, refuses printing a name that may hold a secret; `no-or-default.js`, the lint's, refuses a default made with `\|\|`. The other repos run both from here. |
| The versions tool | `bin/github-project-deps.js`, `github-project-deps/` | The bin `github-project-deps`, which sets a project's dependencies from GitHub to their projects' main branch or latest release. |
| The actionlint runner | `bin/run-actionlint.js`, `actionlint/` | The bin `run-actionlint`, which runs actionlint, the checker of GitHub Actions workflow files, from its official release, refused unless its SHA-256, and the program's in it, are the ones this repo pins: every repo's lint runs it. |
| The Summ CSV writer | `bin/summ-csv.js`, `summ-csv/` | Writes the CSV files the owner imports into Summ, once every row has passed its rules: `npm run summ-csv`, the bin `summ-csv`, and `writeSummCsv` for a program. |
| The shared helpers | `lib/` | Code more than one part, or more than one repo, uses, exported by the package's name for the projects that install this repo (`exports` in package.json): `messageOf`, which gives the message of something thrown (`crypto-price-fetchers/lib/message-of`); the checks of a command line's help, every option its examples use listed in it among them, and of its help into a closed pipe (`…/lib/command-line-help`); `endQuietlyWhenOutputCloses`, which ends a command line quietly when the program reading its output stops (`…/lib/closed-output`); `dayStartSeconds`, a day of the calendar written YYYY-MM-DD as the start of that day in UTC, refusing a day the calendar does not have (`…/lib/calendar-day`); `isHttpUrl` (`…/lib/http-url`); the checks of a repo's tracked files: EVM addresses in EIP-55's form, the npm targets and test files the docs must name, the links and paths in the docs, which must point at files, folders and headings the repo keeps, and the `config-example.json` beside every `config.json` (`…/lib/repo-checks`); `fetchWithinTimeLimit`, which sends a request and reads its whole answer within a time limit, naming the service when the time runs out (`…/lib/time-limited-fetch`): the price clients, the runner, the key store's checks and the downloads of actionlint and of DEX Screener's files send their requests through it; the checks of a settings file against its JSON Schema, a description in JSON of the keys the file may hold and the kind of value each takes: the kinds of value, with the words of a refusal (`…/lib/settings-schema`), and `readSettingsFile`, which reads a settings file and checks it against its schema (`…/lib/settings-file`), as [Settings Files](#settings-files) describes; and `checkConflicts`, which refuses a typed option that conflicts with one a settings file sets (`…/lib/option-conflicts`). Two more serve this repo's parts alone, and are not exported: `askLine`, which asks a question at the terminal and gives the line typed (`lib/ask-line.js`), and the desktop's clipboard tool, found, handed text, and the package that holds one named (`lib/clipboard.js`). |

---

## The Sheets Scripts

A Sheets script is Google Apps Script: JavaScript that runs on Google's
servers, inside a spreadsheet, where a cell calls one of its functions.

`crypto-price-fetchers/src/crypto-price-fetchers.gs` gives a token's
current price and its fully diluted value, from DexTools, a service that prices tokens from the pools
of decentralized exchanges, for the chains DexTools covers, and from
x1.ninja, which does the same for X1, which DexTools does not list. A cell
names the chain and the token, or a pool.

`fetch-from-centralized-exchange/src/getCryptoPriceFromCentralizedExchange.gs`
gives a token's price at a past minute: by default the average of the high and the low of the candle
that holds it, or else the candle's high, low or close, from MEXC, a
centralized exchange, first, then CoinGecko, then CoinPaprika, two
services that gather the exchanges' prices. MEXC keeps minute candles for
about the last 30 days, so for an older time its period is the hour that
holds it. When nothing traded in that minute or hour, MEXC's price comes
from the first larger period around it, up to a year, in which something
did. A larger period may hold only trades from after a time that comes
before the coin's first trade on MEXC, which comes on the day MEXC listed
it, and a candle of the day before shows the coin traded before that day.
So when MEXC gives no candle of a recent time's minute, or of the hour, or
the request for it fails, the script asks for the day before: with none,
or when that request fails too, the next source answers. Apps Script runs
the calls of many cells at the same time. The script's lock makes those
calls take turns at the services, and its cache answers a question
already asked without asking again. So a sheet full of cells keeps within
the services' rate limits. Google stops a call after 30 seconds, so each
call keeps to 25 (`CALL_BUDGET_MS`): it waits for the lock, or for a
request refused as one too many (status 429), only while the wait fits in
them, and sends no request once they are used. A request that gets no
response at all, as on a timeout or when Apps Script's daily quota of
requests is spent, is a failed one, and the next source answers. Such a
request, an answer with a server error (5xx) or a request timeout (408),
a refusal still there after the last try or past the time the call could
wait, and a request it had no time to send are cut short: when no source then gave a price, the cell
shows the script's busy message, and no source keeps the lack of an
answer from a request cut short, since it says nothing of whether the
source has a price.
The script is
in three files, which Apps Script loads into one scope: the function and
its settings, the price sources (`-sources.gs`), and the tests run from the
editor (`-tests.gs`). Each file names what it uses from the others in a
`/* global */` comment, for the lint. How both scripts are tested is in
[`docs/engineering.md`](engineering.md#how-the-sheets-scripts-gs-are-tested).

`crypto-price-fetchers-menu.gs` adds the Crypto Price Fetchers menu, which
its `onOpen` builds when the spreadsheet opens. Google stops a custom
function, a function a cell calls, after 30 seconds, and Sheets runs a
cell again only when its formula is edited or a cell it names changes, so
a cell stopped that way keeps showing `#ERROR!`. The menu's items make
that edit: each adds a `!` to a cell's formula, which Sheets saves as a
formula it cannot read, then puts the formula back, which Sheets runs as
a new one. They work 20 cells at a time, and wait for those to finish
before the next 20, since Google runs at most 30 calls of one person at
once. Before each write, the cell's formula is read again, so a cell that
changed during the run, as when the tab is sorted, is left alone and
reported. Clean up errors does this for the cells that show `#ERROR!` or
a price script's busy message, which the menu reads from the scripts' own
constants (`DEXTOOLS_BUSY_MESSAGE`, `EXCHANGE_BUSY_MESSAGE`); Refresh for
every cell that asks for a current value; and Refresh & freeze historical
prices for the past prices of one tab, whose numbers it keeps in place of
their formulas block by block, within the run's time. A current value
that Refresh runs again may come from a script's cache: the scripts keep
a DexTools or x1.ninja price or FDV above 0 for 5 minutes, as the script
is written (`DEXTOOLS_CONFIG.CACHE_SECONDS`), or for the seconds the
cell's fourth argument gives, and a DEX Screener answer for 30 seconds,
and ask again for a 0, an error or a busy message. Help shows the page the build step
makes from the help sections of the scripts' headers. No Node version
loads the menu, since it gives no price.

The owner pastes the one file the build step gives into a spreadsheet's
Apps Script project; the repo is where the scripts change.

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
its own, a second thread of JavaScript that Node runs beside the main one. The worker blocks on each web request while the caller's thread
does it, with the caller's `fetch`, and wakes with the response
(`run-apps-script.js`, `script-worker.js`). The caller's thread never
blocks, so a program that uses the runner goes on with its other work.

A script of several files loads as Apps Script loads them: every file is
compiled first, so one that does not compile stops the load before any
runs, then each runs, in order, in one scope (`load-apps-script.js`).

The runner also lays a config over the script's config objects, such as an
api key the script reads from `CONFIG`, once it has checked a config file
against the Node version's schemas of those objects (`config-file.js`),
and holds every config it lays to a schema built from the objects
themselves: each field an object has, of the JavaScript type of the value
the script gives it (`load-apps-script.js`). It sets Script
Properties the script reads, and makes a command line of a script's
functions (`command-line.js`). Tests can run a script in their own thread
instead, with stand-in services (`loadAppsScript`), as
[`docs/engineering.md`](engineering.md#the-node-tests) describes.

---

## The Node Versions

A Node version opens its Sheets script through the runner and exports its
functions, which take the Sheets arguments and return what the cell would
show. It never copies the script's logic: a fix in the `.gs` fixes both.

What differs from the sheet: there is no daily cap on requests, and no
30-second limit per call, though the exchange script's `getCryptoPrice`
keeps to its 25 seconds a call (`CALL_BUDGET_MS`) under Node too; the
cache lasts while the script is open; and the api keys come from the key
store, not the script. Each Node version lays
the keys it opens over the script's config: `bin/crypto-price-fetchers.js`
opens only the key its call needs, DexTools' or x1.ninja's, for
`DEXTOOLS_CONFIG.API_KEY` or `X1_CONFIG.API_KEY`;
`bin/getCryptoPriceFromCentralizedExchange.js` opens CoinGecko's and
CoinPaprika's, for `CONFIG.COINGECKO_API_KEY` and
`CONFIG.COINPAPRIKA_API_KEY`. Its `openCentralizedExchangeSources` opens
the script's three price sources rather than its Sheets function, for
crypto-price-filler.

---

## The Build Step

A spreadsheet runs its scripts from its Apps Script project, where the
owner pastes them. Apps Script cannot read the key file, so a key reaches
a sheet only inside the script pasted there, and it runs every script file
of a project in one global scope, so the scripts must work as one.
`npm run build apps-script` (`build/tools/build.js`,
`build/tools/apps-script-build/`) gives one
file that holds them all, with the keys written in, for one paste.

- **The parts**, in the order they run: the menu
  (`src/crypto-price-fetchers-menu.gs`); then each script whose Node version
  exports a build spec, `APPS_SCRIPT_BUILD`, which names the script's
  files in Apps Script's order, the services whose keys it sends, and the
  function that lays the keys over its config:
  `crypto-price-fetchers/src/crypto-price-fetchers.gs`, then the exchange
  script's three files, its in-editor tests included;
  then DEX Screener's functions, when the owner asks for them.
- **DEX Screener's functions.** DEX Screener, a service that lists the pairs
  of decentralized exchanges with their prices, published Google Sheets
  functions of its own, such as `DEX_SCREENER_PAIR_PROP`, in a repo that
  carries no license, so this repo holds none of their code. Every build
  asks whether to include them; Enter includes them. The build then runs the
  audit that `npm run audit:dex-screener` runs (`dex-screener-files.js`): it
  downloads their files from raw.githubusercontent.com at the commit written
  there, checks each file's SHA-256 against the one written beside it, and
  says its line. It compiles only the files the audit gave with esbuild, the
  program that compiles TypeScript and JavaScript into one file, as DEX
  Screener's own build does, with zod, a library that checks data against a
  schema, and lodash, a library of helper functions, which DEX Screener's
  code imports and this repo lists as dependencies, since the file holds
  their code (`dex-screener.js`). Their code runs inside a function of its
  own in the file, so its names, its own `onOpen` among them, stay inside
  it, and a top-level function of each custom function's name hands a cell's
  call on. A failed download, a file that differs, or a failed compile stops
  the build with the advice to run it again and answer n. npm audit, npm's
  check of the installed packages against known vulnerabilities, does not
  cover that code, so `npm run audit:dex-screener`
  (`build/tools/audit-dex-screener.js`), which `npm run audit:deps` runs after npm
  audit, runs the same audit on its own.
- **The values.** The build opens the keys as the programs do
  (`unlockProjectKeys`), and sets, as the file's last statements, the
  values each Node version would set: those of the config.json it reads,
  with the keys laid over them. It reads each config.json before its first
  question and checks it against the Node version's schemas, so a file
  they refuse stops the build before it asks anything or opens a key. Code
  a script runs as it loads has run by the last statements, so a field it
  reads there keeps the value written in the script, as under Node, and
  the schemas refuse such a field. The last value is the page the menu's Help item shows,
  made from the help section of each script's header (`help-page.js`).
- **The checks.** Before it hands the file over, the build checks that the
  parts make one Apps Script project (`built-script.js`). Each part,
  loaded alone, must declare no function or `var` that another part
  declares, since the one that runs later would replace the other without
  a word; the whole file must load, which a name declared twice with
  `const` prevents; each value must name a field the scripts have; and DEX
  Screener's functions, when asked for, must be functions.
- **The hand-over.** The build puts the file on the clipboard, through the
  desktop's tool (`lib/clipboard.js`), says how to paste it, waits for
  Enter, and clears the clipboard. With no tool installed, on a Linux
  desktop with Homebrew or apt, it offers the install
  `npm run os-dependencies` runs (`install/os-dependencies.js`), and runs
  it on a yes. Declined, failed, or with no install to offer, it warns
  that the keys go to disk in the clear, then writes the file to
  `dist/apps-script/`, which git, the version-control program that keeps
  the repo's history, ignores, readable by the owner alone.

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
key store, each one saved. Its backfill, `backfill.js`, started by
`bin/backfill.js`, fills the prices marked `Error` in a file already
written.

Its settings are `config-example.json`, committed, with its own
`config.json`, which git ignores, laid over them, and its tokens are those
`supported-tokens.json` lists; each file is checked against its schema
(`config.js`, `supported-tokens.js`) before the tool takes it, as
[Settings Files](#settings-files) describes. The exchange sources run on
the script's own `CONFIG`, with the values of the `config.json` in the
script's tool folder, `fetch-from-centralized-exchange/`, laid over it, which the script's Node version reads when it opens
the script, at the first price. So the filler checks that file against
the Node version's schemas before its first row
(`checkExchangeSettings`, `sources/exchange.js`), and a file they refuse
ends the run there, with exit code 1, as its own settings files do.

---

## Prices of Tokens That Trade in Pools

A token that trades in a blockchain's pools has a price wherever it
trades, and the services that read the pools give it. `dex-prices/` holds
their clients, asked in LP Ranger's order:

- Moralis (`moralis.js`) gives the token's price at a block: the block the
  chain had at a time, then the price there. It needs a key, and gives one
  price, with no high or low. It also gives a pool's candles over a span of
  time (`pairCandles`), in USD, of the token the pool lists first, as in
  HEX / WPLS, which prices HEX; its answer names that token. To find a pool
  whose candles price a token, `tokenPairs` lists the pairs that trade the
  token, up to 10 pages, each with the token it lists first, and
  `pairListingFirst` picks the deepest of those that list the token first,
  leaving out a pair Moralis marks inactive for having traded nothing over
  the last day.
- GeckoTerminal (`geckoterminal.js`) gives a pool's candles. The pool is
  the one LP Ranger picks: of the first pools GeckoTerminal ranks for the
  token, the deepest that traded in the last day and holds the token on
  one of its sides. Its public api serves the last 180 days, and takes
  about thirty requests a minute, so the client keeps every caller in the
  process within one budget of twenty a minute.
- DexTools (`dextools.js`) gives a token's price now. It needs a key,
  which it sends at the path of the plan the caller names, the standard
  plan unless another is named.
- Every request goes through `web-request.js`, the one loop that sends a
  request again after each wait while a service refuses it as one too
  many (status 429). Each try has 30 seconds to answer in full, the body
  included (`fetchWithinTimeLimit`, `lib/time-limited-fetch.js`), and a try
  that runs out of time fails with an error that names the service.

crypto-price-filler's pool sources use these clients, and other repos
install them from this one: pulsechain-analytics' ratio chart, which charts
the ratio of two tokens' prices, asks GeckoTerminal, Moralis and DexTools
through them. x1-validator-analytics and pulsechain-validator-analytics
send their requests to a chain's endpoint or a beacon node through
`fetchWithinTimeLimit` too.

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
- `source ./bin/unlock-api-keys.sh`, a script in the repo's `bin/`, asks
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
   for the chain, so a chain is added there, with no change to the code;
   the file is checked against its schema (`SUMM_CSV_SETTINGS_SCHEMA`) as
   it is read. A
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

## Settings Files

A tool keeps its settings in a JSON file, such as its `config.json`, and a
setting in a file is a decision the owner made: a misspelled key that the
tool passes over, or a value of the wrong kind that the tool bends to fit,
runs the tool on a setting the owner did not choose. So each settings file
has a JSON Schema, a description in JSON of the keys the file may hold and
the kind of value each takes, and the file is checked against it before
the tool takes any setting, as LP Ranger checks its settings.

Ajv, an npm package of the ajv-validator project that checks JSON against
a schema, compiles each schema on the 2020-12 draft of JSON Schema, strict, so a keyword or format it does
not know is refused as the schema compiles. Each schema is compiled once,
the first time a file is read against it, and the check is kept for every
later read: crypto-price-filler reads its token list for every row. An
object of settings names the keys it takes and refuses any other
(`additionalProperties: false`). An object keyed by names or addresses the
owner chooses, such as the filler's tokens by symbol, takes any such key,
held to a form where the code needs one (`propertyNames`): the filler's
symbols in lower case. A value of the wrong kind is refused,
never corrected, and every problem in the file is listed at once, one line
each:

```text
crypto-price-filler/config.json → BACKFILL_HIGEST is not a setting this tool reads
crypto-price-filler/config.json → BACKFILL_LOWEST must be true or false; it is "no"
```

`lib/settings-schema.js` holds the shared part:

- `compileSettingsSchema` compiles a schema with the formats code checks,
  since JSON Schema cannot: `http-url`, an http or https url
  (`lib/http-url.js`), and `eip55-address`, an address in EIP-55's form
  (`lib/repo-checks.js`).
- `KINDS` holds the kinds of value the settings files share, each a schema
  whose `description` is the words a refusal uses, such as "a whole number
  above 0". The two kinds of a time limit, in seconds and in milliseconds,
  and the kind of a wait, which may be 0, take a whole number up to
  2147483647 milliseconds, the longest Node's timers keep: a timer set for longer fires after 1 millisecond, and
  `fetchWithinTimeLimit` refuses a limit past it.
- `kindParser` makes a command line's option parser from a kind, so a
  value typed and the same value in a settings file meet one rule.
- `settingsProblems` words Ajv's errors, one line for each value at
  fault.

`lib/settings-file.js` reads a file with them. A missing file gives no
settings, so the tool runs on its defaults, unless the caller marks the
file required; a file that cannot be read, is not JSON, holds no JSON
object or has a problem its schema finds stops the run.

The settings files of this repo, and the schemas they are held to:

| File | Schema | Read by |
| --- | --- | --- |
| `config.json`, its `apiKeys` | `apiKeysSchema` in `api-key-store/project-keys.js`: a list of services the key store knows, each once; it reads no other key, since every other key of the file is the project's | The key store, for any project |
| A Node version's `config.json`, in its tool's folder: `crypto-price-fetchers/config.json`, `fetch-from-centralized-exchange/config.json` | `CONFIG_SCHEMAS` in the Node version (`bin/crypto-price-fetchers.js`, `bin/getCryptoPriceFromCentralizedExchange.js`), which it passes to the runner and the build as `configSchemas`: for each config object it names, every field the script reads each time it is called, of its kind of value. An api key, which the key store sets, and a field the script reads as it loads, which a value laid after the load does not reach, are refused. The runner's `configSchemaProblems` (`apps-script-runner/config-schema-check.js`) holds each schema to its script: it loads the script with each config object watched, and names a field a schema names that the script reads as it loads, holds a key or lacks, a field read only when called that no schema names, and a value of the script's own that its schema refuses; `test/config-schemas.test.js` runs it on each Node version | The runner, before the script opens (`apps-script-runner/config-file.js`), and the build step, before its first question |
| `crypto-price-filler/config-example.json`, `crypto-price-filler/config.json` | `SETTINGS_SCHEMA` in `config.js` | crypto-price-filler |
| `crypto-price-filler/supported-tokens.json` | `SUPPORTED_TOKENS_SCHEMA` in `supported-tokens.js` | crypto-price-filler |
| `summ-csv/settings.json` | `SUMM_CSV_SETTINGS_SCHEMA` in `summ-csv/index.js` | The Summ CSV writer |

Each kind of `config.json` ships with a `config-example.json` beside it,
which git keeps and never ignores: the file's settings, each with its
default value, so the owner sees every setting a file may hold and copies
the example to make his own. Where the code holds the defaults, the
example repeats them, and the code stays as it is for now: the Node
versions' scripts hold theirs, and `test/config-schemas.test.js` holds
each example to its schemas and to the values written in its script.
crypto-price-filler is the one tool that reads its example, as its
committed settings. The top `config-example.json` holds what the
committed top `config.json` holds. `configExampleProblems`
(`lib/repo-checks.js`), which every repo of the owner runs in its tests,
finds a `config.json`, kept by git or named in the top `.gitignore`, with
no example beside it.

A command line that takes its options' defaults from a settings file makes
each option's parser from the kind its schema gives the setting. Commander
refuses two conflicting options only when both are typed, so
`checkConflicts` (`lib/option-conflicts.js`) refuses a typed option that
conflicts with one the settings file sets.

The projects that install this repo build their schemas from `KINDS` and
read their settings with `readSettingsFile`, as
`crypto-price-fetchers/lib/settings-schema` and `…/lib/settings-file`.

---

## Projects That Use This One

Three of the owner's projects install this repo from GitHub, as a
dependency their `npm install` installs:

- pulsechain-analytics, his tools for questions about PulseChain, runs a
  Sheets script of its own, `fetch-amount-of-token-transferred.gs`,
  through the runner, and calls nothing in this repo's Sheets scripts. Its
  ratio chart asks GeckoTerminal, Moralis and DexTools through their
  clients, and its Summ sweep writes its CSV through the Summ CSV writer.
  Its other tools read the chain through ethers, a library for talking to
  Ethereum-style chains.
- pulsechain-validator-analytics, for his PulseChain validators'
  withdrawal addresses and payments, sends no key today, and keeps the key
  store ready. It sends its requests to a beacon node and an execution
  layer endpoint through `fetchWithinTimeLimit`.
- x1-validator-analytics, for his X1 validator's rewards, prices each
  reward through the GeckoTerminal client, and sends its requests to the X1
  endpoint through `fetchWithinTimeLimit`.

All three use the key store, run `no-secret-logging` in their security
lint, keep a copy of `bin/unlock-api-keys.sh` in their own `bin/`, which
their tests hold to this one, run the versions tool, run actionlint on their workflow files
through `run-actionlint`, run `no-or-default` in their lint, use helpers
of `lib/` in their command lines, and run the shared checks of `lib/` in
their tests.

### Which Version They Install

A dependency installed from GitHub names its repo and a ref:
`github:nottoseethesun/crypto-price-fetchers#main` names this repo's main
branch, and `#semver:*` its latest release, the highest version tag. When
npm makes a project's lockfile, it installs the commit the ref names at
that moment, and the lockfile keeps that commit, which `npm ci` installs
until the lockfile is made again. So a change here reaches a project once
its lockfile is made again at a commit that has the change.

The bin `github-project-deps` (`bin/github-project-deps.js`,
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

- **Node 24 or later**, ES modules, Node's own test runner for the runner,
  the Node versions and the key store; vitest, a test runner for
  JavaScript, for crypto-price-filler, whose tests are written for it.
- **commander**, the package that parses a command line and writes its
  help, for every command line.
- **Ajv**, the package that checks JSON against a JSON Schema, for every
  settings file, as LP Ranger checks its own: draft 2020-12, strict. It is
  a dependency, since the projects that install this repo check their
  settings with `lib/settings-schema.js`.
- **esbuild**, a development package, for the build step's compile of DEX
  Screener's TypeScript, as DEX Screener's own build compiles it. zod and
  lodash, the two packages that code imports, are dependencies: the built
  file holds their code, and the gate's npm audit checks dependencies
  only.
- **actionlint's official release**, through `run-actionlint`, for the
  check of the workflow files, rather than an npm package that wraps it:
  the program comes from its author's GitHub release, and the run refuses
  an archive, or a program in it, whose SHA-256 differs from the one
  `actionlint/release.js` pins, so no package between the release and the
  run decides what runs.
  Node's zlib opens the archive, and `actionlint/index.js` reads the tar
  file inside, so the download and unpacking add no package either.
- **@noble/hashes**, a package of hash functions written in JavaScript,
  for the Keccak-256 hash that an address's EIP-55 checksum is made from
  (`lib/repo-checks.js`): Node's `crypto` offers SHA3-256, which pads its
  input otherwise and so gives another hash. It is a dependency, since the
  projects that install this repo run the check in their tests.
- **Node's `crypto`**, its built-in module of ciphers and hashes, for the
  key store: no package between the password
  and the cipher.
- **Worker threads and `Atomics.wait`**, the call that blocks a thread
  until another thread wakes it, for the runner, rather than a
  package such as synckit. synckit does the waited-for work in a worker of
  its own, and a function cannot be passed to another thread. Doing the
  request on the caller's thread lets a caller hand in its own `fetch`, as
  the tests do.
