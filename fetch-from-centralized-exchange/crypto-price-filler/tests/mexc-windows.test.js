/**
 * Tests of the windows the Sheets script asks MEXC, an exchange, for: the
 * minute that holds a time, or for an older time its hour, and, when
 * nothing traded in it, the next window up that holds the time, to the
 * year; and, when MEXC keeps no candle of the hour, the day, which tells a
 * time older than the hour candles MEXC keeps from one before it listed
 * the pair.
 * @module tests/mexc-windows.test
 *
 * The script, getCryptoPriceFromCentralizedExchange.gs with its
 * `-sources.gs`, runs unchanged in the test's thread
 * (`helpers/sheets-script.js`). A stand-in MEXC answers its candle
 * requests as MEXC does (`test/helpers/stand-in-mexc.js`), with a candle
 * for every period: one in which nothing traded with volume 0 and every
 * price at the last trade's, as MEXC gives it.
 */

import { describe, it, expect } from "vitest";
import path from "path";
import { loadSheetsScript } from "./helpers/sheets-script.js";
import { mexcKlines } from "../../../test/helpers/stand-in-mexc.js";

const SHEETS_SCRIPT_PATH = [
  "../../getCryptoPriceFromCentralizedExchange.gs",
  "../../getCryptoPriceFromCentralizedExchange-sources.gs",
].map((file) => path.resolve(__dirname, file));

/** 12:30 UTC on Sunday 2025-06-15, the time the tests price. */
const TIME_MS = Date.UTC(2025, 5, 15, 12, 30, 0);

/** A candle of a period with a trade in it: high 1.60, low 0.60, so its average is 1.10. */
const TRADED = ["1.20", "1.60", "0.60", "1.20", "5"];

/** A candle of a period with no trade in it, every price at the last trade's, 1.30. */
const FLAT = ["1.30", "1.30", "1.30", "1.30", "0"];

/**
 * The candles of a pair in which one trade happened, at a time.
 *
 * @param {number} tradeMs - The time of the trade, in ms since 1970 UTC
 * @param {boolean} [keepsMinutes=true] - Whether MEXC keeps minute candles for the time, as it does for about the last 30 days
 * @returns {function(number, number, string): ?string[]} The prices of each candle, by its open, its last millisecond and its interval
 */
function tradedOnceAt(tradeMs, keepsMinutes = true) {
  return (open, end, interval) => {
    if (interval === "1m" && !keepsMinutes) return null;
    return tradeMs >= open && tradeMs <= end ? TRADED : FLAT;
  };
}

/**
 * Loads the script against a stand-in MEXC that lists XTMUSDT, XMRBTC and
 * BTCUSDT, recording each candle request asked.
 *
 * @param {function(string, number, number, string): ?string[]} pricesOf - Each candle's prices, by the pair, its open, its last millisecond and its interval
 * @returns {{script: Object, klines: Array<URLSearchParams>}} The script, and the queries of the candle requests it asked
 */
function scriptWithMexc(pricesOf) {
  const klines = [];
  const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
    if (url.includes("/exchangeInfo")) {
      return {
        symbols: [
          { symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" },
          { symbol: "XMRBTC", baseAsset: "XMR", quoteAsset: "BTC" },
          { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" },
        ],
      };
    }
    if (!url.includes("/klines")) return null;
    const query = new URL(url).searchParams;
    klines.push(query);
    return mexcKlines(url, (open, end, interval) =>
      pricesOf(query.get("symbol"), open, end, interval),
    );
  });
  return { script, klines };
}

/**
 * The window a candle request asked for.
 *
 * @param {URLSearchParams} query - The request's query
 * @returns {{interval: string, start: string, end: string, limit: string}} Its interval, its window, and its limit of candles
 */
function windowOf(query) {
  return {
    interval: query.get("interval"),
    start: new Date(Number(query.get("startTime"))).toISOString(),
    end: new Date(Number(query.get("endTime"))).toISOString(),
    limit: query.get("limit"),
  };
}

