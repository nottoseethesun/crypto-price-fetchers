/**
 * Tests of the Sheets script's price sources, MEXC, CoinGecko and
 * CoinPaprika, which the sheet and the Node tool both price with.
 * @module tests/sheets-sources.test
 *
 * The script, getCryptoPriceFromCentralizedExchange.gs with its
 * `-sources.gs`, runs unchanged in the test's thread
 * (`helpers/sheets-script.js`), each test answering the urls it asks.
 * A source takes the time in UTC milliseconds and "high", "low" or
 * "close", and gives the price in USD, or null.
 */

import { describe, it, expect } from "vitest";
import path from "path";
import { loadSheetsScript, rawReply, reply } from "./helpers/sheets-script.js";
import { mexcKlines } from "../../../test/helpers/stand-in-mexc.js";

const SHEETS_SCRIPT_PATH = [
  "../../getCryptoPriceFromCentralizedExchange.gs",
  "../../getCryptoPriceFromCentralizedExchange-sources.gs",
].map((file) => path.resolve(__dirname, file));

/** 12:30 UTC on 2025-06-15, the time most tests price. */
const TIME_MS = Date.UTC(2025, 5, 15, 12, 30, 0);

/** The prices of XTMUSDT's candles: open 1.00, high 1.50, low 0.80, close 1.10, volume 10. */
const XTM_PRICES = ["1.00", "1.50", "0.80", "1.10", "10"];

/**
 * Loads the script with an answer function, recording each request asked.
 *
 * @param {function(string, Object): *} answer - How each url is answered (`loadSheetsScript`)
 * @param {Object} [options] - Config values and the sleep (`loadSheetsScript`)
 * @returns {{script: Object, asked: Array<{url: string, headers: Object}>, waits: number[]}} The script, the requests, and the waits it made
 */
function scriptAnswering(answer, options = {}) {
  const asked = [];
  const waits = [];
  const script = loadSheetsScript(
    SHEETS_SCRIPT_PATH,
    (url, request) => {
      asked.push({ url, headers: request.headers });
      return answer(url, request);
    },
    { sleep: (ms) => waits.push(ms), ...options },
  );
  return { script, asked, waits };
}

/**
 * Answers as MEXC does for pairs it lists, a klines request with the
 * candle of the period asked (`test/helpers/stand-in-mexc.js`).
 *
 * @param {Array<{baseAsset: string, quoteAsset: string}>} pairs - The pairs exchangeInfo lists
 * @param {function(string): ?string[]} klines - The prices of the candles MEXC keeps for a klines url's pair and interval, or null when it keeps none
 * @returns {function(string): *} The answer function
 */
function mexcAnswering(pairs, klines) {
  return (url) => {
    if (url.includes("/exchangeInfo")) {
      return {
        symbols: pairs.map((pair) => ({
          ...pair,
          symbol: pair.baseAsset + pair.quoteAsset,
        })),
      };
    }
    if (url.includes("/klines")) {
      const prices = klines(url);
      return prices === null ? [] : mexcKlines(url, prices);
    }
    return null;
  };
}

const XTM_USDT = [{ baseAsset: "XTM", quoteAsset: "USDT" }];

