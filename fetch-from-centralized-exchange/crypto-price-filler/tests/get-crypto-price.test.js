/**
 * Tests of getCryptoPrice, the price of a token at a time, asked of the
 * sources in turn, each source's requests answered by a stand-in for
 * fetchWithRetry: the cache, MEXC, the fallback to CoinGecko, the price
 * modes and the retry after a rate limit. Split from index.test.js, which
 * tests the helpers and the command line, at LP Ranger's 500-line cap;
 * the edge cases of the fallback to CoinGecko are in
 * get-crypto-price-coingecko.test.js.
 */

import { describe, it, expect, vi } from "vitest";
import { DateTime } from "luxon";
import { getCryptoPrice } from "../sources/price.js"; // the wrapper
import * as fetchUtils from "../utils/fetch.js"; // for mocking fetchWithRetry
import { useFetchStandIn } from "./helpers/fetch-with-retry.js";

const verbose = process.env.VERBOSE === "1";

// Mock supports BOTH named and default import styles
vi.mock("../utils/fetch.js", () => {
  const mockFn = vi.fn();
  return {
    fetchWithRetry: mockFn, // for named import { fetchWithRetry }
    default: mockFn, // for default import fetchWithRetry from ...
  };
});

const mockFetchWithRetry = vi.mocked(fetchUtils.fetchWithRetry); // works for named
// If needed for default: vi.mocked(fetchUtils.default)

useFetchStandIn(mockFetchWithRetry);

