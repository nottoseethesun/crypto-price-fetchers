// utils/fetch.js
import config from '../config.json' assert { type: 'json' };

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
        console.log('[DEBUG] BACKOFF TRIGGERED - awaiting', backoff, 'ms for URL:', url); // debug
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue; // <--- THIS IS CRITICAL — retry the same URL
      } else {
        logv(verbose, 1, `Fetch failed: HTTP ${res.status} for ${url}`);
        return null; // non-429 error → stop
      }
    } catch (e) {
      logv(verbose, 1, `Fetch error: ${e.message} for ${url}`);
      return null;
    }
  }
  logv(verbose, 1, `All retries failed for ${url}`);
  return null;
}

