/**
 * The api keys a run has opened, held in memory for the run, as LP
 * Ranger's `src/lib/api-key-holder.js` holds them.
 * @module api-key-store/key-holder
 *
 * What: `setApiKey` keeps a service's key for the run, and `getApiKey`
 * gives it to the code that sends it, such as a price source, which so
 * never sees the password or the key file. A run sets a key once, as it
 * starts (`key-prompts.js`).
 *
 * How: one map for the process, held in this module and written nowhere,
 * so a key lasts as long as the process does.
 */

/** The keys the run has opened, by service. */
const keys = new Map();

/**
 * Keeps a service's key in memory for the run, or forgets it.
 *
 * @param {string} service - The service, such as 'coingecko'
 * @param {?string} key - The key, or null to forget the one kept
 * @returns {void}
 * @throws {TypeError} When the key is neither a string that is not empty nor null
 */
export function setApiKey(service, key) {
  if (key === null) {
    keys.delete(service);
    return;
  }
  if (typeof key !== "string" || key.length === 0) {
    throw new TypeError(
      "An api key is a string that is not empty, or null to forget one",
    );
  }
  keys.set(service, key);
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