describe("getCryptoPrice", () => {
  it("returns cached price if available", async () => {
    if (verbose) console.log("[TEST] Setting cache for cached price test");

    // Create and set cache explicitly for this test
    const testCache = new Map();
    testCache.set("price_xtm_20251219001700_UTC_high", 42.5);

    // Debug: confirm set worked in this scope
    console.log(
      "[TEST CACHE] Keys in test scope:",
      Array.from(testCache.keys()),
    );

    mockFetchWithRetry.mockResolvedValue({ ok: false });

    if (verbose)
      console.log("[TEST] Calling getCryptoPrice with explicit cache");

    const price = await getCryptoPrice(
      "xtm",
      "2025-12-19 00:17:00",
      "UTC",
      "high",
      verbose,
      testCache,
      null,
      null,
    );

    if (verbose) console.log("[TEST] getCryptoPrice returned:", price);

    expect(price).toBe(42.5);
  });

  it("tries MEXC first and returns price when successful", async () => {
    if (verbose) console.log("[TEST] Starting MEXC success test");
    mockFetchWithRetry
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          symbols: [{ baseAsset: "XTM", quoteAsset: "USDT" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [[1766103360000, 0, 50.0, 40.0, 45.0, 1000]],
      });

    const price = await getCryptoPrice(
      "xtm",
      "2025-12-19 00:17:00",
      "UTC",
      "high",
      verbose,
      null,
      null,
      null,
    );
    if (verbose) console.log("[TEST] getCryptoPrice returned:", price);
    expect(price).toBe(50.0);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);
  });

  it("falls back to CoinGecko when MEXC fails", async () => {
    if (verbose) console.log("[TEST] Starting CoinGecko fallback test");

    mockFetchWithRetry.mockReset();
    mockFetchWithRetry.mockClear();

    mockFetchWithRetry.mockImplementation(async (url) => {
      if (verbose) console.log("[MOCK] Fetch called for URL:", url);

      if (url.includes("mexc.com")) {
        return { ok: false, status: 500 };
      }

      if (url.includes("/market_chart/range")) {
        const atRow = Date.UTC(2025, 11, 19, 0, 17, 0);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            prices: [
              [atRow - 3600000, 41.0],
              [atRow, 42.7],
              [atRow + 3600000, 40.0],
            ],
          }),
        };
      }

      return { ok: false, status: 404 };
    });

    const price = await getCryptoPrice(
      "xtm",
      "2025-12-19 00:17:00",
      "UTC",
      "high",
      verbose,
      null,
      null,
      null,
    );
    if (verbose) console.log("[TEST] getCryptoPrice returned:", price);
    expect(price).toBe(42.7);
  });

  it("returns null when all sources fail", async () => {
    if (verbose) console.log("[TEST] Starting all-sources-fail test");
    mockFetchWithRetry.mockResolvedValue({ ok: false, status: 500 });
    const price = await getCryptoPrice(
      "xtm",
      "2025-12-19 00:17:00",
      "UTC",
      "high",
      verbose,
      null,
      null,
      null,
    );
    if (verbose) console.log("[TEST] getCryptoPrice returned:", price);
    expect(price).toBeNull();
  });

  it("skips future dates", async () => {
    if (verbose) console.log("[TEST] Starting future date skip test");
    const future = DateTime.now()
      .plus({ days: 1 })
      .toFormat("yyyy-MM-dd HH:mm:ss");
    const price = await getCryptoPrice(
      "xtm",
      future,
      "UTC",
      "high",
      verbose,
      null,
      null,
      null,
    );
    if (verbose) console.log("[TEST] getCryptoPrice returned:", price);
    expect(price).toBeNull();
  });

  it("handles invalid token (no symbol in MEXC + no fallback)", async () => {
    if (verbose) console.log("[TEST] Starting invalid token test");
    mockFetchWithRetry
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ symbols: [] }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const price = await getCryptoPrice(
      "unknown_token",
      "2025-12-19 00:17:00",
      "UTC",
      "high",
      verbose,
      null,
      null,
      null,
    );
    if (verbose) console.log("[TEST] getCryptoPrice returned:", price);
    expect(price).toBeNull();
  });

  it("handles low price mode correctly", async () => {
    if (verbose) console.log("[TEST] Starting low price mode test");

    // Reset mocks completely for this test
    mockFetchWithRetry.mockReset();
    mockFetchWithRetry.mockClear();

    mockFetchWithRetry.mockImplementation(async (url) => {
      if (verbose) console.log("[MOCK] Fetch called for URL:", url); // debug to see order

      if (url.includes("exchangeInfo")) {
        return {
          ok: true,
          status: 200,
          json: async () => {
            return {
              symbols: [{ baseAsset: "XTM", quoteAsset: "USDT" }],
            };
          },
        };
      }

      if (url.includes("klines")) {
        return {
          ok: true,
          status: 200,
          json: async () => {
            return [[1766103360000, 0, 60.0, 40.0, 50.0, 1000]];
          },
        };
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: "Not mocked" }),
      };
    });

    const price = await getCryptoPrice(
      "xtm",
      "2025-12-19 00:17:00",
      "UTC",
      "low",
      verbose,
      null,
      null,
      null,
    );
    if (verbose) console.log("[TEST] getCryptoPrice returned:", price);

    expect(price).toBe(40.0);
  });

  it("handles BTC pair adjustment, with BTC/USDT's candle at the same time", async () => {
    if (verbose) console.log("[TEST] Starting BTC pair adjustment test");
    mockFetchWithRetry
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          symbols: [{ baseAsset: "XTM", quoteAsset: "BTC" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [[1766103360000, 0, 0.0005, 0.0004, 0.00045, 1000]],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [[1766103360000, 99500, 100000, 99000, 99800, 10]],
      });

    const price = await getCryptoPrice(
      "xtm",
      "2025-12-19 00:17:00",
      "UTC",
      "high",
      verbose,
      null,
      null,
      null,
    );
    if (verbose) console.log("[TEST] getCryptoPrice returned:", price);
    expect(price).toBeCloseTo(50.0, 2);
  });

  it("handles rate limit retry (mock 429)", async () => {
    mockFetchWithRetry
      .mockImplementationOnce(async (url, verbose) => {
        if (verbose)
          console.log(
            "[DEBUG] Mock call 1 - initial failure with status 429 - URL:",
            url,
          );
        return new Response(null, { status: 429, ok: false });
      })
      .mockImplementationOnce(async (url, verbose) => {
        if (verbose)
          console.log(
            "[DEBUG] Mock call 2 - retry exchangeInfo success - URL:",
            url,
          );
        return {
          ok: true,
          status: 200,
          json: async () => ({
            symbols: [{ baseAsset: "XTM", quoteAsset: "USDT" }],
          }),
        };
      })
      .mockImplementationOnce(async (url, verbose) => {
        if (verbose)
          console.log("[DEBUG] Mock call 3 - retry klines success - URL:", url);
        return {
          ok: true,
          status: 200,
          json: async () => [[1766103360000, 0, 50.0, 40.0, 45.0, 1000]],
        };
      })
      .mockImplementationOnce(async (url, verbose) => {
        if (verbose)
          console.log(
            "[DEBUG] Mock call 4 - CoinPaprika fallback failure - URL:",
            url,
          );
        return { ok: false, status: 500 };
      });

    if (verbose) console.log("[VERBOSE] Starting rate limit test promise...");

    const pricePromise = getCryptoPrice(
      "xtm",
      "2025-12-19 00:17:00",
      "UTC",
      "high",
      verbose,
      null,
      null,
      null,
    );

    if (verbose) {
      console.log("[DEBUG] Pending timers before flush:", vi.getTimerCount());
      console.log(
        "[DEBUG] Mock calls before flush:",
        mockFetchWithRetry.mock.calls.length,
      );
    }

    if (verbose)
      console.log("[VERBOSE] Running all timers to flush backoff (step 1)");
    vi.runAllTimers();
    await Promise.resolve(); // Flush microtasks

    if (verbose) {
      console.log("[DEBUG] Pending timers after flush 1:", vi.getTimerCount());
      console.log(
        "[DEBUG] Mock calls after flush 1:",
        mockFetchWithRetry.mock.calls.length,
      );
    }

    if (verbose)
      console.log("[VERBOSE] Running all timers to flush backoff (step 2)");
    vi.runAllTimers();
    await Promise.resolve();

    if (verbose) {
      console.log("[DEBUG] Pending timers after flush 2:", vi.getTimerCount());
      console.log(
        "[DEBUG] Mock calls after flush 2:",
        mockFetchWithRetry.mock.calls.length,
      );
    }

    if (verbose)
      console.log("[VERBOSE] Running all timers to flush backoff (step 3)");
    vi.runAllTimers();
    await Promise.resolve();

    if (verbose) {
      console.log("[DEBUG] Pending timers after flush 3:", vi.getTimerCount());
      console.log(
        "[DEBUG] Mock calls after flush 3:",
        mockFetchWithRetry.mock.calls.length,
      );
    }

    if (verbose)
      console.log("[VERBOSE] All timers flushed - awaiting price...");
    const price = await pricePromise;

    if (verbose)
      console.log(`[VERBOSE] Rate limit test completed with price: ${price}`);

    expect(price).toBe(50.0);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(3); // 3 calls (fallback skipped)
  }, 30000); // 30s timeout - generous buffer
});
