/**
 * Tests for `dex-prices/geckoterminal.js`, the GeckoTerminal client, part
 * two: a pool's candles page by page, and the candle and price of a time.
 * Part one, `dex-prices-geckoterminal.test.js`, covers the settings, a
 * token's facts and pools, and the pool to read its price from.
 * @module test/dex-prices-geckoterminal-candles.test
 *
 * GeckoTerminal is a stand-in (`helpers/gecko-terminal-stand-in.js`) that
 * answers from candles the tests build, so nothing outside the computer is
 * asked. Each test counts its requests in a budget record of its own, and
 * its waits are recorded rather than waited.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CANDLES_PER_REQUEST,
  PUBLIC_HISTORY_SECONDS,
  candleAt,
  candlePage,
  candlePrice,
  fetchCandles,
  priceAt,
} from "../dex-prices/geckoterminal.js";
import {
  API,
  HOUR,
  answerCandles,
  hourlyCandles,
  paramsOf,
  standIn,
} from "./helpers/gecko-terminal-stand-in.js";

describe("candlePage", () => {
  it("asks in USD for the token named, and reads the candles as numbers", async () => {
    const { settings, fetch } = standIn(() => ({
      data: {
        attributes: {
          ohlcv_list: [
            [7200, "2", "3", "1", "2.5", "9"],
            [3600, 1, 1.5, 0.5, 1, 4],
          ],
        },
      },
      meta: { base: { address: "0xbase" }, quote: { address: "0xquote" } },
    }));
    const page = await candlePage(
      {
        network: "pulsechain",
        pool: "0xpool",
        timeframe: "hour",
        token: "base",
        beforeSeconds: 7201,
      },
      settings,
    );
    assert.deepEqual(page, {
      candles: [
        [7200, 2, 3, 1, 2.5, 9],
        [3600, 1, 1.5, 0.5, 1, 4],
      ],
      base: "0xbase",
      quote: "0xquote",
      received: 2,
      outOfReach: false,
    });
    const request = fetch.requests[0];
    assert.ok(
      request.url.startsWith(
        `${API}/networks/pulsechain/pools/0xpool/ohlcv/hour?`,
      ),
    );
    const params = paramsOf(request);
    assert.equal(params.get("aggregate"), "1");
    assert.equal(params.get("limit"), String(CANDLES_PER_REQUEST));
    assert.equal(params.get("currency"), "usd");
    assert.equal(params.get("before_timestamp"), "7201");
    assert.equal(params.get("token"), "base");
  });

  it("asks for the latest candles in the pool's other token when told to", async () => {
    const { settings, fetch } = standIn(() => ({
      data: { attributes: { ohlcv_list: [] } },
    }));
    const page = await candlePage(
      {
        network: "x1-network",
        pool: "0xpool",
        timeframe: "day",
        currency: "token",
        limit: 5,
      },
      settings,
    );
    assert.deepEqual(page.candles, []);
    assert.equal(page.base, null);
    const params = paramsOf(fetch.requests[0]);
    assert.equal(params.get("currency"), "token");
    assert.equal(params.get("limit"), "5");
    assert.equal(params.has("before_timestamp"), false);
    assert.equal(params.has("token"), false);
  });

  it("drops candles it cannot read, and counts every candle sent", async () => {
    const { settings } = standIn(() => ({
      data: {
        attributes: {
          ohlcv_list: [
            [3600, 1, 1, 1, 0, 1],
            [7200, 1, 1],
            "x",
            [10800, "a", 1, 1, 1, 1],
            [14400, 1, 2, 1, 1.5, 3],
          ],
        },
      },
    }));
    const page = await candlePage(
      { network: "pulsechain", pool: "0xp", timeframe: "hour" },
      settings,
    );
    assert.deepEqual(page.candles, [[14400, 1, 2, 1, 1.5, 3]]);
    assert.equal(page.received, 5);
  });

  it("gives an empty page out of reach when the public api refuses the request as too old", async () => {
    const { settings } = standIn(() => ({ status: 401, text: "{}" }));
    const page = await candlePage(
      {
        network: "pulsechain",
        pool: "0xp",
        timeframe: "hour",
        beforeSeconds: 1,
      },
      settings,
    );
    assert.deepEqual(page, {
      candles: [],
      base: null,
      quote: null,
      received: 0,
      outOfReach: true,
    });
  });

  it("throws on any other error, and when the answer holds no candle list", async () => {
    const failing = standIn(() => ({ status: 500, text: "{}" }));
    await assert.rejects(
      candlePage(
        { network: "pulsechain", pool: "0xp", timeframe: "hour" },
        failing.settings,
      ),
      /GeckoTerminal answered 500/,
    );
    const empty = standIn(() => ({ data: {} }));
    await assert.rejects(
      candlePage(
        { network: "pulsechain", pool: "0xp", timeframe: "hour" },
        empty.settings,
      ),
      /no candle list for pool 0xp/,
    );
  });
});

describe("fetchCandles", () => {
  it("pages back from the later time to the earlier, oldest first", async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 30 * 24 * HOUR;
    const firstOpen = start - (start % HOUR);
    const pool = hourlyCandles(firstOpen, 30);
    const { settings, fetch, waits } = standIn((request) =>
      answerCandles(pool, request),
    );
    const earliest = firstOpen + 5 * HOUR;
    const latest = firstOpen + 24 * HOUR;
    const result = await fetchCandles(
      {
        network: "pulsechain",
        pool: "0xp",
        timeframe: "hour",
        token: "quote",
        limit: 8,
      },
      earliest,
      latest,
      settings,
    );
    assert.deepEqual(
      result.candles.map(([open]) => open),
      Array.from({ length: 20 }, (_, index) => earliest + index * HOUR),
    );
    assert.equal(result.base, "0xbase");
    assert.equal(result.quote, "0xquote");
    assert.equal(fetch.requests.length, 3);
    assert.deepEqual(waits, []);
    assert.equal(
      paramsOf(fetch.requests[0]).get("before_timestamp"),
      String(latest + HOUR),
    );
    assert.equal(paramsOf(fetch.requests[0]).get("token"), "quote");
  });

  it("stops once a page comes back short, when the pool has no older candles", async () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 10 * HOUR;
    const firstOpen = start - (start % HOUR);
    const pool = hourlyCandles(firstOpen, 6);
    const { settings, fetch } = standIn((request) =>
      answerCandles(pool, request),
    );
    const result = await fetchCandles(
      { network: "pulsechain", pool: "0xp", timeframe: "hour", limit: 100 },
      firstOpen - 50 * HOUR,
      firstOpen + 5 * HOUR,
      settings,
    );
    assert.equal(result.candles.length, 6);
    assert.equal(fetch.requests.length, 1);
  });

  it("asks its last page at the edge of the public api's 180 days, and never older", async () => {
    const before = Math.floor(Date.now() / 1000);
    const edge = before - PUBLIC_HISTORY_SECONDS + 24 * HOUR;
    const start = edge - 3000 * HOUR;
    const firstOpen = start - (start % HOUR);
    const pool = hourlyCandles(firstOpen, 3100);
    const { settings, fetch } = standIn((request) =>
      answerCandles(pool, request),
    );
    const latest = firstOpen + 3099 * HOUR;
    const result = await fetchCandles(
      { network: "pulsechain", pool: "0xp", timeframe: "hour" },
      firstOpen,
      latest,
      settings,
    );
    const befores = fetch.requests.map((request) =>
      Number(paramsOf(request).get("before_timestamp")),
    );
    const after = Math.floor(Date.now() / 1000);
    const lastBefore = befores.at(-1);
    assert.ok(lastBefore >= edge);
    assert.ok(lastBefore <= after - PUBLIC_HISTORY_SECONDS + 24 * HOUR);
    assert.ok(befores.every((time) => time >= before - PUBLIC_HISTORY_SECONDS));
    assert.equal(result.candles.at(-1)[0], latest);
    assert.ok(result.candles[0][0] > firstOpen);
  });

  it("gives no candles when the whole range is older than the public api serves", async () => {
    const { settings } = standIn(() => ({ status: 401, text: "{}" }));
    const result = await fetchCandles(
      { network: "pulsechain", pool: "0xp", timeframe: "hour" },
      0,
      HOUR,
      settings,
    );
    assert.deepEqual(result, { candles: [], base: null, quote: null });
  });
});

describe("candleAt and candlePrice", () => {
  const candles = [
    [7200, 2, 3, 1, 2.5, 9],
    [3600, 1, 1.5, 0.5, 1.25, 4],
  ];

  it("finds the candle that opened at the start of the time's period", () => {
    assert.deepEqual(candleAt(candles, 3600 + 1799, "hour"), candles[1]);
    assert.deepEqual(candleAt(candles, 7200, "hour"), candles[0]);
    assert.deepEqual(candleAt(candles, 3601, "minute"), candles[1]);
  });

  it("finds none for a period with no candle", () => {
    assert.equal(candleAt(candles, 10800 + 5, "hour"), null);
    assert.equal(candleAt(candles, 3661, "minute"), null);
  });

  it("reads each price by its name", () => {
    assert.equal(candlePrice(candles[0], "open"), 2);
    assert.equal(candlePrice(candles[0], "high"), 3);
    assert.equal(candlePrice(candles[0], "low"), 1);
    assert.equal(candlePrice(candles[0], "close"), 2.5);
  });
});

describe("priceAt", () => {
  const candles = [
    [3600, 1, 1, 1, 1.1, 1],
    [7200, 2, 2, 2, 2.2, 1],
    [10800, 3, 3, 3, 3.3, 1],
  ];

  it("gives the close of the last candle that opened at or before the time", () => {
    assert.equal(priceAt(candles, 7200, 86400), 2.2);
    assert.equal(priceAt(candles, 10799, 86400), 2.2);
    assert.equal(priceAt(candles, 20000, 86400), 3.3);
  });

  it("gives none before the first candle, or past the age allowed", () => {
    assert.equal(priceAt(candles, 3599, 86400), null);
    assert.equal(priceAt(candles, 10800 + 3600, 3600), null);
    assert.equal(priceAt([], 1, 86400), null);
  });
});
