/**
 * Tests for `dex-prices/web-request.js`, which sends a request to a price
 * service again after each wait while the service answers 429.
 * @module test/dex-prices-web-request.test
 *
 * The requests go to a stand-in fetch (`helpers/stand-in-web.js`), or, for
 * the default fetch, to a stand-in server on this computer, so nothing
 * outside the computer is asked. The waits are a stand-in that records
 * them, so no test waits.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REQUEST_TIMEOUT_MS,
  RETRY_DELAYS_MS,
  fetchWithRetries,
  requestSettings,
} from "../dex-prices/web-request.js";
import { standInFetch, startStandInWeb } from "./helpers/stand-in-web.js";

/**
 * A stand-in fetch that answers each request with the next status in a
 * list, and with the last status once the list runs out.
 *
 * @param {number[]} statuses - The statuses, in order
 * @returns {function(string, Object): Promise<Response>} The fetch, with its `requests`
 */
function answering(statuses) {
  let next = 0;
  return standInFetch(() => {
    const status = statuses[Math.min(next, statuses.length - 1)];
    next++;
    return { status, text: "{}" };
  });
}

/**
 * Settings whose waits are recorded rather than waited.
 *
 * @param {function(string, Object): Promise<Response>} fetch - The fetch
 * @param {Object} [overrides] - Settings in place of the defaults
 * @returns {{settings: Object, waits: number[], retries: Array<number[]>}} The settings, and what they recorded
 */
function recordingSettings(fetch, overrides = {}) {
  const waits = [];
  const retries = [];
  const settings = requestSettings({
    fetch,
    sleep: async (ms) => {
      waits.push(ms);
    },
    onRetry: (attempt, ms) => retries.push([attempt, ms]),
    ...overrides,
  });
  return { settings, waits, retries };
}

describe("fetchWithRetries", () => {
  it("gives the first answer other than 429, after a wait for each 429", async () => {
    const fetch = answering([429, 429, 200]);
    const { settings, waits, retries } = recordingSettings(fetch, {
      retryDelaysMs: [10, 20, 30],
    });
    const response = await fetchWithRetries(
      "https://service.test/price",
      { headers: { Accept: "application/json" } },
      settings,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(waits, [10, 20]);
    assert.deepEqual(retries, [
      [1, 10],
      [2, 20],
    ]);
    assert.equal(fetch.requests.length, 3);
    assert.equal(fetch.requests[0].headers.accept, "application/json");
  });

  it("gives the last 429 once every wait is used up", async () => {
    const fetch = answering([429]);
    const { settings, waits } = recordingSettings(fetch, {
      retryDelaysMs: [5],
    });
    const response = await fetchWithRetries(
      "https://service.test/price",
      {},
      settings,
    );
    assert.equal(response.status, 429);
    assert.deepEqual(waits, [5]);
    assert.equal(fetch.requests.length, 2);
  });

  it("gives any other error at once, without waiting", async () => {
    const fetch = answering([500]);
    const { settings, waits } = recordingSettings(fetch);
    const response = await fetchWithRetries(
      "https://service.test/price",
      {},
      settings,
    );
    assert.equal(response.status, 500);
    assert.deepEqual(waits, []);
  });

  it("gives every try a signal that aborts at the timeout", async () => {
    const signals = [];
    const fetch = async (_url, init) => {
      signals.push(init.signal);
      return new Response("{}", { status: signals.length === 1 ? 429 : 200 });
    };
    const { settings } = recordingSettings(fetch, { retryDelaysMs: [1] });
    await fetchWithRetries("https://service.test/price", {}, settings);
    assert.equal(signals.length, 2);
    for (const signal of signals) {
      assert.ok(signal instanceof AbortSignal);
      assert.equal(signal.aborted, false);
    }
  });

  it("waits for beforeTry before each try, a try sent again among them", async () => {
    const events = [];
    const fetch = async () => {
      events.push("try");
      return new Response("{}", {
        status:
          events.filter((event) => event === "try").length === 1 ? 429 : 200,
      });
    };
    const { settings } = recordingSettings(fetch, {
      retryDelaysMs: [1],
      beforeTry: async () => {
        events.push("budget");
      },
    });
    await fetchWithRetries("https://service.test/price", {}, settings);
    assert.deepEqual(events, ["budget", "try", "budget", "try"]);
  });

  it("throws when the request fails", async () => {
    const fetch = async () => {
      throw new Error("connection refused");
    };
    const { settings } = recordingSettings(fetch);
    await assert.rejects(
      fetchWithRetries("https://service.test/price", {}, settings),
      /connection refused/,
    );
  });
});

describe("requestSettings", () => {
  let web;

  before(async () => {
    web = await startStandInWeb(() => ({ answered: true }));
  });

  after(async () => {
    await web.close();
  });

  it("completes the settings with Node's fetch, real waits, and the waits and timeout above", async () => {
    const settings = requestSettings();
    assert.equal(settings.retryDelaysMs, RETRY_DELAYS_MS);
    assert.equal(settings.timeoutMs, REQUEST_TIMEOUT_MS);
    const response = await settings.fetch(`${web.url}/ping`, {});
    assert.deepEqual(await response.json(), { answered: true });
    await settings.sleep(1);
    assert.equal(await settings.beforeTry(), undefined);
    assert.equal(settings.onRetry(1, 1), undefined);
  });

  it("keeps the caller's own settings", () => {
    const sleep = async () => {};
    const settings = requestSettings({ retryDelaysMs: [1, 2], sleep });
    assert.deepEqual(settings.retryDelaysMs, [1, 2]);
    assert.equal(settings.sleep, sleep);
    assert.equal(settings.timeoutMs, REQUEST_TIMEOUT_MS);
  });
});
