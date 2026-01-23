/**
 * Simple in-memory cache for Crypto Price Filler
 * @module utils/cache
 * @description Provides a shared Map instance for price caching.
 * Uses singleton pattern so all parts of the app share the same cache.
 * Global shared cache for Crypto Price Filler
 * Uses globalThis to ensure the same Map instance across all modules/workers.
 * @version 1.0.0
 * @author Christopher M. Balz with Grok and Claude.ai
 */

if (!globalThis.__crypto_price_cache__) {
  globalThis.__crypto_price_cache__ = new Map();
}

const cacheInstance = globalThis.__crypto_price_cache__;

/**
 * Get the cached value for a specific key, or the entire cache Map if no key is provided.
 * Returns the raw cached price (number or null) or undefined if not found/expired.
 * For backward compatibility with tests that expect the whole Map.
 *
 * @param {string} [key] - Optional cache key to lookup
 * @returns {number|null|undefined|Map} Cached price, undefined, or the full Map
 */
export function getCache(key = null) {
  if (key === null) {
    return cacheInstance; // return whole Map for backward compatibility with tests
  }

  const entry = cacheInstance.get(key);
  if (!entry) return undefined;

  const now = Date.now();
  if (entry.expires && now > entry.expires) {
    cacheInstance.delete(key);
    return undefined;
  }

  return entry.value; // return primitive price value for normal CLI usage
}

/**
 * Set a value in the cache for a specific key with optional TTL.
 *
 * @param {string} key - The cache key
 * @param {number|null} value - The price to cache
 * @param {number} [ttlMs] - Time to live in ms (optional)
 */
export function setCache(key, value, ttlMs = null) {
  const expires = ttlMs ? Date.now() + ttlMs : null;
  cacheInstance.set(key, { value, expires });
}

/**
 * Replace the entire cache with a new Map (used in tests).
 * @param {Map} newCache - New cache instance
 * @returns {Map} The new cache
 */
export function replaceCache(newCache) {
  globalThis.__crypto_price_cache__ = newCache;
  return newCache;
}

/**
 * Clear the entire cache (useful for tests or reset).
 */
export function clearCache() {
  cacheInstance.clear();
}

/**
 * Get current cache size (for debugging).
 * @returns {number} Number of entries
 */
export function cacheSize() {
  return cacheInstance.size;
}
