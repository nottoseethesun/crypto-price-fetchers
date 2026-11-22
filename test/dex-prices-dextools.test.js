/**
 * Tests for `dex-prices/dextools.js`, the DexTools client: a token's current
 * price in USD.
 * @module test/dex-prices-dextools.test
 *
 * DexTools is a stand-in fetch (`helpers/stand-in-web.js`), or, for its
 * time limit, a stand-in server on this computer that never answers, so
 * nothing outside the computer is asked. The key the tests send is a
 * stand-in too; the tests check that it travels in its header, and in no
 * url or error message.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  DEXTOOLS_API_URL,
  DEXTOOLS_KEY_HEADER,
  currentUsdPrice,
  dexToolsSettings,
} from "../dex-prices/dextools.js";
import { standInFetch } from "./helpers/stand-in-web.js";

/** The stand-in key. */
const STAND_IN_KEY = "stand-in-dextools-key";

/** HEX, on PulseChain, as DexTools names the chain. */
const QUERY = {
  chain: "pulse",
  token: "0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39",
};

/**
 * Settings that ask a stand-in DexTools, recording the waits after a 429.
 *
 * @param {function(Object): *} answer - The stand-in's answer to a request
 * @returns {{settings: Object, fetch: Function, waits: number[]}} The settings, the fetch, and the waits
 */
function standIn(answer) {
  const fetch = standInFetch(answer);
  const waits = [];
  const settings = dexToolsSettings({
    host: "https://dextools.test",
    fetch,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  return { settings, fetch, waits };
}

describe("dexToolsSettings", () => {
  it("completes the settings with DexTools' api, the standard plan, version 2 and its name", () => {
    const settings = dexToolsSettings();
    assert.equal(settings.host, DEXTOOLS_API_URL);
    assert.equal(settings.plan, "standard");
    assert.equal(settings.version, "v2");
    assert.equal(settings.name, "DexTools");
    assert.equal(DEXTOOLS_KEY_HEADER, "X-API-Key");
  });

  it("keeps the caller's own plan and address", () => {
    const settings = dexToolsSettings({
      plan: "trial",
      host: "https://x.test",
    });
    assert.equal(settings.plan, "trial");
    assert.equal(settings.host, "https://x.test");
  });
});

describe("currentUsdPrice", () => {
  it("asks for the token's price on the chain, at the plan's path, with the key in its header only", async () => {
    const { settings, fetch } = standIn(() => ({ data: { price: 0.00106 } }));
    assert.equal(await currentUsdPrice(QUERY, STAND_IN_KEY, settings), 0.00106);
    const request = fetch.requests[0];
    assert.equal(
      request.url,
      `https://dextools.test/standard/v2/token/pulse/${QUERY.token}/price`,
    );
    assert.equal(request.headers["x-api-key"], STAND_IN_KEY);
    assert.equal(request.url.includes(STAND_IN_KEY), false);
  });

  it("reads a price DexTools writes as text", async () => {
    const { settings } = standIn(() => ({ data: { price: "2.5" } }));
    assert.equal(await currentUsdPrice(QUERY, STAND_IN_KEY, settings), 2.5);
  });

  it("waits out a 429, then reads the answer", async () => {
    let tries = 0;
    const { settings, waits } = standIn(() =>
      ++tries === 1 ? { status: 429, text: "{}" } : { data: { price: 3 } },
    );
    assert.equal(await currentUsdPrice(QUERY, STAND_IN_KEY, settings), 3);
    assert.deepEqual(waits, [10000]);
  });

  it("throws on an error status, an answer that is not json, and no price above 0, never naming the key", async () => {
    const answers = [
      [{ status: 403, text: '{"error":"plan"}' }, /DexTools answered 403/],
      [{ status: 200, text: "<html>" }, /not json/],
      [{ data: {} }, /DexTools gave no price for 0x2b591e/],
      [{ data: { price: 0 } }, /DexTools gave no price/],
    ];
    for (const [answer, message] of answers) {
      const { settings } = standIn(() => answer);
      await assert.rejects(
        currentUsdPrice(QUERY, STAND_IN_KEY, settings),
        (error) => {
          assert.match(error.message, message);
          assert.equal(error.message.includes(STAND_IN_KEY), false);
          return true;
        },
      );
    }
  });
});

describe("currentUsdPrice, against a DexTools that gives no answer", () => {
  let server;
  let base;

  before(async () => {
    server = http.createServer(() => {});
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it("gives up at the time limit, naming DexTools", async () => {
    const settings = dexToolsSettings({ host: base, timeoutMs: 200 });
    await assert.rejects(currentUsdPrice(QUERY, STAND_IN_KEY, settings), {
      message: "DexTools gave no answer within 0.2 seconds",
    });
  });
});
