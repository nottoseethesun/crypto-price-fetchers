# api-key-store

An api key must not be committed, and should not sit on disk in plain
text. This module, part of crypto-price-fetchers, the owner's repo of code
his projects share, keeps a project's api keys in a JSON file that git,
the version-control program, ignores,
each encrypted with one password the owner types. It is the way LP Ranger,
the owner's bot that manages his 9mm V3 liquidity positions, keeps its api
keys, as a module any project on Node, the program that runs JavaScript
outside a browser, can use.

## How it keeps a key

A project names the services whose keys it sends. The key manager asks for
each key, and saves it encrypted once its service takes it:

- A project lists the services whose keys its programs use in its top
  folder's `config.json`, under `apiKeys`:

  ```json
  { "apiKeys": ["coingecko", "dextools", "x1ninja"] }
  ```

  The key store checks `apiKeys` against its JSON Schema as it reads the
  file (`readNeededKeys`, `project-keys.js`): a list of the services it
  knows, each once. A file without the list, or with a service listed
  twice or one the store does not know, stops the program, with every
  problem listed. The file's other keys are the project's.

- The project's key manager, which `npm run api-keys` runs (npm, Node's
  package manager, runs the commands a project's `package.json` names),
  lists those keys, each saved or not, and asks for each one not saved. Nothing it prints shows a
  key's characters. Each key is saved only once its service takes it.
- A service may give keys of more than one type, which look alike, each
  taken only at an api of its own, as CoinGecko gives a Demo key, its free
  one, which its public api takes, and a paid plan's key, which its Pro api
  takes. Such a service lists its types in `services.js`, each with its
  own check. The manager checks a key of it as each type in turn, saves it
  with the type the service takes it as, and lists that type beside it, as
  `saved, a paid plan's key`. A program then sends the key where its type
  says.
- Where more than one service can do one job, as CoinGecko and
  CoinPaprika can each give a past price, a program asks them in the
  order of priority the owner ranked them in. The manager lists the
  services numbered in that order, and, while the key file holds no order
  that ranks exactly the services `config.json` lists, asks for one,
  typed as those numbers, highest priority first, with Enter alone keeping
  the order shown (`key-ranking.js`). Until one is saved, a program asks
  them in the order `config.json` lists them in (`projectPriority`).
- The key and the password are typed at a prompt that shows nothing of what
  is typed. Neither is ever a command-line argument, which shell history
  would keep.
- The password is made into an encryption key by PBKDF2-SHA512 at 600,000
  rounds, with a random salt, and the api key is encrypted with that key by
  AES-256-GCM. Without the password, the file tells nothing of the api key.
  A wrong password, or a file changed on disk, fails to open it.
- Every key in one file is saved with one password. The password is kept
  nowhere on disk, and the plain keys only in memory, for one run. A
  program that opens the keys takes the password from the environment
  variable `API_KEYS_PASSWORD` when it holds one, and asks for it only
  when it does not.

## Run

