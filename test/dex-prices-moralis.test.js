/**
 * Tests for `dex-prices/moralis.js`, the Moralis client: the block a chain
 * had at a time, a token's price at a block, and a pool's candles.
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
  pairCandles,
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
    assert.equal(settings.name, "Moralis");
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

describe("pairCandles", () => {
  /** HEX / WPLS, a pool that lists HEX first, and HEX, which its candles price. */
  const POOL = "0x19BB45a7270177e303DEe6eAA6F5Ad700812bA98";
  const HEX = "0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39";

  /**
   * A day's candle as Moralis writes it.
   *
   * @param {string} day - The day, YYYY-MM-DD
   * @param {number} close - Its close
   * @returns {Object} The candle
   */
  function day(day, close) {
    return {
      timestamp: `${day}T00:00:00.000Z`,
      open: close,
      high: close * 1.1,
      low: close * 0.9,
      close,
      volume: 1000,
      trades: 12,
    };
  }

  /** A query for two years of daily candles. */
  const QUERY = {
    chain: "0x171",
    pair: POOL,
    timeframe: "1d",
    fromSeconds: 1732147200,
    toSeconds: 1795219200,
  };

  it("reads every page, by its cursor, and gives the candles oldest first, with the token Moralis priced", async () => {
    // Moralis's pages, newest first, the second named by the first's cursor
    const { settings, fetch } = standIn(({ url }) =>
      new URL(url).searchParams.get("cursor") === "page-2"
        ? {
            cursor: null,
            tokenAddress: HEX,
            result: [day("2026-11-19", 0.0011)],
          }
        : {
            cursor: "page-2",
            tokenAddress: HEX,
            result: [day("2026-11-21", 0.0013), day("2026-11-20", 0.0012)],
          },
    );
    const { tokenAddress, candles } = await pairCandles(
      QUERY,
      STAND_IN_KEY,
      settings,
    );
    assert.equal(tokenAddress, HEX.toLowerCase());
    assert.deepEqual(
      candles.map(({ seconds, close }) => [seconds, close]),
      [
        [Date.UTC(2026, 10, 19) / 1000, 0.0011],
        [Date.UTC(2026, 10, 20) / 1000, 0.0012],
        [Date.UTC(2026, 10, 21) / 1000, 0.0013],
      ],
    );
    const first = new URL(fetch.requests[0].url);
    assert.equal(first.pathname, `/api/v2.2/pairs/${POOL}/ohlcv`);
    assert.deepEqual(Object.fromEntries(first.searchParams), {
      chain: "0x171",
      timeframe: "1d",
      currency: "usd",
      fromDate: "1732147200",
      toDate: "1795219200",
    });
    assert.equal(fetch.requests.length, 2);
    assert.equal(fetch.requests[1].headers["x-api-key"], STAND_IN_KEY);
    assert.ok(fetch.requests.every(({ url }) => !url.includes(STAND_IN_KEY)));
  });

  it("leaves out a candle with an unreadable field or a close not above 0", async () => {
    const { settings } = standIn(() => ({
      tokenAddress: HEX,
      result: [
        day("2026-11-21", 0.0013),
        { ...day("2026-11-20", 0.0012), timestamp: "soon" },
        day("2026-11-19", 0),
        { ...day("2026-11-18", 0.001), high: "much" },
      ],
    }));
    const { candles } = await pairCandles(QUERY, STAND_IN_KEY, settings);
    assert.deepEqual(
      candles.map(({ close }) => close),
      [0.0013],
    );
  });

  it("gives no candles, and no token, when Moralis answers 404", async () => {
    const { settings } = standIn(() => ({ status: 404, text: "{}" }));
    assert.deepEqual(await pairCandles(QUERY, STAND_IN_KEY, settings), {
      tokenAddress: null,
      candles: [],
    });
  });

  it("throws on any other error, and on more pages than it reads", async () => {
    const refused = standIn(() => ({ status: 401, text: "{}" }));
    await assert.rejects(
      pairCandles(QUERY, STAND_IN_KEY, refused.settings),
      /Moralis answered 401/,
    );
    let page = 0;
    const endless = standIn(() => ({
      cursor: `page-${++page}`,
      tokenAddress: HEX,
      result: [],
    }));
    await assert.rejects(
      pairCandles(QUERY, STAND_IN_KEY, endless.settings),
      /Moralis gave more than 50 pages of candles for pool/,
    );
    assert.equal(endless.fetch.requests.length, 50);
  });
});
