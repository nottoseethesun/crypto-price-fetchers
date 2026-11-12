/**
 * A stand-in for `fetchWithRetry`, the http layer every price source in the
 * Node tool calls.
 * @module tests/helpers/fetch-with-retry
 *
 * A test mocks `../utils/fetch.js` with vitest, as the source tests do, and
 * gives the mock an implementation built by `answeringFetchWithRetry`. That
 * implementation answers each url from the test's `answer` function the way
 * the real `fetchWithRetry` answers: with a response whose `json()` gives
 * the body, or with null where a service answers 404.
 */

/**
 * Builds a `fetchWithRetry` stand-in.
 *
 * @param {function(string): (Object|Array|null)} answer - The json body for a url, or null for a 404
 * @returns {function(string): Promise<Object|null>} The stand-in
 */
export function answeringFetchWithRetry(answer) {
  return async (url) => {
    const body = answer(url);
    if (body === null) return null;
    return { ok: true, status: 200, json: async () => body };
  };
}
