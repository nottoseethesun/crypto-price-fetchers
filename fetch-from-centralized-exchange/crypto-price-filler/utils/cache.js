/**
 * Simple in-memory cache for Crypto Price Filler
 * @module utils/cache
 * @description Provides a shared Map instance for price caching.
 * Uses singleton pattern so all parts of the app share the same cache.
 * Global shared cache for Crypto Price Filler
 * Uses globalThis to ensure the same Map instance across all modules/workers.
 * @version 1.0.0
 * @author Christopher M. Balz with Grok
 */

if (!globalThis.__crypto_price_cache__) {
  globalThis.__crypto_price_cache__ = new Map();
}

const cacheInstance = globalThis.__crypto_price_cache__;

/**
 * Get the shared cache Map instance.
 * @returns {Map} The global cache Map
 */
export function getCache() {
  return cacheInstance;
}

/**
 * Replace the cache with a new Map (used in tests).
 * @param {Map} newCache - New cache instance
 * @returns {Map} The new cache
 */
export function setCache(newCache) {
  globalThis.__crypto_price_cache__ = newCache;
  return newCache;
}

/**
 * Clear the cache (useful for tests or reset).
 */
export function clearCache() {
  cacheInstance.clear();
}