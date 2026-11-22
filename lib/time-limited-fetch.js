/**
 * Requests with a time limit, for a program that asks a service over the
 * web: a price service, a chain's json-rpc endpoint or a beacon node.
 * @module lib/time-limited-fetch
 *
 * What: `fetchWithinTimeLimit` sends a request and reads its whole answer,
 * its body included, within a time limit, and gives it as a Response. Node's
 * fetch has no limit of its own, so a connection that hangs, or a body that
 * stops coming, would hold its caller forever. When the time runs out, it
 * throws an error that names the service, as the caller names it, and the
 * limit in seconds, so the message says which service gave no answer. A
 * signal of the caller's own, such as one a library hands the fetch it is
 * given, still aborts the request.
 *
 * How: the request carries a signal that aborts at the limit, joined with
 * the caller's by `AbortSignal.any`. The body is read before the function
 * returns, so the limit covers it, and the Response it gives holds the
 * body read, which can be read as any Response's is.
 *
 * Fit: the request loop of the price services' clients
 * (`dex-prices/web-request.js`) sends each try through it, and the
 * projects that install this repo send their own requests through it, as
 * `crypto-price-fetchers/lib/time-limited-fetch`: x1-validator-analytics'
 * requests to X1's endpoint, and pulsechain-validator-analytics' to the
 * beacon node and the json-rpc endpoint.
 */

/**
 * The longest time limit Node's timers keep, in milliseconds: 2^31 - 1,
 * about 24.8 days. A timer set for longer fires after 1 millisecond.
 */
export const LONGEST_TIME_LIMIT_MS = 2147483647;

/** Statuses whose answer has no body, which a Response holding one cannot be built with. */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/**
 * Sends a request and reads its whole answer within a time limit.
 *
 * @param {string} url - The url
 * @param {Object} [options={}] - The fetch options, such as the headers; a `signal` among them still aborts the request
 * @param {Object} limits - The limit, and what the error names
 * @param {number} limits.timeoutMs - How long the request and its answer may take: a whole number of milliseconds from 1 to `LONGEST_TIME_LIMIT_MS`, as Node's timers keep
 * @param {string} [limits.name] - The service, as an error names it, such as 'DexTools'; the url when none is given
 * @param {function(string, Object): Promise<Response>} [limits.fetch] - Sends the request, as Node's fetch does, which it is when none is given
 * @returns {Promise<Response>} The answer, its body read in full
 * @throws {RangeError} When the limit is not a whole number of milliseconds from 1 to `LONGEST_TIME_LIMIT_MS`
 * @throws {Error} When the time runs out, naming the service and the limit in seconds; or the error of a request that fails or that the caller's signal aborts
 */
export async function fetchWithinTimeLimit(url, options = {}, limits = {}) {
  const { timeoutMs, name = String(url), fetch: send = fetch } = limits;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > LONGEST_TIME_LIMIT_MS
  ) {
    throw new RangeError(
      `A time limit is a whole number of milliseconds from 1 to ${LONGEST_TIME_LIMIT_MS}, as Node's timers keep, not ${JSON.stringify(timeoutMs)}`,
    );
  }
  const limit = AbortSignal.timeout(timeoutMs);
  const signal =
    options.signal === undefined || options.signal === null
      ? limit
      : AbortSignal.any([options.signal, limit]);
  try {
    const response = await send(url, { ...options, signal });
    const body = NULL_BODY_STATUSES.has(response.status)
      ? null
      : await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    if (error?.name !== "TimeoutError") throw error;
    throw new Error(
      `${name} gave no answer within ${timeoutMs / 1000} seconds`,
      { cause: error },
    );
  }
}