describe("MEXC (getPriceFromMEXC)", () => {
  it("gives the high, the low or the close of the 1-minute candle holding the time", () => {
    const { script } = scriptAnswering(
      mexcAnswering(XTM_USDT, () => XTM_PRICES),
    );
    expect(script.getPriceFromMEXC("XTM", TIME_MS, "high")).toBe(1.5);
    expect(script.getPriceFromMEXC("XTM", TIME_MS, "low")).toBe(0.8);
    expect(script.getPriceFromMEXC("XTM", TIME_MS, "close")).toBe(1.1);
  });

  it("gives null for a target it does not know", () => {
    const { script } = scriptAnswering(
      mexcAnswering(XTM_USDT, () => XTM_PRICES),
    );
    expect(script.getPriceFromMEXC("XTM", TIME_MS, "open")).toBeNull();
  });

  it("skips GridCoin, in any letter case, asking nothing", () => {
    const { script, asked } = scriptAnswering(() => null);
    expect(script.getPriceFromMEXC("grc", TIME_MS, "high")).toBeNull();
    expect(script.getPriceFromMEXC("GRC", TIME_MS, "high")).toBeNull();
    expect(asked).toEqual([]);
  });

  it("gives null for a coin it lists no USDT or BTC pair for", () => {
    const { script } = scriptAnswering(
      mexcAnswering(
        [{ baseAsset: "XTM", quoteAsset: "ETH" }],
        () => XTM_PRICES,
      ),
    );
    expect(script.getPriceFromMEXC("XTM", TIME_MS, "high")).toBeNull();
  });

  it("prices a BTC pair in USD with BTC/USDT's candle of the same minute, target for target", () => {
    const { script, asked } = scriptAnswering(
      mexcAnswering([{ baseAsset: "XMR", quoteAsset: "BTC" }], (url) =>
        url.includes("symbol=BTCUSDT")
          ? ["60000", "62000", "59000", "61000", "1"]
          : ["0.005", "0.006", "0.004", "0.0055", "1"],
      ),
    );
    expect(script.getPriceFromMEXC("XMR", TIME_MS, "high")).toBeCloseTo(
      0.006 * 62000,
      8,
    );
    expect(script.getPriceFromMEXC("XMR", TIME_MS, "close")).toBeCloseTo(
      0.0055 * 61000,
      8,
    );
    const windowAsked = (symbol) => {
      const query = new URL(
        asked.find((request) => request.url.includes(`symbol=${symbol}`)).url,
      ).searchParams;
      return [query.get("startTime"), query.get("endTime")];
    };
    expect(windowAsked("BTCUSDT")).toEqual([
      String(TIME_MS),
      String(TIME_MS + 59999),
    ]);
    expect(windowAsked("XMRBTC")).toEqual(windowAsked("BTCUSDT"));
  });

  it("gives null for a BTC pair when MEXC has no BTC/USDT candle for the time", () => {
    const { script } = scriptAnswering(
      mexcAnswering([{ baseAsset: "XMR", quoteAsset: "BTC" }], (url) =>
        url.includes("symbol=BTCUSDT")
          ? null
          : ["0.005", "0.006", "0.004", "0.0055", "1"],
      ),
    );
    expect(script.getPriceFromMEXC("XMR", TIME_MS, "high")).toBeNull();
  });

  it("takes the candle of the hour that holds the time when MEXC keeps no candle of its minute", () => {
    const { script, asked } = scriptAnswering(
      mexcAnswering(XTM_USDT, (url) =>
        url.includes("interval=1m")
          ? null
          : ["1.00", "1.70", "0.90", "1.20", "60"],
      ),
    );
    expect(script.getPriceFromMEXC("XTM", TIME_MS, "high")).toBe(1.7);
    const hour = asked.find((request) => request.url.includes("interval=60m"));
    const query = new URL(hour.url).searchParams;
    expect([query.get("startTime"), query.get("endTime")]).toEqual([
      String(TIME_MS - 1800000),
      String(TIME_MS + 1799999),
    ]);
  });

  it("refuses an interval in CONFIG whose length it does not know, asking MEXC for no candle", () => {
    const { script, asked } = scriptAnswering(
      mexcAnswering(XTM_USDT, () => XTM_PRICES),
      { config: { CONFIG: { DEFAULT_INTERVAL: "5m" } } },
    );
    expect(() => script.getPriceFromMEXC("XTM", TIME_MS, "high")).toThrow(
      "MEXC interval 5m is not one the script knows",
    );
    expect(asked.some((request) => request.url.includes("/klines"))).toBe(
      false,
    );
  });

  it("gives null when neither interval has a candle", () => {
    const { script } = scriptAnswering(mexcAnswering(XTM_USDT, () => null));
    expect(script.getPriceFromMEXC("XTM", TIME_MS, "high")).toBeNull();
  });

  it("asks again after each wait in RETRY_DELAYS_MS while MEXC answers 429, and gives up after the last", () => {
    let refusals = 2;
    const retried = scriptAnswering((url) => {
      if (url.includes("/exchangeInfo") && refusals > 0) {
        refusals -= 1;
        return reply(429);
      }
      return mexcAnswering(XTM_USDT, () => XTM_PRICES)(url);
    });
    expect(retried.script.getPriceFromMEXC("XTM", TIME_MS, "close")).toBe(1.1);
    expect(retried.waits).toEqual([5000, 5000]);

    const refused = scriptAnswering(() => reply(429));
    expect(refused.script.getPriceFromMEXC("XTM", TIME_MS, "close")).toBeNull();
    expect(refused.asked).toHaveLength(3);
  });

  it("gives null when exchangeInfo or the klines answer with a body that is no json", () => {
    const badInfo = scriptAnswering((url) =>
      url.includes("/exchangeInfo") ? rawReply(200, "<html>") : null,
    );
    expect(badInfo.script.getPriceFromMEXC("XTM", TIME_MS, "high")).toBeNull();
    const badKlines = scriptAnswering((url) =>
      url.includes("/klines")
        ? rawReply(200, "<html>")
        : mexcAnswering(XTM_USDT, () => null)(url),
    );
    expect(
      badKlines.script.getPriceFromMEXC("XTM", TIME_MS, "high"),
    ).toBeNull();
  });
});

