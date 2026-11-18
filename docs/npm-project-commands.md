# crypto-price-fetchers — `npm` Project Commands

Every command defined in `package.json`, and in crypto-price-filler's, what
it does, and what to type.

Companion to [`docs/engineering.md`](engineering.md), which covers how the
gates work. This file covers how to drive them.

---

## Table of Contents

- [Passing Flags](#passing-flags)
- [Api Keys](#api-keys)
- [Developer Tools](#developer-tools)
- [Test](#test)
- [Commands That Are Usually Not Run Alone](#commands-that-are-usually-not-run-alone)
- [crypto-price-filler's Commands](#crypto-price-fillers-commands)
- [See Also](#see-also)

---

## Passing Flags

Run with `npm run <name>`; `test` also works without `run`. Flags go after
a `--` separator, which tells npm the rest belongs to the script:

```sh
npm run api-keys -- set dextools
npm test -- --test-name-pattern="unlockApiKeys"
```

---

## Api Keys

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `api-keys` | `set <service>`, `check-password`, `--help` | The key manager. Lists each key the top `config.json` names, saved or not, never showing a key's characters, and asks for each one not saved: the key, then the password. Each key is saved, encrypted, once its service takes it. `set <service>` replaces one key. `check-password` says, by its exit code, whether the password in `API_KEYS_PASSWORD` opens every key saved; `unlock-api-keys.sh` runs it. | `npm run api-keys` · `npm run api-keys -- set coingecko` |

`source ./unlock-api-keys.sh`, which is no npm command, keeps the password
for a terminal: see [the key store's README](../api-key-store/README.md).

---

## Developer Tools

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `format` | — | Prettier's write pass over every JavaScript, Sheets script, JSON and YAML file. | `npm run format` |
| `knip:files` | — | The dead-code check: fails on any file nothing reaches. `lint` runs it. | `npm run knip:files` |
| `lint` | — | The linters: ESLint, markdownlint, Prettier in check mode, actionlint, and knip's unused files. The husky pre-commit hook runs it. | `npm run lint` |
| `lint:fix` | — | ESLint and markdownlint with their fixes, then `format`. | `npm run lint:fix` |

---

## Test

The gates. `check` runs all of them and is what must pass before a commit
and a push.

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `audit:deps` | — | `npm audit` at the `high` threshold over the packages that ship (`--omit=dev`), the repo's and crypto-price-filler's. | `npm run audit:deps` |
| `audit:secrets` | — | secretlint across the repo. | `npm run audit:secrets` |
| `audit:security` | — | The security lint, `eslint-security.config.js`: eslint-plugin-security, eslint-plugin-no-secrets and `no-secret-logging`. | `npm run audit:security` |
| `check` | — | The full gate: `lint`, `test:coverage`, `test:filler` and the three audits, in that order, stopping at the first that fails. | `npm run check` |
| `format:check` | — | Prettier in check mode; fails rather than rewriting. | `npm run format:check` |
| `test` | any `node --test` flag | The tests of the runner, the Node versions, the key store and the lint rule, on Node's test runner. | `npm test -- --test-name-pattern="openAppsScript"` |
| `test:coverage` | — | The same tests with coverage, failing below 80% of lines covered. | `npm run test:coverage` |
| `test:filler` | — | crypto-price-filler's `test:strict`, from the top folder. | `npm run test:filler` |

---

## Commands That Are Usually Not Run Alone

| Command | Flags | Description | Example |
| ------- | ----- | ----------- | ------- |
| `prelint` | — | Runs before `lint`; installs the husky hooks, so the pre-commit hook is in place once `lint` or `check` has run. It is here rather than in `prepare` because npm runs a git dependency's `prepare`, after installing its development packages, in every project that installs this repo from GitHub. | automatic |

---

## crypto-price-filler's Commands

Run in `fetch-from-centralized-exchange/crypto-price-filler/`, after
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

- [`docs/engineering.md`](engineering.md) — the gates, the tests and CI.
- [`docs/architecture.md`](architecture.md) — how the parts fit.
- [LP Ranger's `docs/claude/CLAUDE-CI.md`](https://github.com/nottoseethesun/lp-ranger/blob/main/docs/claude/CLAUDE-CI.md)
  — the merge protocol these gates feed.
