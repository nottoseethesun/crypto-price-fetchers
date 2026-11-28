# Glossary

The tools and terms that crypto-price-fetchers' docs and comments use
without introducing them: each is said once, here. A help, which a user
reads apart from the docs, introduces in a few words what its reader
needs. A part of this repo
of its own, such as crypto-price-filler, the key store or the build step,
is introduced in the doc that is its home, which
[The Parts](architecture.md#the-parts) lists.

## Table of Contents

- [Programs and Platforms](#programs-and-platforms)
- [Packages the Code Uses](#packages-the-code-uses)
- [Services the Tools Ask](#services-the-tools-ask)
- [Terms](#terms)

## Programs and Platforms

- **Node** (Node.js, NodeJS): an outside party's program that runs JavaScript outside a
  browser. Every tool here runs on it, on the two major versions
  [CI](engineering.md#ci-and-branch-protection) runs the gate on.
- **npm**: Node's package manager. It installs the packages
  `package.json` names, and runs the commands it names, each an npm
  target, as `npm run <target>`; `npm run check` is the gate.
  The field `engines` of a `package.json` names the versions of Node its
  package runs on.
  `package-lock.json`, the lockfile, records the exact version of each
  package npm installed. **npx**, npm's command that runs a package's
  program and may download it first, is never used here (LP Ranger's
  rule). **npm audit**: npm's check of the installed packages against the
  known vulnerabilities the **npm registry**, the service npm installs
  packages from, lists.
- **git**: an outside party's version-control program. A commit records a
  change, a branch is a line of commits, and a push sends commits to
  GitHub. A hook is a point at which git runs a script, such as before a
  commit.
- **GitHub**: the website that hosts the repo. A pull request asks to
  merge a branch into the main branch, `main`. **GitHub Actions** runs the
  repo's workflows, the files in `.github/workflows/`; CI is the one that
  runs the gate.
- **Google Sheets**: Google's spreadsheet app. **Apps Script**: Google's
  platform for scripts that run inside its apps. A spreadsheet's Apps
  Script project holds its scripts, and runs every script file of it in
  one global scope, as if the files were one. A **Sheets script** is a
  file of Apps Script in this repo, ending in `.gs`.
- **Homebrew**: a package manager of macOS and Linux. **apt**: the package
  manager of Debian and Ubuntu.
- **LTS** (long-term support): Node's name for the even-numbered major
  versions it keeps fixing longest, which a project is meant to run on.
- **A shell**: the program that reads the commands typed in a terminal.
  **bash** is the one most Linux computers come with; **zsh** is macOS's
  default, which other computers may lack.
- **curl**: an outside party's program that fetches an address.
- **actionlint**: rhysd's program that checks GitHub Actions' workflow
  files, published as one archive for each system. The lint runs its
  official release, never an npm package that wraps it
  ([run-actionlint.js](engineering.md#run-actionlintjs)).

## Packages the Code Uses

Each is an outside party's npm package.

- **commander**: parses command lines; each command line here in
  JavaScript is declared with it, so the options its help lists come from the declaration the
  program parses.
- **Ajv**, of the ajv-validator project: checks JSON against a JSON
  Schema ([Terms](#terms)).
- **esbuild**: compiles TypeScript and JavaScript into one file. **zod**:
  checks data against a schema. **lodash**: helper functions.
- **ESLint**: checks JavaScript against rules. **Prettier**: formats
  code. **markdownlint**: checks the form of Markdown files. **knip**:
  finds files nothing uses. **secretlint**: looks for keys and credentials in
  files. **husky**: runs scripts at git's hooks.
- **vitest**: a test runner, which crypto-price-filler's tests run on.
  The other tests run on Node's own test runner, `node --test`.

## Services the Tools Ask

- **MEXC**: a centralized exchange, a company that runs markets in which
  people trade coins, and publishes each market's candles.
- **CoinGecko** and **CoinPaprika**: services that gather the prices of
  many exchanges.
- **Moralis**, **GeckoTerminal**, **DexTools** and **DEX Screener**:
  services that price a token from the pools of decentralized exchanges.
- **x1.ninja**: a service that prices tokens on X1 from its pools.

## Terms

- **Api key**: the secret a service gives its customer, sent with each
  request. No character of one is ever shown.
- **JSON Schema**: a standard description, in JSON, of the keys a JSON
  file may hold and the kind of value each takes.
- **Http status**: the number that opens a service's answer to a web
  request and says how the request went: 200 when it went well, 429 when
  the service refuses it as one too many, and 500 or above when the
  service failed.
- **Candle**: one market's trades over one period, such as a minute, an
  hour or a day, summed up from its open time: the first price (open), the
  highest (high), the lowest (low), the last (close), and how much traded
  (volume).
- **UTC** (Coordinated Universal Time): the world's time standard, which
  keeps no daylight saving; a
  **UTC day** is a day as UTC counts it.
- **Decentralized exchange**: a set of contracts on a blockchain in which
  people swap one token for another, from its **pools**: each pool holds
  two tokens that people swap for each other, and has its own price.
- **SHA-256**: a function that gives a fingerprint of a file's contents,
  64 hexadecimal digits long, which any change to the file changes.
- **PulseChain**: a blockchain built from Ethereum's code, which runs
  Ethereum's virtual machine, an **EVM** chain. **X1**: a blockchain
  built from Solana's code.
- **EIP-55**: the form of an EVM chain's address in which the mix of
  capital and small letters is a checksum of it.
- **LP Ranger**: the owner's bot that manages his liquidity positions on
  **9mm**, a decentralized exchange on PulseChain; its rules are the
  coding standards of his projects.
- **Summ**: the crypto tax calculator the owner keeps his books in.
- **PBKDF2**: a function that makes an encryption key from a password.
  **AES-256-GCM**: the encryption the key store keeps each api key in.
