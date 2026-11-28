# crypto-price-fetchers — notes for Claude

The rules an agent follows in this repo, each with a link to the doc that
holds the facts it rests on. This file states no fact a doc holds
([One Home for Each Fact](docs/claude/CLAUDE-DOC-AUDIT.md#one-home-for-each-fact)):
read the doc a rule links before acting on it. The repo's parts this file
names, such as the runner, the Node versions and the exchange script, are
introduced in [The Parts](docs/architecture.md#the-parts), and the basic
tools and terms in [docs/glossary.md](docs/glossary.md).

## Where the Facts Are

| Topic | Its home |
| --- | --- |
| What each tool does for its user: install, run, configure | [README.md](README.md), and each tool's README: [crypto-price-fetchers/](crypto-price-fetchers/README.md), [fetch-from-any-exchange/](fetch-from-any-exchange/README.md), [crypto-price-filler](fetch-from-any-exchange/crypto-price-filler/README.md), [api-key-store/](api-key-store/README.md), [summ-csv/](summ-csv/README.md) |
| How the parts work and fit | [docs/architecture.md](docs/architecture.md) |
| Which price each tool gives, and in what order it asks its sources | [docs/price-determination-rules.md](docs/price-determination-rules.md) |
| The files, the programs in `bin/`, the gate, the tests and CI | [docs/engineering.md](docs/engineering.md) |
| Every command, with its flags and an example | [docs/project-commands.md](docs/project-commands.md) |
| The basic tools and terms | [docs/glossary.md](docs/glossary.md) |
| The documentation audit | [docs/claude/CLAUDE-DOC-AUDIT.md](docs/claude/CLAUDE-DOC-AUDIT.md) |

## Conventions

- Follow LP Ranger's coding standards: its `CLAUDE.md` and everything
  under `docs/claude/`, in
  [nottoseethesun/lp-ranger](https://github.com/nottoseethesun/lp-ranger)
  or the local clone at `~/code/lp-ranger-project/lp-ranger/`. Read them,
  and never change anything in LP Ranger.
- Work in this repo, never in a copy of it. Code written to check
  something goes into the tests, so that later sessions reuse it.
- The Sheets scripts change only here. The build step joins them into one
  file, in which every file shares one global scope, so no two files
  declare one top-level name; the lint reads each file alone, so a name
  one file uses from another is declared in a `/* global */` comment
  ([The Sheets Scripts](docs/architecture.md#the-sheets-scripts),
  [The Build Step](docs/architecture.md#the-build-step)).
- A Node version runs its Sheets script unchanged, through the runner,
  and never copies its logic, so a fix goes in the `.gs`, where it fixes
  both ([The Node Versions](docs/architecture.md#the-node-versions)).
  crypto-price-filler keeps no price source of its own for MEXC,
  CoinGecko or CoinPaprika, and orders all its sources with the exchange
  script's own rule, `sourcesInPriority`
  ([crypto-price-filler](docs/architecture.md#crypto-price-filler)).
- Code that more than one part or repo uses lives once, and the projects
  that install this repo import it and keep no copy: the helpers in
  `lib/`, the price clients in `dex-prices/`, the key store, the runner,
  the Summ CSV writer, the lint rules and `github-project-deps`, save
  `bin/unlock-api-keys.sh`, of which each keeps a copy that its tests hold
  to this one ([Projects That Use This One](docs/architecture.md#projects-that-use-this-one)).
- The programs a reader runs from a terminal are in `bin/`, and those
  only an end user normally runs are in `bin/end-user/` (the owner's
  rule). A tool reads the owner's own files from its `input/` folder and
  writes its results in its `output/` folder, a folder for each kind of
  file; a test names its own files, in temp folders, and never writes in
  those folders ([Files on Disk](docs/engineering.md#files-on-disk)).
- No README names `bin/unlock-api-keys.sh` (the owner's rule):
  [docs/engineering.md](docs/engineering.md#unlock-api-keyssh) describes
  it, once.

## Keys

- **Never show any character of an api key once it is entered**: not in a
  reply, a log line, an error message, a test's output, or a listing.
- No api key is committed: the keys live in `api-keys.json`, encrypted,
  which git ignores ([The Key Store](docs/architecture.md#the-key-store)).
- A test names a key file of its own, never the owner's, and never passes
  on the terminal's `API_KEYS_PASSWORD`, the variable that holds the key
  store's password ([unlock-api-keys.sh](docs/engineering.md#unlock-api-keyssh),
  [Tests](docs/engineering.md#tests)).
- A name the security lint's `no-secret-logging` refuses because it
  sounds like a secret, but that holds none, is renamed, never excused
  ([Security Audits](docs/engineering.md#security-audits)).
- Where more than one service with a key can do one job, the code asks
  them in the owner's order of priority, through the exchange script's
  `sourcesInPriority`, which is written once
  ([The Order of the Sheet's Sources](docs/price-determination-rules.md#the-order-of-the-sheets-sources),
  [The Order of the Filler's Sources](docs/price-determination-rules.md#the-order-of-the-fillers-sources)).

## Summ Csv Files

- **Every csv file for Summ is written by `summ-csv/`**, through
  `npm run summ-csv`, the bin `summ-csv`, or `writeSummCsv`, never by a
  script written for the occasion (the owner's rule;
  [summ-csv/README.md](summ-csv/README.md)).
- This public repo holds no address of the owner's.

## Settings Files

- A tool checks each settings file against its JSON Schema before it takes
  any setting: an object of settings refuses a key its schema does not
  name, a value of the wrong kind is refused, never corrected, and every
  problem is listed at once
  ([Settings Files](docs/architecture.md#settings-files)).
- A key is added to a schema only with the owner's go-ahead.
- Each kind of `config.json` ships with a `config-example.json` beside
  it, which git keeps.

## DEX Screener's Functions

- None of DEX Screener's code is ever committed here: its repo carries no
  license ([The Build Step](docs/architecture.md#the-build-step)).
- zod and lodash ship in the built file, so `package.json` lists them as
  dependencies, never as development packages
  ([Packages That Ship in the Built File](docs/engineering.md#packages-that-ship-in-the-built-file)).

## Docs

- A change keeps every text true, in the same change: the docs, a help, a
  doc block, a test title.
- Each fact has one home, and other texts link to it. A basic tool or term
  is introduced only in [docs/glossary.md](docs/glossary.md), save in a
  text a user sees apart from the docs, such as a command line's help or
  the Sheets help page, which introduces what its reader needs in a few
  words ([Where an Introduction Appears](docs/claude/CLAUDE-DOC-AUDIT.md#where-an-introduction-appears),
  [One Home for Each Fact](docs/claude/CLAUDE-DOC-AUDIT.md#one-home-for-each-fact)).
- Every text meets the documentation audit's standard, and an audit is led
  by the code ([docs/claude/CLAUDE-DOC-AUDIT.md](docs/claude/CLAUDE-DOC-AUDIT.md)).
- This file holds rules and links, and no fact a doc holds.

## Command Lines

- Every command line answers `--help` and `-h` with each option and
  argument, examples of its common uses and its exit codes. Each one in JavaScript
  is declared with commander, with the examples and exit codes in
  `addHelpText("after", …)`; `bin/unlock-api-keys.sh`, the one a shell
  sources, holds its help itself
  ([Command-Line Help](docs/claude/CLAUDE-DOC-AUDIT.md#3-command-line-help-and-the-command-list)).
- Each entry point calls `endQuietlyWhenOutputCloses`
  (`lib/closed-output.js`) before it starts. A value a command line takes
  is checked as commander parses it, with `InvalidArgumentError`, so a
  mistake names its option before anything runs; `lib/calendar-day.js`
  checks a day and `lib/http-url.js` an http or https url, for every repo. A
  command line that takes its defaults from a settings file makes its
  options' parsers from that file's schema, and refuses a typed option
  that conflicts with the file with `checkConflicts`
  (`lib/option-conflicts.js`), since commander refuses two conflicting
  options only when both are typed
  ([The Parts](docs/architecture.md#the-parts),
  [Settings Files](docs/architecture.md#settings-files)).
- [docs/project-commands.md](docs/project-commands.md) lists every npm
  target and every command line run with `node` or `source`, each with
  its flags and an example. LP Ranger's rules do not yet ask for the
  examples; this repo does.

## Gates and CI

- `npm run check` is the one gate. It must pass before a commit and a push
  ([The Gate](docs/engineering.md#the-gate-npm-run-check)).
- `package.json` has no `prepare`, `install` or `postinstall` script
  ([What Installing It Runs](docs/architecture.md#what-installing-it-runs)).
- actionlint runs only from its author's release, pinned by SHA-256, never
  from an npm package that wraps it
  ([run-actionlint.js](docs/engineering.md#run-actionlintjs)).
- A default is written with `??` or an explicit check, never with `||`
  (`eslint-rules/no-or-default.js`; [Lint](docs/engineering.md#lint)).
- `main` is protected, and a change reaches it by LP Ranger's eight steps
  in its `docs/claude/CLAUDE-CI.md`
  ([CI and Branch Protection](docs/engineering.md#ci-and-branch-protection)).
- The repo supports two major versions of Node, the newest LTS and the one
  two majors before it, and every tool, test and npm target runs on both.
  CI's two checks are named for their roles, never for their versions;
  `engines` names only the oldest major as a minimum; no file pins one
  exact version of Node
  ([CI and Branch Protection](docs/engineering.md#ci-and-branch-protection)).

## Tests

- No test asks an outside service: a script's requests go to a stand-in
  fetch or a stand-in server ([Tests](docs/engineering.md#tests)).
- The automated tests use only programs every computer they run on has;
  the zsh tests of `bin/unlock-api-keys.sh` are a step run by hand (the
  owner's rule; [unlock-api-keys.sh](docs/engineering.md#unlock-api-keyssh)).
- [docs/engineering.md](docs/engineering.md#test-files) names every test
  file and helper, which the repo checks hold it to.

A new clone installs both packages, by the two `npm ci` lines of
[Quick Start](docs/engineering.md#quick-start), and runs the gate,
`npm run check`, which needs no saved key
([Tests](docs/engineering.md#tests)).

## Known Bugs

None is known. A bug found in committed code gets a test in
crypto-price-filler's `tests/known-bugs.test.js`, declared with `it.fails`,
so it passes while the bug is present, and a row here, in a table of the
bug and its test's name. The test goes in a commit of its own, before the
fix's ([Significant and Minor Findings](docs/claude/CLAUDE-DOC-AUDIT.md#6-significant-and-minor-findings)).
Its fix makes that test fail; the same change
declares the test with `it`, moves it to the regression tests of its area
([Known Bugs](docs/engineering.md#known-bugs) lists them, and
[Test Files](docs/engineering.md#test-files) gives each one's area), and
removes the row. The known-bug file and the table go with the last test
and row, since vitest fails a test file that holds no test. A bug found in
work not yet committed is fixed in that work, with an ordinary test.
