/**
 * The file a project's api keys are kept in, each encrypted with one
 * password.
 * @module api-key-store/key-file
 *
 * What: one JSON file holds a project's api keys, each under
 * `<service>Encrypted`, such as `coingeckoEncrypted`, as an entry
 * `key-crypto.js` makes. A service whose keys come in types
 * (`services.js`) has the type of its key beside it, under
 * `<service>KeyType`, such as `"coingeckoKeyType": "paid"`, in plain text,
 * since a type is no secret. The order of priority the owner ranked the
 * services in is under `priority`, a list of their names, highest first,
 * in plain text too. `saveEncryptedKey` adds or replaces a key,
 * with its type, `loadEncryptedKey` opens one with the password,
 * `savedKeyType` gives a key's type, `savePriority` and `savedPriority`
 * save and give the order of priority, `hasEncryptedKey` says whether a key
 * is saved, `savedServices` lists them, and `checkPasswordOpensKeys` says
 * whether a password opens every one. It is LP Ranger's `api-keys.json`,
 * each key's entry in LP Ranger's format, so each reads a file the other
 * wrote: LP Ranger finds a key's entry by its name and leaves a type's
 * entry, which it never writes, as it was.
 *
 * How:
 *
 * - Every key in a file is saved with one password, so a run asks for it
 *   once. A new key is saved only with the password that opens the keys
 *   already there; LP Ranger leaves that to whoever types it.
 * - The file is held to its JSON Schema (`KEY_FILE_SCHEMA`) as it is read
 *   and before it is written (`lib/settings-file.js`): each key's entry an
 *   object, each type one of its service's types, a key whose service's
 *   keys come in types saved with its type and a type with its key, the
 *   order of priority a list of services' names, each once, and no other
 *   entry. A file with a problem stops the read, every problem
 *   listed, one line each.
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
import { checkSettings, readSettingsFile } from "../lib/settings-file.js";
import { decryptKey, encryptKey } from "./key-crypto.js";
import { SERVICES } from "./services.js";

/** The ending of each key's entry's name, as LP Ranger names them. */
const ENTRY_SUFFIX = "Encrypted";

/** The ending of the name of the entry that holds a key's type. */
const TYPE_SUFFIX = "KeyType";

/** The name of the entry that holds the services' order of priority. */
const PRIORITY_ENTRY = "priority";

/** A service's name: a letter, then letters and digits. */
const SERVICE_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

/** Only the owner may read or write the file. */
const FILE_MODE = 0o600;

/** The services whose keys come in types (`services.js`). */
const TYPED_SERVICES = Object.values(SERVICES).filter(
  (service) => service.keyTypes !== undefined,
);

/**
 * The JSON Schema of the key file: each key's entry, an object in LP
 * Ranger's format, which `key-crypto.js` checks as it opens it; for each
 * service whose keys come in types, the type of its key, one of the
 * service's types; each of the two with the other; and no other entry.
 */
const KEY_FILE_SCHEMA = Object.freeze({
  type: "object",
  patternProperties: {
    /*- SERVICE_NAME's pattern, without its ^ and $, then the ending. */
    [`^${SERVICE_NAME.source.slice(1, -1)}${ENTRY_SUFFIX}$`]: {
      type: "object",
      /*- No problem names the value, which may be a key typed in by hand. */
      writeOnly: true,
      description:
        "an object, a key encrypted with the password in LP Ranger's format",
    },
  },
  properties: {
    ...Object.fromEntries(
      TYPED_SERVICES.map((service) => [
        `${service.service}${TYPE_SUFFIX}`,
        {
          enum: Object.keys(service.keyTypes),
          description: `${Object.keys(service.keyTypes)
            .map((type) => JSON.stringify(type))
            .join(" or ")}, the type of the ${service.name} key`,
        },
      ]),
    ),
    [PRIORITY_ENTRY]: {
      type: "array",
      uniqueItems: true,
      items: {
        type: "string",
        pattern: SERVICE_NAME.source,
        description: "a service's name, letters and digits",
      },
      description:
        "a list of the services' names, each once, highest priority first",
    },
  },
  dependentRequired: Object.fromEntries(
    TYPED_SERVICES.flatMap((service) => [
      [
        `${service.service}${ENTRY_SUFFIX}`,
        [`${service.service}${TYPE_SUFFIX}`],
      ],
      [
        `${service.service}${TYPE_SUFFIX}`,
        [`${service.service}${ENTRY_SUFFIX}`],
      ],
    ]),
  ),
  additionalProperties: false,
});

