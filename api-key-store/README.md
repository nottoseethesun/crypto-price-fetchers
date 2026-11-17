# api-key-store

Api keys kept encrypted with a password, in a JSON file git ignores: LP
Ranger's way of keeping its api keys, as a module any Node project can use.

## How it keeps a key

- The owner types the key, then a password, twice, at a prompt that shows
  nothing of what is typed. Neither is ever a command-line argument, which
  shell history would keep.
- The password is made into an encryption key by PBKDF2-SHA512 at 600,000
  rounds, with a random salt, and the api key is encrypted with that key by
  AES-256-GCM. Without the password, the file tells nothing of the api key.
  A wrong password, or a file changed on disk, fails to open it.
- The password is kept nowhere, and the plain api key only in memory, for
  one run.
- Every key in one file is saved with one password, so a run asks for it
  once.

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

Install this repo from GitHub, pinned to a commit:

```bash
npm install github:nottoseethesun/crypto-price-fetchers#<commit>
```

Describe each service's key once, then call the two flows:

```js
import { enterApiKey, getApiKey, unlockApiKey } from 'crypto-price-fetchers/api-key-store';

const exampleKey = {
  file: '/path/to/my-project/api-keys.json', // list it in .gitignore, with api-keys.json.tmp
  service: 'example', // kept in the file as exampleEncrypted
  name: 'Example', // how messages name the service
  saveCommand: 'npm run save-api-key', // the command messages point to
  check: async (key) => {
    const response = await fetch('https://api.example.com/ping', { headers: { 'x-api-key': key } });
    if (response.status === 200) return 'valid';
    if (response.status === 401) return 'invalid';
    throw new Error(`Example answered with status ${response.status}`);
  },
  say: (line) => console.error(line)
};

// The command that saves a key: asks for it and its password, and saves it once the service takes it.
await enterApiKey(exampleKey);

// As a run starts: asks for the password and opens the key; null when none is saved.
await unlockApiKey(exampleKey);

// Where the key is sent:
const key = getApiKey('example');
```

`check` answers `'valid'` when the service takes the key and `'invalid'` when
it refuses it, and throws when the service does not answer. A refused key
stops the run with an error whose `keyRefused` is true and whose message says
what to do.

The tests are in `../test/api-key-store.test.js`.
