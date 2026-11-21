# crypto-price-fetchers — notes for Claude

## Conventions

Follow the coding standards of LP Ranger, the owner's bot that manages his
9mm V3 liquidity positions: its `CLAUDE.md` and everything under
`docs/claude/`, in [nottoseethesun/lp-ranger](https://github.com/nottoseethesun/lp-ranger)
or the local clone at `~/code/lp-ranger/github-repo/lp-ranger/`. Read them, and
never change anything in LP Ranger.

Work in this repo, never in a copy of it. Code written to check something goes
into the tests, so that later sessions reuse it instead of writing it again.

The Sheets scripts (`.gs`) price crypto tokens in the cells of Google
Sheets, Google's spreadsheet app, and run there as Apps Script, Google's
platform for scripts that run inside its apps. They change only here. The
build step, `npm run build apps-script` (below), joins them into one file,
which the owner pastes into a spreadsheet's Apps Script project, where
every script file runs in one scope; npm, the package manager of Node, the
program that runs JavaScript outside a browser, runs the commands
`package.json` names. The build joins the menu,
`crypto-price-fetchers-menu.gs`, which runs a spreadsheet's price cells
again; then `crypto-price-fetchers.gs`, a token's price now; then the
exchange script, a token's price at a past time, in three files:
`getCryptoPriceFromCentralizedExchange.gs`, its `-sources.gs` and its
`-tests.gs`. A name one file uses from another is declared in a
`/* global */` comment, and no two files declare one top-level name.

## Node versions of the Sheets scripts

Each `.gs` that gives a price has a Node version beside it, which runs it
on Node, under the same name ending in `.js`: `crypto-price-fetchers.js` and
`fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js`.
The menu gives none and has none; its tests run it with a stand-in
spreadsheet.
A Node version runs its `.gs` unchanged, through the runner in
`apps-script-runner/`, and never copies the script's logic, since LP
Ranger's rules forbid a second copy. A fix belongs in the `.gs`, where it
fixes both. crypto-price-filler, the Node tool in
`fetch-from-centralized-exchange/crypto-price-filler/` that fills a CSV's
price columns, keeps no price source of its own for MEXC, a centralized
exchange, or CoinGecko or CoinPaprika, two services that gather the
exchanges' prices: it asks the exchange script's, through its Node
version's `openCentralizedExchangeSources` (`sources/exchange.js`).

Apps Script's `UrlFetchApp.fetch` returns the response, where Node's
`fetch` returns a promise that a script's code cannot wait for on its own
thread. So the runner loads a script, one file or several in Apps Script's
order, in a worker thread, a second thread of JavaScript that Node runs
beside the main one, with Node versions of the Apps Script services.
It does each web request on the caller's thread, with the caller's fetch,
while the worker blocks; the file headers in `apps-script-runner/` explain
how. pulsechain-analytics, the owner's tools for questions about
PulseChain, installs this repo from GitHub, the website that hosts it,
for the runner
(`crypto-price-fetchers/apps-script-runner`), which runs
pulsechain-analytics' own Sheets script. A change to the runner reaches it
once its lockfile is made again, below.

## The projects that install this repo

pulsechain-analytics, pulsechain-validator-analytics (the owner's
PulseChain validators' withdrawal addresses and payments) and
x1-validator-analytics (his X1 validator's rewards) install this repo from
GitHub as
`github:nottoseethesun/crypto-price-fetchers#main`, which follows main, or
`#semver:*`, which follows the latest release, the highest version tag;
their lockfiles keep the commit installed. The bin `github-project-deps`
(`github-project-deps.js`, `github-project-deps/`) switches between the
two, as each project's `npm run github-project-deps -- main|release`, and
makes the lockfiles again, as LP Ranger's rule for a change of dependency
says: package-lock.json deleted first, then node_modules, then
`npm install`. The projects follow main; tags carry no `v`. The tool
belongs here, once, since each project installs this repo: no project keeps
a copy.

## Prices of tokens that trade in pools

`dex-prices/` holds the clients of the services that price a token from
a blockchain's pools, in LP Ranger's order: Moralis (`moralis.js`) first,
at the block the chain had at a time, when a key is saved, then
GeckoTerminal (`geckoterminal.js`), from the candles of the pool LP Ranger
would pick, within its budget of requests. Every request goes through
`web-request.js`, the one loop that sends a request again after a 429.
crypto-price-filler's pool sources use them, and other repos install them
as `crypto-price-fetchers/dex-prices/...`. The exchange script keeps a loop
of its own in its `-sources.gs`, since Apps Script cannot load a Node
module.

## Summ csv files

Summ is the crypto tax calculator the owner keeps his books in.
**Every csv file for Summ is written by `summ-csv/`**, through
`npm run summ-csv`, the bin `summ-csv`, or `writeSummCsv` from
`crypto-price-fetchers/summ-csv`: never by a script written for the
occasion. The owner's rule; the utility checks every row against the
rules in `summ-csv/README.md` and writes nothing while any row breaks one.
A chain's facts (its own coin, the forms of its hashes and addresses) are
in `summ-csv/settings.json`, so a chain is added there. The header comes
from the owner's template, whose path a caller passes; this public repo
holds only a copy of its header, `test/fixtures/summ-template.csv`, and no
address of the owner's.

## Keys

**Never show any character of an api key once it is entered**: not in a
reply, a log line, an error message, a test's output, or a listing. The key
manager says only whether each key is saved.

No api key is committed. The keys the programs send (CoinGecko's,
CoinPaprika's and Moralis', for past prices; DexTools' and x1.ninja's, the
services `crypto-price-fetchers.gs` asks for current prices; as the top
`config.json` lists them under `apiKeys`) are kept in `api-keys.json` at
the repo's top, which git, the version-control program, ignores,
encrypted with one password the owner types: LP Ranger's design, built as a
module any project can use, `api-key-store/` (its README shows how).
`npm run api-keys` runs the key manager, `manage-api-keys.js`. A program
opens its keys with the password in `API_KEYS_PASSWORD`, which
`source ./unlock-api-keys.sh`, a script at the repo's top, keeps for a
terminal, or else asks for it, and keeps the keys only in memory.
pulsechain-analytics, pulsechain-validator-analytics and
x1-validator-analytics install the module from GitHub and keep a copy of
`unlock-api-keys.sh`, which their tests hold to this one.

A test names a key file of its own, never the owner's, and passes no
`API_KEYS_PASSWORD` it did not set: crypto-price-filler's
`vitest.config.js`, the settings of vitest, the test runner its tests run
on, names a key file that does not exist and empties the password.

The Node versions hand the keys they open to their scripts as config
values: `CONFIG.COINGECKO_API_KEY` and `CONFIG.COINPAPRIKA_API_KEY` in the
exchange script, `DEXTOOLS_CONFIG.API_KEY` and `X1_CONFIG.API_KEY` in
`crypto-price-fetchers.gs`, which the committed scripts leave empty or
holding a placeholder. For Apps Script, `npm run build apps-script`
(`build.js`, `apps-script-build/`) sets the same values, with those of the
config.json each Node version reads and the menu's Help page, as the last
statements of the one file it gives, from each Node version's
`APPS_SCRIPT_BUILD` spec. It puts the file on the clipboard, or, when no
clipboard tool is installed and the owner declines the install it offers,
writes it to `build/apps-script/`, which git ignores, as do the lint, the
format check and the secret scan (Gates and CI, below), readable by the
owner alone. It prints no
key. crypto-price-filler reads `config-example.json`, its committed
settings, with its own `config.json`, which git ignores, laid over them.

## DEX Screener's functions

DEX Screener, a service that lists the pairs of decentralized exchanges
with their prices, publishes Google Sheets functions of its own
(`DEX_SCREENER_PAIR_PROP` and two more) in its repo
`dexscreener/google-sheets`, which carries no license: none of it is ever committed here. At every
build, `npm run build apps-script` asks whether to include them, Enter
meaning yes, and says the step is optional and that a failed build should
be run again with n. On a yes, it checks that their files are the ones
this repo pinned: it downloads each, at the commit
`apps-script-build/dex-screener-files.js` names, within 30 seconds, and
compares it with the SHA-256 written there, the check
`npm run audit:dex-screener` also runs on its own. Then it compiles only
the files the check gave, with esbuild, the program that compiles
TypeScript and JavaScript into one file, and zod, a library that checks
data against a schema, and lodash, a library of helper functions, which
DEX Screener's code imports, and wraps them in a function of their own in
the built file, so their `onOpen` never replaces the menu's.
`npm run audit:deps` runs `npm run audit:dex-screener` after npm audit,
npm's check of the installed packages against known vulnerabilities, which
does not cover that code. zod and lodash ship in the built file, so
`package.json` lists them as dependencies, which the gate's npm audit
checks, never as development packages, which it skips.

## Docs

`docs/architecture.md` says how the parts fit, `docs/engineering.md`
covers the files, the gates, the tests and CI (the gates, run by GitHub
Actions at each push), and
`docs/npm-project-commands.md` lists every npm command, as LP Ranger's
`docs/` does. A change keeps them true.

Every doc passes the owner's documentation audit: it tells no story of an
old bug, leads every topic and sub-topic with the context it needs,
introduces each tool where it first names it, explains with facts rather
than adjectives, and leaves out no step in the logic of an explanation. A
tool is anything a reader runs or a program uses: an `npm run` command, a
bin, a script, a package or an outside service. Its introduction starts
from the big picture, gives a few words of context or a scenario where the
tool is used, says which codebase it comes from, and says what it does in
precise words.

## Command lines

Every command line in this repo answers `--help`, and `-h`, with all it
takes and how to use it: each option and argument with what it does, then
examples of its common uses, each a full command and what it does, and its
exit codes. An npm target that runs one passes the flag through, as
`npm run <target> -- --help`. Each is declared with commander, the package
that parses command lines, so the options its help lists come from the
declaration the program parses; the examples and exit codes go in the
help's closing text (`addHelpText("after", …)`). The checks of a help
are in `lib/command-line-help.js`, exported as
`crypto-price-fetchers/lib/command-line-help`:
`test/command-line-help.test.js` runs them on every command line here,
and the repos that install this one run them in their own tests.
`docs/npm-project-commands.md` lists every npm target, including those
that run other tools, such as `lint` and `check`, with its flags and an
example. LP Ranger's rules do not yet ask for the examples; this repo does.

## Gates and CI

`npm run check` is the one gate, LP Ranger's: the lint (ESLint, which
checks JavaScript against rules, here LP Ranger's; markdownlint, which
checks the form of Markdown files; Prettier, which formats code; actionlint,
which checks the GitHub Actions workflow files; and knip, which finds files
nothing uses), the tests with at least 80% of lines covered,
crypto-price-filler's tests with the same floor, and the security audits
(npm audit, npm's check of the installed packages against known
vulnerabilities, with the check of DEX Screener's files; the security lint
in `eslint-security.config.js`; and secretlint, which looks for keys and
credentials in files). It must pass before a commit
and a push; husky, the package that runs scripts at git's hooks, runs
`npm run lint` before each commit. The repo has no
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

The runner, the Node versions, the build step, the menu, the price
clients, the key store, the lint rule, the versions tool, the shared
helpers in `lib/` and every command line's help
(`test/command-line-help.test.js`) are tested from the repo's top folder, on Node's own test
runner. The menu runs against a spreadsheet held in memory
(`test/helpers/stand-in-spreadsheet.js`), and DEX Screener's part is
built from stand-in sources written in its test, compiled with the real
esbuild. Code
that more than one part uses lives once, in `lib/`, which ships with the
package; `messageOf` is exported as `crypto-price-fetchers/lib/message-of`,
and the checks of a command line's help as
`crypto-price-fetchers/lib/command-line-help`, for the projects that
install this repo. The tests ask no
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

The Sheets scripts are tested two ways, which `docs/engineering.md` sets
apart: under Node, unchanged, in both suites; and in Apps Script, by test
functions inside the scripts that the owner runs by hand. crypto-price-filler's
`tests/helpers/` holds its stand-ins:

- `sheets-script.js` runs a Sheets script, one file or several, in the
  test's thread with the runner's services. Its `UrlFetchApp` answers from
  a function the test gives, with any status, the script's config is set
  as its Node version sets it, and a test may hand in more stand-in
  services, such as the top folder's spreadsheet.
- `stand-in-fetch.js` is a stand-in fetch for the Node tool's own sources:
  the exchange sources, whose Sheets script then runs for real in its
  worker, and the pool sources, whose shared clients then ask it.
- `stand-in-fetch-preload.js` runs the real command line, `index.js`, in a
  child process against a stand-in MEXC, and a stand-in CoinGecko ping that
  takes the one key in `stand-in-coingecko-key.js`.

## Known bugs

A bug found gets a test in crypto-price-filler's
`tests/known-bugs.test.js`, declared with `it.fails`, so it passes while the
bug is present, and a row in the table below. Its fix makes the test fail;
the same change declares the test with `it`, moves it to
`tests/regressions.test.js`, which guards the fixed bugs, and removes the
row.

Google stops a custom function, a function a cell calls, after 30 seconds,
and the cell shows `#ERROR!`. Both bugs below are waits longer than that.

| Bug | Test in `tests/known-bugs.test.js` |
| --- | --- |
| `dexToolsGetTokenPrice` and `dexToolsGetTokenFDV`, in `crypto-price-fetchers.gs`, wait up to `DEXTOOLS_CONFIG.LOCK_WAIT_MS`, 120 seconds, for the script lock, so a cell that waits more than 30 seconds shows `#ERROR!`, never the busy message the script returns when the wait ends. | dexToolsGetTokenPrice waits for the script lock no longer than Google lets a custom function run |
| `getCryptoPrice`, in the exchange script, tries the script lock 3 times for 2 seconds each, waiting 5, 10 and 20 seconds after each failed try (`LOCK_RETRY_BACKOFF`): 41 seconds in all. | getCryptoPrice waits for the script lock, in all, no longer than Google lets a custom function run |
