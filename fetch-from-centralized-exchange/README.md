# Get Crypto Price from Centralized Exchange

## Overview

USE AT YOUR OWN RISK: SEE LICENSE FILE, INCLUDED IN PARENT DIRECTORY.

Gets the price at a speficied point in time in the past (can be a prior minute, even) for tokens not supported by smart-contract-oriented API,
such as DexScreener's or DexTools.

For example, tokens such as Bitcoin and Monero, although someetimes they have wrapped versions such as $wBTC, don't trade directly in
decentralized exchange liquidity pools.  

Instead, it's easiest to get their current price from a centralized exchange, which calls for a different codebase as for example, one
cannot specifiy a liquidity pool.  

Important: As a Google Apps Script, this cannot handle more than 100 or so calls at a time.  For more capacity, use
`crypto-price-filler/index.js`.

Note: If the few decentralized trading exchanges for these coins had more volume and an API, then that could be used.

### Current Roster of Utilities

- `getCryptoPriceFromCentralizedExchange.gs`, a Google Apps Script

#### Sample Output

![Validator Rewards with Prices](./readme-images/xnt-rewards-with-prices.png)
![Validator Rewards Analytics](./readme-images/xnt-rewards-analytics.png)

## Prerequisites

Google Sheets

## Installation

See the file, `../README.md`, `Install` section.

### Usage

Refer to the module or file header documentation.

## Development

### Test

From the "Run" or "Debug" menu at the top of the Google Apps Script IDE / Editor, run `testGetCryptoPrice` and check the log below at the bottom of the screen.

## Contributing

Fork me on GitHub. :)  Contributions are welcome but note that any contributions are subject to the license as defined in the LICENSE file here.

To be accepted for pull request:

- All tests must pass
- Any major new functionality must have a test runnable from the current approach
- All code must be modular e.g. low cyclomatic complexity ~17 or so.
