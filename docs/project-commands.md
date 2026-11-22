# crypto-price-fetchers — Project Commands

Every command of crypto-price-fetchers, the owner's repo of code his
projects share, with what each does and what to type. Most run through
npm, the package manager of Node, the program that runs JavaScript outside
a browser, from a `package.json`: those its top `package.json` defines,
which run from the repo's top folder, and those of crypto-price-filler,
its tool that fills a CSV's price columns, which has a package of its own.
The rest run with `node`, or `source`, at a terminal
([Commands Run Without npm](#commands-run-without-npm)).

Each command runs on both major versions of Node the repo supports: the
newest LTS (long-term support) version, today 26, and the version two
majors before it, today 24.

Companion to [`docs/engineering.md`](engineering.md), which covers how the
gates work. This file covers how to drive them.

---

## Table of Contents

- [Passing Flags](#passing-flags)
- [Api Keys](#api-keys)
- [Build](#build)
- [Summ CSV Files](#summ-csv-files)
- [Developer Tools](#developer-tools)
- [Test](#test)
- [Commands That Are Usually Not Run Alone](#commands-that-are-usually-not-run-alone)
- [crypto-price-filler's Commands](#crypto-price-fillers-commands)
- [Commands Run Without npm](#commands-run-without-npm)
- [See Also](#see-also)

---

## Passing Flags

Run with `npm run <name>`; `test` also works without `run`. Flags go after
a `--` separator, which tells npm the rest belongs to the script; a word
with no dashes, such as `apps-script`, needs none. A command that runs one
of the repo's command lines passes `--help` on to it, which then lists its
options, examples of its common uses and its exit codes:
`npm run build -- --help`. These three commands replace the saved key of
DexTools, the service that gives current prices ([Api Keys](#api-keys)),
run the tests whose names hold `unlockApiKeys` ([Test](#test)), and give
the Sheets scripts, the repo's scripts for Google Sheets, Google's
spreadsheet app, as one file, with their keys ([Build](#build)):

```sh
npm run api-keys -- set dextools
npm test -- --test-name-pattern="unlockApiKeys"
npm run build apps-script
```

---

## Api Keys

The api keys the programs send are kept encrypted in `api-keys.json` by
this repo's key store, `api-key-store/`. One command runs its key
manager.

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `api-keys` | `set <service>`, `check-password`, `--help` | The key manager. Lists each key the top `config.json` names, saved or not, never showing a key's characters, and asks for each one not saved: the key, then the password. Each key is saved, encrypted, once its service takes it. `set <service>` replaces one key. `check-password` says, by its exit code, whether the password in `API_KEYS_PASSWORD` opens every key saved; `unlock-api-keys.sh`, the script that keeps the password for a terminal, runs it. | `npm run api-keys` · `npm run api-keys -- set coingecko` |

`source ./unlock-api-keys.sh`, a script in the repo's top folder, keeps the
password for a terminal ([Commands Run Without npm](#commands-run-without-npm));
[the key store's README](../api-key-store/README.md) explains the store.

---

## Build

A spreadsheet runs the Sheets scripts from its project in Apps Script,
Google's platform for scripts that run inside its apps, which cannot read
the key file and runs every script file in one global scope,
so the scripts are pasted as one file, with the keys written in. One
command gives that file.

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `build` | `apps-script`, `--help` | `apps-script` first reads the config.json each Node version, the script's twin that runs it on Node, reads, and checks it as that Node version does, stopping, with every problem listed, when a file sets a field the script does not take or a value of the wrong kind. It then asks whether to include the Google Sheets functions of DEX Screener, a service that lists the pairs of decentralized exchanges with their prices (Enter or y includes them, n leaves them out), naming the commit of DEX Screener's repo they come from, and saying that the step is optional and that a build that fails should be run again with n. On a yes, it checks that those files are the ones this repo pinned: it downloads each and compares its SHA-256 with the one written in the repo, the check `audit:dex-screener` runs on its own; then it prints the result and compiles the files it checked. Then it opens the saved keys, as the programs do, and joins the menu, every Sheets script and DEX Screener's functions into one file, with the keys, the values of those config.json files, and the Help page set at its end. It puts the file on the clipboard, says how to paste it, waits for Enter, and clears the clipboard. With no clipboard tool installed, it offers to install one (`sudo apt install xclip`, or `wl-clipboard` on Wayland); declined, it warns that the keys go to disk in the clear, then writes the file to `build/apps-script/crypto-price-fetchers.gs`, readable by the owner alone. It takes no other argument; `--help` gives its exit codes. | `npm run build apps-script` |

---

## Summ CSV Files

Every CSV file the owner imports into Summ, the crypto tax calculator he
keeps his books in, is written by one utility, this repo's `summ-csv/`,
which checks every row first and writes nothing while any row breaks a
rule ([its README](../summ-csv/README.md) lists the rules).

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `summ-csv` | `--rows <file>`, `--template <file>`, `--out <file>`, `--replace`, `--help` | Reads a JSON array of rows from `--rows`, checks each, and writes the file at `--out`: the header of the template at `--template`, as it is written there, then a line per row. Prints the rows written and where, with exit code 0, or every problem with its row, with exit code 1. A file already at `--out` is written over only with `--replace`. | `npm run summ-csv -- --rows rows.json --template advanced-template-reference.csv --out missing.csv` |

---

## Developer Tools

These commands check or fix the form of the code: `lint` runs the checks,
and `format` and `lint:fix` make the fixes the tools can make.

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `format` | — | The write pass of Prettier, the package that formats code, over every JavaScript, Sheets script, JSON and YAML file. | `npm run format` |
| `knip:files` | — | The dead-code check: fails on any file nothing reaches. `lint` runs it. | `npm run knip:files` |
| `lint` | — | The linters: ESLint, which checks JavaScript against rules, LP Ranger's and `no-or-default`, this repo's rule against a default made with `\|\|`; markdownlint, which checks the form of Markdown files; Prettier in check mode; actionlint, which checks the GitHub Actions workflow files, run from its official release by this repo's bin `run-actionlint`, which checks the release's SHA-256; and knip's check for files nothing uses. husky, the package that runs scripts at the hooks of git, the version-control program, runs it before each commit. | `npm run lint` |
| `lint:fix` | — | ESLint and markdownlint with their fixes, then `format`. | `npm run lint:fix` |

---

## Test

These commands run the gates: the tests and the audits. `check` runs all of
them, after the lint, and must pass before a commit and a push.

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `audit:actionlint` | `--help` | Runs `run-actionlint --check`: downloads every archive of the release of actionlint, the checker of GitHub Actions workflow files, that `lint` runs, and fails when one cannot be downloaded, or its SHA-256 or its program's differs from the one `actionlint/release.js` pins; npm audit does not cover actionlint, which is no npm package. `audit:deps` runs it. | `npm run audit:actionlint` |
| `audit:deps` | — | `npm audit`, npm's check of the installed packages against known vulnerabilities, at the `high` threshold over the packages that ship (`--omit=dev`), the repo's and crypto-price-filler's, then `audit:dex-screener` and `audit:actionlint`. | `npm run audit:deps` |
| `audit:dex-screener` | `--help` | Downloads each file of DEX Screener's Google Sheets functions at the commit the build step uses, and fails when one cannot be downloaded or its SHA-256 differs from the one the build checks; npm audit does not cover that code. `audit:deps` runs it. | `npm run audit:dex-screener` |
| `audit:secrets` | — | secretlint, which looks for keys and credentials in files, across the repo. | `npm run audit:secrets` |
| `audit:security` | — | The security lint, ESLint with `eslint-security.config.js`: the rules of eslint-plugin-security, against code open to attack, of eslint-plugin-no-secrets, against strings that look like keys, and `no-secret-logging`, this repo's rule against printing a name that may hold a secret. | `npm run audit:security` |
| `check` | — | The full gate: `lint`, `test:coverage`, `test:filler`, `audit:deps` (with `audit:dex-screener` and `audit:actionlint`), `audit:security` and `audit:secrets`, in that order, stopping at the first that fails. | `npm run check` |
| `format:check` | — | Prettier in check mode; fails rather than rewriting. | `npm run format:check` |
| `test` | any `node --test` flag | The tests of the runner, which runs a Sheets script under Node; the Node versions; the build step; the menu the built file adds to a spreadsheet; the price clients of the services that price pools; the key store; the two lint rules; the versions tool; the Summ CSV writer; the actionlint runner; the shared helpers; every command line's help, and its help into a closed pipe; the package's exports; and the repo's tracked files, held to the checks of `lib/repo-checks.js`; on Node's test runner. | `npm test -- --test-name-pattern="openAppsScript"` |
| `test:coverage` | — | The same tests with coverage, failing below 80% of lines covered. | `npm run test:coverage` |
| `test:filler` | — | crypto-price-filler's `test:strict`, from the top folder. | `npm run test:filler` |

---

## Commands That Are Usually Not Run Alone

npm runs this command itself, before another one.

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `prelint` | — | Runs before `lint`; installs the husky hooks, so the pre-commit hook is in place once `lint` or `check` has run. It is here rather than in `prepare` because npm runs a git dependency's `prepare`, after installing its development packages, in every project that installs this repo from GitHub, the website that hosts it. | automatic |

---

## crypto-price-filler's Commands

crypto-price-filler is a package of its own, with its own commands. They
run in `fetch-from-centralized-exchange/crypto-price-filler/`, after
`npm ci` there. Its lint is the top folder's.

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `clean` | — | Remove the files a test run can leave: `tests/mock-filled*.csv`, `test.log`, `test.html`. | `npm run clean` |
| `start` | the tool's options; `--help` | Run the tool: read a CSV, fill its price columns, write the output. See its README. | `npm start -- --token=xtm --input=in.csv --output=out.csv` |
| `test` | — | vitest, a test runner for JavaScript, with coverage, quietly. | `npm test` |
| `test:ci` | — | vitest with coverage and no cache. | `npm run test:ci` |
| `test:debug` | — | vitest with `VERBOSE=1`, the verbose reporter, coverage and no cache. | `npm run test:debug` |
| `test:strict` | — | `validate-parse`, then the tests with coverage, failing below 80% of lines covered. What `npm run check` runs. | `npm run test:strict` |
| `test:watch` | — | vitest in watch mode, with coverage. | `npm run test:watch` |
| `validate-parse` | — | Loads `index.js` with `--help`, so a broken import fails before the tests run. | `npm run validate-parse` |

---

## Commands Run Without npm

These command lines run with `node`, or, for the password script,
`source`, at a terminal: the Node version of each Sheets script, which
prints the number the script gives a cell, crypto-price-filler's command
line and its backfill, and the script that keeps the key store's password
for a terminal. Each
Node command line answers `--help` with its options, examples and exit
codes; [the README's Usage](../README.md#usage) shows each at work.

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `node crypto-price-fetchers.js` | `price <chain> <token>`, `fdv <chain> <token>`, `--pool <address>` (after `price` or `fdv`), `--config <file>`, `--verbose`, `--help` | The Node version of `crypto-price-fetchers.gs`: a token's price, or fully diluted value (FDV), in USD now, from DexTools, or from x1.ninja for X1, which needs `--pool`. In the repo's top folder. | `node crypto-price-fetchers.js price ether 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| `node getCryptoPriceFromCentralizedExchange.js` | `<token> <date>`, `--tz <abbreviation>`, `--mode <mode>`, `--config <file>`, `--verbose`, `--help` | The Node version of the exchange script: a coin's USD price at a past time, from MEXC, then CoinGecko, then CoinPaprika. In `fetch-from-centralized-exchange/`; from another folder, give the file's path. | `node getCryptoPriceFromCentralizedExchange.js btc "2026-01-15 14:30:00"` |
| `node index.js` | `--token <symbol>`, `--input <path>`, `--output <path>`, `--mode <mode>`, `--tz <zone>`, `--list-valid-timezones`, `--backfill-highest`, `--backfill-lowest`, `--verbose`, `--version`, `--help` | crypto-price-filler's command line: fills the price columns of a CSV file of dated rows with the token's USD price at each row's time, from the pools a token trades in, then MEXC, CoinGecko and CoinPaprika; a row no service priced gets `Error`. In `fetch-from-centralized-exchange/crypto-price-filler/`, as `npm start` runs it. | `node index.js --token=grc --input=mining.csv` |
| `node backfill.js` | `--input <path>`, `--output <path>`, `--backfill-highest`, `--backfill-lowest`, `--verbose`, `--version`, `--help` | crypto-price-filler's backfill: fills each row the filler left without a price, in a CSV it wrote, with the price of the nearest priced row before or after it, the higher of the two or the lower, asking no service. In `fetch-from-centralized-exchange/crypto-price-filler/`; from another folder, give the file's path. `--input` and `--output` are read from the folder it runs in. | `node backfill.js --input=output.csv --backfill-highest` |
| `source ./unlock-api-keys.sh` | — | Asks for the key store's password, showing nothing typed, checks that it opens every key saved, and keeps it in `API_KEYS_PASSWORD` for the terminal, so the programs open their keys without asking. Runs in bash or zsh. | `source ./unlock-api-keys.sh` |

---

## See Also

This repo's bin, `github-project-deps`, the versions tool, is no command
of this repo: the projects that install this repo (pulsechain-analytics,
pulsechain-validator-analytics and x1-validator-analytics) run it, as
`npm run github-project-deps -- main` or `-- release`. Its bin `summ-csv`
is the command above, for a project that installs this repo, and its bin
`run-actionlint` is the actionlint of `lint` above, which each of those
projects' lint runs on its workflow files.
The gates are those of LP Ranger, the owner's bot that manages his 9mm V3
liquidity positions, whose merge protocol the last link below gives.

- [Which version they install](architecture.md#which-version-they-install)
  — what that bin does.
- [`docs/engineering.md`](engineering.md) — the gates, the tests and CI,
  the checks GitHub Actions runs at each push.
- [`docs/architecture.md`](architecture.md) — how the parts fit.
- [LP Ranger's `docs/claude/CLAUDE-CI.md`](https://github.com/nottoseethesun/lp-ranger/blob/main/docs/claude/CLAUDE-CI.md)
  — the merge protocol these gates feed.