describe("MEXC's window when nothing traded in the minute that holds the time", () => {
  const climbs = [
    {
      window: "hour",
      tradeMs: Date.UTC(2025, 5, 15, 12, 45),
      asked: [
        "60m",
        "2025-06-15T12:00:00.000Z",
        "2025-06-15T12:59:59.999Z",
        "1",
      ],
    },
    {
      window: "2 hours, joined from its two hour candles",
      tradeMs: Date.UTC(2025, 5, 15, 13, 15),
      asked: [
        "60m",
        "2025-06-15T12:00:00.000Z",
        "2025-06-15T13:59:59.999Z",
        "2",
      ],
    },
    {
      window: "4 hours",
      tradeMs: Date.UTC(2025, 5, 15, 15, 0),
      asked: [
        "4h",
        "2025-06-15T12:00:00.000Z",
        "2025-06-15T15:59:59.999Z",
        "1",
      ],
    },
    {
      window: "day",
      tradeMs: Date.UTC(2025, 5, 15, 6, 0),
      asked: [
        "1d",
        "2025-06-15T00:00:00.000Z",
        "2025-06-15T23:59:59.999Z",
        "1",
      ],
    },
    {
      window: "week, from Monday",
      tradeMs: Date.UTC(2025, 5, 10, 12, 0),
      asked: [
        "1W",
        "2025-06-09T00:00:00.000Z",
        "2025-06-15T23:59:59.999Z",
        "1",
      ],
    },
    {
      window: "month",
      tradeMs: Date.UTC(2025, 5, 2, 12, 0),
      asked: [
        "1M",
        "2025-06-01T00:00:00.000Z",
        "2025-06-30T23:59:59.999Z",
        "1",
      ],
    },
    {
      window: "year, joined from its twelve month candles",
      tradeMs: Date.UTC(2025, 2, 1, 12, 0),
      asked: [
        "1M",
        "2025-01-01T00:00:00.000Z",
        "2025-12-31T23:59:59.999Z",
        "12",
      ],
    },
  ];

  for (const { window, tradeMs, asked } of climbs) {
    it(`gives the average of the high and low of the ${window} that holds it, whatever the target, when that is the first window up in which something traded`, () => {
      const { script, klines } = scriptWithMexc((symbol, ...period) =>
        tradedOnceAt(tradeMs)(...period),
      );
      for (const target of ["average", "high", "low", "close"]) {
        expect(script.getPriceFromMEXC("XTM", TIME_MS, target)).toBeCloseTo(
          1.1,
          10,
        );
      }
      const [interval, start, end, limit] = asked;
      expect(windowOf(klines[klines.length - 1])).toEqual({
        interval,
        start,
        end,
        limit,
      });
    });
  }

  it("gives null when nothing traded in the year that holds the time, having asked for each window from the minute up", () => {
    const { script, klines } = scriptWithMexc((symbol, ...period) =>
      tradedOnceAt(Date.UTC(2024, 11, 31, 12, 0))(...period),
    );
    expect(script.getPriceFromMEXC("XTM", TIME_MS, "average")).toBeNull();
    expect(klines.map((query) => query.get("interval"))).toEqual([
      "1m",
      "60m",
      "60m",
      "4h",
      "1d",
      "1W",
      "1M",
      "1M",
    ]);
  });

  it("prices a BTC pair with BTC/USDT's average over the same window, when the pair's price is the window's average", () => {
    const { script, klines } = scriptWithMexc((symbol, open, end, interval) => {
      if (symbol === "BTCUSDT")
        return ["60000", "62000", "59000", "61000", "9"];
      if (interval === "1m") return ["0.005", "0.005", "0.005", "0.005", "0"];
      return ["0.005", "0.006", "0.004", "0.0055", "3"];
    });
    expect(script.getPriceFromMEXC("XMR", TIME_MS, "high")).toBeCloseTo(
      0.005 * 60500,
      8,
    );
    const btc = klines.find((query) => query.get("symbol") === "BTCUSDT");
    expect(windowOf(btc)).toEqual({
      interval: "60m",
      start: "2025-06-15T12:00:00.000Z",
      end: "2025-06-15T12:59:59.999Z",
      limit: "1",
    });
  });

  it("gives a cell that asks for the high the average of the hour, when nothing traded in the minute", () => {
    const { script } = scriptWithMexc((symbol, ...period) =>
      tradedOnceAt(Date.UTC(2025, 5, 15, 12, 45))(...period),
    );
    expect(
      script.getCryptoPrice("xtm", "2025-06-15 12:30:00", "UTC", "high", 0),
    ).toBeCloseTo(1.1, 10);
  });
});

describe("MEXC's window for a time older than the minute candles it keeps", () => {
  it("gives the target's price from the hour that holds the time, when something traded in it", () => {
    const { script } = scriptWithMexc((symbol, ...period) =>
      tradedOnceAt(Date.UTC(2025, 5, 15, 12, 45), false)(...period),
    );
    expect(script.getPriceFromMEXC("XTM", TIME_MS, "high")).toBe(1.6);
    expect(script.getPriceFromMEXC("XTM", TIME_MS, "low")).toBe(0.6);
    expect(script.getPriceFromMEXC("XTM", TIME_MS, "average")).toBeCloseTo(
      1.1,
      10,
    );
  });

  it("goes up from the hour, to the average of the 2 hours, when nothing traded in the hour", () => {
    const { script, klines } = scriptWithMexc((symbol, ...period) =>
      tradedOnceAt(Date.UTC(2025, 5, 15, 13, 15), false)(...period),
    );
    expect(script.getPriceFromMEXC("XTM", TIME_MS, "high")).toBeCloseTo(
      1.1,
      10,
    );
    expect(windowOf(klines[klines.length - 1]).limit).toBe("2");
  });
});

describe("MEXC's windows when it keeps no candle of the hour that holds a time", () => {
  it("climbs from the day, when MEXC keeps the day's candle", () => {
    const { script, klines } = scriptWithMexc((symbol, open, end, interval) =>
      interval === "1d" ? TRADED : null,
    );
    expect(script.getPriceFromMEXC("XTM", TIME_MS, "close")).toBeCloseTo(
      1.1,
      10,
    );
    expect(klines.map((query) => query.get("interval"))).toEqual([
      "1m",
      "60m",
      "60m",
      "4h",
      "1d",
    ]);
  });

  it("gives no price when MEXC keeps no candle of the day either, as before it listed the pair", () => {
    const { script, klines } = scriptWithMexc(() => null);
    expect(script.getPriceFromMEXC("XTM", TIME_MS, "close")).toBeNull();
    expect(klines.map((query) => query.get("interval"))).toEqual([
      "1m",
      "60m",
      "60m",
      "4h",
      "1d",
    ]);
  });
});
