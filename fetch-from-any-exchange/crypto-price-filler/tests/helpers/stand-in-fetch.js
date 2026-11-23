/**
 * A stand-in fetch for the Node tool's price sources, in the test's own
 * process: its requests are answered by the test, and recorded.
 * @module tests/helpers/stand-in-fetch
 *
 * `answerWith(answer)` sets how each request is answered, as
 * `sheets-script.js` answers (a json body with status 200, null for a 404,
 * or its `reply(status, body)`), and clears `requests`, the requests made
 * since, each with its url and its headers by lower-case name. A test file
 * hands `standInFetch` to the code under test by mocking the module that
 * opens it:
 *
 * - the Sheets script's sources (`sources/exchange.js`), which run the
 *   script in a worker through the repo's runner: mock its Node version
 *   with `withStandInFetch`,
 *
 *     vi.mock("../../../bin/end-user/getCryptoPriceFromCentralizedExchange.js", async (importOriginal) => {
 *       const { withStandInFetch } = await import("./helpers/stand-in-fetch.js");
 *       return withStandInFetch(await importOriginal());
 *     });
 *
 *   and close the sources after each test (`closeExchangeSources`), so the
 *   next opens the script afresh, with an empty cache;
 * - the pool sources (`sources/moralis.js`, `sources/geckoterminal.js`):
 *   mock the shared client's settings function so that it takes
 *   `standInFetch` and waits for nothing.
 *
 * The code under test runs for real; only the web is a stand-in.
 */

import { replyOf } from "./sheets-script.js";

/** The requests made since `answerWith` was last called: each one's url, and its headers by lower-case name. */
export const requests = [];

/** The urls asked since `answerWith` was last called, in order. */
export const asked = [];

/** How each request is answered (`sheets-script.js`). */
let answer = () => null;

/**
 * Sets how the stand-in web answers, and clears the requests made.
 *
 * @param {function(string, {url: string, headers: Object<string, string>}): *} answerFunction - A json body for a request, null for a 404, or a reply
 * @returns {void}
 */
export function answerWith(answerFunction) {
  requests.length = 0;
  asked.length = 0;
  answer = answerFunction;
}

/**
 * The stand-in fetch: records the request and answers from `answer`.
 *
 * @param {string|URL} url - The url
 * @param {{headers: (Object<string, string>|undefined)}} [init] - The request's options
 * @returns {Promise<Response>} The answer
 */
export async function standInFetch(url, init = {}) {
  const request = {
    url: String(url),
    headers: Object.fromEntries(new Headers(init.headers ?? {})),
  };
  requests.push(request);
  asked.push(request.url);
  const { status, text } = replyOf(answer(request.url, request));
  return new Response(text, {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * The Node version's module, with `openCentralizedExchangeSources` opening
 * the script with the stand-in fetch.
 *
 * @param {Object} real - The real module
 * @returns {Object} The module to use in its place
 */
export function withStandInFetch(real) {
  return {
    ...real,
    openCentralizedExchangeSources: (options = {}) =>
      real.openCentralizedExchangeSources({ ...options, fetch: standInFetch }),
  };
}
