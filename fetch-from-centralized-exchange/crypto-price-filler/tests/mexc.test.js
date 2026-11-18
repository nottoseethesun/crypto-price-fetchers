/**
 * Unit tests for MEXC price fetching module
 * @module tests/mexc.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getPriceFromMEXC } from "../sources/mexc.js";
import * as fetchModule from "../utils/fetch.js";

// Mock fetch module
vi.mock("../utils/fetch.js", () => ({
  fetchWithRetry: vi.fn(),
}));

const mockFetch = vi.mocked(fetchModule.fetchWithRetry);

// Mock exchange info with BTC pair only (no USDT pair)
const mockExchangeInfoBTCOnly = {
  symbols: [{ symbol: "XTMBTC", baseAsset: "XTM", quoteAsset: "BTC" }],
};

// Mock exchange info with USDT pair
const mockExchangeInfoUSDT = {
  symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("MEXC Price Fetching", () => {
  describe("getPriceFromMEXC", () => {
    describe("skipped tokens", () => {
      it("returns null for GRC token (in skip list)", async () => {
        const price = await getPriceFromMEXC("grc", Date.now(), "high", false);
        expect(price).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it("returns null for GRC regardless of case", async () => {
        const price = await getPriceFromMEXC("GRC", Date.now(), "high", false);
        expect(price).toBeNull();
      });
    });

    describe("cache behavior", () => {
      it("returns cached value when cache hit", async () => {
        const testCache = new Map();
        const utcMs = new Date("2024-01-01T12:00:00Z").getTime();
        testCache.set("price_btc_20240101120000_UTC_high", 50000);

        const price = await getPriceFromMEXC(
          "btc",
          utcMs,
          "high",
          false,
          testCache,
        );

        expect(price).toBe(50000);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it("sets cache when price is fetched with provided cache", async () => {
        const testCache = new Map();
        const utcMs = new Date("2024-01-01T12:00:00Z").getTime();

        // Mock successful fetch
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT,
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [
              [utcMs, "50000", "50500", "49500", "50200", "1000"],
            ],
          });

        const price = await getPriceFromMEXC(
          "btc",
          utcMs,
          "high",
          false,
          testCache,
        );

        expect(price).toBe(50500);
        expect(testCache.size).toBe(1);
        expect(testCache.get("price_btc_20240101120000_UTC_high")).toBe(50500);
      });
    });

    describe("BTC pair handling", () => {
      /**
       * Answers as MEXC does for a coin it trades only against BTC: the
       * XTMBTC pair, an XTMBTC candle and a BTCUSDT candle, both at the time
       * asked.
       *
       * @param {number} utcMs - The time asked, in UTC milliseconds
       * @param {Array|null} btcCandle - The BTCUSDT candle, or null when MEXC has none
       * @returns {void}
       */
      function answerBtcPair(utcMs, btcCandle) {
        mockFetch.mockImplementation(async (url) => {
          if (url.includes("/exchangeInfo")) {
            return {
              ok: true,
              status: 200,
              json: async () => mockExchangeInfoBTCOnly,
            };
          }
          if (url.includes("symbol=XTMBTC")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                [utcMs, "0.00001", "0.000012", "0.000008", "0.000011", "1000"],
              ],
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => (btcCandle === null ? [] : [btcCandle]),
          };
        });
      }

      it("converts a BTC pair's high to USD with BTC/USDT's high at the same time", async () => {
        const utcMs = new Date("2024-01-01T12:00:00Z").getTime();
        answerBtcPair(utcMs, [utcMs, "49000", "50000", "48000", "49500", "10"]);

        const price = await getPriceFromMEXC("xtm", utcMs, "high", false);

        // 0.000012 BTC at 50000 USD
        expect(price).toBeCloseTo(0.6, 10);
        const btcUrls = mockFetch.mock.calls
          .map(([url]) => url)
          .filter((url) => url.includes("symbol=BTCUSDT"));
        expect(btcUrls).toHaveLength(1);
        expect(new URL(btcUrls[0]).searchParams.get("endTime")).toBe(
          String(utcMs),
        );
      });

      it("converts a BTC pair's close to USD with BTC/USDT's close", async () => {
        const utcMs = new Date("2024-01-01T12:00:00Z").getTime();
        answerBtcPair(utcMs, [utcMs, "49000", "50000", "48000", "49500", "10"]);

        const price = await getPriceFromMEXC("xtm", utcMs, "close", false);

        // 0.000011 BTC at 49500 USD
        expect(price).toBeCloseTo(0.5445, 10);
      });

      it("returns null when MEXC has no BTC/USDT candle for the time", async () => {
        const utcMs = new Date("2024-01-01T12:00:00Z").getTime();
        answerBtcPair(utcMs, null);

        const price = await getPriceFromMEXC("xtm", utcMs, "high", false);

        expect(price).toBeNull();
      });
    });

    describe("error handling", () => {
      it("returns null when no symbol found", async () => {
        const utcMs = Date.now();

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ symbols: [] }),
        });

        const price = await getPriceFromMEXC(
          "unknowntoken",
          utcMs,
          "high",
          false,
        );

        expect(price).toBeNull();
      });

      it("returns null when exchange info JSON parse fails", async () => {
        const utcMs = Date.now();

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("Invalid JSON");
          },
        });

        const price = await getPriceFromMEXC("btc", utcMs, "high", false);

        expect(price).toBeNull();
      });

      it("returns null when klines JSON parse fails", async () => {
        const utcMs = new Date("2024-01-01T12:00:00Z").getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT,
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => {
              throw new Error("Invalid JSON");
            },
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => {
              throw new Error("Invalid JSON");
            },
          });

        const price = await getPriceFromMEXC("btc", utcMs, "high", false);

        expect(price).toBeNull();
      });

      it("returns null when exchange info request fails after retries", async () => {
        const utcMs = Date.now();

        // Return failed response for all retry attempts
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        });

        const price = await getPriceFromMEXC("btc", utcMs, "high", false);

        expect(price).toBeNull();
      });

      it("returns null when price is NaN", async () => {
        const utcMs = new Date("2024-01-01T12:00:00Z").getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT,
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [
              [utcMs, "invalid", "invalid", "invalid", "invalid", "1000"],
            ],
          });

        const price = await getPriceFromMEXC("btc", utcMs, "high", false);

        expect(price).toBeNull();
      });
    });

    describe("price target selection", () => {
      it("returns high price when target is high", async () => {
        const utcMs = new Date("2024-01-01T12:00:00Z").getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT,
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [
              [utcMs, "50000", "50500", "49500", "50200", "1000"],
            ],
          });

        const price = await getPriceFromMEXC("btc", utcMs, "high", false);

        expect(price).toBe(50500); // candle[2] is high
      });

      it("returns low price when target is low", async () => {
        const utcMs = new Date("2024-01-01T12:00:00Z").getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT,
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [
              [utcMs, "50000", "50500", "49500", "50200", "1000"],
            ],
          });

        const price = await getPriceFromMEXC("btc", utcMs, "low", false);

        expect(price).toBe(49500); // candle[3] is low
      });

      it("returns close price when target is close", async () => {
        const utcMs = new Date("2024-01-01T12:00:00Z").getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT,
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [
              [utcMs, "50000", "50500", "49500", "50200", "1000"],
            ],
          });

        const price = await getPriceFromMEXC("btc", utcMs, "close", false);

        expect(price).toBe(50200); // candle[4] is close
      });

      it("returns null for a target it does not know, asking MEXC nothing", async () => {
        const price = await getPriceFromMEXC("btc", Date.now(), "open", false);

        expect(price).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    describe("fallback interval", () => {
      it("uses fallback interval when 1m klines return empty", async () => {
        const utcMs = new Date("2024-01-01T12:00:00Z").getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT,
          })
          // 1m klines returns empty
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [],
          })
          // 60m fallback klines returns data
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [
              [utcMs, "50000", "50500", "49500", "50200", "1000"],
            ],
          });

        const price = await getPriceFromMEXC("btc", utcMs, "high", false);

        expect(price).toBe(50500);
        expect(mockFetch).toHaveBeenCalledTimes(3);
      });

      it("passes over a 1-minute candle that opens more than two minutes from the time asked", async () => {
        const utcMs = new Date("2024-01-01T12:00:00Z").getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT,
          })
          // 1m klines gives a candle from three minutes before
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [[utcMs - 180000, "1", "2", "0.5", "1.5", "10"]],
          })
          // 60m fallback klines returns data
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [
              [utcMs - 1800000, "50000", "50500", "49500", "50200", "1000"],
            ],
          });

        const price = await getPriceFromMEXC("btc", utcMs, "high", false);

        expect(price).toBe(50500);
        expect(mockFetch.mock.calls[2][0]).toContain("interval=60m");
      });

      it("returns null when both intervals fail", async () => {
        const utcMs = new Date("2024-01-01T12:00:00Z").getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT,
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [],
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [],
          });

        const price = await getPriceFromMEXC("btc", utcMs, "high", false);

        expect(price).toBeNull();
      });
    });

    describe("verbose logging", () => {
      it("logs when verbose is enabled", async () => {
        const consoleSpy = vi
          .spyOn(console, "log")
          .mockImplementation(() => {});
        const utcMs = new Date("2024-01-01T12:00:00Z").getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT,
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [
              [utcMs, "50000", "50500", "49500", "50200", "1000"],
            ],
          });

        await getPriceFromMEXC("btc", utcMs, "high", true);

        expect(consoleSpy).toHaveBeenCalled();
        const logCalls = consoleSpy.mock.calls.map((c) => c[0]);
        expect(logCalls.some((msg) => msg && msg.includes("[VERBOSE"))).toBe(
          true,
        );

        consoleSpy.mockRestore();
      });
    });
  });
});