A project that uses the store runs one program of it, from the
project's top folder: the key manager, which saves the keys
([Using it in another project](#using-it-in-another-project) adds it).
The sub-section below gives first an example of how to run it, then what
it does, and, under its Usage, more examples.

### manage-api-keys.js

```bash
npm run api-keys
```

This runs the project's key manager, which lists the keys and asks for
each one not saved, as [How it keeps a key](#how-it-keeps-a-key) says.

#### Usage of manage-api-keys.js

A service's saved key replaced, as after the service issues a new one,
here DexTools':

```bash
npm run api-keys -- set dextools
```

The services' order of priority shown, numbered, and a new one saved,
typed as those numbers, highest priority first, such as `2 1 3`:

```bash
npm run api-keys -- rank
```

Whether the password in `API_KEYS_PASSWORD` opens every saved key, by
its exit code, 0 when it does; run with no `API_KEYS_PASSWORD` set, it
says so and ends with exit code 1:

```bash
npm run api-keys -- check-password
```

## The file

The file is LP Ranger's `api-keys.json`, each key's entry in LP Ranger's
format, so each opens a file the other wrote. A key of a service whose
keys come in types has its type beside it, in plain text, since a type is
no secret, and so is the services' order of priority, under `priority`;
LP Ranger, which writes neither, finds a key's entry by its name and leaves
the others as they were:

```json
{
  "coingeckoEncrypted": {
    "version": 1,
    "kdfParams": { "digest": "sha512", "iterations": 600000, "saltHex": "…" },
    "ivHex": "…",
    "authTagHex": "…",
    "ciphertextHex": "…"
  },
  "coingeckoKeyType": "paid",
  "priority": ["moralis", "coingecko", "coinpaprika"]
}
```

The store holds the file to its JSON Schema (`KEY_FILE_SCHEMA` in
`key-file.js`) as it reads it and before it writes it: each key's entry
an object, each type one its service gives, `"demo"` or `"paid"` for
CoinGecko, a CoinGecko key saved with its type and a type with its key,
the order of priority a list of services' names, each once, and no other
entry. A file with a problem stops the program, with every
problem listed, one line each, and the store writes no file its next read
would refuse.

## Using it in another project

Another project installs this repo from GitHub, the website that hosts
it, then calls the store from
its own key manager and programs:

1. Install this repo from GitHub as a dependency, following its main
   branch, so `npm install` installs its newest commit and the
   project's lockfile keeps the commit installed:

   ```bash
   npm install github:nottoseethesun/crypto-price-fetchers#main
   ```

   This repo's versions tool moves it later: add the npm script
   `"github-project-deps": "github-project-deps"`, which runs the bin
   of that name this repo installs, then run
   `npm run github-project-deps -- main`
   ([github-project-deps.js](../docs/engineering.md#github-project-depsjs)
   says when `-- release` works).

2. List the services in the project's top `config.json`, as above, with
   a `config-example.json` beside it that holds the same, which the
   repo checks (`configExampleProblems`, `lib/repo-checks.js`) hold to
   it, and add `api-keys.json` and `api-keys.json.tmp` to its
   `.gitignore`. The services known are in `services.js`, each with the
   check that asks it whether it takes a key, or, for a service whose keys
   come in types, a check for each type.
3. Add the key manager, `manage-api-keys.js`, in the project's
   `bin/end-user/` folder, with an npm script
   `"api-keys": "node bin/end-user/manage-api-keys.js"`:

   ```js
   import { fileURLToPath } from "node:url";
   import { runKeyManager } from "crypto-price-fetchers/api-key-store";
   import { endQuietlyWhenOutputCloses } from "crypto-price-fetchers/lib/closed-output";

   endQuietlyWhenOutputCloses();

   process.exitCode = await runKeyManager(process.argv, {
     projectTop: fileURLToPath(new URL("../..", import.meta.url)),
   });
   ```

4. As a program starts, open the keys it uses:

   ```js
   import { unlockProjectKeys } from "crypto-price-fetchers/api-key-store";

   const keys = await unlockProjectKeys({ projectTop, services: ["dextools"] });
   // keys.dextools is the key, or null when none is saved
   ```

   A key of a service whose keys come in types comes with its type
   beside it, under the service's name and `KeyType`: with a CoinGecko key
   saved, `keys.coingeckoKeyType` is `"demo"` or `"paid"`. `keys.priority`
   is the services `config.json` lists, by name, highest priority first:
   where more than one can do one job, ask them in that order. For the
   rest of the run, `getApiKey(service)` gives the key,
   `getApiKeyType(service)` its type, and `getApiKeyPriority()` the order
   (`key-holder.js`).

A key a service refuses, or a password that does not open the keys, stops
the run with an error whose `keyRefused` is true and whose message says
what to do.

The tests are in `../test/api-key-store.test.js`,
`../test/key-prompts.test.js`, `../test/key-services.test.js`,
`../test/key-ranking.test.js` and `../test/key-manager.test.js`.
