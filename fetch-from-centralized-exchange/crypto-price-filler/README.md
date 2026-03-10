# Get Crypto Price from Centralized Exchange

## Overview

USE AT YOUR OWN RISK: SEE LICENSE FILE, INCLUDED TWO DIRECTORIES UP.

This is a NodeJS utility that reads a given input csv that contains a set of rows each with a timestamp, and gets the
price at a specified point in time in the past (can be a prior minute, even) for the specified token, writing it out to
an `output.csv` file that also contains the timestamps, but paired with the price of the token for each row.

This utility is useful for tokens not supported by smart-contract-oriented API, such as DexScreener's or DexTools, since
it focuses on reading prices from Centralized Exchanges as distinguished from Decentralized Exchanges.

For example, tokens such as Bitcoin and Monero, although sometimes they have wrapped versions such as $wBTC, don't trade
directly in decentralized exchange liquidity pools.  

Instead, it's easiest to get their current price from a centralized exchange, which calls for a different codebase
as for example, one cannot specifiy a liquidity pool.  

Note: If the few decentralized trading exchanges for these coins had more volume and an API, then that could be used.

### Current Roster of Utilities

- `index.js` - Main CLI tool for fetching prices and filling CSV files
- `backfill.js` - Standalone utility to backfill empty prices in existing CSV files

## Prerequisites

NodeJS 21.1.0+

## Installation

`npm install`

### Usage

#### index.js - Price Fetching

Refer to the file-header documentation in `./index.js` for complete usage details.

```bash
node index.js --token=grc --input=mining.csv --output=filled.csv
```

#### backfill.js - Backfill Existing CSV

Use `backfill.js` to apply backfill to an existing output CSV file without re-fetching prices.
Refer to the file-header documentation in `./backfill.js` for complete usage details.

```bash
# Backfill with highest bracketing price (conservative tax estimates)
node backfill.js --input=output.csv --backfill-highest

# Backfill with lowest bracketing price (budgeting)
node backfill.js --input=output.csv --backfill-lowest
```

## Development

### Lint

ESLint is configured to enforce code quality and cyclomatic complexity (max 17).

```bash
npm run lint        # Check for lint errors
npm run lint:fix    # Auto-fix lint errors where possible
```

### Test

Because `vitest` (amazingly) neglects to verify that the files will actually load into
NodeJS, a whole separate test target, `test:strict`, is required for that.
This way, if an `import` statement is incorrect, the error will be caught in test
and not break production.

```bash
npm run test        # Run tests with coverage
npm run test:strict # Validate CLI parsing + run tests
```

#### Debug Test

`npm run test:debug`
`npm run test:strict`

#### Save Test Log to File

`npm run test:debug > test.log 2>&1`

#### View Log for Quick Copy-Paste of Log

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

Fork me on GitHub. :)  Contributions are welcome but note that any contributions are subject to the license as defined in the LICENSE file here.

To be accepted for pull request:

- **ESLint must pass** (`npm run lint`) - enforces cyclomatic complexity max 17
- **All tests must pass** (`npm run test:strict`)
- Any major new functionality must have a test runnable from the current approach
- Statement coverage must remain at or above 80%

[![CI - Lint & Tests](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/test-price-filler.yml/badge.svg)](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/test-price-filler.yml)
