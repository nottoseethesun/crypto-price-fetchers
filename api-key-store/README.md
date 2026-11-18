# api-key-store

Api keys kept encrypted with a password, in a JSON file git ignores: LP
Ranger's way of keeping its api keys, as a module any Node project can use.

## How it keeps a key

- A project lists the services whose keys its programs use in its top
  folder's `config.json`, under `apiKeys`:

  ```json
  { "apiKeys": ["coingecko", "dextools", "x1ninja"] }
  ```

- `npm run api-keys`, the project's key manager, lists those keys, each
  saved or not, and asks for each one not saved. Nothing it prints shows a
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

`unlock-api-keys.sh`, a copy of which is in each project's top folder, asks
for the password once and keeps it for that terminal in the environment
variable `API_KEYS_PASSWORD`:

```bash
source ./unlock-api-keys.sh
```

It checks that the password opens the keys saved before it keeps it.
The project's programs then open their keys with it, without asking, and
the key manager saves new keys with it. Without it, a program asks for
the password as it starts. Closing the terminal forgets the password, as
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

1. Install this repo from GitHub, pinned to a commit, as a dependency, so
   `npm install` installs it:

   ```bash
   npm install github:nottoseethesun/crypto-price-fetchers#<commit>
   ```

2. List the services in the project's top `config.json`, as above, and add
   `api-keys.json` and `api-keys.json.tmp` to its `.gitignore`. The
   services known are in `services.js`, each with the check that asks it
   whether it takes a key.
3. Add the key manager, `manage-api-keys.js`, in the top folder, with an
   npm script `"api-keys": "node manage-api-keys.js"`:

   ```js
   import { fileURLToPath } from "node:url";
   import { runKeyManager } from "crypto-price-fetchers/api-key-store";

   process.exitCode = await runKeyManager(process.argv, {
     projectTop: fileURLToPath(new URL(".", import.meta.url)),
   });
   ```

4. Copy `unlock-api-keys.sh` from this repo's top folder into the
   project's top folder, and test that the copy matches.
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
