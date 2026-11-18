# crypto-price-fetchers — notes for Claude

## Conventions

Follow LP Ranger's coding standards: its `CLAUDE.md` and everything under
`docs/claude/`, in [nottoseethesun/lp-ranger](https://github.com/nottoseethesun/lp-ranger)
or the local clone at `~/code/lp-ranger/github-repo/lp-ranger/`. Read them, and
never change anything in LP Ranger.

Work in this repo, never in a copy of it. Code written to check something goes
into the tests, so that later sessions reuse it instead of writing it again.

The Sheets scripts (`.gs`) change only here. The owner pastes them into Apps
Script and deploys them. The exchange script is in three files, which Apps
Script loads into one scope: `getCryptoPriceFromCentralizedExchange.gs`,
its `-sources.gs` and its `-tests.gs`. A name one file uses from another is
declared in a `/* global */` comment.

## Node versions of the Sheets scripts

Each `.gs` has a Node version beside it, of the same name ending in `.js`:
`crypto-price-fetchers.js` and
`fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js`.
A Node version runs its `.gs` unchanged, through the runner in
`apps-script-runner/`, and never copies the script's logic, since LP
Ranger's rules forbid a second copy. A fix belongs in the `.gs`, where it
fixes both.

The runner loads a script, one file or several in Apps Script's order, in a
worker thread with Node versions of the Apps Script services, and does each web request on the caller's thread, with the
caller's fetch, while the worker blocks; the file headers in
`apps-script-runner/` explain how. pulsechain-analytics installs this repo
from GitHub, pinned to a commit, for the runner
(`crypto-price-fetchers/apps-script-runner`), so a change to the runner
reaches it only when it moves the pin.

## Keys

**Never show any character of an api key once it is entered**: not in a
reply, a log line, an error message, a test's output, or a listing. The key
manager says only whether each key is saved.

No api key is committed. The keys the programs send (CoinGecko's,
DexTools' and x1.ninja's, as the top `config.json` lists them under
`apiKeys`) are kept in `api-keys.json` at the repo's top, which git ignores,
encrypted with one password the owner types: LP Ranger's design, built as a
module any project can use, `api-key-store/` (its README shows how).
`npm run api-keys` runs the key manager, `manage-api-keys.js`. A program
opens its keys with the password in `API_KEYS_PASSWORD`, which
`source ./unlock-api-keys.sh` keeps for a terminal, or else asks for it, and
keeps the keys only in memory. pulsechain-analytics and
x1-validator-analytics install the module from GitHub and keep a copy of
`unlock-api-keys.sh`, which their tests hold to this one.

A test names a key file of its own, never the owner's, and passes no
`API_KEYS_PASSWORD` it did not set: crypto-price-filler's
`vitest.config.js` names a key file that does not exist and empties the
password.

In Apps Script, the CoinGecko key is the Script Property `COINGECKO_API_KEY`,
which the owner sets, and the DexTools and x1.ninja keys are pasted into
`crypto-price-fetchers.gs`. The Node versions hand the keys they open to
their scripts: as that Script Property, and as `CONFIG.API_KEY` and
`X1_CONFIG.API_KEY`. crypto-price-filler reads `config-example.json`, its
committed settings, with its own `config.json`, which git ignores, laid over
them.

## Docs

`docs/architecture.md` says how the parts fit, `docs/engineering.md`
covers the files, the gates, the tests and CI, and
`docs/npm-project-commands.md` lists every npm command, as LP Ranger's
`docs/` does. A change keeps them true.

## Gates and CI

`npm run check` is the one gate, LP Ranger's: the lint (ESLint with LP
Ranger's rules, markdownlint, Prettier, actionlint, knip's unused files),
the tests with at least 80% of lines covered, crypto-price-filler's tests
with the same floor, and the security audits (npm audit, the security lint
in `eslint-security.config.js`, secretlint). It must pass before a commit
and a push; the husky pre-commit hook runs `npm run lint`. The repo has no
`prepare`, `install` or `postinstall` script, since npm runs a git
dependency's `prepare` in every project that installs it: `prelint`
installs the hooks.

CI runs `npm run check` on Node 22 and 24 (`ci.yml`) and each audit as a
job of its own (`security-audit.yml`). `main` is protected: those five
checks must pass on a pull request, never squashed, and no branch is
deleted. LP Ranger's eight steps in `docs/claude/CLAUDE-CI.md` take a
change to `main`.

The security lint runs `eslint-rules/no-secret-logging.js`, which refuses
printing a name that may hold a secret, through `console`, a stream's
`write` or `say`. A name that sounds like a secret but holds none is
renamed, never excused. pulsechain-analytics and x1-validator-analytics run
the rule from this repo (`crypto-price-fetchers/eslint-rules/no-secret-logging`).

## Tests

The runner, the Node versions, the key store and the lint rule are tested
from the repo's top folder, on Node's own test runner. The tests ask no
outside service: the scripts' requests go to a stand-in fetch or a stand-in
server on the computer (`test/helpers/stand-in-web.js`). The key store's
tests save keys in temp folders of their own
(`test/helpers/temp-folders.js`); `test/fixtures/lp-ranger-api-keys.json`,
written by LP Ranger's own code, checks that the store opens LP Ranger's
files.

```bash
npm ci
npm ci --prefix fetch-from-centralized-exchange/crypto-price-filler
npm run check
```

crypto-price-filler's tests are in
`fetch-from-centralized-exchange/crypto-price-filler/tests/`, on vitest,
and `npm run test:filler` runs them from the top folder. They ask no
outside service either. The top folder's lint covers the filler.

The Sheets scripts are tested there too, run unchanged under Node.
`tests/helpers/` holds the stand-ins:

- `sheets-script.js` runs a Sheets script, one file or several, in the
  test's thread with the runner's services. Its `UrlFetchApp` answers from
  a function the test gives.
- `fetch-with-retry.js` stands in for `fetchWithRetry`, the http layer of the
  Node tool's price sources, and holds the hooks the getCryptoPrice tests
  share.
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
