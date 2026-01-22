/**
 * Fetch utility with rate-limit retry for Crypto Price Filler
 * @module utils/fetch
 */

import config from '../config.json' assert { type: 'json' };

/**
 * Fetches a URL with automatic retry on 429 (rate limit) errors.
 * @param {string} url - The URL to fetch
 * @param {boolean} [verbose=false] - Enable verbose logging
 * @returns {Promise<Response|null>} Response object if successful, null if all retries fail
 */
export async function fetchWithRetry(url, verbose = false) {
  const logv = (shouldLog, level, message, ...args) => {
    if (!shouldLog || level < 1) return;
    console.log(`[VERBOSE:${level}] ${message}`, ...args);
  };

  let attempts = 0;
  while (attempts < config.MAX_RETRIES) {
    attempts++;
    logv(verbose, 2, `Fetch attempt ${attempts}/${config.MAX_RETRIES} for ${url}`);

    try {
      const res = await fetch(url);
      logv(verbose, 2, `Fetch response status: ${res.status} for ${url}`);

      if (res.ok) {
        logv(verbose, 2, `Fetch succeeded for ${url} (HTTP ${res.status})`);
        return res;
      }

      if (res.status === 429) {
        const backoff = config.RETRY_BACKOFF_MS[attempts - 1] || 5000;
        logv(verbose, 1, `429 rate limit - backoff ${backoff}ms (attempt ${attempts}/${config.MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue; // retry the same URL
      } else {
        logv(verbose, 1, `Fetch failed: HTTP ${res.status} for ${url}`);
        return null;
      }
    } catch (e) {
      logv(verbose, 1, `Fetch error: ${e.message} for ${url}`);
      return null;
    }
  }

  logv(verbose, 1, `All retries failed for ${url}`);
  return null;
}
