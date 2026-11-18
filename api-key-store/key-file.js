/**
 * The file a project's api keys are kept in, each encrypted with one
 * password.
 * @module api-key-store/key-file
 *
 * What: one JSON file holds a project's api keys, each under
 * `<service>Encrypted`, such as `coingeckoEncrypted`, as an entry
 * `key-crypto.js` makes. `saveEncryptedKey` adds or replaces one,
 * `loadEncryptedKey` opens one with the password, `hasEncryptedKey` says
 * whether one is saved, `savedServices` lists them, and
 * `checkPasswordOpensKeys` says whether a password opens every one. It is
 * LP Ranger's `api-keys.json`, in the same format, so each reads a file
 * the other wrote.
 *
 * How:
 *
 * - Every key in a file is saved with one password, so a run asks for it
 *   once. A new key is saved only with the password that opens the keys
 *   already there; LP Ranger leaves that to whoever types it.
 * - The file is written whole, to a temp file beside it and then renamed
 *   over it, so a write cut off leaves the old file whole, and only its
 *   owner may read it (mode 0600).
 * - A file that is not valid JSON stops the read rather than reading as no
 *   keys, so a save never writes over keys it could not read.
 * - The project's `.gitignore` names the file, so it never reaches the
 *   remote.
 *
 * Fit: `key-prompts.js` asks for keys and passwords and keeps them here.
 */

import fs from "node:fs";
import path from "node:path";
import { decryptKey, encryptKey } from "./key-crypto.js";

/** The ending of each entry's name, as LP Ranger names them. */
const ENTRY_SUFFIX = "Encrypted";

/** Only the owner may read or write the file. */
const FILE_MODE = 0o600;

/**
 * The name a service's entry is kept under.
 *
 * @param {string} service - The service, such as 'coingecko'
 * @returns {string} The entry's name, such as 'coingeckoEncrypted'
 * @throws {TypeError} When the service is not a name of letters and digits
 */
function entryName(service) {
  if (typeof service !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(service)) {
    throw new TypeError(
      `A service's name is letters and digits, such as coingecko, not ${JSON.stringify(service)}`,
    );
  }
  return `${service}${ENTRY_SUFFIX}`;
}

/**
 * Reads the file's entries.
 *
 * @param {string} file - The file
 * @returns {Object<string, Object>} The entries by name: none when the file does not exist
 * @throws {Error} When the file cannot be read, is not valid JSON, or holds no JSON object
 */
function readKeyFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Cannot read ${file}: ${error.message}`, { cause: error });
  }
  let store;
  try {
    store = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${file} is not valid JSON, so no key in it can be read: ${error.message}`,
      { cause: error },
    );
  }
  if (store === null || typeof store !== "object" || Array.isArray(store))
    throw new Error(`${file} holds no JSON object`);
  return store;
}

/**
 * Writes the file whole, through a temp file beside it, readable by its
 * owner alone.
 *
 * @param {string} file - The file
 * @param {Object<string, Object>} store - The entries by name
 * @returns {void}
 */
function writeKeyFile(file, store) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, {
    mode: FILE_MODE,
  });
  fs.chmodSync(temp, FILE_MODE);
  fs.renameSync(temp, file);
}

/**
 * Lists the services with an entry among the entries given.
 *
 * @param {Object<string, Object>} store - The entries by name
 * @returns {string[]} The services, such as ['coingecko']
 */
function servicesIn(store) {
  return Object.keys(store)
    .filter(
      (name) =>
        name.endsWith(ENTRY_SUFFIX) && name.length > ENTRY_SUFFIX.length,
    )
    .map((name) => name.slice(0, -ENTRY_SUFFIX.length));
}

/**
 * Lists the services with a key saved in the file.
 *
 * @param {string} file - The file
 * @returns {string[]} The services, such as ['coingecko']
 * @throws {Error} When the file cannot be read (`readKeyFile`)
 */
export function savedServices(file) {
  return servicesIn(readKeyFile(file));
}

/**
 * Says whether a key is saved for a service.
 *
 * @param {string} file - The file
 * @param {string} service - The service, such as 'coingecko'
 * @returns {boolean} Whether one is saved
 * @throws {Error} When the file cannot be read (`readKeyFile`)
 */
export function hasEncryptedKey(file, service) {
  return Object.hasOwn(readKeyFile(file), entryName(service));
}

/**
 * Checks that a password opens every key saved in the file.
 *
 * @param {string} file - The file
 * @param {string} password - The password
 * @returns {Promise<number>} How many keys it opened: 0 when none is saved
 * @throws {Error} When the file cannot be read, or the password does not open a key
 */
export async function checkPasswordOpensKeys(file, password) {
  const store = readKeyFile(file);
  const services = servicesIn(store);
  for (const service of services)
    await decryptKey(store[entryName(service)], password);
  return services.length;
}

/**
 * Opens a service's saved key with the password.
 *
 * @param {string} file - The file
 * @param {string} service - The service, such as 'coingecko'
 * @param {string} password - The password the key was saved with
 * @returns {Promise<string|null>} The key, or null when none is saved
 * @throws {Error} When the file cannot be read, or the password does not open the key
 */
export async function loadEncryptedKey(file, service, password) {
  const entry = readKeyFile(file)[entryName(service)];
  if (entry === undefined) return null;
  return decryptKey(entry, password);
}

/**
 * Saves a service's key, encrypted with the password, in place of any it
 * had.
 *
 * @param {string} file - The file
 * @param {string} service - The service, such as 'coingecko'
 * @param {string} apiKey - The key
 * @param {string} password - The password: the one the file's other keys are saved with, when it has any
 * @returns {Promise<void>} Settles once the file is written
 * @throws {Error} When the file cannot be read, or the password does not open its other keys
 */
export async function saveEncryptedKey(file, service, apiKey, password) {
  const name = entryName(service);
  const store = readKeyFile(file);
  const other = servicesIn(store).find((saved) => saved !== service);
  if (other !== undefined) {
    try {
      await decryptKey(store[entryName(other)], password);
    } catch {
      throw new Error(
        `That password does not open the other keys saved in ${file}, and every key there is saved with one password`,
      );
    }
  }
  store[name] = await encryptKey(apiKey, password);
  writeKeyFile(file, store);
}
