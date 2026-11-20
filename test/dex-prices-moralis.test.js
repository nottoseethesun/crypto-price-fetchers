/**
 * Tests for `dex-prices/moralis.js`, the Moralis client: the block a chain
 * had at a time, and a token's price at a block.
 * @module test/dex-prices-moralis.test
 *
 * Moralis is a stand-in fetch (`helpers/stand-in-web.js`), so nothing
 * outside the computer is asked, and the key the tests send is a stand-in
 * too. The tests check that the key travels in its header and never in a
 * url.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MORALIS_API_URL,
  MORALIS_KEY_HEADER,
  blockAt,
  moralisSettings,
  priceAtBlock,
} from "../dex-prices/moralis.js";
import { standInFetch } from "./helpers/stand-in-web.js";

/** The stand-in api's address. */
const API = "https://moralis.test/api/v2.2";

/** The stand-in key. */
const STAND_IN_KEY = "stand-in-moralis-key";

/**
 * Settings that ask a stand-in Moralis.
 *
 * @param {function(Object): *} answer - The stand-in's answer to a request
 * @returns {{settings: Object, fetch: Function}} The settings and the fetch
 */
function standIn(answer) {
  const fetch = standInFetch(answer);
  return { settings: moralisSettings({ apiUrl: API, fetch }), fetch };
}

describe("moralisSettings", () => {
  it("completes the settings with Moralis's api", () => {
    const settings = moralisSettings();
    assert.equal(settings.apiUrl, MORALIS_API_URL);
    assert.equal(typeof settings.fetch, "function");
    assert.equal(MORALIS_KEY_HEADER, "X-API-Key");
  });
});

describe("blockAt", () => {
  it("asks for the chain's block at the time, with the key in its header only", async () => {
    const { settings, fetch } = standIn(() => ({
      block: 24123456,
      date: "2026-03-15T11:38:45.000Z",
    }));
    const block = await blockAt(
      { chain: "0x171", seconds: 1773574725 },
      STAND_IN_KEY,
      settings,
    );
    assert.equal(block, 24123456);
    const request = fetch.requests[0];
    assert.equal(request.url, `${API}/dateToBlock?chain=0x171&date=1773574725`);
    assert.equal(request.headers["x-api-key"], STAND_IN_KEY);
    assert.equal(request.url.includes(STAND_IN_KEY), false);
  });

  it("gives none when Moralis has no block, or answers 404", async () => {
    const odd = standIn(() => ({ block: "soon" }));
    assert.equal(
      await blockAt({ chain: "0x171", seconds: 1 }, STAND_IN_KEY, odd.settings),
      null,
    );
    const missing = standIn(() => null);
    assert.equal(
      await blockAt(
        { chain: "0x171", seconds: 1 },
        STAND_IN_KEY,
        missing.settings,
      ),
      null,
    );
  });

  it("throws when Moralis refuses the key, without the key in the message", async () => {
    const { settings } = standIn(() => ({
      status: 401,
      text: '{"message":"Token is invalid"}',
    }));
    await assert.rejects(
      blockAt({ chain: "0x171", seconds: 1 }, STAND_IN_KEY, settings),
      (error) => {
        assert.match(error.message, /Moralis answered 401/);
        assert.equal(error.message.includes(STAND_IN_KEY), false);
        return true;
      },
    );
  });
});

describe("priceAtBlock", () => {
  it("asks for the token's USD price at the block", async () => {
    const { settings, fetch } = standIn(() => ({
      usdPrice: 0.00181743,
      tokenSymbol: "HEX",
    }));
    const price = await priceAtBlock(
      { chain: "0x171", token: "0xtoken", block: 24123456 },
      STAND_IN_KEY,
      settings,
    );
    assert.equal(price, 0.00181743);
    const request = fetch.requests[0];
    assert.equal(
      request.url,
      `${API}/erc20/0xtoken/price?chain=0x171&to_block=24123456`,
    );
    assert.equal(request.headers["x-api-key"], STAND_IN_KEY);
  });

  it("gives none for a missing, zero or unreadable price, and for a 404", async () => {
    for (const body of [{}, { usdPrice: 0 }, { usdPrice: "n/a" }, null]) {
      const { settings } = standIn(() => body);
      assert.equal(
        await priceAtBlock(
          { chain: "0x171", token: "0xt", block: 1 },
          STAND_IN_KEY,
          settings,
        ),
        null,
      );
    }
  });

  it("throws on any other error", async () => {
    const { settings } = standIn(() => ({ status: 500, text: "{}" }));
    await assert.rejects(
      priceAtBlock(
        { chain: "0x171", token: "0xt", block: 1 },
        STAND_IN_KEY,
        settings,
      ),
      /Moralis answered 500/,
    );
  });
});
