# crypto-price-fetchers — `npm` Project Commands

Every npm command of crypto-price-fetchers, the owner's repo of code his
projects share: those its top `package.json` defines, which run from the
repo's top folder, and those of crypto-price-filler, its Node tool that
fills a CSV's price columns, which has a package of its own; with what
each does and what to type.

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
- [See Also](#see-also)

---

## Passing Flags

Run with `npm run <name>`; `test` also works without `run`. Flags go after
a `--` separator, which tells npm the rest belongs to the script; a word
with no dashes, such as `apps-script`, needs none. These three commands
replace the saved DexTools key ([Api Keys](#api-keys)), run the tests
whose names hold `unlockApiKeys` ([Test](#test)), and give the Sheets
scripts as one file, with their keys ([Build](#build)):

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
| `api-keys` | `set <service>`, `check-password`, `--help` | The key manager. Lists each key the top `config.json` names, saved or not, never showing a key's characters, and asks for each one not saved: the key, then the password. Each key is saved, encrypted, once its service takes it. `set <service>` replaces one key. `check-password` says, by its exit code, whether the password in `API_KEYS_PASSWORD` opens every key saved; `unlock-api-keys.sh` runs it. | `npm run api-keys` · `npm run api-keys -- set coingecko` |

`source ./unlock-api-keys.sh`, a script in the repo's top folder and no npm
command, keeps the password for a terminal: see
[the key store's README](../api-key-store/README.md).

---

## Build

A spreadsheet runs the Sheets scripts from its Apps Script project, which
cannot read the key file and runs every script file in one global scope,
so the scripts are pasted as one file, with the keys written in. One
command gives that file.

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `build` | `apps-script`, `--help` | `apps-script` first asks whether to include DEX Screener's Google Sheets functions (Enter or y includes them, n leaves them out), naming the commit of DEX Screener's repo they come from, and saying that the step is optional and that a build that fails should be run again with n. On a yes, it checks that those files are the ones this repo pinned: it downloads each and compares its SHA-256 with the one written in the repo, the check `audit:dex-screener` runs on its own; then it prints the result and compiles the files it checked. Then it opens the saved keys, as the programs do, and joins the menu, every Sheets script and DEX Screener's functions into one file, with the keys, the values of the config.json each Node version reads, and the Help page set at its end. It puts the file on the clipboard, says how to paste it, waits for Enter, and clears the clipboard. With no clipboard tool installed, it offers to install one (`sudo apt install xclip`, or `wl-clipboard` on Wayland); declined, it warns that the keys go to disk in the clear, then writes the file to `build/apps-script/crypto-price-fetchers.gs`, readable by the owner alone. It takes no other argument; `--help` gives its exit codes. | `npm run build apps-script` |

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
| `format` | — | Prettier's write pass over every JavaScript, Sheets script, JSON and YAML file. | `npm run format` |
| `knip:files` | — | The dead-code check: fails on any file nothing reaches. `lint` runs it. | `npm run knip:files` |
| `lint` | — | The linters: ESLint, markdownlint, Prettier in check mode, actionlint, and knip's unused files. husky, the package that runs scripts at git's hooks, runs it before each commit. | `npm run lint` |
| `lint:fix` | — | ESLint and markdownlint with their fixes, then `format`. | `npm run lint:fix` |

---

## Test

These commands run the gates: the tests and the audits. `check` runs all of
them, after the lint, and must pass before a commit and a push.

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `audit:deps` | — | `npm audit` at the `high` threshold over the packages that ship (`--omit=dev`), the repo's and crypto-price-filler's, then `audit:dex-screener`. | `npm run audit:deps` |
| `audit:dex-screener` | `--help` | Downloads each file of DEX Screener's Google Sheets functions at the commit the build step uses, and fails when one cannot be downloaded or its SHA-256 differs from the one the build checks; npm audit does not cover that code. `audit:deps` runs it. | `npm run audit:dex-screener` |
| `audit:secrets` | — | secretlint across the repo. | `npm run audit:secrets` |
| `audit:security` | — | The security lint, `eslint-security.config.js`: eslint-plugin-security, eslint-plugin-no-secrets and `no-secret-logging`. | `npm run audit:security` |
| `check` | — | The full gate: `lint`, `test:coverage`, `test:filler`, `audit:deps` (with `audit:dex-screener`), `audit:security` and `audit:secrets`, in that order, stopping at the first that fails. | `npm run check` |
| `format:check` | — | Prettier in check mode; fails rather than rewriting. | `npm run format:check` |
| `test` | any `node --test` flag | The tests of the runner, the Node versions, the build step, the menu, the price clients, the key store, the lint rule, the versions tool and the Summ CSV writer, on Node's test runner. | `npm test -- --test-name-pattern="openAppsScript"` |
| `test:coverage` | — | The same tests with coverage, failing below 80% of lines covered. | `npm run test:coverage` |
| `test:filler` | — | crypto-price-filler's `test:strict`, from the top folder. | `npm run test:filler` |

---

## Commands That Are Usually Not Run Alone

npm runs this command itself, before another one.

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `prelint` | — | Runs before `lint`; installs the husky hooks, so the pre-commit hook is in place once `lint` or `check` has run. It is here rather than in `prepare` because npm runs a git dependency's `prepare`, after installing its development packages, in every project that installs this repo from GitHub. | automatic |

---

## crypto-price-filler's Commands

crypto-price-filler is a package of its own, with its own commands. They
run in `fetch-from-centralized-exchange/crypto-price-filler/`, after
`npm ci` there. Its lint is the top folder's.

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `clean` | — | Remove the files a test run can leave: `tests/mock-filled*.csv`, `test.log`, `test.html`. | `npm run clean` |
| `start` | the tool's options; `--help` | Run the tool: read a CSV, fill its price columns, write the output. See its README. | `npm start -- --token=xtm --input=in.csv --output=out.csv` |
| `test` | — | vitest with coverage, quietly. | `npm test` |
| `test:ci` | — | vitest with coverage and no cache. | `npm run test:ci` |
| `test:debug` | — | vitest with `VERBOSE=1`, the verbose reporter, coverage and no cache. | `npm run test:debug` |
| `test:strict` | — | `validate-parse`, then the tests with coverage, failing below 80% of lines covered. What `npm run check` runs. | `npm run test:strict` |
| `test:watch` | — | vitest in watch mode, with coverage. | `npm run test:watch` |
| `validate-parse` | — | Loads `index.js` with `--help`, so a broken import fails before the tests run. | `npm run validate-parse` |

---

## See Also

This repo's bin, `github-project-deps`, the versions tool, is no command
of this repo: the projects that install this repo (pulsechain-analytics,
pulsechain-validator-analytics and x1-validator-analytics) run it, as
`npm run github-project-deps -- main` or `-- release`. Its other bin,
`summ-csv`, is the command above, for a project that installs this repo.
The gates are those of LP Ranger, the owner's bot that manages his 9mm V3
liquidity positions, whose merge protocol the last link below gives.

- [Which version they install](architecture.md#which-version-they-install)
  — what that bin does.
- [`docs/engineering.md`](engineering.md) — the gates, the tests and CI.
- [`docs/architecture.md`](architecture.md) — how the parts fit.
- [LP Ranger's `docs/claude/CLAUDE-CI.md`](https://github.com/nottoseethesun/lp-ranger/blob/main/docs/claude/CLAUDE-CI.md)
  — the merge protocol these gates feed.
