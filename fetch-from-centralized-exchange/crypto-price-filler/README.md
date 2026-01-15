# Get Crypto Price from Centralized Exchange

## Overview

USE AT YOUR OWN RISK: SEE LICENSE FILE, INCLUDED TWO DIRECTORIES UP.

This is a NodeJS utility that reads a given input csv that contains a set of rows each with a timestamp, and gets the
price at a speficied point in time in the past (can be a prior minute, even) for the specified token, writing it out to
an `output.csv` file that also contains the timestamps, but paired with the price of the token for each row.

This utility is useful for tokens not supported by smart-contract-oriented API, such as DexScreener's or DexTools, since
it focuses on reading prices from Centralized Exchanges as distinguished from Decentralized Exchanges.

For example, tokens such as Bitcoin and Monero, although someetimes they have wrapped versions such as $wBTC, don't trade 
directly in decentralized exchange liquidity pools.  

Instead, it's easiest to get their current price from a centralized exchange, which calls for a different codebase 
as for example, one cannot specifiy a liquidity pool.  

Note: If the few decentralized trading exchanges for these coins had more volume and an API, then that could be used.

### Current Roster of Utilities

- `index.js`, a NodeJS Script

## Prerequisites

NodeJS 18+

## Installation

`npm install`

### Usage

Refer to the module or file header documentation.

## Development

### Test

`npm run test`

or

`npm run test:verbose`

## Contributing

Fork me on GitHub. :)  Contributions are welcome but note that any contributions are subject to the license as defined in the LICENSE file here.

To be accepted for pull request:

- All tests must pass
- Any major new functionality must have a test runnable from the current approach
- All code must be modular e.g. low cyclomatic complexity ~17 or so.

[![Price Filler Tests](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/test-price-filler.yml/badge.svg)](https://github.com/nottoseethesun/crypto-price-fetchers/actions/workflows/test-price-filler.yml)
