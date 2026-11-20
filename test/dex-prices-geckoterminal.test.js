/**
 * Tests for `dex-prices/geckoterminal.js`, the GeckoTerminal client, part
 * one: its settings and the budget of requests every caller shares, a
 * token's facts and pools, and the pool to read its price from. Part two,
 * `dex-prices-geckoterminal-candles.test.js`, covers candles and prices.
 * @module test/dex-prices-geckoterminal.test
 *
 * GeckoTerminal is a stand-in fetch (`helpers/stand-in-web.js`, through
 * `helpers/gecko-terminal-stand-in.js`) that answers from pools the tests
 * build, so nothing outside the computer is asked. Each test counts its
 * requests in a budget record of its own, and its waits are recorded
 * rather than waited.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GECKO_TERMINAL_API_URL,
  bestPool,
  geckoTerminalSettings,
  tokenInfo,
  tokenPools,
} from "../dex-prices/geckoterminal.js";
import { standInFetch } from "./helpers/stand-in-web.js";
import { API, standIn } from "./helpers/gecko-terminal-stand-in.js";

/**
 * A pool as GeckoTerminal lists it for a token.
 *
 * @param {Object} pool - Its facts
 * @returns {Object} The pool, as GeckoTerminal sends it
 */
function listedPool({ address, liquidity, volume, base, quote }) {
  return {
    attributes: {
      address,
      name: `${address} pool`,
      reserve_in_usd: liquidity,
      volume_usd: { h24: volume },
    },
    relationships: {
      base_token: { data: { id: `pulsechain_${base}` } },
      quote_token: { data: { id: `pulsechain_${quote}` } },
    },
  };
}

describe("geckoTerminalSettings", () => {
  it("completes the settings with GeckoTerminal's api, a clock and the shared budget", () => {
    const settings = geckoTerminalSettings();
    assert.equal(settings.apiUrl, GECKO_TERMINAL_API_URL);
    assert.equal(typeof settings.now(), "number");
    assert.ok(Array.isArray(settings.requestLog));
    assert.equal(geckoTerminalSettings().requestLog, settings.requestLog);
  });

  it("waits before a request until the budget of twenty a minute has room", async () => {
    let clock = 1_000_000;
    const waits = [];
    const requestLog = Array.from(
      { length: 20 },
      (_, index) => clock - 59_000 + index,
    );
    const settings = geckoTerminalSettings({
      apiUrl: API,
      fetch: standInFetch(() => ({ data: {} })),
      requestLog,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    await tokenInfo({ network: "pulsechain", token: "0xt" }, settings);
    assert.deepEqual(waits, [1000]);
    assert.equal(requestLog.at(-1), 1_001_000);
  });

  it("sends at once while the budget has room, dropping requests older than the window", async () => {
    const clock = 1_000_000;
    const waits = [];
    const requestLog = Array.from(
      { length: 20 },
      (_, index) => clock - 60_000 - index,
    );
    const settings = geckoTerminalSettings({
      apiUrl: API,
      fetch: standInFetch(() => ({ data: {} })),
      requestLog,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await tokenInfo({ network: "pulsechain", token: "0xt" }, settings);
    assert.deepEqual(waits, []);
    assert.deepEqual(requestLog, [clock]);
  });
});

describe("tokenInfo", () => {
  it("reads a token's name, symbol and CoinGecko coin", async () => {
    const { settings, fetch } = standIn(() => ({
      data: {
        attributes: {
          name: "HEX",
          symbol: "HEX",
          coingecko_coin_id: "hex-pulsechain",
        },
      },
    }));
    const info = await tokenInfo(
      { network: "pulsechain", token: "0xtoken" },
      settings,
    );
    assert.deepEqual(info, {
      name: "HEX",
      symbol: "HEX",
      coingeckoCoinId: "hex-pulsechain",
    });
    assert.equal(
      fetch.requests[0].url,
      `${API}/networks/pulsechain/tokens/0xtoken`,
    );
  });

  it("gives nulls for what GeckoTerminal leaves out", async () => {
    const { settings } = standIn(() => ({ data: {} }));
    assert.deepEqual(
      await tokenInfo({ network: "pulsechain", token: "0xt" }, settings),
      { name: null, symbol: null, coingeckoCoinId: null },
    );
  });

  it("throws when GeckoTerminal does not know the token", async () => {
    const { settings } = standIn(() => null);
    await assert.rejects(
      tokenInfo({ network: "pulsechain", token: "0xnone" }, settings),
      /GeckoTerminal answered 404/,
    );
  });
});

describe("tokenPools", () => {
  it("lists the pools with their liquidity, volume, and the token's side", async () => {
    const { settings, fetch } = standIn(() => ({
      data: [
        listedPool({
          address: "0xa",
          liquidity: "389546.12",
          volume: "5000",
          base: "0xHeX",
          quote: "0xwpls",
        }),
        listedPool({
          address: "0xb",
          liquidity: "180012",
          volume: "20",
          base: "0xusdc",
          quote: "0xhex",
        }),
        listedPool({
          address: "0xc",
          liquidity: "100",
          volume: "1",
          base: "0xother",
          quote: "0xwpls",
        }),
        {},
      ],
    }));
    const pools = await tokenPools(
      { network: "pulsechain", token: "0xHEX" },
      settings,
    );
    assert.deepEqual(pools, [
      {
        address: "0xa",
        name: "0xa pool",
        liquidityUsd: 389546.12,
        volume24hUsd: 5000,
        side: "base",
      },
      {
        address: "0xb",
        name: "0xb pool",
        liquidityUsd: 180012,
        volume24hUsd: 20,
        side: "quote",
      },
      {
        address: "0xc",
        name: "0xc pool",
        liquidityUsd: 100,
        volume24hUsd: 1,
        side: null,
      },
      { address: "", name: "", liquidityUsd: 0, volume24hUsd: 0, side: null },
    ]);
    assert.equal(
      fetch.requests[0].url,
      `${API}/networks/pulsechain/tokens/0xHEX/pools?page=1`,
    );
  });

  it("gives no pools when GeckoTerminal lists none", async () => {
    const { settings } = standIn(() => ({}));
    assert.deepEqual(
      await tokenPools({ network: "pulsechain", token: "0xt" }, settings),
      [],
    );
  });
});

describe("bestPool", () => {
  const pool = (address, liquidityUsd, volume24hUsd, side) => ({
    address,
    name: address,
    liquidityUsd,
    volume24hUsd,
    side,
  });

  it("picks the deepest of the pools considered that trade the token on one of their sides", () => {
    const pools = [
      pool("0xa", 100, 5, "base"),
      pool("0xb", 900, 0, "base"),
      pool("0xc", 800, 5, null),
      pool("0xd", 300, 5, "quote"),
      pool("0xe", 5000, 5, "base"),
    ];
    assert.equal(bestPool(pools, 4).address, "0xd");
    assert.equal(bestPool(pools, 5).address, "0xe");
  });

  it("gives none when no pool considered qualifies", () => {
    assert.equal(
      bestPool([pool("", 1, 1, "base"), pool("0xb", 1, 0, "base")], 10),
      null,
    );
    assert.equal(bestPool([], 10), null);
  });
});
