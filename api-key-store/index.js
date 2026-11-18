/**
 * Api keys kept encrypted with a password, for any Node project: LP
 * Ranger's way of keeping them, as a module of its own.
 * @module api-key-store
 *
 * What: a project keeps its api keys in one JSON file that git ignores,
 * each encrypted with a password its owner types, and a run opens the key
 * it needs with that password. This module gathers the parts:
 *
 * - `unlockApiKey` and `enterApiKey` are the two flows a project calls:
 *   open a saved key as a run starts, and save a new one
 *   (`key-prompts.js`). Each takes a `KeySpec` naming the file, the
 *   service and how to ask the service about a key.
 * - `getApiKey` gives the key a run opened to the code that sends it, and
 *   `setApiKey` keeps one (`key-holder.js`).
 * - `saveEncryptedKey`, `loadEncryptedKey`, `hasEncryptedKey` and
 *   `savedServices` read and write the file (`key-file.js`), and
 *   `encryptKey` and `decryptKey` are the cryptography (`key-crypto.js`):
 *   AES-256-GCM, with a key made from the password by PBKDF2-SHA512 at
 *   600,000 rounds. The file is LP Ranger's `api-keys.json`, in the same
 *   format, so each reads a file the other wrote.
 * - `askPassword` and `openSecretPrompt` ask on the terminal and show
 *   nothing of what is typed (`ask-password.js`).
 * - `keyRefused` builds the error that stops a run for want of a key the
 *   service takes.
 *
 * How another project uses it: install this repo from GitHub, pinned to a
 * commit, and import `crypto-price-fetchers/api-key-store`. `README.md`
 * beside this file shows the calls.
 *
 * Fit: `coingecko-api-key.js`, at the repo's top, fills in the spec for
 * CoinGecko's key, which both tools in this repo send.
 */

export { askPassword, openSecretPrompt } from './ask-password.js';
export { decryptKey, encryptKey, ENTRY_VERSION, PBKDF2_ITERATIONS } from './key-crypto.js';
export { hasEncryptedKey, loadEncryptedKey, saveEncryptedKey, savedServices } from './key-file.js';
export { getApiKey, setApiKey } from './key-holder.js';
export { enterApiKey, keyRefused, unlockApiKey } from './key-prompts.js';
