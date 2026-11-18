/**
 * Tests of getCryptoPrice's fallback to CoinGecko at its edges: a day's
 * price when the hourly range is empty, and the answers that give no
 * price. Each source's requests are answered by a stand-in for
 * fetchWithRetry. Split from get-crypto-price.test.js at LP Ranger's
 * 500-line cap.
 */

import { describe, it, expect, vi } from "vitest";
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

describe("getCryptoPrice, falling back to CoinGecko", () => {
  it("uses CoinGecko's price for the day when its hourly range is empty, in close mode", async () => {
    if (verbose) console.log("[TEST] Starting day-price fallback test");

    mockFetchWithRetry.mockReset();
    mockFetchWithRetry.mockClear();

    mockFetchWithRetry.mockImplementation(async (url) => {
      if (verbose) console.log("[MOCK] Fetch called for URL:", url);

      if (url.includes("mexc.com")) {
        return { ok: false, status: 500 };
      }

      if (url.includes("/market_chart/range")) {
        return { ok: true, status: 200, json: async () => ({ prices: [] }) };
      }

      if (url.includes("/history?date=19-12-2025")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            market_data: { current_price: { usd: 42.7 } },
          }),
        };
      }

      return { ok: false, status: 404 };
    });

    const price = await getCryptoPrice(
      "xtm",
      "2025-12-19 00:17:00",
      "UTC",
      "close",
      verbose,
      null,
      null,
      null,
    );
    if (verbose) console.log("[TEST] getCryptoPrice returned:", price);
    expect(price).toBe(42.7);
  });

  it("returns null when both CoinGecko endpoints return 404", async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce({ ok: false, status: 500 }) // MEXC fails
      .mockResolvedValueOnce({ ok: false, status: 404 }) // hourly range 404
      .mockResolvedValueOnce({ ok: false, status: 404 }); // history 404

    const price = await getCryptoPrice(
      "xtm",
      "2025-12-19 00:17:00",
      "UTC",
      "close",
      verbose,
      null,
      null,
      null,
    );
    expect(price).toBeNull();
  });

  it("returns null when CoinGecko history is missing market_data key", async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce({ ok: false, status: 500 }) // MEXC fails
      .mockResolvedValueOnce({ ok: false, status: 404 }) // hourly range fails
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ market_data: null }), // missing / null
      });

    const price = await getCryptoPrice(
      "xtm",
      "2025-12-19 00:17:00",
      "UTC",
      "close",
      verbose,
      null,
      null,
      null,
    );
    expect(price).toBeNull();
  });

  it("returns null when CoinGecko history is missing current_price.usd", async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce({ ok: false, status: 500 }) // MEXC fails
      .mockResolvedValueOnce({ ok: false, status: 404 }) // hourly range fails
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          market_data: {
            current_price: { eur: 39.5 }, // usd missing
          },
        }),
      }); // history missing usd

    const price = await getCryptoPrice(
      "xtm",
      "2025-12-19 00:17:00",
      "UTC",
      "close",
      verbose,
      null,
      null,
      null,
    );
    expect(price).toBeNull();
  });

  it("handles invalid response object from CoinGecko (no .json method)", async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce({ ok: false, status: 500 }) // MEXC fails
      .mockResolvedValueOnce({}) // invalid response (no json)
      .mockResolvedValueOnce({}); // invalid again for history

    const price = await getCryptoPrice(
      "xtm",
      "2025-12-19 00:17:00",
      "UTC",
      "close",
      verbose,
      null,
      null,
      null,
    );
    expect(price).toBeNull();
  });

  it("handles JSON parse error in CoinGecko responses", async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce({ ok: false, status: 500 }) // MEXC fails
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Simulated parse error");
        },
      }) // hourly range parse error
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Simulated parse error");
        },
      }); // history parse error

    const price = await getCryptoPrice(
      "xtm",
      "2025-12-19 00:17:00",
      "UTC",
      "close",
      verbose,
      null,
      null,
      null,
    );
    expect(price).toBeNull();
  });
});
