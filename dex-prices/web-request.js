/**
 * Requests to the price services, sent again when a service refuses one
 * as too many.
 * @module dex-prices/web-request
 *
 * What: `fetchWithRetries` sends one request and gives its response. A
 * price service that counts requests answers 429 when a caller asks too
 * often, and takes the same request again once the caller has waited, so
 * a 429 is sent again after each of the waits in turn. Any other answer,
 * or a 429 once every wait is used up, is the response given. Each try
 * gives up at the request timeout, since a connection that hangs would
 * otherwise hold its caller forever.
 *
 * How: `requestSettings` completes a caller's settings with Node's fetch,
 * real waits, the waits below and the timeout. The waits are LP Ranger's,
 * measured against GeckoTerminal: ten seconds first, since three seconds
 * did not outlast its burst counter, and a minute last, which outlasts a
 * free plan's window. A test hands in a fetch and waits of its own, and a
 * caller that a service holds to other limits hands in its own waits.
 * Before each try, the request waits for `beforeTry`, where a client
 * keeps within a service's budget of requests (`geckoterminal.js` does),
 * so a try sent again takes its place in the budget like any other. The
 * caller hears of each wait after a 429 through `onRetry`, for its log.
 *
 * Fit: the GeckoTerminal and Moralis clients beside this file send every
 * request through it, so each Node program that asks them, such as
 * crypto-price-filler's pool sources, tries again the same way. A Sheets
 * script runs in Apps Script, which cannot load a Node module, so the
 * centralized-exchange script keeps a loop of its own, `fetchWithRetries`
 * in `getCryptoPriceFromCentralizedExchange-sources.gs`, which the filler
 * also runs for MEXC, CoinGecko and CoinPaprika.
 */

/** The waits before each new try after a 429, in milliseconds. */
export const RETRY_DELAYS_MS = Object.freeze([10000, 30000, 60000]);

/** How long one try may take, in milliseconds. */
export const REQUEST_TIMEOUT_MS = 30000;

/**
 * Waits.
 *
 * @param {number} ms - How long, in milliseconds
 * @returns {Promise<void>} Settles once the time is up
 */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * How requests are sent: what a test, or a caller held to other limits,
 * replaces.
 *
 * @typedef {Object} RequestSettings
 * @property {function(string, Object): Promise<Response>} fetch - Sends a request, as Node's fetch does
 * @property {function(number): Promise<void>} sleep - Waits a number of milliseconds
 * @property {number[]} retryDelaysMs - The waits before each new try after a 429, in milliseconds
 * @property {number} timeoutMs - How long one try may take, in milliseconds
 * @property {function(): Promise<void>} beforeTry - Settles when a try may be sent, such as once a service's budget has room
 * @property {function(number, number): void} onRetry - Hears the number of the try about to wait and the wait, in milliseconds
 */

/**
 * Completes a caller's settings with Node's fetch, real waits, the waits
 * after a 429 above, the request timeout above, and no wait before a try,
 * wherever the caller gives none.
 *
 * @param {Partial<RequestSettings>} [settings={}] - The caller's settings
 * @returns {RequestSettings} The completed settings
 */
export function requestSettings(settings = {}) {
  return {
    fetch: (url, options) => fetch(url, options),
    sleep: wait,
    retryDelaysMs: RETRY_DELAYS_MS,
    timeoutMs: REQUEST_TIMEOUT_MS,
    beforeTry: async () => {},
    onRetry: () => {},
    ...settings,
  };
}

/**
 * Sends a request, and sends it again after each wait while the service
 * answers 429.
 *
 * @param {string} url - The url
 * @param {Object} options - The fetch options, such as the headers
 * @param {RequestSettings} settings - How to send it (`requestSettings`)
 * @returns {Promise<Response>} The first answer other than 429, or the last 429 once every wait is used up
 * @throws {Error} When the request fails or times out
 */
export async function fetchWithRetries(url, options, settings) {
  for (let attempt = 0; ; attempt++) {
    await settings.beforeTry();
    const response = await settings.fetch(url, {
      ...options,
      signal: AbortSignal.timeout(settings.timeoutMs),
    });
    if (response.status !== 429 || attempt >= settings.retryDelaysMs.length) {
      return response;
    }
    const delay = settings.retryDelaysMs[attempt];
    settings.onRetry(attempt + 1, delay);
    await settings.sleep(delay);
  }
}
