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
- The key and the password are typed at a prompt that shows nothing of what
  is typed. Neither is ever a command-line argument, which shell history
  would keep.
- The password is made into an encryption key by PBKDF2-SHA512 at 600,000
  rounds, with a random salt, and the api key is encrypted with that key by
  AES-256-GCM. Without the password, the file tells nothing of the api key.
  A wrong password, or a file changed on disk, fails to open it.
- Every key in one file is saved with one password. The password is kept
  nowhere on disk, and the plain keys only in memory, for one run.

## The password in a terminal

Without help, each program asks for the password as it starts, which is
slow when several programs run in turn. `unlock-api-keys.sh`, a copy of
which is in each project's `bin/` folder, asks
for the password once and keeps it for that terminal in the environment
variable `API_KEYS_PASSWORD`:

```bash
source ./bin/unlock-api-keys.sh
```

It checks that the password opens the keys saved before it keeps it.
The project's programs then open their keys with it, without asking, and
the key manager saves new keys with it. Closing the terminal forgets the password, as
does `unset API_KEYS_PASSWORD`. With one password for every project, one
unlock serves them all.

## The file

The file is LP Ranger's `api-keys.json`, in the same format, so each opens a
file the other wrote:

```json
{
  "coingeckoEncrypted": {
    "version": 1,
    "kdfParams": { "digest": "sha512", "iterations": 600000, "saltHex": "…" },
    "ivHex": "…",
    "authTagHex": "…",
    "ciphertextHex": "…"
  }
}
```

## Using it in another project

Another project installs this repo from GitHub, the website that hosts
it, then calls the store from
its own key manager and programs:

1. Install this repo from GitHub, pinned to a commit, as a dependency, so
   `npm install` installs it:

   ```bash
   npm install github:nottoseethesun/crypto-price-fetchers#<commit>
   ```

2. List the services in the project's top `config.json`, as above, and add
   `api-keys.json` and `api-keys.json.tmp` to its `.gitignore`. The
   services known are in `services.js`, each with the check that asks it
   whether it takes a key.
3. Add the key manager, `manage-api-keys.js`, in the project's `bin/`
   folder, with an npm script `"api-keys": "node bin/manage-api-keys.js"`:

   ```js
   import { fileURLToPath } from "node:url";
   import { runKeyManager } from "crypto-price-fetchers/api-key-store";

   process.exitCode = await runKeyManager(process.argv, {
     projectTop: fileURLToPath(new URL("..", import.meta.url)),
   });
   ```

4. Copy `bin/unlock-api-keys.sh` from this repo into the project's
   `bin/` folder, and test that the copy matches. The script finds the
   project's top folder as the one above its own, and runs
   `bin/manage-api-keys.js` there.
5. As a program starts, open the keys it uses:

   ```js
   import { unlockProjectKeys } from "crypto-price-fetchers/api-key-store";

   const keys = await unlockProjectKeys({ projectTop, services: ["dextools"] });
   // keys.dextools is the key, or null when none is saved
   ```

A key a service refuses, or a password that does not open the keys, stops
the run with an error whose `keyRefused` is true and whose message says
what to do.

The tests are in `../test/api-key-store.test.js`,
`../test/key-prompts.test.js`, `../test/key-manager.test.js` and
`../test/unlock-api-keys.test.js`.