/**
 * Answers as CoinGecko does: hourly points for the range, the day's price
 * for history, and a ticker whose price is today's, which no source may
 * ask for.
 *
 * @param {Array<[number, number]>} points - The range's [time in ms, price] points
 * @param {?number} dayPrice - The history's price, or null for a 404
 * @returns {function(string): *} The answer function
 */
function coinGeckoAnswering(points, dayPrice) {
  return (url) => {
    if (url.includes("/market_chart/range")) return { prices: points };
    if (url.includes("/history")) {
      return dayPrice === null
        ? null
        : { market_data: { current_price: { usd: dayPrice } } };
    }
    if (url.includes("/tickers")) return { tickers: [{ last: 99 }] };
    return null;
  };
}

const HOURLY_POINTS = [
  [TIME_MS - 3600000, 2.0],
  [TIME_MS - 600000, 2.4],
  [TIME_MS + 3600000, 1.8],
];

describe("CoinGecko (getPriceFromCoinGecko)", () => {
  it("asks for the prices from 12 hours before the time to 12 hours after it, in seconds", () => {
    const { script, asked } = scriptAnswering(
      coinGeckoAnswering(HOURLY_POINTS, null),
    );
    script.getPriceFromCoinGecko("tezos", TIME_MS, "high");
    const range = new URL(asked[0].url);
    expect(range.pathname).toBe("/api/v3/coins/tezos/market_chart/range");
    expect(range.searchParams.get("vs_currency")).toBe("usd");
    expect(Number(range.searchParams.get("from"))).toBe(
      (TIME_MS - 43200000) / 1000,
    );
    expect(Number(range.searchParams.get("to"))).toBe(
      (TIME_MS + 43200000) / 1000,
    );
  });

  it("stops the range at now for a time less than 12 hours ago", () => {
    const { script, asked } = scriptAnswering(
      coinGeckoAnswering(HOURLY_POINTS, null),
    );
    const recent = Date.now() - 3600000;
    script.getPriceFromCoinGecko("tezos", recent, "high");
    const to = Number(new URL(asked[0].url).searchParams.get("to"));
    expect(to).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });

  it("gives the highest point for high, the lowest for low, and the one nearest the time for close", () => {
    const { script } = scriptAnswering(coinGeckoAnswering(HOURLY_POINTS, null));
    expect(script.getPriceFromCoinGecko("tezos", TIME_MS, "high")).toBe(2.4);
    expect(script.getPriceFromCoinGecko("tezos", TIME_MS, "low")).toBe(1.8);
    expect(script.getPriceFromCoinGecko("tezos", TIME_MS, "close")).toBe(2.4);
  });

  it("passes over points that are not a time and a price", () => {
    const { script } = scriptAnswering(
      coinGeckoAnswering([[TIME_MS, "2"], [TIME_MS], [TIME_MS, 3.5]], null),
    );
    expect(script.getPriceFromCoinGecko("tezos", TIME_MS, "high")).toBe(3.5);
  });

  it("gives the price of the UTC day for close once the range is empty, never the current one", () => {
    const { script, asked } = scriptAnswering(coinGeckoAnswering([], 1.23));
    expect(script.getPriceFromCoinGecko("tezos", TIME_MS, "close")).toBe(1.23);
    const history = asked.find((request) => request.url.includes("/history"));
    expect(new URL(history.url).searchParams.get("date")).toBe("15-06-2025");
    expect(asked.some((request) => request.url.includes("/tickers"))).toBe(
      false,
    );
  });

  it("gives no high or low from the day's single price, asking no history", () => {
    const { script, asked } = scriptAnswering(coinGeckoAnswering([], 1.23));
    expect(script.getPriceFromCoinGecko("tezos", TIME_MS, "high")).toBeNull();
    expect(script.getPriceFromCoinGecko("tezos", TIME_MS, "low")).toBeNull();
    expect(asked.some((request) => request.url.includes("/history"))).toBe(
      false,
    );
  });

  it("gives null when both requests answer 404, or history has no price", () => {
    expect(
      scriptAnswering(() => null).script.getPriceFromCoinGecko(
        "tezos",
        TIME_MS,
        "close",
      ),
    ).toBeNull();
    const noPrice = scriptAnswering((url) =>
      url.includes("/history") ? { market_data: {} } : { prices: [] },
    );
    expect(
      noPrice.script.getPriceFromCoinGecko("tezos", TIME_MS, "close"),
    ).toBeNull();
  });

  it("sends the demo key set in CONFIG in CoinGecko's header, and none without one", () => {
    const keyed = scriptAnswering(coinGeckoAnswering(HOURLY_POINTS, null), {
      config: { CONFIG: { COINGECKO_API_KEY: " gecko-key " } },
    });
    keyed.script.getPriceFromCoinGecko("tezos", TIME_MS, "high");
    expect(keyed.asked[0].headers["x-cg-demo-api-key"]).toBe("gecko-key");
    expect(keyed.asked[0].url).not.toContain("gecko-key");

    for (const key of ["", "  "]) {
      const bare = scriptAnswering(coinGeckoAnswering(HOURLY_POINTS, null), {
        config: { CONFIG: { COINGECKO_API_KEY: key } },
      });
      bare.script.getPriceFromCoinGecko("tezos", TIME_MS, "high");
      expect(bare.asked[0].headers).toEqual({});
    }
  });

  it("asks again after each wait in RETRY_DELAYS_MS while CoinGecko answers 429", () => {
    let refusals = 1;
    const { script, waits } = scriptAnswering((url) => {
      if (refusals > 0) {
        refusals -= 1;
        return reply(429);
      }
      return coinGeckoAnswering(HOURLY_POINTS, null)(url);
    });
    expect(script.getPriceFromCoinGecko("tezos", TIME_MS, "high")).toBe(2.4);
    expect(waits).toEqual([5000]);
  });

  it("keeps a price it found, asking nothing for the same time again", () => {
    const { script, asked } = scriptAnswering(
      coinGeckoAnswering(HOURLY_POINTS, null),
    );
    script.getPriceFromCoinGecko("tezos", TIME_MS, "high");
    expect(script.getPriceFromCoinGecko("tezos", TIME_MS, "high")).toBe(2.4);
    expect(asked).toHaveLength(1);
  });
});

