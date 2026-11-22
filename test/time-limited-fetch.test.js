/**
 * Tests for `lib/time-limited-fetch.js`, which sends a request and reads its
 * whole answer within a time limit.
 * @module test/time-limited-fetch.test
 *
 * A service that never answers, or that sends its headers and then stops,
 * is a stand-in server on this computer, so the limit is met for real and
 * nothing outside the computer is asked. Answers in full come from a
 * stand-in fetch (`helpers/stand-in-web.js`).
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchWithinTimeLimit } from "../lib/time-limited-fetch.js";
import { standInFetch } from "./helpers/stand-in-web.js";

/** A short limit, so a test that meets it ends soon. */
const LIMIT_MS = 200;

let server;
let base;

before(async () => {
  server = http.createServer((request, response) => {
    // /silent never answers; /stops sends its headers and part of a body
    if (request.url === "/stops") {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"partial":');
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("fetchWithinTimeLimit", () => {
  it("gives the answer, its body read in full, as a Response", async () => {
    const fetch = standInFetch(() => ({ status: 201, text: '{"block":7}' }));
    const response = await fetchWithinTimeLimit(
      "https://node.test/block",
      { headers: { Accept: "application/json" } },
      { timeoutMs: LIMIT_MS, fetch },
    );
    assert.ok(response instanceof Response);
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { block: 7 });
    assert.equal(fetch.requests[0].headers.accept, "application/json");
  });

  it("names the service and the limit when a server gives no answer in time", async () => {
    await assert.rejects(
      fetchWithinTimeLimit(
        `${base}/silent`,
        {},
        {
          timeoutMs: LIMIT_MS,
          name: "the beacon node",
        },
      ),
      { message: "the beacon node gave no answer within 0.2 seconds" },
    );
  });

  it("holds the answer's body to the limit too, naming the url when no name is given", async () => {
    await assert.rejects(
      fetchWithinTimeLimit(`${base}/stops`, {}, { timeoutMs: LIMIT_MS }),
      { message: `${base}/stops gave no answer within 0.2 seconds` },
    );
  });

  it("lets the caller's own signal abort the request, with the abort's own error", async () => {
    const caller = new AbortController();
    const asked = fetchWithinTimeLimit(
      `${base}/silent`,
      { signal: caller.signal },
      { timeoutMs: 60000 },
    );
    caller.abort();
    await assert.rejects(asked, { name: "AbortError" });
  });

  it("gives an answer that has no body, such as a 204", async () => {
    const fetch = async () => new Response(null, { status: 204 });
    const response = await fetchWithinTimeLimit(
      "https://node.test/",
      {},
      {
        timeoutMs: LIMIT_MS,
        fetch,
      },
    );
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
  });

  it("refuses a limit that is not a number of milliseconds above 0", async () => {
    for (const timeoutMs of [0, -1, "30", undefined, Number.NaN]) {
      await assert.rejects(
        fetchWithinTimeLimit("https://node.test/", {}, { timeoutMs }),
        RangeError,
      );
    }
  });
});
