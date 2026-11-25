# crypto-price-filler

## Overview

USE AT YOUR OWN RISK: SEE LICENSE FILE, INCLUDED TWO DIRECTORIES UP.

This tool, which runs on Node, the program that runs JavaScript outside
a browser, fills in a token's prices in a CSV file. It reads a CSV
whose rows each hold a timestamp, finds the token's USD price at each
time, down to the minute, and writes the file again with each row's
price, by default as `output.csv` in this folder's `output/csv/`.

It prices two kinds of token, each where it trades:

- A coin that trades on centralized exchanges rather than in pools, such
  as Bitcoin and Monero, has no pool for a pool's price service to read.
  The tool asks MEXC, a centralized exchange, then CoinGecko, then
  CoinPaprika, two services that gather the exchanges' prices, through the
  price sources of the repo's script for Google Sheets, Google's
  spreadsheet app, written in Apps Script, Google's platform for scripts
  that run inside its apps:
  `fetch-from-any-exchange/src/getCryptoPriceFromCentralizedExchange-sources.gs`,
  which it runs unchanged under Node (`sources/exchange.js`), so the sheet
  and the tool take a price from the same sources, and neither from a
  period before it is over: MEXC's candle of the minute that holds the
  time, or of the larger period MEXC is asked for when nothing traded in
  that minute, CoinGecko's 24 hours around the time, or CoinPaprika's UTC
  day. Where a cell then says when to ask again, the tool writes
  `Error` in the row's price, unless a later source gives a final one; a
  run once the period is over fills it, when a source then has a price,
  or this package's backfill, which fills each `Error` from the priced
  rows around it
  ([Current Roster of Utilities](#current-roster-of-utilities)).
- A token that trades in a blockchain's pools, such as HEX on PulseChain,
  is asked of Moralis first, when a Moralis key is saved, then of
  GeckoTerminal, two services that price a token from its chain's pools,
  in the order LP Ranger, the owner's bot that manages his 9mm V3
  liquidity positions, asks them, and then, as every token is, of MEXC,
  CoinGecko and CoinPaprika, each under the id the token's entry in
  `supported-tokens.json` names, and skipped where the entry names none:
  HEX on PulseChain names none at MEXC. GeckoTerminal's candle of a minute
  or an hour gives no price before that minute or hour is over. The
  token's entry also names its contract and its chain's ids.

The order of the sources, and what each gives, is in the file header of
`./index.js`.

### Current Roster of Utilities

- `index.js` - Main CLI tool for fetching prices and filling CSV files,
  started by the repo's `bin/end-user/crypto-price-filler.js`
- `backfill.js` - Fills each price the main tool marked `Error`, in a CSV
  it wrote, with the price of the nearest priced row before or after it,
  the higher of the two or the lower, asking no service; started by the
  repo's `bin/end-user/backfill.js`, which
  [the repo's README](../../README.md#backfilljs-1) covers

## Prerequisites

NodeJS 24+

## Installation

The tool uses two parts of crypto-price-fetchers, the repo this folder is
in: the runner, which runs a Sheets script under Node, and the key store,
which keeps the api keys encrypted. Both come from the repo's top folder,
so the tool needs the packages of both folders, which npm, Node's package
manager, installs. From the repo's top folder:

```bash
npm ci
npm ci --prefix fetch-from-any-exchange/crypto-price-filler
```

See [Install](../../README.md#install) in the repo's README.

## Configuration

`config-example.json` holds the tool's settings as committed. Your own
settings go in `config.json` beside it, which git, the version-control
program, ignores: each setting there
takes the place of the same one in `config-example.json`, so it needs only
those that differ. The file header in `./index.js` describes every setting.
Both files, and `supported-tokens.json`, are checked against their JSON
Schemas (`SETTINGS_SCHEMA` in `config.js`, `SUPPORTED_TOKENS_SCHEMA` in
`supported-tokens.js`) before the tool takes them: a setting the tool does
not read, such as a misspelled one, or a value of the wrong kind stops the
run, with every problem listed. The exchange sources run on the Sheets
script's own settings, its `CONFIG`, with the values of the
`config.json` in the folder above, which git ignores and beside which
`config-example.json` shows each field with its default, laid over it; that
file is checked against the script's Node version's schemas
(`CONFIG_SCHEMAS` in the repo's `bin/end-user/getCryptoPriceFromCentralizedExchange.js`)
before the first row, and a problem stops the run the same way.

The api keys are no settings: the CoinGecko, CoinPaprika and Moralis keys
are kept in `api-keys.json` at the repo's top, encrypted with a password you
choose, by the repo's key store, whose key manager `npm run api-keys` runs.
To save them, from the repo's top folder:

```bash
npm run api-keys
```

Each run then opens them before it prices anything, with the password,
from the environment variable `API_KEYS_PASSWORD` when it holds one, or
else asked for, and asks each service once whether it takes its key. Without a saved
key, the tool asks CoinGecko without one, at its lower rate limits, asks
CoinPaprika's free server, and does not ask Moralis. The free server keeps
no candle of a day already over, so it gives a past day's close, but no
high or low: a run with `--mode high` or `--mode low`, for a token
CoinPaprika lists, says so and asks whether to go on without CoinPaprika's
prices. y goes on, and a row no other source prices gets `Error`; Enter or
n stops the run, with exit code 1, before any price is asked for. See
[The api keys](../../README.md#3-the-api-keys) in the repo's README.

## Run

```bash
node bin/end-user/crypto-price-filler.js --token=grc --input=fetch-from-any-exchange/crypto-price-filler/input/mining.csv
```

Run from the repo's top folder, this prices each row of `mining.csv`, in
this folder's `input/`, with Gridcoin's close at the row's time, read in
UTC, and writes the rows, with their prices, to `output/csv/output.csv`,
in this folder. The tool's program is the repo's
`bin/end-user/crypto-price-filler.js`, which runs `index.js`. The files
you give the tool go in this folder's `input/`, and the files it writes
in its `output/csv/`: they hold your own data, and the repo is public, so
git keeps nothing in either folder but the folder.

### Usage of crypto-price-filler.js

`node bin/end-user/crypto-price-filler.js --help` lists all its options,
with examples and its exit codes, and the file header in `./index.js`
says more about each.

The same prices, written to a file you name, `filled.csv` in its
`output/csv/`:

```bash
node bin/end-user/crypto-price-filler.js --token=grc --input=fetch-from-any-exchange/crypto-price-filler/input/mining.csv --output=fetch-from-any-exchange/crypto-price-filler/output/csv/filled.csv
```

The tool reads its own files, `supported-tokens.json`,
`config-example.json` and `config.json`, from this folder, and writes
`output/csv/output.csv` here when no `--output` is given, so it runs from
any folder; the paths `--input` and `--output` name are taken from the
folder it runs in. `npm start -- <options>`, in this folder, runs the same
command line.

The dates are read in UTC unless `--tz` names another time zone in full, such
as `America/Chicago`; each row gets the offset the zone had at that time,
daylight saving included. `node bin/end-user/crypto-price-filler.js
--list-valid-timezones` prints every zone `--tz` takes, each by the name
Node's list of time zones spells; `--tz` also takes the current name of
a zone that list spells by an older one, such as `Asia/Kolkata` for
`Asia/Calcutta`. XTM's high at each row's time, the times read in US
Central time, with each step logged:

```bash
node bin/end-user/crypto-price-filler.js --token=xtm --input=fetch-from-any-exchange/crypto-price-filler/input/input.csv --mode=high --tz=America/Chicago --verbose
```

With no CoinPaprika key saved, it first asks whether to go on without
CoinPaprika's prices (see the api keys, above): y goes on.

A row no service priced gets `Error` in its price. `--backfill-highest`
fills it with the higher of the prices of the nearest priced rows before
and after it, and `--backfill-lowest` with the lower:

```bash
node bin/end-user/crypto-price-filler.js --token=grc --input=fetch-from-any-exchange/crypto-price-filler/input/mining.csv --backfill-highest
```

## Development

### Lint

The repo's lint, run from its top folder, covers this tool too, with LP
Ranger's rules: no function above cyclomatic complexity 17, no file above
500 lines of code, the formatting of Prettier, the package that formats
code, and the rest that
[`docs/engineering.md`](../../docs/engineering.md) lists.

```bash
cd ../..
npm run lint        # Check for lint errors
npm run lint:fix    # Fix what the tools can
```

`npm run check`, also from the top folder, runs the lint, both test suites,
this one's with at least 80% of lines covered, and the security audits.

### Test

The tests run on vitest, a test runner. vitest loads each file through its
own module loader, which finds imports
that Node itself does not. So the tests can pass while `index.js` fails to
start under Node, for example after a wrong `import`. `test:strict` first
starts the real command line with `--help`, then runs the tests, so such
an import fails the run.

From this folder, `fetch-from-any-exchange/crypto-price-filler/`,
whose `package.json` names these commands, or from the repo's top folder
as `npm run test:filler`:

```bash
npm run test        # Run tests with coverage
npm run test:strict # Validate CLI parsing + run tests
```

#### Debug Test

`npm run test:debug` runs the tests with each one named, and the tool's
log shown (`VERBOSE=1`).

#### Save Test Log to File

The log is long, so it can be written to a file:

`npm run test:debug > test.log 2>&1`

#### View Log for Quick Copy-Paste of Log

The log holds the terminal's color codes, which a text editor shows as
noise. `aha` turns them into an HTML page, which a browser shows in color,
ready to copy.

##### Install `aha`

`sudo apt install aha`

##### Run the Command

`aha --black -y 'body { font-size: 14px; }' < test.log > test.html && xdg-open test.html`

`xdg-open`, the Linux command that opens a file with its default program,
shows the page.

##### Optionally Add To Your Shell Alias File

```bash
# - - - - - - Test Log Utilities

alias svtlog='npm run test:debug > test.log 2>&1'
alias swtlog="aha --black -y 'body { font-size: 14px; }' < test.log > test.html && xdg-open test.html"
```

## Contributing

Fork the repo on GitHub, the website that hosts it. Contributions are welcome, and each is subject to the license in the repo's [LICENSE](../../LICENSE) file, two folders up.

To be accepted for pull request:

- **ESLint, which checks JavaScript against rules, must pass** (`npm run lint`, from the repo's top folder, two folders up): it allows a cyclomatic complexity of at most 17
- **All tests must pass** (`npm run test:strict`)
- Any major new functionality must have a test runnable from the current approach
- Line coverage must remain at or above 80%

[![CI](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/ci.yml/badge.svg)](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/ci.yml)