/** CoinPaprika's candle of 2025-06-15. */
const PAPRIKA_CANDLE = {
  time_open: "2025-06-15T00:00:00Z",
  time_close: "2025-06-15T23:59:59Z",
  open: 2.1,
  high: 2.5,
  low: 2.0,
  close: 2.2,
};

/**
 * Answers as CoinPaprika does.
 *
 * @param {*} candles - The answer to the candle request: a list, null for a 404, or a reply
 * @param {*} ticks - The answer to the day-price request
 * @returns {function(string): *} The answer function
 */
function paprikaAnswering(candles, ticks) {
  return (url) => {
    if (url.includes("/ohlcv/historical")) return candles;
    if (url.includes("/tickers/") && url.includes("/historical")) return ticks;
    if (url.includes("/tickers/")) return { quotes: { USD: { price: 99 } } };
    return null;
  };
}

/** The day price CoinPaprika records for 2025-06-15, at 00:00 UTC. */
const PAPRIKA_DAY_TICK = [
  { timestamp: "2025-06-15T00:00:00Z", price: 2.05, volume_24h: 1 },
];

/** CoinPaprika's answer for a candle beyond the plan's reach. */
const BEYOND_PLAN = reply(402, {
  error: "Getting historical OHLCV data before ... is not allowed in this plan",
});

