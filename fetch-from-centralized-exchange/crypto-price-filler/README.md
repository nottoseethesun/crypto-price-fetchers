# Get Crypto Price from Centralized Exchange

## Overview

USE AT YOUR OWN RISK: SEE LICENSE FILE, INCLUDED TWO DIRECTORIES UP.

This tool, which runs on Node, the program that runs JavaScript outside
a browser, fills in a token's prices in a CSV file. It reads a CSV
whose rows each hold a timestamp, finds the token's USD price at each
time, down to the minute, and writes `output.csv`, with each row's
timestamp and price.

It prices two kinds of token, each where it trades:

- A coin that trades on centralized exchanges rather than in pools, such
  as Bitcoin and Monero, has no pool for a pool's price service to read.
  The tool asks MEXC, a centralized exchange, then CoinGecko, then
  CoinPaprika, two services that gather the exchanges' prices, through the
  price sources of the repo's script for Google Sheets, Google's
  spreadsheet app, written in Apps Script, Google's platform for scripts
  that run inside its apps:
  `src/getCryptoPriceFromCentralizedExchange-sources.gs`, which it runs
  unchanged under Node (`sources/exchange.js`), so the sheet and the tool
  price alike.
- A token that trades in a blockchain's pools, such as HEX on PulseChain,
  is asked of Moralis first, when a Moralis key is saved, then of
  GeckoTerminal, two services that price a token from its chain's pools,
  in the order LP Ranger, the owner's bot that manages his 9mm V3
  liquidity positions, asks them, and then of CoinGecko and CoinPaprika. Its entry in `supported-tokens.json` names its contract and
  its chain's ids.

The order of the sources, and what each gives, is in the file header of
`./index.js`.

### Current Roster of Utilities

- `index.js` - Main CLI tool for fetching prices and filling CSV files,
  started by the repo's `bin/crypto-price-filler.js`
- `backfill.js` - Standalone utility to backfill the Error prices in
  existing CSV files, started by the repo's `bin/backfill.js`

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
npm ci --prefix fetch-from-centralized-exchange/crypto-price-filler
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
`config.json` in the folder above, which git ignores, laid over it; that
file is checked against the script's Node version's schemas
(`CONFIG_SCHEMAS` in the repo's `bin/getCryptoPriceFromCentralizedExchange.js`)
before the first row, and a problem stops the run the same way.

The api keys are no settings: the CoinGecko, CoinPaprika and Moralis keys
are kept in `api-keys.json` at the repo's top, encrypted with a password you
choose, by the repo's key store, whose key manager `npm run api-keys` runs.
To save them, from the repo's top folder:

```bash
npm run api-keys
```

Each run then opens them before it prices anything, with the password
`source ./bin/unlock-api-keys.sh`, run in the repo's top folder, keeps for
the terminal, or else one it asks
for, and asks each service once whether it takes its key. Without a saved
key, the tool asks CoinGecko without one, at its lower rate limits, asks
CoinPaprika's free server, and does not ask Moralis. See
[The api keys](../../README.md#3-the-api-keys) in the repo's README.

## Run

The tool's two programs are in the repo's `bin/` folder; the commands
below run from the repo's top folder.

### crypto-price-filler.js

`bin/crypto-price-filler.js` runs `index.js`, which prices every row of a
CSV file. `node bin/crypto-price-filler.js --help` lists all its options,
with examples and its exit codes, and the file header in `./index.js`
says more about each.

```bash
node bin/crypto-price-filler.js --token=grc --input=mining.csv --output=filled.csv
```

The tool reads its own files, `supported-tokens.json`,
`config-example.json` and `config.json`, from this folder, so it runs from
any folder; the paths `--input` and `--output` name are taken from the
folder it runs in. `npm start -- <options>`, in this folder, runs the same
command line.

The dates are read in UTC unless `--tz` names another time zone in full, such
as `America/Chicago`; each row gets the offset the zone had at that time,
daylight saving included. `node bin/crypto-price-filler.js
--list-valid-timezones` prints every name `--tz` takes.

### backfill.js

A row whose price no service gave gets `Error` in the output's
`$usd price` column. `bin/backfill.js` runs `backfill.js`, which fills
such rows in an output CSV file already written, without asking any
service again: each takes the price of the nearest priced row before or
after it, the higher of the two with `--backfill-highest`, the lower with
`--backfill-lowest`. The rows that hold no data, a "Total" row, a row
with no date and the rows after the last date, have a blank price, which
backfill leaves as it is, so they stay out of the grand total. The file
header in `./backfill.js` lists all its options.

```bash
# Backfill with highest bracketing price (conservative tax estimates)
node bin/backfill.js --input=output.csv --backfill-highest

# Backfill with lowest bracketing price (budgeting)
node bin/backfill.js --input=output.csv --backfill-lowest
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

- **ESLint, which checks JavaScript against rules, must pass** (`npm run lint`): it allows a cyclomatic complexity of at most 17
- **All tests must pass** (`npm run test:strict`)
- Any major new functionality must have a test runnable from the current approach
- Line coverage must remain at or above 80%

[![CI](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/ci.yml/badge.svg)](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/ci.yml)