/**
 * Gives a service's name once it is checked as one.
 *
 * @param {string} service - The service, such as 'coingecko'
 * @returns {string} The service
 * @throws {TypeError} When the service is not a name of letters and digits
 */
function checkedService(service) {
  if (typeof service !== "string" || !SERVICE_NAME.test(service)) {
    throw new TypeError(
      `A service's name is letters and digits, such as coingecko, not ${JSON.stringify(service)}`,
    );
  }
  return service;
}

/**
 * The name a service's key is kept under.
 *
 * @param {string} service - The service, such as 'coingecko'
 * @returns {string} The entry's name, such as 'coingeckoEncrypted'
 * @throws {TypeError} When the service is not a name of letters and digits
 */
function entryName(service) {
  return `${checkedService(service)}${ENTRY_SUFFIX}`;
}

/**
 * The name the type of a service's key is kept under, in the key file and
 * among the keys a run opens (`unlockApiKeys` in `key-prompts.js`).
 *
 * @param {string} service - The service, such as 'coingecko'
 * @returns {string} The name, such as 'coingeckoKeyType'
 * @throws {TypeError} When the service is not a name of letters and digits
 */
export function typeEntryName(service) {
  return `${checkedService(service)}${TYPE_SUFFIX}`;
}

/**
 * Reads the file's entries, once they hold to `KEY_FILE_SCHEMA`.
 *
 * @param {string} file - The file
 * @returns {Object<string, *>} The entries by name: none when the file does not exist
 * @throws {Error} When the file cannot be read, is not valid JSON, holds no JSON object, or has a problem its schema finds, every problem listed
 */
function readKeyFile(file) {
  return readSettingsFile(file, { schema: KEY_FILE_SCHEMA });
}

/**
 * Writes the file whole, through a temp file beside it, readable by its
 * owner alone, once its entries hold to `KEY_FILE_SCHEMA`.
 *
 * @param {string} file - The file
 * @param {Object<string, *>} store - The entries by name
 * @returns {void}
 * @throws {Error} When the entries have a problem the schema finds, every problem listed; the file is then left as it was
 */
function writeKeyFile(file, store) {
  checkSettings(store, KEY_FILE_SCHEMA, { name: file });
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
 * Gives the order of priority saved in the file.
 *
 * @param {string} file - The file
 * @returns {?Array<string>} The services, by name, highest priority first; null when none is saved
 * @throws {Error} When the file cannot be read (`readKeyFile`)
 */
export function savedPriority(file) {
  return readKeyFile(file)[PRIORITY_ENTRY] ?? null;
}

/**
 * Saves an order of priority, in place of any saved, keeping every key.
 *
 * @param {string} file - The file
 * @param {Array<string>} priority - The services, by name, highest priority first
 * @returns {void}
 * @throws {Error} When the file cannot be read, or the order would break its schema, as a service named twice would
 */
export function savePriority(file, priority) {
  const store = readKeyFile(file);
  store[PRIORITY_ENTRY] = [...priority];
  writeKeyFile(file, store);
}

/**
 * Gives the type saved with a service's key.
 *
 * @param {string} file - The file
 * @param {string} service - The service, such as 'coingecko'
 * @returns {?string} The type, such as 'paid'; null when the file holds none for the service, as for a service whose keys do not come in types
 * @throws {Error} When the file cannot be read (`readKeyFile`)
 */
export function savedKeyType(file, service) {
  return readKeyFile(file)[typeEntryName(service)] ?? null;
}

/**
 * Saves a service's key, encrypted with the password, and its type, in
 * place of any key and type it had.
 *
 * @param {string} file - The file
 * @param {string} service - The service, such as 'coingecko'
 * @param {string} apiKey - The key
 * @param {string} password - The password: the one the file's other keys are saved with, when it has any
 * @param {?string} [keyType=null] - The key's type, for a service whose keys come in types, such as 'paid'; null for one whose keys do not
 * @returns {Promise<void>} Settles once the file is written
 * @throws {Error} When the file cannot be read, the password does not open its other keys, or the file would break its schema, as a CoinGecko key with no type would
 */
export async function saveEncryptedKey(
  file,
  service,
  apiKey,
  password,
  keyType = null,
) {
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
  if (keyType === null) delete store[typeEntryName(service)];
  else store[typeEntryName(service)] = keyType;
  writeKeyFile(file, store);
}
