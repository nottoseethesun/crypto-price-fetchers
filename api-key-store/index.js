/**
 * Api keys kept encrypted with a password, for any Node project: LP
 * Ranger's way of keeping them, as a module of its own.
 * @module api-key-store
 *
 * What: a project lists the services whose keys its programs use in its
 * top folder's `config.json` (`"apiKeys": ["coingecko"]`), and keeps the
 * keys in `api-keys.json` beside it, which git ignores, each encrypted
 * with one password its owner types. Three parts serve it:
 *
 * - The manager, `runKeyManager` (`key-manager.js`), which the project's
 *   `bin/end-user/manage-api-keys.js` runs as `npm run api-keys`: it
 *   lists the keys, saved or not, never showing their characters, and
 *   asks for those not saved, each saved once its service takes it, with
 *   its type for a service whose keys come in types, such as CoinGecko's
 *   Demo keys and its paid plans' keys; and it asks for the services'
 *   order of priority when none is saved, which `rank` changes
 *   (`key-ranking.js`).
 * - `bin/unlock-api-keys.sh`, a copy of which is in each project's `bin/`:
 *   sourced in a terminal, it asks for the password once and keeps it in
 *   the environment variable `API_KEYS_PASSWORD` for that terminal.
 * - `unlockProjectKeys` (`project-keys.js`), which a program calls as it
 *   starts: it opens the keys it uses with `API_KEYS_PASSWORD`, or asks
 *   for the password when that is not set, has each service check its key
 *   once, and keeps them in memory for the run, where `getApiKey` gives
 *   them, `getApiKeyType` a key's type, and `getApiKeyPriority` the
 *   services' order of priority (`projectPriority`): where more than one
 *   service can do one job, a program asks them in that order
 *   (`key-holder.js`).
 *
 * Underneath: `services.js` holds the services known and how each checks
 * a key; `key-prompts.js` the flows that open and save keys; `key-file.js`
 * the key file, each key's entry in LP Ranger's format, so each reads a
 * file the other wrote; `key-crypto.js` the cryptography, AES-256-GCM with a key made
 * from the password by PBKDF2-SHA512 at 600,000 rounds; and
 * `ask-password.js` the prompt that shows nothing of what is typed.
 *
 * How another project uses it: install this repo from GitHub, following
 * its main branch, and import `crypto-price-fetchers/api-key-store`.
 * `README.md` beside this file shows the calls.
 */

export { askPassword, openSecretPrompt } from "./ask-password.js";
export {
  decryptKey,
  encryptKey,
  ENTRY_VERSION,
  PBKDF2_ITERATIONS,
} from "./key-crypto.js";
export {
  checkPasswordOpensKeys,
  hasEncryptedKey,
  loadEncryptedKey,
  saveEncryptedKey,
  savedKeyType,
  savedPriority,
  savedServices,
  savePriority,
  typeEntryName,
} from "./key-file.js";
export {
  getApiKey,
  getApiKeyPriority,
  getApiKeyType,
  setApiKey,
  setApiKeyPriority,
} from "./key-holder.js";
export { runKeyManager } from "./key-manager.js";
export {
  enterApiKey,
  keyRefused,
  MANAGE_COMMAND,
  UNLOCK_VARIABLE,
  savingPassword,
  UNLOCK_COMMAND,
  unlockApiKeys,
} from "./key-prompts.js";
export { askPriority, typedOrder } from "./key-ranking.js";
export {
  KEY_FILE,
  keyFileFor,
  PROJECT_CONFIG_FILE,
  projectPriority,
  readNeededKeys,
  unlockProjectKeys,
} from "./project-keys.js";
export { COINGECKO_KEY_TYPES, SERVICES, serviceNamed } from "./services.js";
