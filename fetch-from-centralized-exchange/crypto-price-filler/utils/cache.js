/**
 * The run's cache of lookups: the prices, and the pool a token's
 * GeckoTerminal price is read from, with the token's side of it
 * (`sources/geckoterminal.js`).
 * @module utils/cache
 *
 * One Map, held at this module's scope: each module of a run imports this
 * one module, so all of them share the Map. A value kept with a time to
 * live is dropped the first time it is asked for after that time.
 *
 * @author Christopher M. Balz with Grok and Claude.ai
 */

/** The cached entries, by key: each value, and when it expires in ms, or null. */
const entries = new Map();

/**
 * The value cached for a key: a price, a pool, or null as it was cached.
 *
 * @param {string} key - The cache key
 * @returns {number|Object|null|undefined} The value, or undefined when nothing is cached for the key or its time to live is up
 */
export function getCache(key) {
  const entry = entries.get(key);
  if (entry === undefined) return undefined;
  if (entry.expiresAtMs !== null && Date.now() > entry.expiresAtMs) {
    entries.delete(key);
    return undefined;
  }
  return entry.value;
}

/**
 * Keeps a value for a key, for a time to live or for the whole run.
 *
 * @param {string} key - The cache key
 * @param {number|Object|null} value - The value: a price, a pool as `{address, side}`, or null
 * @param {?number} [ttlMs=null] - How long to keep it, in ms, or null for the whole run
 */
export function setCache(key, value, ttlMs = null) {
  const expiresAtMs =
    ttlMs === null || ttlMs === undefined ? null : Date.now() + ttlMs;
  entries.set(key, { value, expiresAtMs });
}

/**
 * Empties the cache.
 */
export function clearCache() {
  entries.clear();
}

/**
 * The number of entries the cache holds, an expired one included until it
 * is asked for.
 *
 * @returns {number} The count
 */
export function cacheSize() {
  return entries.size;
}
