# Get Crypto Price from Centralized Exchange

## Overview

USE AT YOUR OWN RISK: SEE LICENSE FILE, INCLUDED TWO DIRECTORIES UP.

This Node tool fills in a token's prices in a CSV file. It reads a CSV
whose rows each hold a timestamp, finds the token's price at each time,
down to the minute, and writes `output.csv`, with each row's timestamp
and price.

It is for coins that trade on centralized exchanges rather than in
decentralized exchanges' pools, such as Bitcoin and Monero. A wrapped
version, such as wBTC, may trade in a pool, but the coin itself does not.
Services that price a token from its pool, such as DexScreener and
DexTools, have no price for these coins, since there is no pool to name.
This tool asks centralized exchanges instead. If the few decentralized
exchanges that trade these coins had more volume and an API, they could be
asked too.

### Current Roster of Utilities

- `index.js` - Main CLI tool for fetching prices and filling CSV files
- `backfill.js` - Standalone utility to backfill empty prices in existing CSV files

## Prerequisites

NodeJS 22+

## Installation

`npm install`

## Configuration

`config-example.json` holds the tool's settings as committed. Your own
settings go in `config.json` beside it, which git ignores: each setting there
takes the place of the same one in `config-example.json`, so it needs only
those that differ. The file header in `./index.js` describes every setting.

The CoinGecko demo key is no setting: it is kept in `api-keys.json` at the
repo's top, encrypted with a password you choose. To save it, from the repo's
top folder:

```bash
npm run api-keys
```

Each run then opens it before it prices anything, with the password
`source ./unlock-api-keys.sh` keeps for the terminal, or else one it asks
for, and asks CoinGecko once whether it takes the key. Without a saved key,
the tool asks CoinGecko without one, at CoinGecko's lower rate limits. See
[Api keys](../../README.md#api-keys) in the repo's README.

## Usage

### index.js: Price Fetching

`index.js` prices every row of a CSV file. The file header in `./index.js`
lists all its options.

```bash
node index.js --token=grc --input=mining.csv --output=filled.csv
```

The dates are read in UTC unless `--tz` names another time zone in full, such
as `America/Chicago`; each row gets the offset the zone had at that time,
daylight saving included. `node index.js --list-valid-timezones` prints every
name `--tz` takes.

### backfill.js: Filling Empty Prices

A row whose price no service gave is left empty in the output. `backfill.js`
fills such rows in an output CSV file already written, without asking any
service again: each takes the price of the nearest priced row before or
after it, the higher of the two with `--backfill-highest`, the lower with
`--backfill-lowest`. The file header in `./backfill.js` lists all its
options.

```bash
# Backfill with highest bracketing price (conservative tax estimates)
node backfill.js --input=output.csv --backfill-highest

# Backfill with lowest bracketing price (budgeting)
node backfill.js --input=output.csv --backfill-lowest
```

## Development

### Lint

The repo's lint, run from its top folder, covers this tool too, with LP
Ranger's rules: no function above cyclomatic complexity 17, no file above
500 lines of code, Prettier's formatting, and the rest that
[`docs/engineering.md`](../../docs/engineering.md) lists.

```bash
cd ../..
npm run lint        # Check for lint errors
npm run lint:fix    # Fix what the tools can
```

`npm run check`, also from the top folder, runs the lint, both test suites,
this one's with at least 80% of lines covered, and the security audits.

### Test

vitest loads each file through its own module loader, which finds imports
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

##### Optionally Add To Your Shell Alias File

```bash
# - - - - - - Test Log Utilities

alias svtlog='npm run test:debug > test.log 2>&1'
alias swtlog="aha --black -y 'body { font-size: 14px; }' < test.log > test.html && xdg-open test.html"
```

## Contributing

Fork me on GitHub. :) Contributions are welcome but note that any contributions are subject to the license as defined in the LICENSE file here.

To be accepted for pull request:

- **ESLint must pass** (`npm run lint`) - enforces cyclomatic complexity max 17
- **All tests must pass** (`npm run test:strict`)
- Any major new functionality must have a test runnable from the current approach
- Line coverage must remain at or above 80%

[![CI](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/ci.yml/badge.svg)](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/ci.yml)
