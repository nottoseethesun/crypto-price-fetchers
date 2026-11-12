/**
 * Stand-ins for the web, for the tests of Sheets scripts run under Node,
 * so the tests ask nothing outside the computer.
 * @module test/helpers/stand-in-web
 *
 * Both stand-ins answer each request from the test's `answer` function,
 * which takes `{url, method, headers, body}`, headers by lower-case name,
 * and returns the response: a body to send as JSON with status 200, a
 * `{status, text}` to send as it is, or null for a 404. Each keeps the
 * requests it answered, in order, in its `requests` array.
 *
 * - `standInFetch` is a fetch, shaped as Node's own, to hand to the runner
 *   in place of Node's fetch. It gives up when the request's signal aborts,
 *   as Node's fetch does.
 * - `startStandInWeb` is an http server on this computer, for the tests of
 *   the runner with Node's own fetch.
 */

import http from 'node:http';

/**
 * Turns what `answer` returned into a status and text.
 *
 * @param {*} answered - What `answer` returned
 * @returns {{status: number, text: string}} The response
 */
function toResponse(answered) {
  if (answered === null) return { status: 404, text: 'Not found' };
  if (typeof answered === 'object' && typeof answered.status === 'number' && typeof answered.text === 'string') {
    return answered;
  }
  return { status: 200, text: JSON.stringify(answered) };
}

/**
 * Builds a fetch that answers from `answer`.
 *
 * @param {function({url: string, method: string, headers: Object<string, string>, body: (string|undefined)}): *} answer - The response for a request
 * @returns {function(string, Object): Promise<Response>} The fetch, with the requests it answered in its `requests` array
 */
export function standInFetch(answer) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    init.signal?.throwIfAborted();
    const headers = Object.fromEntries(new Headers(init.headers ?? {}));
    const request = { url, method: init.method ?? 'GET', headers, body: init.body ?? undefined };
    requests.push(request);
    const { status, text } = toResponse(answer(request));
    return new Response(text, { status, headers: { 'content-type': 'application/json' } });
  };
  fetch.requests = requests;
  return fetch;
}

/**
 * Starts an http server on this computer that answers from `answer`.
 *
 * @param {function({url: string, method: string, headers: Object<string, string>, body: string}): *} answer - The response for a request; its url is the path asked for
 * @returns {Promise<{url: string, requests: Array<Object>, close: function(): Promise<void>}>} The server's base url, the requests it answered, and a way to stop it
 */
export async function startStandInWeb(answer) {
  const requests = [];
  const server = http.createServer((incoming, outgoing) => {
    let body = '';
    incoming.setEncoding('utf8');
    incoming.on('data', (chunk) => {
      body += chunk;
    });
    incoming.on('end', () => {
      const request = { url: incoming.url, method: incoming.method, headers: incoming.headers, body };
      requests.push(request);
      const { status, text } = toResponse(answer(request));
      outgoing.writeHead(status, { 'content-type': 'application/json', 'x-stand-in': 'yes' });
      outgoing.end(text);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  };
}
