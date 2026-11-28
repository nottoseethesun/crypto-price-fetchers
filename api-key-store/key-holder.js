/**
 * The api keys a run has opened, held in memory for the run, as LP
 * Ranger's `src/lib/api-key-holder.js` holds them.
 * @module api-key-store/key-holder
 *
 * What: `setApiKey` keeps a service's key for the run, with its type for a
 * service whose keys come in types (`services.js`); `getApiKey` gives the
 * key, and `getApiKeyType` its type, to the code that sends it, such as a
 * price source, which so never sees the password or the key file. A run
 * sets a key once, as it starts (`key-prompts.js`).
 * `setApiKeyPriority` keeps the services' order of priority for the run,
 * as it opens its keys (`project-keys.js`), and `getApiKeyPriority` gives
 * it to the code that chooses which service to ask first.
 *
 * How: two maps for the process, the keys and their types, and the order
 * of priority, held in this module and written nowhere, so each lasts as
 * long as the process does.
 */

/** The keys the run has opened, by service. */
const keys = new Map();

/** The types of the keys the run has opened, by service, for each service whose keys come in types. */
const keyTypes = new Map();

/** The run's order of priority, its services' names highest first; null until the run opens its keys. */
let priority = null;

/**
 * Keeps a service's key in memory for the run, with its type, or forgets
 * them.
 *
 * @param {string} service - The service, such as 'coingecko'
 * @param {?string} key - The key, or null to forget the one kept, and its type
 * @param {?string} [keyType=null] - The key's type, such as 'paid', for a service whose keys come in types; null for one whose keys do not
 * @returns {void}
 * @throws {TypeError} When the key is neither a string that is not empty nor null, or the type neither a string that is not empty nor null
 */
export function setApiKey(service, key, keyType = null) {
  if (key === null) {
    keys.delete(service);
    keyTypes.delete(service);
    return;
  }
  if (typeof key !== "string" || key.length === 0) {
    throw new TypeError(
      "An api key is a string that is not empty, or null to forget one",
    );
  }
  if (keyType !== null && (typeof keyType !== "string" || keyType === "")) {
    throw new TypeError(
      "A key's type is a string that is not empty, or null for none",
    );
  }
  keys.set(service, key);
  if (keyType === null) keyTypes.delete(service);
  else keyTypes.set(service, keyType);
}

/**
 * Gives a service's key, when the run has one.
 *
 * @param {string} service - The service, such as 'coingecko'
 * @returns {?string} The key, or null when the run has none
 */
export function getApiKey(service) {
  return keys.get(service) ?? null;
}

/**
 * Gives the type of a service's key, when the run has a key of a type.
 *
 * @param {string} service - The service, such as 'coingecko'
 * @returns {?string} The type, such as 'paid'; null when the run has no key for the service, or its keys do not come in types
 */
export function getApiKeyType(service) {
  return keyTypes.get(service) ?? null;
}

/**
 * Keeps the services' order of priority for the run, or forgets it.
 *
 * @param {?Array<string>} services - The services' names, highest priority first, or null to forget the order kept
 * @returns {void}
 * @throws {TypeError} When it is neither a list of names, each a string that is not empty, nor null
 */
export function setApiKeyPriority(services) {
  if (services === null) {
    priority = null;
    return;
  }
  if (
    !Array.isArray(services) ||
    !services.every((name) => typeof name === "string" && name !== "")
  ) {
    throw new TypeError(
      "An order of priority is a list of services' names, or null to forget one",
    );
  }
  priority = Object.freeze([...services]);
}

/**
 * Gives the run's order of priority.
 *
 * @returns {?ReadonlyArray<string>} The services' names, highest priority first; null before the run opens its keys
 */
export function getApiKeyPriority() {
  return priority;
}
