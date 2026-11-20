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
  - [How the Sheets Scripts (`.gs`) Are Tested](#how-the-sheets-scripts-gs-are-tested)
    - [The Node Tests](#the-node-tests)
    - [The Apps Script Tests](#the-apps-script-tests)
- [Security Audits](#security-audits)
- [Dead Code Detection](#dead-code-detection)
- [CI and Branch Protection](#ci-and-branch-protection)
- [Known Bugs](#known-bugs)

---

## Quick Start

A working copy needs Node 22 or later, the packages of the repo and of
crypto-price-filler, and the api keys. From the repo's top folder:

```bash
npm ci
npm ci --prefix fetch-from-centralized-exchange/crypto-price-filler
npm run api-keys            # save the api keys, once
npm run check               # the gate
npm run build apps-script   # the Sheets scripts with their keys, for Apps Script
```

---

## Files on Disk

The programs and their tests read and write these files. Git keeps only
the ones that hold no key and none of the owner's own settings.

| File | In git | What it holds |
| ---- | ------ | ------------- |
| `config.json` | yes | The services whose keys the programs send, under `apiKeys`. No key. |
| `api-keys.json` | no | The keys, each encrypted with the owner's password (see [the key store](architecture.md#the-key-store)). `api-keys.json.tmp` is the file it is written through. `API_KEYS_FILE_PATH` names another, as the tests do. |
| `config.json` beside a Node version | no | Values laid over the script's config objects. `crypto-price-fetchers.js` and the exchange script read one when it is there. |
| `summ-csv/settings.json` | yes | The Summ CSV writer's facts of each chain, by Summ's name for it (its own coin, the forms of its hashes and addresses), and the fiat currencies a reference price may be in. |
| `crypto-price-filler/config-example.json` | yes | The filler's settings. |
| `crypto-price-filler/config.json` | no | The owner's settings, laid over `config-example.json`. |
| `build/apps-script/` | no | The Sheets scripts as `npm run build apps-script` writes them when the owner declines a clipboard tool: they hold the api keys in the clear, readable by the owner alone. |
| `coverage/` | no | A test run's coverage report. |

---

## The Gate: `npm run check`

`npm run check` runs every gate, in order, and stops at the first that
fails: the lint, the tests with coverage, crypto-price-filler's tests with
coverage, then the three security audits. It must pass before every commit
and push, and CI runs it on Node 22 and Node 24.

---

## Lint

The lint checks each file's form before any test runs: the rules the code
follows, its formatting, the workflows, and files nothing uses.
`npm run lint` runs five tools:

| Tool | Configured in | What it holds the repo to |
| ---- | ------------- | ------------------------- |
| ESLint | `eslint.config.js` | LP Ranger's rules, with no warning allowed: cyclomatic complexity ≤ 17, ≤ 500 lines of code a file (blank lines and comments not counted), lines ≤ 80 characters but strings, urls and comments, `===`, no unused name, no `var`, `const` where nothing is reassigned, no `Math.random`, no comment that tells Prettier to skip code, and every import resolved. It reads the Sheets scripts too, as the paragraph below the table says. |
| markdownlint | `.markdownlint-cli2.jsonc` | LP Ranger's settings, over every Markdown file. |
| Prettier | `.prettierrc`, `.prettierignore` | Its formatting, in check mode, over every JavaScript, Sheets script, JSON and YAML file. |
| actionlint | — | The GitHub workflows. |
| knip | `knip.json` | No file nothing reaches. See [Dead Code Detection](#dead-code-detection). |

The Sheets scripts are plain scripts, not modules: Apps Script loads them
without imports, with its services as globals. ESLint reads them the same
way, and two settings follow from that. A name that one file of the
exchange script uses from another is declared in a `/* global */` comment,
since no import says where it comes from. And `no-unused-vars` passes a
script's top-level functions, since a cell or another file calls them, out
of ESLint's sight. The security lint reads the Sheets scripts too.

The husky pre-commit hook (`.husky/pre-commit`) runs `npm run lint`, so an
unformatted or failing file stops the commit; `npm run format` or
`npm run lint:fix` fixes formatting. No rule is ever switched off in a file,
no file is left out of the lint, and a file over 500 lines is split, not
excused.

---

## Tests

Two test suites run in `npm run check`: the top folder's, on Node's own
test runner, and crypto-price-filler's, on vitest. Neither asks a service
outside the computer, and neither reads the owner's key file or password.

**The top folder's tests** (`test/`, Node's test runner) cover the runner,
the Node versions, the build step, the price clients (`dex-prices/`), the
key store, `no-secret-logging`, the versions tool
(`github-project-deps/`), the Summ CSV writer (`summ-csv/`) and the shared
helpers (`lib/`). The scripts' and the clients' requests
go to a stand-in fetch or a stand-in server on the computer
(`test/helpers/stand-in-web.js`; `test/helpers/gecko-terminal-stand-in.js`
answers as GeckoTerminal does). The build step's tests stand in for the
clipboard, the install and the questions. The versions tool's tests run
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
file of its own in `API_KEYS_FILE_PATH`. `unlock-api-keys.sh` is tested in
bash, and in zsh where zsh is installed. `npm run test:coverage` fails below
80% of lines covered.

**crypto-price-filler's tests** (`tests/`, vitest) cover the tool, its
sources and its command line, and run the exchange script unchanged under
Node: its price sources in `sheets-sources.test.js`, which carries what
each source must do for both tools. Its `vitest.config.js` names a key file
that does not exist and empties `API_KEYS_PASSWORD`, so no test finds the
owner's key, and fails a coverage run below 80% of lines. `tests/helpers/`
holds the stand-ins:

- `sheets-script.js` runs a Sheets script, one file or several, in the
  test's thread with the runner's services; its `UrlFetchApp` answers from
  a function the test gives, with any status, and the script's config is
  set as its Node version sets it.
- `stand-in-fetch.js` is a stand-in fetch for the tool's own sources: the
  exchange sources, whose Sheets script then runs for real in the runner's
  worker, and the pool sources, whose shared clients then ask it.
- `stand-in-fetch-preload.js` runs the real command line, `index.js`, in a
  child process against a stand-in MEXC, and a stand-in CoinGecko ping that
  takes the one key in `stand-in-coingecko-key.js`.

Code written to check something goes into the tests, so it is kept and run
again rather than written again.

### How the Sheets Scripts (`.gs`) Are Tested

The repo has two Sheets scripts. A Sheets script is Google Apps Script:
JavaScript that runs on Google's servers, inside a spreadsheet, where a
cell calls one of its functions. `crypto-price-fetchers.gs` is one file.
The exchange script is three: `getCryptoPriceFromCentralizedExchange.gs`,
its price sources in `-sources.gs`, and its tests in `-tests.gs`.

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
   Script's order, in one `vm` context (`load-apps-script.js`).
3. **Waiting for a web request.** In Apps Script, `UrlFetchApp.fetch` holds
   the script until the response arrives, then returns it. In Node, `fetch`
   returns a promise at once, and the response comes only after the running
   code has finished and Node's event loop has run. A script's code cannot
   finish without its response. So if the script ran on Node's main
   thread, the response could never arrive. The runner therefore runs the
   script in a worker thread. For each request, the worker hands the
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
| `test/crypto-price-fetchers.test.js`, `test/get-crypto-price-from-centralized-exchange.test.js` | Through its Node version, in the worker thread. Each request goes to `standInFetch` (`test/helpers/stand-in-web.js`), which answers as DexTools, x1.ninja, MEXC or CoinGecko does. | What each Sheets function returns, as its cell would show it, and the Node versions' command lines. |
| `test/run-apps-script.test.js` | A small script, `test/fixtures/runner-check.gs`, in the worker thread. Its requests go through Node's own `fetch` to a web server on this computer. | The hand-off between the threads: the worker waits, the main thread does the request, and each response reaches the request it answers. |
| crypto-price-filler's `tests/sheets-sources.test.js`, `tests/regressions.test.js`, `tests/xtm-coingecko-id.test.js` | In the test's own thread (`tests/helpers/sheets-script.js`). `UrlFetchApp.fetch` answers at once from a function the test gives, so nothing waits. | What each price source gives, the cases the regression tests cover, and that no file of the exchange script holds a CoinGecko api key. |
| crypto-price-filler's `tests/regressions.test.js`, `tests/xtm-coingecko-id.test.js`, through the tool | Through the exchange script's Node version, in the worker thread, as the tool runs it (`tests/helpers/stand-in-fetch.js`). | The same cases, reached through the tool's provider chain. |
| `test/load-apps-script.test.js`, `test/apps-script-services.test.js` | Small scripts in `test/fixtures/`, in the test's own thread, with requests answered at once. | That a script's files load into one scope, in order, and that each Node service acts as Apps Script's does. |

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
floor. The test functions inside `crypto-price-fetchers.gs` never run under
Node, so their lines count as not covered. No Node test loads `-tests.gs`,
so it is not in the report. crypto-price-filler's coverage, from vitest,
does not count the `.gs` files.

#### The Apps Script Tests

The Apps Script tests run on Google's servers, through Apps Script's real
services, and ask the real price services. So they need a network, and the
api keys the scripts read. The owner runs each one by hand, from the Run
button in the Apps Script editor, and reads its results in the editor's
log. No automated run calls them.

- **`crypto-price-fetchers.gs`** holds its own. `testDexToolsFunctions`
  asks for the prices and fully diluted values of a few tokens on
  PulseChain, Ethereum and X1, and logs each result. `testDexToolsVerbose`
  runs it with the lock attempts, the raw responses and the cache's state
  logged too.
- **The exchange script's** are in its third file,
  `getCryptoPriceFromCentralizedExchange-tests.gs`. The owner pastes it
  into the same Apps Script project as the other two files; the sheet
  needs it for nothing else. `test` runs the file's two tests:
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

Three audits look for security problems: in the packages the repo
installs, in the code, and in the text of every file.

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
| `ci.yml` | Check (Node 22), Check (Node 24) | `npm run check`, after installing the repo's packages and crypto-price-filler's. |
| `security-audit.yml` | Dependency Audit, Security Lint, Secret Scan | Each audit as a job of its own. |

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
it with `it` and moves it to `tests/regressions.test.js`, where it keeps
the fixed behavior from coming back. None is known today.
