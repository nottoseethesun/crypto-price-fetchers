# Fetch a Crypto Token's Price Now

## Overview

**USE AT YOUR OWN RISK: SEE LICENSE FILE IN PARENT DIRECTORY.**

This folder holds the tool that gives a crypto token's price in USD now,
and its fully diluted value (FDV): its price times its total supply. It
asks DexTools, a service that prices tokens from the pools of
decentralized exchanges, for the chains DexTools lists, such as
PulseChain, Ethereum and Solana. For X1, which DexTools does not list, it
asks x1.ninja, a service that does the same for X1.

## Tools

The tool runs in Google Sheets, Google's spreadsheet app, as Apps Script,
Google's platform for scripts that run inside its apps, and on Node, the
program that runs JavaScript outside a browser:

| Tool | Use | Limits |
| ---- | --- | ------ |
| **The Sheets script**, `src/crypto-price-fetchers.gs`, in this folder | A price, or a fully diluted value, in a spreadsheet's cell | Google stops a cell's call after 30 seconds, and runs at most 30 calls of one person at once. |
| **The Sheets script's Node version**, `bin/crypto-price-fetchers.js`, at the repo's top | One price, or one fully diluted value, from the command line or a Node program | None of Apps Script's. |

### 1. Google Apps Script (`crypto-price-fetchers.gs`)

[`src/crypto-price-fetchers.gs`](src/crypto-price-fetchers.gs) gives a
spreadsheet two functions: `=dexToolsGetTokenPrice()`, a token's price,
and `=dexToolsGetTokenFDV()`, its fully diluted value. The help section of
its header, which the spreadsheet shows under Crypto Price Fetchers >
Help, says how to call each.

The repo's build step, `npm run build apps-script` (npm, Node's package
manager, runs the commands the repo's `package.json` names), puts the
script, with the repo's other Sheets scripts and the Crypto Price Fetchers
menu, in one file to paste into a spreadsheet, with the DexTools and
x1.ninja keys saved in the repo set at its end: see
[Install in Google Sheets](../README.md#4-install-in-google-sheets) in the
repo's README.

### 2. Node version of the Apps Script (`bin/crypto-price-fetchers.js`)

The repo's `bin/crypto-price-fetchers.js` runs
`src/crypto-price-fetchers.gs`, in this folder, itself, unchanged, under
Node, so it answers as the spreadsheet's functions do, from a Node program
or the command line, run from the repo's top folder. USDC's price on
Ethereum:

```bash
node bin/crypto-price-fetchers.js price ether 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
```

It sends DexTools' key, or x1.ninja's for X1, saved, encrypted, in the
repo's key file ([The Api Keys](../README.md#3-the-api-keys)), asking for
its password first. Its settings are `config.json`, in this folder, which
git ignores and which may set the fields of the script's
`DEXTOOLS_CONFIG` it reads each time it is called: `CACHE_SECONDS`, how
long a price above 0 is kept, and `LOCK_WAIT_MS`, how long a call waits
for the script's lock. Without the file, the script runs on the values
written in it, which `config-example.json`, beside it, shows. The rest is
in the repo's README, under
[crypto-price-fetchers.js](../README.md#crypto-price-fetchersjs-1).
