# crypto-price-fetchers — notes for Claude

## Conventions

Follow LP Ranger's coding standards: its `CLAUDE.md` and everything under
`docs/claude/`, in [nottoseethesun/lp-ranger](https://github.com/nottoseethesun/lp-ranger)
or the local clone at `~/code/lp-ranger/github-repo/lp-ranger/`. Read them, and
never change anything in LP Ranger.

Work in this repo, never in a copy of it. Code written to check something goes
into the tests, so that later sessions reuse it instead of writing it again.

The Sheets scripts (`.gs`) change only here. The owner pastes them into Apps
Script and deploys them.

## Tests

The tests are in `fetch-from-centralized-exchange/crypto-price-filler/tests/`,
on vitest. They ask no outside service.

```bash
cd fetch-from-centralized-exchange/crypto-price-filler
npm ci
npm run lint
npm run test:strict
```

The Sheets scripts are tested there too, run unchanged under Node.
`tests/helpers/` holds the stand-ins:

- `sheets-script.js` runs a Sheets script with stand-ins for the Apps Script
  services. Its `UrlFetchApp` answers from a function the test gives.
- `fetch-with-retry.js` stands in for `fetchWithRetry`, the http layer of the
  Node tool's price sources.
- `stand-in-fetch-preload.js` runs the real command line, `index.js`, in a
  child process against a stand-in MEXC.

## Known bugs

`tests/known-bugs.test.js` holds one test per known bug, declared with
`it.fails`, so it passes while the bug is present. A bug's fix makes its test
fail; change that test's `it.fails` to `it` in the same change.

| Item | Bug |
| --- | --- |
| 1 | `--mode close` returns the MEXC candle's high |
| 2 | A past date gets CoinGecko's live price when CoinGecko lists the coin against USD; the Sheets script too, once CoinGecko's hourly range is empty |
| 3 | The day asked of CoinGecko comes from the computer's clock, not from UTC |
| 4 | A time zone the tool doesn't know is read as UTC, and one fixed offset can't follow daylight saving |
| 5 | The CoinGecko api key is committed, in `config.json` and in the Sheets script |
