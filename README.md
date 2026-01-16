# Crypto Price Fetchers

## Overview

A collection of scripts useful for fetching the current price and also the price at
a point in time in the past (can even be one minute in the past) of various
crypto tokens.

The need for this arises out of the proliferation of crypto tokens, such that
most tracking services simply cannot fetch the price of many of the great tokens out
there.

Note: For the files that are for Google Sheets, Google Sheets does not use the
now-standard `fetch` API.  So, to convert these scripts to work under Web or NodeJS,
you will need to use `fetch` with `async` and `await` as per normal for those platforms.
Also, Google Apps Script differs from standard JS and NodeJS in how it handles concurrency
and recursion (creates a brand-new execution context for recursion), leading to the
need to use Google Apps Script process lock to implement back-off timeouts for
async operations, etc.

### Options

`crypto-price-fetchers.gs` is a Google Apps Script that fetches only the current
price, and is limited to tokens that are based on smart-contract technology,
such as in PulseChain, Ethereum, and Solana.

`fetch-from-centralized-exchage/getCryptoPriceFromCentralizedExchange.gs` is
a Google Apps Script currently fetches the price only at a point in time in
the past, although "the past" can be just one minute in the past.  It is limited
to tokens traded on the API of the Centralized Exchanges that it currently
supports and also, as a Google Apps Script, cannot handle more than 100 or
so calls at a time.

`fetch-from-centralized-exchage/crypto-price-filler/index.js` is like
`getCryptoPriceFromCentralizedExchange.gs` but, as a NodeJS script, can
handle any load in terms of numbers of price points to fetch.

## Install

For `./fetch-from-centralized-exchage/getCryptoPriceFromCentralizedExchange.gs`,
and all other scripts in other sub-directories here, see the
`README.md` in that directory.

For `./crypto-price-fetchers.gs`, see the file-header doc in that file.

## Usage

For `./fetch-from-centralized-exchage/getCryptoPriceFromCentralizedExchange.gs`,
and all other scripts in other sub-directories here, see the
`README.md` in that directory.

For `./crypto-price-fetchers.gs`, see the file-header doc in that file.

## Test

For `./fetch-from-centralized-exchage/getCryptoPriceFromCentralizedExchange.gs`,
and all other scripts in other sub-directories here, see the
`README.md` in that directory.

For `./crypto-price-fetchers.gs`, see the file-header doc in that file.
