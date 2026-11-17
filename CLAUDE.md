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

## Node versions of the Sheets scripts

Each `.gs` has a Node version beside it, of the same name ending in `.js`:
`crypto-price-fetchers.js` and
`fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js`.
A Node version runs its `.gs` unchanged, through the runner in
`apps-script-runner/`, and never copies the script's logic, since LP
Ranger's rules forbid a second copy. A fix belongs in the `.gs`, where it
fixes both.

The runner loads a script in a worker thread with Node versions of the Apps
Script services, and does each web request on the caller's thread, with the
caller's fetch, while the worker blocks; the file headers in
`apps-script-runner/` explain how. pulsechain-analytics installs this repo
from GitHub, pinned to a commit, for the runner
(`crypto-price-fetchers/apps-script-runner`), so a change to the runner
reaches it only when it moves the pin.

## Keys

No api key is committed. The CoinGecko key is kept in `api-keys.json` at the
repo's top, which git ignores, encrypted with a password the owner types:
LP Ranger's design, built as a module any project can use, `api-key-store/`
(its README shows how). `coingecko-api-key.js` fills it in for CoinGecko,
and `npm run save-api-key -- coingecko` saves a key. crypto-price-filler and
the Node version of `getCryptoPriceFromCentralizedExchange.gs` ask for the
password as a run starts, and keep the key only in memory. A test names a
key file of its own, never the owner's: crypto-price-filler's
`vitest.config.js` names one that does not exist (`API_KEYS_FILE_PATH`).

In Apps Script, the CoinGecko key is the Script Property `COINGECKO_API_KEY`,
which the owner sets. The Node version hands the script the key it opened as
that property, through the runner's `scriptProperties`.

`crypto-price-fetchers.js` reads its DexTools and x1.ninja keys from
`config.json` beside it, which git ignores; `config-example.json` shows the
shape, and the Sheets script holds placeholders the owner replaces in Apps
Script. crypto-price-filler reads `config-example.json`, its committed
settings, with its own `config.json`, which git ignores, laid over them.

## Tests

The runner, the Node versions and the key store are tested from the repo's
top folder, on Node's own test runner. The tests ask no outside service: the
scripts' requests go to a stand-in fetch or a stand-in server on the computer
(`test/helpers/stand-in-web.js`). The key store's tests save keys in temp
folders of their own; `test/fixtures/lp-ranger-api-keys.json`, written by LP
Ranger's own code, checks that the store opens LP Ranger's files.

```bash
npm ci
npm run lint
npm test
```

crypto-price-filler's tests are in
`fetch-from-centralized-exchange/crypto-price-filler/tests/`, on vitest.
They ask no outside service either.

```bash
cd fetch-from-centralized-exchange/crypto-price-filler
npm ci
npm run lint
npm run test:strict
```

The Sheets scripts are tested there too, run unchanged under Node.
`tests/helpers/` holds the stand-ins:

- `sheets-script.js` runs a Sheets script in the test's thread with the
  runner's services. Its `UrlFetchApp` answers from a function the test
  gives.
- `fetch-with-retry.js` stands in for `fetchWithRetry`, the http layer of the
  Node tool's price sources.
- `stand-in-fetch-preload.js` runs the real command line, `index.js`, in a
  child process against a stand-in MEXC, and a stand-in CoinGecko ping that
  takes the one key in `stand-in-coingecko-key.js`.

## Known bugs

None is known. A bug found gets a test in crypto-price-filler's
`tests/known-bugs.test.js`, declared with `it.fails`, so it passes while the
bug is present, and a row in a table here. Its fix makes the test fail; the
same change declares the test with `it`, moves it to
`tests/regressions.test.js`, which guards the fixed bugs, and removes the
row.
