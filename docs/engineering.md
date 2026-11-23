# crypto-price-fetchers — Engineering Reference

The files the programs read and write, the gates every change passes, the
tests, and CI: the same gates, run at each push by GitHub Actions, the
service of GitHub, the website that hosts the repo. The programs are this
repo's parts. The Sheets scripts run in Google Sheets, Google's spreadsheet
app, as Apps Script, Google's platform for scripts that run inside its
apps, and their Node versions run them on Node, the program that runs
JavaScript outside a browser; both price tokens in USD. crypto-price-filler
is the Node tool that fills a CSV's price columns; the build step joins
the Sheets scripts into one file, with the saved api keys set in it, for
one paste into Apps Script; the key store keeps the api keys encrypted;
the versions tool sets a project's dependencies from GitHub to a branch or
a release; and the Summ CSV writer writes the CSV files the owner imports
into Summ, the crypto tax calculator he keeps his books in.
For how the parts fit, see [`docs/architecture.md`](architecture.md); for
every command, those the repo's `package.json` gives npm, Node's package
manager, to run and those run with `node` or `source`, see
[`docs/project-commands.md`](project-commands.md).

The repo follows the coding standards of LP Ranger, the owner's bot that
manages his 9mm V3 liquidity positions: its `CLAUDE.md` and
`docs/claude/`, in
[nottoseethesun/lp-ranger](https://github.com/nottoseethesun/lp-ranger).

---

## Table of Contents

- [Quick Start](#quick-start)
- [Files on Disk](#files-on-disk)
- [The Gate: `npm run check`](#the-gate-npm-run-check)
- [Lint](#lint)
- [Tests](#tests)
  - [Test Files](#test-files)
  - [How the Sheets Scripts (`.gs`) Are Tested](#how-the-sheets-scripts-gs-are-tested)
    - [The Node Tests](#the-node-tests)
    - [The Apps Script Tests](#the-apps-script-tests)
- [Security Audits](#security-audits)
- [The Build Step](#the-build-step)
  - [Packages That Ship in the Built File](#packages-that-ship-in-the-built-file)
- [Dead Code Detection](#dead-code-detection)
- [CI and Branch Protection](#ci-and-branch-protection)
- [Known Bugs](#known-bugs)

---

## Quick Start

The repo supports two major versions of Node: the newest LTS (long-term
support) version, today 26, and the version two majors before it, today
24. Every tool, every test and every npm command runs on both, and CI runs
the gate on each (below).

A working copy needs Node 24 or later, the packages of the repo and of
crypto-price-filler, and the api keys. `npm run api-keys` runs the key
store's manager, `npm run check` the gate below, and
`npm run build apps-script` the build step, which gives the Sheets scripts
as one file, with the saved keys set in it, for one paste into Apps Script.
From the repo's top folder:

```bash
npm ci
npm ci --prefix fetch-from-centralized-exchange/crypto-price-filler
npm run api-keys            # save the api keys, once
npm run check               # the gate
npm run build apps-script   # the Sheets scripts as one file, for Apps Script
```

---

## Files on Disk

The programs and their tests read and write these files. Git, the
version-control program that keeps the repo's history, keeps only the ones
that hold no key and none of the owner's own settings.

| File | In git | What it holds |
| ---- | ------ | ------------- |
| `config.json` | yes | The services whose keys the programs send, under `apiKeys`. Never a key. |
| `config-example.json` | yes | What `config.json` holds, as the example of its settings that every `config.json` has beside it. |
| `api-keys.json` | no | The keys, each encrypted with the owner's password (see [the key store](architecture.md#the-key-store)). `api-keys.json.tmp` is the file it is written through. `API_KEYS_FILE_PATH` names another, as the tests do. |
| `crypto-price-fetchers/config.json` | no | The fields of `DEXTOOLS_CONFIG` that `bin/crypto-price-fetchers.js`, the Node version of `crypto-price-fetchers/src/crypto-price-fetchers.gs`, lays over the script's, `CACHE_SECONDS` and `LOCK_WAIT_MS`, held to its schemas (`CONFIG_SCHEMAS`), when the file is there. |
| `crypto-price-fetchers/config-example.json` | yes | Those two fields, with the values written in the script. |
| `fetch-from-centralized-exchange/config.json` | no | Values the exchange script's Node version lays over the script's `CONFIG`, held to its schemas of it (`CONFIG_SCHEMAS`), when the file is there. |
| `fetch-from-centralized-exchange/config-example.json` | yes | Every field of `CONFIG` its schemas name, with the value written in the script. |
| `summ-csv/settings.json` | yes | The Summ CSV writer's facts of each chain, by Summ's name for it (its own coin, the forms of its hashes and addresses), and the fiat currencies a reference price may be in. |
| `crypto-price-filler/config-example.json` | yes | The filler's settings. |
| `crypto-price-filler/config.json` | no | The owner's settings, laid over `config-example.json`. |
| `fetch-from-centralized-exchange/crypto-price-filler/input/`, `summ-csv/input/` | `.gitkeep` alone | The owner's files a tool reads: the filler's dated rows, and the Summ CSV writer's rows and template. |
| `fetch-from-centralized-exchange/crypto-price-filler/output/csv/`, `summ-csv/output/csv/` | `.gitkeep` alone | The csv files the tool writes: the filler's `output.csv` when no `--output` is given, and the Summ CSV writer's file at `--out` in its examples. |
| `dist/apps-script/` | no | `crypto-price-fetchers.gs`, the one file `npm run build apps-script` writes when there is no clipboard tool: it holds the api keys in the clear, readable by the owner alone. The lint, the security lint and the secret scan, below, pass over the folder. |

A folder git keeps by its `.gitkeep` alone holds the owner's own data:
git ignores everything in it but that empty file, which keeps the folder
in the repo, and the format check and the secret scan pass over it.

---

## The Gate: `npm run check`

`npm run check` runs every gate, in order, and stops at the first that
fails: the lint, the tests with coverage, crypto-price-filler's tests with
coverage, then the security audits. It must pass before every commit and
push, and CI runs it on Node 26, the newest LTS (long-term support) version,
and on Node 24, the oldest the repo supports.

---

## Lint

The lint checks each file's form before any test runs: the rules the code
follows, its formatting, the workflows, and files nothing uses.
`npm run lint` runs five tools: four npm packages, and actionlint, a
program its author publishes for each system, which the table's fourth
row explains:

| Tool | Configured in | What it does, and what it holds the repo to |
| ---- | ------------- | ------------------------------------------- |
| ESLint | `eslint.config.js` | Checks JavaScript against rules: LP Ranger's, with no warning allowed: cyclomatic complexity ≤ 17, ≤ 500 lines of code a file (blank lines and comments not counted), lines ≤ 80 characters but strings, urls and comments, `===`, no unused name, no `var`, `const` where nothing is reassigned, no `Math.random`, no comment that tells Prettier, the formatter in the row below, to skip code, and every import resolved; and `no-or-default` (`eslint-rules/`), this repo's rule against `a \|\| b` whose value is kept, as a default is, when `b` is no boolean, since `\|\|` takes its fallback for every falsy value, a 0 or an empty string held on purpose among them: a default is written with `??` or an explicit check. It reads the Sheets scripts too, as the paragraph below the table says. |
| markdownlint | `.markdownlint-cli2.jsonc` | Checks the form of Markdown files: LP Ranger's settings, over every Markdown file, such as one top heading first and no HTML. |
| Prettier | `.prettierrc`, `.prettierignore` | Formats code; in check mode, it fails on any JavaScript, Sheets script, JSON or YAML file the repo keeps whose layout its formatting would change. |
| actionlint | `actionlint/release.js` | Checks the GitHub Actions workflow files, in `.github/workflows/`, for mistakes in their syntax, their expressions and the shell scripts their steps run. The lint runs the official release of actionlint, rhysd's program, through this repo's bin `run-actionlint` (`run-actionlint.js`, `actionlint/`): the first run downloads the archive for its system, refuses it unless its SHA-256 is the one `actionlint/release.js` pins, refuses the program in it unless its own SHA-256 is the one pinned beside it, and keeps the program in `node_modules/.cache/actionlint/`; each later run checks the kept program's SHA-256 again, and downloads the archive again when the program has changed. |
| knip | `knip.json` | Finds files nothing imports or runs, and fails on any. See [Dead Code Detection](#dead-code-detection). |

The Sheets scripts are plain scripts, not modules: Apps Script loads them
without imports, with its services as globals. ESLint reads them the same
way, and two settings follow from that. A name that one file of the
exchange script uses from another is declared in a `/* global */` comment,
since no import says where it comes from. And `no-unused-vars` passes a
script's top-level functions, since a cell or another file calls them, out
of ESLint's sight. The security lint reads the Sheets scripts too.

husky, a package that runs scripts at git's hooks, runs `npm run lint`
before each commit (`.husky/pre-commit`), so an unformatted or failing
file stops the commit; `npm run format` or
`npm run lint:fix` fixes formatting. No rule is ever switched off in a file,
no file git keeps is left out of the lint, and a file over 500 lines is
split, not excused. The one folder the lint and the security lint pass
over is `dist/`, which git ignores: the build step writes its file there
when there is no
clipboard, and that file holds the compiled code of DEX Screener, a
service that lists the pairs of decentralized exchanges with their prices,
and the api keys. The format check and the secret scan also pass over the
tools' `input/` and `output/` folders, which hold the owner's own files
and which git ignores but for their `.gitkeep` (`.prettierignore`,
`.secretlintignore`).

---

## Tests

Two test suites run in `npm run check`: the top folder's, on Node's own
test runner, and crypto-price-filler's, on vitest, a test runner its tests
were written for. Neither asks a service
outside the computer, and neither reads the owner's key file or password.

**The top folder's tests** (`test/`, Node's test runner) cover the runner
(`apps-script-runner/`), which runs a Sheets script under Node; the Node
versions; the build step; the menu (`src/crypto-price-fetchers-menu.gs`), which
runs a spreadsheet's price cells again; the price clients (`dex-prices/`),
which ask the services that price a token from its chain's pools; the key
store; `no-secret-logging`, the lint rule that refuses printing a name
that may hold a secret; the versions tool (`github-project-deps/`); the
Summ CSV writer (`summ-csv/`); the actionlint runner (`actionlint/`);
`no-or-default`, the lint rule that refuses a default made with `||`; the
shared helpers (`lib/`); every command line's help, and its help into a
closed pipe (`test/command-line-help.test.js`), with the checks in
`lib/command-line-help.js`; and the repo's tracked files, with the checks
in `lib/repo-checks.js`. The repos that install this one run both sets of
checks in their own tests. The scripts' and the clients' requests
go to a stand-in fetch or a stand-in server on the computer
(`test/helpers/stand-in-web.js`; `test/helpers/gecko-terminal-stand-in.js`
answers as GeckoTerminal, one of those services, does). The build step's tests stand in for the
clipboard, the install, the questions and DEX Screener's part.
`test/dex-screener.test.js` builds that part from stand-in TypeScript
sources, written in the test with their checksums, served by a stand-in
fetch, and compiled with the real esbuild, the program that compiles
TypeScript and JavaScript into one file; `test/built-script.test.js`
checks the joining of parts on short scripts. The menu's tests run
`src/crypto-price-fetchers-menu.gs` unchanged against a spreadsheet held in
memory (`test/helpers/stand-in-spreadsheet.js`), which records each
formula written. The versions tool's tests run
it on projects in temp folders, with a stand-in npm that writes the
lockfile an install would (`test/helpers/github-project-deps-stand-ins.js`);
git itself lists their package.json files, and npm's dry-run pack shows
what the package ships for the bin. The shared helpers' tests ask npm's
dry-run pack whether `lib/` ships, and import `messageOf` by the
package's own name, `crypto-price-fetchers/lib/message-of`, which Node
resolves through the package's `exports`, as it does in a project that
installs this repo. The Summ CSV writer's tests change one
value of a row that passes every rule, so each test reads one rule's
problem (`test/helpers/summ-csv-rows.js`), read a copy of the owner's
template (`test/fixtures/summ-template.csv`), and write their files in
temp folders; their rows' wallets and hashes are made up, so no address of
the owner's is in the repo. The key store's tests save keys in temp
folders of their own (`test/helpers/temp-folders.js`), removed when a test
file ends; `test/fixtures/lp-ranger-api-keys.json`, written by LP Ranger's
own code, checks that the store opens LP Ranger's files. A test that starts
a program gives it an environment without `API_KEYS_PASSWORD`, and a key
file of its own in `API_KEYS_FILE_PATH`. `bin/unlock-api-keys.sh`, the script
that keeps the password for a terminal, is tested in
bash, and in zsh where zsh is installed. `npm run test:coverage` fails below
80% of lines covered.

**crypto-price-filler's tests** (`tests/`, vitest) cover the tool, its
sources and its command line, and run the exchange script unchanged under
Node: its price sources in `sheets-sources.test.js`, which carries what
each source must do for both tools, and the windows the script asks MEXC
for in `mexc-windows.test.js`. Its `vitest.config.js` names a key file
that does not exist and empties `API_KEYS_PASSWORD`, so no test finds the
owner's key, and fails a coverage run below 80% of lines. `tests/helpers/`
holds the stand-ins:

- `sheets-script.js` runs a Sheets script, one file or several, in the
  test's thread with the runner's services; its `UrlFetchApp` answers from
  a function the test gives, with any status or no response at all, the
  script's config is set as its Node version sets it, and more stand-in
  services, such as the top folder's spreadsheet or its own script lock
  that is never free (`busyLockService`), can be handed in. It also gives
  the time Google lets a custom function run (`CUSTOM_FUNCTION_LIMIT_MS`).
- `stand-in-fetch.js` is a stand-in fetch for the tool's own sources: the
  exchange sources, whose Sheets script then runs for real in the runner's
  worker, and the pool sources, whose shared clients then ask it.
- `stand-in-fetch-preload.js` runs the real command line,
  `bin/crypto-price-filler.js`, in a
  child process against a stand-in MEXC, a centralized exchange, and a
  stand-in ping of CoinGecko, a service that gathers the exchanges' prices,
  that takes the one key in `stand-in-coingecko-key.js`.
- `stand-in-settings-preload.js` hands the command line, run in a child
  process, a settings file, a token list or a `config.json` of the
  exchange script of the test's own, from the environment variable
  `STAND_IN_FILLER_CONFIG`, `STAND_IN_FILLER_TOKENS` or
  `STAND_IN_EXCHANGE_CONFIG`, since the tool reads its two beside its own
  files, and the exchange script's Node version its own beside the
  script, and a test never writes the owner's settings.
- `regression-runs.js` holds the settings, stand-in answers, times and
  runs that the regression tests and the known-bug tests share: answers
  as MEXC, CoinGecko and CoinPaprika give them, a time as a cell writes it
  (`cellTime`), the command line run over one row in a child process, or
  in a folder of the test's own with the stand-in settings (`runIndexIn`,
  for `tests/regressions-command-line.test.js`), and a call run with the
  computer's time zone set to another.
- `log-lines.js` reads the lines the tool prints through the seam of its
  log, `utils/log.js`, a mock function in place of the console's log until
  the test ends, so no test replaces `console.log`, as LP Ranger's rules
  ask.

### Test Files

Each test file and helper, by folder. `test/repo-checks.test.js` checks
that this section, or `CLAUDE.md`, names every one.

**The top folder's** (`test/`):

| File | What it covers |
| ---- | -------------- |
| `actionlint.test.js` | The actionlint runner (`actionlint/`), against archives built in the test: the archive for a system downloaded and refused unless its SHA-256 and its program's match the pinned ones, the tar file read, the program kept and checked on each run, and the command line. |
| `api-key-store.test.js` | The key store (`api-key-store/`): keys encrypted with a password, saved, opened, and read from LP Ranger's key files. |
| `apps-script-build.test.js` | The build step, `npm run build apps-script`: its questions, the file it gives, and where it puts it, the install it offers when there is no clipboard tool among them. |
| `apps-script-services.test.js` | The runner's Node versions of the Apps Script services. |
| `ask-line.test.js` | `lib/ask-line.js`: a question written, and the line typed given, or null when the input ends first. |
| `built-script.test.js` | The joining of the built file's parts into one Apps Script project, on short scripts. |
| `calendar-day.test.js` | `lib/calendar-day.js`: the start of a day in UTC, and a day the calendar does not have refused. |
| `clipboard.test.js` | `lib/clipboard.js`: the clipboard tool found for each platform and session, the package that holds one named, a command found on `PATH`, and the copy. |
| `closed-output.test.js` | `lib/closed-output.js` and `helpIntoClosedPipe`: a command line that calls the helper ends with its exit code and writes nothing to stderr when its output's reader has closed the pipe, and one that does not shows the stack trace the check looks for. |
| `command-line-help.test.js` | Every command line's help, `--help` and `-h`, and its help into a closed pipe; the list of command lines held to the repo; and the checks of `lib/command-line-help.js`. |
| `config-file.test.js` | A Node version's config file read, with and without its schemas, and the opened keys laid over its values. |
| `config-schemas.test.js` | The runner's check of a Node version's schemas of its script's config objects (`configSchemaProblems`), on a small script, `test/fixtures/config-schema-check.gs`; the check run on each Node version's `CONFIG_SCHEMAS`, its script loaded as the build joins it; each Node version's `config-example.json` held to its schemas and to the values written in its script; and a config.json refused for a field read as it loads, an api key, or a value of the wrong kind. |
| `crypto-price-fetchers-menu.test.js` | The menu (`src/crypto-price-fetchers-menu.gs`), against a spreadsheet held in memory. |
| `crypto-price-fetchers.test.js` | `bin/crypto-price-fetchers.js`, the Node version of the script of current prices, its settings file, `crypto-price-fetchers/config.json`, which git ignores, and its command line. |
| `dex-prices-geckoterminal.test.js` | The GeckoTerminal client, part one: its settings, the budget of requests every caller shares, a token's facts and pools, and the pool it reads a price from. |
| `dex-prices-geckoterminal-candles.test.js` | The GeckoTerminal client, part two: a pool's candles, page by page, and the candle and price of a time. |
| `dex-prices-dextools.test.js` | The DexTools client: a token's price now, asked at the plan's path with the key in its header only, a 429 waited out, the errors it throws, which never name the key, and its time limit, against a stand-in server that never answers. |
| `dex-prices-moralis.test.js` | The Moralis client: the block a chain had at a time, a token's price at a block, the pairs that trade a token, read page by page up to 10 pages, the pick of the deepest active pair that lists a token first, and a pool's candles, read page by page and given oldest first, with the token Moralis priced. |
| `dex-prices-web-request.test.js` | `dex-prices/web-request.js`: a request sent again after each wait while the service answers 429, each try with its time limit. |
| `dex-screener.test.js` | DEX Screener's part of the build: its files downloaded at one commit, checked against their SHA-256, and compiled, from stand-in sources. |
| `format-date.test.js` | `Utilities.formatDate` under Node. |
| `get-crypto-price-from-centralized-exchange.test.js` | The exchange script's Node version, and its command line. |
| `github-project-deps.test.js` | The versions tool, part one: the refs it sets and its runs. |
| `github-project-deps-files.test.js` | The versions tool, part two: the package.json files a run reads, and what the package ships for the bin. |
| `help-page.test.js` | The page the menu's Help item shows. |
| `http-url.test.js` | `lib/http-url.js`: an http or https url taken, anything else refused. |
| `key-manager.test.js` | The key store's services, a project's key list, the key manager, and this repo's `bin/manage-api-keys.js`. |
| `key-prompts.test.js` | The flows that open the saved keys with one password and save a key once its service takes it. |
| `load-apps-script.test.js` | A Sheets script loaded into a `vm` context, configured and called, in the test's thread; a config value refused when the script's object has no such field or holds another kind of value there. |
| `message-of.test.js` | `lib/message-of.js`, and that the package ships `lib/`. |
| `new-file.test.js` | `lib/new-file.js`: null for a folder that takes a new file, which it leaves as it was, and the system's code for `/proc`, which refuses one even to root, a test skipped on a system without `/proc`. |
| `no-or-default.test.js` | `eslint-rules/no-or-default.js`, the lint's rule against a default made with `\|\|`. |
| `package-exports.test.js` | Every module the package exports, loaded by the package's name, as a project that installs this repo loads it, and shipped. |
| `no-secret-logging.test.js` | `eslint-rules/no-secret-logging.js`, the security lint's rule against printing a name that may hold a secret. |
| `option-conflicts.test.js` | `lib/option-conflicts.js`: a typed option that conflicts with one a settings file sets refused, naming both and the file; the settings file's option alone, or neither option, passed; and two typed options left to commander, which refuses them as it parses. |
| `os-dependencies.test.js` | The install of the operating system's programs (`install/os-dependencies.js`): a clipboard tool already installed, none needed with no desktop session, xclip or wl-clipboard installed with Homebrew, Homebrew recommended and apt asked for without it, a package left to be installed by hand, an install's exit code; `runAtTerminal`; and the command line's exit codes. |
| `repo-checks.test.js` | `lib/repo-checks.js`, on repos made in temp folders, and this repo held to it: its EVM addresses in EIP-55's form, its npm targets and test files named in the docs, its docs' links and paths pointing at the files, folders and headings it keeps, and a `config-example.json` beside each `config.json`, each beside a committed `config.json` holding what that file holds. |
| `run-apps-script.test.js` | `openAppsScript`: a Sheets script run in a worker thread, with its web requests done on the caller's thread. |
| `settings-file.test.js` | `lib/settings-file.js`: a settings file's JSON object read whole; a missing file giving no settings unless it is required; a file it cannot read, one that is not JSON and JSON that is no object refused, naming the file; and a file its schema finds problems in refused, listing every problem. |
| `settings-schema.test.js` | `lib/settings-schema.js`: a schema compiled strict, with the shared formats and a project's own; every problem in a file named at once, in the words of its kind; a value no shape of a choice fits refused in one line; a key another needs named missing; a key its object's `propertyNames` refuses named as the key; the kinds of a time limit and of a wait, up to the longest Node's timers keep; and an option parser made from a kind. |
| `summ-csv.test.js` | The Summ CSV writer, part one: a header's columns, the rules a row must pass, and the text of a file. |
| `summ-csv-values.test.js` | How the Summ CSV writer turns a row's values into the text of cells. |
| `summ-csv-files.test.js` | The Summ CSV writer, part two: the template it reads, the settings it ships and their schema, the file it writes, its command line, and what the package ships for it. |
| `time-limited-fetch.test.js` | `lib/time-limited-fetch.js`: an answer read in full, a server that never answers and one that stops in its body, each given up on at the limit with an error naming the service, a caller's own signal that aborts the request, an answer with no body, and a limit that is not a whole number of milliseconds from 1 to 2147483647, as Node's timers keep, refused. |
| `unlock-api-keys.test.js` | `bin/unlock-api-keys.sh`, in bash, and in zsh where zsh is installed: sourced, the password it keeps or refuses, the status it returns, which says which, and its help, which asks nothing; run as a program, that it says to source it and stops with exit code 1. |

Its helpers (`test/helpers/`), besides those the paragraphs above name:
`captured-output.js`, a stream stand-in that keeps what is written to it,
for the tests of the command lines; and `stand-in-mexc.js`, which gives
the candles MEXC answers a request for candles with, every one that opens
in the window asked, up to the request's limit, or none, so the
stand-ins of both suites answer as MEXC does.

**crypto-price-filler's** (`tests/`):

| File | What it covers |
| ---- | -------------- |
| `backfill-cli.test.js` | `backfill.js`'s command and run, which `bin/backfill.js` starts, with stand-ins for `fs`, csv-writer and `loadConfig`. |
| `backfill.test.js` | `utils/backfill.js`: the bracketing prices of a run of rows marked `Error`, the fill, the totals, a blank price left as it is, and `backfillChoice`. |
| `cache.test.js` | `utils/cache.js`, the cache held in memory, with each entry's expiry, aged through the cache's clock (`setCacheClockForTests`). |
| `coingecko-api-key.test.js` | The command line, `bin/crypto-price-filler.js`, opening the saved CoinGecko key before it prices anything. |
| `exchange.test.js` | `sources/exchange.js`: the exchange script's price sources, opened once per run with the run's keys and closed at its end. |
| `geckoterminal-source.test.js` | `sources/geckoterminal.js`: a token that trades in pools, priced from the GeckoTerminal candle that holds a row's time. |
| `index.test.js` | The command line's helpers, the time zones and the reading of a date, and the command line, `bin/crypto-price-filler.js`, run as a program. |
| `known-bugs.test.js` | The known bugs, each declared with `it.fails`. |
| `mexc-windows.test.js` | The windows the exchange script asks MEXC for: the minute, or for an older time the hour, and, when nothing traded in it, each window up to the year, whose average of high and low then answers; and, when MEXC keeps no candle of the hour, the climb when it keeps one of the day before, or no price when it does not. |
| `moralis-source.test.js` | `sources/moralis.js`: a token that trades in pools, priced by Moralis at the block its chain had at a row's time. |
| `price.test.js` | `sources/price.js`: the order the sources are asked in, and the cache. |
| `progress.test.js` | `utils/progress.js`, the progress bar. |
| `regressions.test.js` | The fixed bugs of the tool and its Sheets script, and of the Summ csv utility, which refuses a time past the year 9999, as a time in milliseconds given for seconds is; and of the key store's password prompt, which refuses at once a question asked after its input has ended. |
| `regressions-command-line.test.js` | The fixed bugs of the Sheets scripts' Node versions' command lines, which name a time zone or a date the exchange script refuses, and a run on x1 with no `--pool`, before a key is opened or anything is asked, and of the exchange script's settings, which refuse a `GENERAL_DELAY_MS` of 0; and of crypto-price-filler's two command lines: their checks of a value, the settings they fall back to, a settings file or token list they cannot take refused as one error, a `config.json` of the exchange script its Node version's schemas refuse ending the run before its first row, what `index.js` logs, `validate-parse` failing when node does not exit with code 0, the file the filler writes when no `--output` is given being one git ignores, run from the repo's top folder, and backfill leaving the rows that hold no data, such as a Total row, out of the fill and the grand total, and bracketing a block of `Error` prices with the nearest priced rows past them; `test:ci` and `test:debug` giving vitest their flags; and an input file not found, or with no rows, named; and of `bin/unlock-api-keys.sh`, which finds the project's top folder when the shell's `CDPATH` lists `.`, answers `--help` and `-h`, run or sourced, and returns 1 when it keeps no password. |
| `regressions-lib.test.js` | The fixed bugs of the repo's shared helpers in `lib/`: a schema compiled once, the words for an empty text and an empty list, the search for command lines, a time limit Node's timers cannot keep refused, the copy to the clipboard, which rejects, naming the exit code, when the tool exits without reading its input, and the questions at the terminal, which give each question its own line of the answers piped in together, and null at once to a question asked after the input has ended. |
| `regressions-sheets.test.js` | Fixed bugs whose tests run a Sheets script in the test's thread: the exchange script's pairs quoted in `CONFIG.QUOTE_CURRENCY`; a cell's own cache seconds outside 1 to 21600 refused with a message before any request, an empty cell taking the config's; each token's own FDV when two cells name one pool, and an answer kept for one cell's seconds never given to a cell with others; and a time before MEXC listed a pair priced by CoinGecko, on an earlier day, before the first trade on the listing day, or, for a recent time, before it in the listing hour, while a time after it still climbs MEXC's windows, as does a recent time whose minute request fails or whose minute MEXC let go in the hour its minute candles begin in; a failed request for the day, which the script goes on past rather than take for no candle; a failed request for the day before, after a minute or an hour with no candle, for which CoinGecko answers, as it does for such a time on the listing day; a request with no response at all, which the next source answers; a call's waits for the lock and for requests refused as too many, within the time Google lets a custom function run, with the busy message, kept nowhere, when no source gave a price; and a call cut short by refusals, by answers with a server error or a request timeout, or by requests with no response, Apps Script's spent quota among them, after which CoinGecko is asked again, while its own lack of an answer is kept when only another source's request was cut short. Also CoinGecko's hourly prices kept for the time asked, not for its day, and the menu's Refresh, which runs again the cells that call `dexToolsGetTokenPrice`. |
| `settings-files.test.js` | `config.js` and `supported-tokens.js`: the committed settings and token list held to their schemas, the owner's `config.json` laid over the committed settings, and files with a key no schema names or a value of the wrong kind refused, listing every problem. |
| `sheets-sources.test.js` | The exchange script's sources, MEXC, CoinGecko and CoinPaprika, which the sheet and the tool both price with. |
| `token-validation.test.js` | A token with no sources refused, naming the tokens the tool supports. |
| `xtm-coingecko-id.test.js` | XTM priced from CoinGecko under the id of Minotari, its project. |

Code written to check something goes into the tests, so it is kept and run
again rather than written again.

### How the Sheets Scripts (`.gs`) Are Tested

A Sheets script is Google Apps Script: JavaScript that runs on Google's
servers, inside a spreadsheet, where a cell calls one of its functions.
The repo has two that give prices, each in the `src/` of its tool's
folder, and the menu, in the top `src/`.
`crypto-price-fetchers/src/crypto-price-fetchers.gs` is one file. The
exchange script is three, in `fetch-from-centralized-exchange/src/`:
`getCryptoPriceFromCentralizedExchange.gs`, its price sources in
`-sources.gs`, and its tests in `-tests.gs`. The menu,
`src/crypto-price-fetchers-menu.gs`, gives no price and has no Node
version.

Two separate sets of tests check the scripts:

- **The Node tests** run on this computer, in `npm run check` and in CI.
  They check the scripts' own logic: what each function returns, given the
  answers the price services give.
- **The Apps Script tests** are functions inside the scripts. The owner
  runs them by hand, in the Apps Script editor. They check what only
  Google's servers can show: Apps Script's own services, the lock, and the
  price services' real answers.

The two sets share no code, and neither runs the other.

#### The Node Tests

Node runs the real `.gs` files, unchanged, so a Node test passes or fails
on the code the owner pastes into Apps Script. Apps Script and Node differ
in three ways, and the runner, `apps-script-runner/`, bridges each one:

1. **The services.** A `.gs` file imports nothing. It reaches the web, a
   cache and a lock through Apps Script's services, which are globals:
   `UrlFetchApp`, `CacheService`, `LockService`, `PropertiesService`,
   `Utilities` and `Logger`. The runner gives the script Node versions of
   the methods it calls (`apps-script-services.js`), and only those. A
   script that calls another method fails under Node with "is not a
   function", which names the method.
2. **One scope.** Apps Script loads all of a project's files into one
   global scope. So the exchange script's files call each other's
   functions with no import. The runner runs a script's files, in Apps
   Script's order, in one context of Node's `vm` module, which runs code
   in a global scope of its own (`load-apps-script.js`).
3. **Waiting for a web request.** In Apps Script, `UrlFetchApp.fetch` holds
   the script until the response arrives, then returns it. In Node, `fetch`
   returns a promise at once, and the response comes only after the running
   code has finished and Node's event loop has run. A script's code cannot
   finish without its response. So if the script ran on Node's main
   thread, the response could never arrive. The runner therefore runs the
   script in a worker thread, a second thread of JavaScript that Node runs
   beside the main one. For each request, the worker hands the
   request to the main thread and blocks. The main thread, whose event loop
   keeps running, does the request with Node's `fetch`, hands the response
   back and wakes the worker. To the script, `UrlFetchApp.fetch` has
   returned the response, as in Apps Script (`run-apps-script.js`,
   `script-worker.js`).

The tests run a script in one of two ways: in the runner's worker thread,
as the Node versions do, or in the test's own thread, with requests
answered at once.

| Tests | How the script runs | What they check |
| ----- | ------------------- | --------------- |
| `test/crypto-price-fetchers.test.js`, `test/get-crypto-price-from-centralized-exchange.test.js` | Through its Node version, in the worker thread. Each request goes to `standInFetch` (`test/helpers/stand-in-web.js`), which answers as DexTools or x1.ninja, the services that give current prices, or MEXC or CoinGecko, which give past ones, does. | What each Sheets function returns, as its cell would show it, and the Node versions' command lines. |
| `test/run-apps-script.test.js` | A small script, `test/fixtures/runner-check.gs`, in the worker thread. Its requests go through Node's own `fetch` to a web server on this computer. | The hand-off between the threads: the worker waits, the main thread does the request, and each response reaches the request it answers. |
| crypto-price-filler's `tests/sheets-sources.test.js`, `tests/mexc-windows.test.js`, `tests/regressions.test.js`, `tests/regressions-sheets.test.js`, `tests/xtm-coingecko-id.test.js` | In the test's own thread (`tests/helpers/sheets-script.js`). `UrlFetchApp.fetch` answers at once from a function the test gives, so nothing waits. | What each price source gives, the cases the regression tests cover, and that no file of the exchange script holds a CoinGecko api key. |
| crypto-price-filler's `tests/regressions.test.js`, `tests/xtm-coingecko-id.test.js`, through the tool | Through the exchange script's Node version, in the worker thread, as the tool runs it (`tests/helpers/stand-in-fetch.js`). | The same cases, reached through the tool's provider chain. |
| `test/load-apps-script.test.js`, `test/apps-script-services.test.js` | Small scripts in `test/fixtures/`, in the test's own thread, with requests answered at once. | That a script's files load into one scope, in order, and that each Node service acts as Apps Script's does. |
| `test/crypto-price-fetchers-menu.test.js`; crypto-price-filler's `tests/regressions-sheets.test.js` and `tests/known-bugs.test.js` | In the test's own thread, with a spreadsheet held in memory (`test/helpers/stand-in-spreadsheet.js`) or a stand-in lock in place of Apps Script's. | What each menu item writes, in which order, and what it reports; and the price functions' waits for the lock. |

The Node tests run Node's versions of the services, one call at a time,
against stand-ins for the price services. So three things lie outside
them:

- **Apps Script's own services.** Google's `UrlFetchApp`, cache and lock
  never run under Node.
- **The lock.** The runner answers one call at a time, so under Node the
  `LockService` lock is always free. A script that asks for a lock it
  already holds is not caught.
- **The price services' real answers.** Each stand-in answers as its
  service answered when the test was written.

The Apps Script tests cover these three.

Node's coverage report lists the `.gs` files, because the runner compiles
each under its own path. So their lines count toward the top folder's 80%
floor. The test functions inside `crypto-price-fetchers/src/crypto-price-fetchers.gs` never run under
Node, so their lines count as not covered. No Node test loads `-tests.gs`,
so it is not in the report. crypto-price-filler's coverage, from vitest,
does not count the `.gs` files.

#### The Apps Script Tests

The Apps Script tests run on Google's servers, through Apps Script's real
services, and ask the real price services. So they need a network, and the
api keys the scripts read. The owner runs each one by hand, from the Run
button in the Apps Script editor, and reads its results in the editor's
log. No automated run calls them.

- **`crypto-price-fetchers/src/crypto-price-fetchers.gs`** holds its own. `testDexToolsFunctions`
  asks for the prices and fully diluted values of a few tokens on
  PulseChain, Ethereum and X1, and logs each result. `testDexToolsVerbose`
  runs it with the lock attempts, the raw responses and the cache's state
  logged too.
- **The exchange script's** are in its third file,
  `fetch-from-centralized-exchange/src/getCryptoPriceFromCentralizedExchange-tests.gs`, which the build step
  puts in the one file with the rest; the sheet needs it for nothing else.
  `test` runs the file's two tests:
  - `testGetCryptoPrice` prices several coins at past dates through
    `getCryptoPrice`, and checks that each price falls in its expected
    range. A coin the script does not know must give a message, not a
    price.
  - `testCoinGeckoDeadlockRegression` checks the lock. Apps Script's
    locks are not re-entrant: a script that asks for a lock it already
    holds waits forever. `getCryptoPrice` holds its lock while it looks up
    a price. The test prices GRC, which MEXC does not list, so the lookup
    goes on to CoinGecko while the lock is held. If that step asked for
    the lock again, the call would never return. The test passes when the
    call returns.

---

## Security Audits

Five audits look for security problems: in the packages the repo
installs, through npm audit, npm's check of installed packages against
known vulnerabilities; in the code DEX Screener publishes that the build
step can put in its file; in the release of actionlint the lint runs; in
the repo's code, through ESLint with security rules; and in the text of
every file, through secretlint, which looks for keys and credentials.

| Command | What it runs | What it catches |
| ------- | ------------ | --------------- |
| `npm run audit:deps` | `npm audit --audit-level=high --omit=dev`, for the repo and crypto-price-filler, then `npm run audit:dex-screener` and `npm run audit:actionlint` | Known vulnerabilities, of high severity or worse, in the packages that ship; then what the next two rows say. |
| `npm run audit:dex-screener` | `build/tools/audit-dex-screener.js`: downloads each file of DEX Screener's Google Sheets functions at the commit `build/tools/apps-script-build/dex-screener-files.js` names | A file that cannot be downloaded, or whose SHA-256 differs from the one written there. npm audit covers only packages installed from npm, and this code is not one. The build step runs the same audit before it compiles those files. |
| `npm run audit:actionlint` | `run-actionlint --check`: downloads every archive of the actionlint release `actionlint/release.js` names | An archive that cannot be downloaded, or whose SHA-256, or its program's, differs from the one written there. npm audit does not cover actionlint, which is no npm package; the lint makes the same checks on the one archive it runs. |
| `npm run audit:security` | ESLint with `eslint-security.config.js` | Code open to attack (eslint-plugin-security), strings that look like keys (eslint-plugin-no-secrets), and printing a name that may hold a secret (`no-secret-logging`). |
| `npm run audit:secrets` | secretlint, with `.secretlintrc.json` and `.secretlintignore` | Keys and credentials in any file. |

The security lint follows LP Ranger's: no warning allowed, with
`detect-non-literal-fs-filename` and `detect-object-injection` off. Two
things are this repo's own:

- `no-secret-logging` is LP Ranger's rule with api keys added, and with this
  repo's ways of printing: `console`, a stream's `write`, and `say`. It
  looks at names, so a name that holds no secret but sounds like one is
  renamed rather than excused: the environment variable that holds the
  password is named in the code as `UNLOCK_VARIABLE`.
- no-secrets passes the public X1 addresses the code names, listed in the
  config as `PUBLIC_ADDRESSES`, which are base58 and look random to it.

---

## The Build Step

`npm run build apps-script`, the build step, joins the Sheets scripts into
`crypto-price-fetchers.gs`, the one file the owner pastes into a
spreadsheet's Apps Script project, on the clipboard, or in
`dist/apps-script/` when there is no clipboard tool; [The Build Step](architecture.md#the-build-step)
in `docs/architecture.md` says how it works. When the owner asks, it also
compiles DEX Screener's Google Sheets functions into that file.

### Packages That Ship in the Built File

DEX Screener's code imports zod, a library that checks data against a
schema, and lodash, a library of helper functions. esbuild compiles both,
from this repo's `node_modules`, into the pasted file, where they run in
the spreadsheet with DEX Screener's functions. So `package.json` lists them
as dependencies, not development packages, and the gate's npm audit, which
skips development packages (`--omit=dev`), checks them.
`test/dex-screener.test.js` holds them there, and compiles a stand-in that
checks an answer with them as DEX Screener's code does.

---

## Dead Code Detection

A file nothing in the repo uses is dead code. knip finds such a file: it
follows the imports from each entry point, a file that a program or a test
starts from, and reports any file it never reaches. `npm run knip:files`
fails on one, as in LP Ranger. Some files are started by their path rather
than imported, so `knip.json` names them as entry points: the command
lines, the worker the runner starts, the preload that crypto-price-filler's
tests start, the security config and the tests. Unused exports are not
gated.

---

## CI and Branch Protection

CI runs the gate again on GitHub, so a change reaches `main` only after it
passes there too. Two workflows run on every push to `main`, every pull
request to `main`, and by hand:

| Workflow | Job | Runs |
| -------- | --- | ---- |
| `ci.yml` | check-latest-nodejs-lts (Node 26), check-oldest-nodejs-supported (Node 24) | `npm run check`, after installing the repo's packages and crypto-price-filler's. |
| `security-audit.yml` | Dependency Audit, Security Lint, Secret Scan | Each audit as a job of its own; Dependency Audit runs `npm run audit:deps`, so the checks of DEX Screener's files and of actionlint's archives with it. |

The two checks of `ci.yml` are named for their roles, not their Node
versions, so moving to newer versions renames no check.

`main` is protected: a change reaches it only by a pull request whose five
checks, those five jobs, have passed. Force pushes and deletion are
refused. Merges are merge commits, never squashed, and no branch is
deleted. The steps from a branch to `main` are LP Ranger's eight, in its
`docs/claude/CLAUDE-CI.md`.

---

## Known Bugs

A bug found but not yet fixed is recorded as a test, which fails once the
bug is gone, so the record cannot go stale. crypto-price-filler's
`tests/known-bugs.test.js` declares each with `it.fails`: the test passes
while the bug is present. The fix makes it fail. The same change declares
it with `it` and moves it to the regression tests, where it keeps the
fixed behavior from coming back: `tests/regressions-command-line.test.js`
for the repo's command lines, `tests/regressions-lib.test.js` for the
shared helpers in `lib/`, `tests/regressions-sheets.test.js` for a test
that runs a Sheets script in the test's thread, and
`tests/regressions.test.js` for any other; the latter also holds older
tests that run a Sheets script that way. The repo's `CLAUDE.md` lists the bugs
known today, each with its test.
