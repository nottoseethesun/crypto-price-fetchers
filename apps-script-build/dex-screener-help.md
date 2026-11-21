# DEX Screener's functions: their help section

This file holds the section that the build step of this repo,
`npm run build apps-script`, which npm, Node's package manager, runs, puts
on the Help page of the file it gives when it includes the functions for
Google Sheets, Google's spreadsheet app, that DEX Screener, a service that
lists the pairs of decentralized exchanges with their prices, wrote.
`dex-screener.js`, beside this file, says how the build downloads and
compiles them. The section, between the two markers
below, is written in the part of Markdown that `help-page.js` turns into
the page.

<!-- HELP START -->
## DEX Screener's functions

These functions are DEX Screener's, downloaded and compiled into this
script by the build step. Each asks DEX Screener for one pair, a pool of a
decentralized exchange, by the chain's id on DEX Screener and the pair's
address. The id is the one in the pair's url on dexscreener.com, such as
`pulsechain`, `ethereum` or `bsc`.

- `DEX_SCREENER_PAIR_PROP(chainId, pairAddress, prop, [refreshTime])`
  gives one field of the pair, such as `priceUsd`, `fdv` or
  `liquidity.usd`.
- `DEX_SCREENER_PAIR(chainId, pairAddress, [props], [direction], [includePropName], [refreshTime])`
  fills one cell for each field named in `props`, separated by commas, or
  for every field with `"all"`: across a row for `"horizontal"`, the
  default, or down a column for `"vertical"`, each after a cell with its
  name unless `includePropName` is `FALSE`.
- `DEX_SCREENER_REFRESH_INTERVAL([seconds])` gives the time `seconds` from
  now, 30 when left out.

```text
=DEX_SCREENER_PAIR_PROP("pulsechain", "<pair-address>", "priceUsd")
=DEX_SCREENER_PAIR("pulsechain", "<pair-address>", "priceUsd,liquidity.usd", "vertical")
```

DEX Screener gives `priceUsd` and `priceNative` as text, which `SUM` skips;
`VALUE()` turns one into a number.

### Keeping DEX Screener cells current

A cell that holds `DEX_SCREENER_REFRESH_INTERVAL()` can be named as the
last argument, `refreshTime`, of the other two functions. Their value does
not use it, but Sheets runs a cell again when a cell it names changes, so
each time that cell runs again, every cell naming it does too. The
Refresh item of the Crypto Price Fetchers menu runs every cell that calls
a `DEX_SCREENER_` function again, that cell included. DEX Screener's own
menu is not in this script: the one menu is Crypto Price Fetchers.
<!-- HELP END -->
