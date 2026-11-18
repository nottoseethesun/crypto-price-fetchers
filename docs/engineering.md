# crypto-price-fetchers — Engineering Reference

The files the programs read and write, the gates every change passes, the
tests, and CI. For how the parts fit, see
[`docs/architecture.md`](architecture.md); for every npm command, see
[`docs/npm-project-commands.md`](npm-project-commands.md).

The repo follows LP Ranger's coding standards: its `CLAUDE.md` and
`docs/claude/`, in
[nottoseethesun/lp-ranger](https://github.com/nottoseethesun/lp-ranger).

---

## Table of Contents

- [Quick Start](#quick-start)
- [Files on Disk](#files-on-disk)
- [The Gate: `npm run check`](#the-gate-npm-run-check)
- [Lint](#lint)
- [Tests](#tests)
- [Security Audits](#security-audits)
- [Dead Code Detection](#dead-code-detection)
- [CI and Branch Protection](#ci-and-branch-protection)
- [Known Bugs](#known-bugs)

---

## Quick Start

Node 22 or later. From the repo's top folder:

```bash
npm ci
npm ci --prefix fetch-from-centralized-exchange/crypto-price-filler
npm run api-keys     # save the api keys, once
npm run check        # the gate
```

---

## Files on Disk

| File | In git | What it holds |
| ---- | ------ | ------------- |
| `config.json` | yes | The services whose keys the programs send, under `apiKeys`. No key. |
| `api-keys.json` | no | The keys, each encrypted with the owner's password (see [the key store](architecture.md#the-key-store)). `api-keys.json.tmp` is the file it is written through. `API_KEYS_FILE_PATH` names another, as the tests do. |
| `config.json` beside a Node version | no | Values laid over the script's config objects. `crypto-price-fetchers.js` and the exchange script read one when it is there. |
| `crypto-price-filler/config-example.json` | yes | The filler's settings. |
| `crypto-price-filler/config.json` | no | The owner's settings, laid over `config-example.json`. |
| `coverage/` | no | A test run's coverage report. |

---

## The Gate: `npm run check`

`npm run check` runs every gate, in order, and stops at the first that
fails: the lint, the tests with coverage, crypto-price-filler's tests with
coverage, then the three security audits. It must pass before every commit
and push, and CI runs it on Node 22 and Node 24.

---

## Lint

`npm run lint` runs:

| Tool | Configured in | What it holds the repo to |
| ---- | ------------- | ------------------------- |
| ESLint | `eslint.config.js` | LP Ranger's rules, with no warning allowed: cyclomatic complexity ≤ 17, ≤ 500 lines of code a file (blank lines and comments not counted), lines ≤ 80 characters but strings, urls and comments, `===`, no unused name, no `var`, `const` where nothing is reassigned, no `Math.random`, no comment that tells Prettier to skip code, and every import resolved. The Sheets scripts are linted as the plain scripts Apps Script loads, with its services as globals. |
| markdownlint | `.markdownlint-cli2.jsonc` | LP Ranger's settings, over every Markdown file. |
| Prettier | `.prettierrc`, `.prettierignore` | Its formatting, in check mode, over every JavaScript, Sheets script, JSON and YAML file. |
| actionlint | — | The GitHub workflows. |
| knip | `knip.json` | No file nothing reaches. See [Dead Code Detection](#dead-code-detection). |

The husky pre-commit hook (`.husky/pre-commit`) runs `npm run lint`, so an
unformatted or failing file stops the commit; `npm run format` or
`npm run lint:fix` fixes formatting. No rule is ever switched off in a file,
no file is left out of the lint, and a file over 500 lines is split, not
excused.

---

## Tests

The tests ask nothing outside the computer, and never read the owner's key
file or password.

**The top folder's tests** (`test/`, Node's test runner) cover the runner,
the Node versions, the key store and `no-secret-logging`. The scripts'
requests go to a stand-in fetch or a stand-in server on the computer
(`test/helpers/stand-in-web.js`). The key store's tests save keys in temp
folders of their own (`test/helpers/temp-folders.js`), removed when a test
file ends; `test/fixtures/lp-ranger-api-keys.json`, written by LP Ranger's
own code, checks that the store opens LP Ranger's files. A test that starts
a program gives it an environment without `API_KEYS_PASSWORD`, and a key
file of its own in `API_KEYS_FILE_PATH`. `unlock-api-keys.sh` is tested in
bash, and in zsh where zsh is installed. `npm run test:coverage` fails below
80% of lines covered.

**crypto-price-filler's tests** (`tests/`, vitest) cover the tool, its
sources and its command line, and run the Sheets script unchanged under
Node. Its `vitest.config.js` names a key file that does not exist and
empties `API_KEYS_PASSWORD`, so no test finds the owner's key, and fails a
coverage run below 80% of lines. `tests/helpers/` holds the stand-ins:

- `sheets-script.js` runs a Sheets script, one file or several, in the
  test's thread with the runner's services; its `UrlFetchApp` answers from
  a function the test gives.
- `fetch-with-retry.js` stands in for `fetchWithRetry`, the http layer of
  the price sources, and holds the hooks the getCryptoPrice tests share
  (`useFetchStandIn`).
- `stand-in-fetch-preload.js` runs the real command line, `index.js`, in a
  child process against a stand-in MEXC, and a stand-in CoinGecko ping that
  takes the one key in `stand-in-coingecko-key.js`.

Code written to check something goes into the tests, so it is kept and run
again rather than written again.

---

## Security Audits

| Command | What it runs | What it catches |
| ------- | ------------ | --------------- |
| `npm run audit:deps` | `npm audit --audit-level=high --omit=dev`, for the repo and crypto-price-filler | Known vulnerabilities, of high severity or worse, in the packages that ship. |
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

## Dead Code Detection

`npm run knip:files` fails on any file nothing reaches, as in LP Ranger.
`knip.json` names the entry points knip cannot find for itself: the command
lines, the worker the runner starts by its path, the filler's preload that
its tests start by its path, the security config and the tests. Unused
exports are not gated.

---

## CI and Branch Protection

Two workflows run on every push to `main`, every pull request to `main`, and
by hand:

| Workflow | Job | Runs |
| -------- | --- | ---- |
| `ci.yml` | Check (Node 22), Check (Node 24) | `npm run check`, after installing the repo's packages and crypto-price-filler's. |
| `security-audit.yml` | Dependency Audit, Security Lint, Secret Scan | Each audit as a job of its own. |

`main` is protected: a change reaches it only by a pull request whose five
checks, those five jobs, have passed. Force pushes and deletion are
refused. Merges are merge commits, never squashed, and no branch is
deleted. The steps from a branch to `main` are LP Ranger's eight, in its
`docs/claude/CLAUDE-CI.md`.

---

## Known Bugs

A bug found gets a test in crypto-price-filler's `tests/known-bugs.test.js`,
declared with `it.fails`, so it passes while the bug is present. Its fix
makes the test fail; the same change declares the test with `it` and moves
it to `tests/regressions.test.js`, which guards the fixed bugs.