describe("CoinPaprika (getPriceFromCoinPaprika)", () => {
  it("asks the free server for the day's candle and gives its high, low or close", () => {
    const { script, asked } = scriptAnswering(
      paprikaAnswering([PAPRIKA_CANDLE], PAPRIKA_DAY_TICK),
    );
    expect(script.getPriceFromCoinPaprika("xtm-tari", TIME_MS, "high")).toBe(
      2.5,
    );
    expect(script.getPriceFromCoinPaprika("xtm-tari", TIME_MS, "low")).toBe(2);
    expect(script.getPriceFromCoinPaprika("xtm-tari", TIME_MS, "close")).toBe(
      2.2,
    );
    expect(asked[0].url).toBe(
      "https://api.coinpaprika.com/v1/coins/xtm-tari/ohlcv/historical?start=2025-06-15&end=2025-06-15&quote=usd",
    );
    expect(asked[0].headers).toEqual({});
  });

  it("reads prices CoinPaprika sends as text", () => {
    const { script } = scriptAnswering(
      paprikaAnswering([{ ...PAPRIKA_CANDLE, high: "2.75" }], null),
    );
    expect(script.getPriceFromCoinPaprika("xtm-tari", TIME_MS, "high")).toBe(
      2.75,
    );
  });

  it("gives the day's 00:00 UTC price for close when the plan does not reach the day's candle", () => {
    const { script, asked } = scriptAnswering(
      paprikaAnswering(BEYOND_PLAN, PAPRIKA_DAY_TICK),
    );
    expect(script.getPriceFromCoinPaprika("xtm-tari", TIME_MS, "close")).toBe(
      2.05,
    );
    expect(asked[1].url).toBe(
      "https://api.coinpaprika.com/v1/tickers/xtm-tari/historical?start=2025-06-15&interval=1d&limit=1&quote=usd",
    );
  });

  it("gives no high or low from the day's single price, asking for none", () => {
    const { script, asked } = scriptAnswering(
      paprikaAnswering(BEYOND_PLAN, PAPRIKA_DAY_TICK),
    );
    expect(
      script.getPriceFromCoinPaprika("xtm-tari", TIME_MS, "high"),
    ).toBeNull();
    expect(
      script.getPriceFromCoinPaprika("xtm-tari", TIME_MS, "low"),
    ).toBeNull();
    expect(asked.every((request) => request.url.includes("/ohlcv/"))).toBe(
      true,
    );
  });

  it("asks for the day's price when the day has no candle with the price", () => {
    for (const candles of [
      [],
      [{ ...PAPRIKA_CANDLE, time_open: "2025-06-16T00:00:00Z" }],
      [{ ...PAPRIKA_CANDLE, close: null }],
    ]) {
      const { script } = scriptAnswering(
        paprikaAnswering(candles, PAPRIKA_DAY_TICK),
      );
      expect(script.getPriceFromCoinPaprika("xtm-tari", TIME_MS, "close")).toBe(
        2.05,
      );
    }
  });

  it("gives null, asking nothing more, for an id CoinPaprika does not know", () => {
    const { script, asked } = scriptAnswering(
      paprikaAnswering(null, PAPRIKA_DAY_TICK),
    );
    expect(
      script.getPriceFromCoinPaprika("no-such-coin", TIME_MS, "close"),
    ).toBeNull();
    expect(asked).toHaveLength(1);
  });

  it("gives null when the day's price is missing, of another day, beyond the plan, or not above zero", () => {
    for (const ticks of [
      [],
      [{ timestamp: "2025-06-16T00:00:00Z", price: 2.05 }],
      reply(402, { error: "not allowed in this plan" }),
      [{ timestamp: "2025-06-15T00:00:00Z", price: 0 }],
      [{ timestamp: "2025-06-15T00:00:00Z", price: "n/a" }],
    ]) {
      const { script } = scriptAnswering(paprikaAnswering(BEYOND_PLAN, ticks));
      expect(
        script.getPriceFromCoinPaprika("xtm-tari", TIME_MS, "close"),
      ).toBeNull();
    }
  });

  it("never asks for the current ticker", () => {
    const { script, asked } = scriptAnswering(
      paprikaAnswering(BEYOND_PLAN, []),
    );
    script.getPriceFromCoinPaprika("xtm-tari", TIME_MS, "close");
    for (const request of asked) {
      expect(request.url).not.toMatch(/\/tickers\/[^/?]+(\?|$)/);
    }
  });

  it("with a key set in CONFIG, asks the paid server, the key the whole Authorization header", () => {
    const { script, asked } = scriptAnswering(
      paprikaAnswering(BEYOND_PLAN, PAPRIKA_DAY_TICK),
      { config: { CONFIG: { COINPAPRIKA_API_KEY: "paprika-key" } } },
    );
    expect(script.getPriceFromCoinPaprika("xtm-tari", TIME_MS, "close")).toBe(
      2.05,
    );
    expect(asked).toHaveLength(2);
    for (const request of asked) {
      expect(
        request.url.startsWith("https://api-pro.coinpaprika.com/v1/"),
      ).toBe(true);
      expect(request.headers.Authorization).toBe("paprika-key");
      expect(request.url).not.toContain("paprika-key");
    }
  });

  it("skips GridCoin, which CoinPaprika lists as inactive, asking nothing", () => {
    const { script, asked } = scriptAnswering(() => null);
    expect(
      script.getPriceFromCoinPaprika("grc-gridcoin", TIME_MS, "close"),
    ).toBeNull();
    expect(asked).toEqual([]);
  });

  it("asks again after a wait while CoinPaprika answers 429", () => {
    let refusals = 1;
    const { script, waits } = scriptAnswering((url) => {
      if (refusals > 0) {
        refusals -= 1;
        return reply(429);
      }
      return paprikaAnswering([PAPRIKA_CANDLE], null)(url);
    });
    expect(script.getPriceFromCoinPaprika("xtm-tari", TIME_MS, "close")).toBe(
      2.2,
    );
    expect(waits).toEqual([5000]);
  });
});

describe("the sheet's getCryptoPrice and its mode", () => {
  it("gives the candle close for close, in any letter case, and the high for any mode it does not know", () => {
    const { script } = scriptAnswering(
      mexcAnswering(XTM_USDT, () => XTM_PRICES),
    );
    const at = "2025-06-15 12:30:00";
    expect(script.getCryptoPrice("xtm", at, "UTC", "close", 0)).toBe(1.1);
    expect(script.getCryptoPrice("xtm", at, "UTC", "LOW", 0)).toBe(0.8);
    expect(script.getCryptoPrice("xtm", at, "UTC", "average", 0)).toBe(1.5);
    expect(script.getCryptoPrice("xtm", at, "UTC")).toBe(1.5);
  });
});
