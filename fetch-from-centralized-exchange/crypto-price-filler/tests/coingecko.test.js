/**
 * Unit tests for CoinGecko price fetching
 * @module tests/coingecko.test
 *
 * CoinGecko stands in at the http layer, `fetchWithRetry`, and the settings
 * are the committed ones in `config-example.json`, whatever a `config.json`
 * on this computer holds. The api key is the one a test puts in memory for
 * the run, as `index.js` does once it opens the saved key.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getPriceFromCoinGecko,
  pickFromPrices,
  utcDay,
} from "../sources/coingecko.js";
import * as fetchUtils from "../utils/fetch.js";
import { setApiKey } from "../../../api-key-store/index.js";

// Mock fetchWithRetry
vi.mock("../utils/fetch.js", () => {
  const mockFn = vi.fn();
  return {
    fetchWithRetry: mockFn,
    default: mockFn,
  };
});

// The committed settings, read afresh for this file, whatever a config.json holds
vi.mock("../config.js", async () => {
  const { readFileSync } = await import("node:fs");
  return {
    default: JSON.parse(
      readFileSync(new URL("../config-example.json", import.meta.url), "utf8"),
    ),
  };
});

const mockFetchWithRetry = vi.mocked(fetchUtils.fetchWithRetry);

// Test constants
const TEST_TOKEN = "GRC";
const TEST_COINGECKO_ID = "gridcoin-research";
const TEST_UTC_MS = Date.UTC(2024, 0, 1, 12, 0, 0); // 2024-01-01 12:00:00 UTC
const HOUR_MS = 3600000;

// CoinGecko's hourly prices around the time: lowest 0.0058, highest 0.0066,
// and 0.0061 nearest the time, 20 minutes after it
const RANGE_PRICES = [
  [TEST_UTC_MS - 2 * HOUR_MS, 0.006],
  [TEST_UTC_MS - HOUR_MS, 0.0058],
  [TEST_UTC_MS + 20 * 60000, 0.0061],
  [TEST_UTC_MS + HOUR_MS, 0.0066],
];

// CoinGecko's price for the day: a single price, with no high or low
const HISTORY_ANSWER = { market_data: { current_price: { usd: 0.006 } } };

/**
 * A response as `fetchWithRetry` gives it when the service answers.
 *
 * @param {Object} body - The json body
 * @returns {{ok: boolean, status: number, json: function(): Promise<Object>}} The response
 */
function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

/**
 * The urls asked, in order.
 *
 * @returns {string[]} The urls
 */
function askedUrls() {
  return mockFetchWithRetry.mock.calls.map(([url]) => url);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchWithRetry.mockReset();

  // Default: fail on unexpected calls
  mockFetchWithRetry.mockImplementation(() => {
    throw new Error("Unexpected fetchWithRetry call - check mock setup");
  });
});

afterEach(() => {
  setApiKey("coingecko", null);
  vi.clearAllMocks();
});

describe("CoinGecko Price Fetching", () => {
  describe("utcDay", () => {
    it("gives the UTC day of a time as dd-mm-yyyy", () => {
      expect(utcDay(Date.UTC(2025, 2, 15, 3, 0, 0))).toBe("15-03-2025");
      expect(utcDay(Date.UTC(2024, 11, 31, 23, 59, 59))).toBe("31-12-2024");
      expect(utcDay(Date.UTC(2025, 0, 1, 0, 0, 0))).toBe("01-01-2025");
    });
  });

  describe("pickFromPrices", () => {
    it("gives the highest for high, the lowest for low, and the one nearest the time for close", () => {
      expect(pickFromPrices(RANGE_PRICES, TEST_UTC_MS, "high")).toBe(0.0066);
      expect(pickFromPrices(RANGE_PRICES, TEST_UTC_MS, "low")).toBe(0.0058);
      expect(pickFromPrices(RANGE_PRICES, TEST_UTC_MS, "close")).toBe(0.0061);
    });

    it("gives null when there are no prices, or for a target it does not know", () => {
      expect(pickFromPrices([], TEST_UTC_MS, "high")).toBeNull();
      expect(pickFromPrices(undefined, TEST_UTC_MS, "close")).toBeNull();
      expect(pickFromPrices(RANGE_PRICES, TEST_UTC_MS, "open")).toBeNull();
    });

    it("passes over points that are not a time and a price", () => {
      const prices = [
        [TEST_UTC_MS, "not a price"],
        null,
        [TEST_UTC_MS + HOUR_MS, 0.5],
      ];
      expect(pickFromPrices(prices, TEST_UTC_MS, "close")).toBe(0.5);
    });
  });

  describe("getPriceFromCoinGecko", () => {
    describe("hourly prices (market_chart/range)", () => {
      it.each([
        ["high", 0.0066],
        ["low", 0.0058],
        ["close", 0.0061],
      ])(
        "in %s mode, gives %s from the hourly prices, asking nothing more",
        async (target, expected) => {
          mockFetchWithRetry.mockResolvedValueOnce(
            okResponse({ prices: RANGE_PRICES }),
          );

          const price = await getPriceFromCoinGecko(
            TEST_TOKEN,
            TEST_UTC_MS,
            target,
            false,
            TEST_COINGECKO_ID,
          );

          expect(price).toBe(expected);
          expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);
        },
      );

      it("asks for the prices from 12 hours before the time to 12 hours after it, in seconds", async () => {
        mockFetchWithRetry.mockResolvedValueOnce(
          okResponse({ prices: RANGE_PRICES }),
        );

        await getPriceFromCoinGecko(
          TEST_TOKEN,
          TEST_UTC_MS,
          "close",
          false,
          TEST_COINGECKO_ID,
        );

        const from = (TEST_UTC_MS - 12 * HOUR_MS) / 1000;
        const to = (TEST_UTC_MS + 12 * HOUR_MS) / 1000;
        expect(askedUrls()[0]).toBe(
          `https://api.coingecko.com/api/v3/coins/${TEST_COINGECKO_ID}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`,
        );
      });

      it("stops the range at now for a time less than 12 hours ago", async () => {
        mockFetchWithRetry.mockResolvedValueOnce(
          okResponse({ prices: RANGE_PRICES }),
        );
        const before = Math.floor(Date.now() / 1000);

        await getPriceFromCoinGecko(
          TEST_TOKEN,
          Date.now() - HOUR_MS,
          "close",
          false,
          TEST_COINGECKO_ID,
        );

        const after = Math.floor(Date.now() / 1000);
        const to = Number(new URL(askedUrls()[0]).searchParams.get("to"));
        expect(to).toBeGreaterThanOrEqual(before);
        expect(to).toBeLessThanOrEqual(after);
      });

      it("uses the token, in lower case, as the id when none is given", async () => {
        mockFetchWithRetry.mockResolvedValueOnce(
          okResponse({ prices: RANGE_PRICES }),
        );

        await getPriceFromCoinGecko("BITCOIN", TEST_UTC_MS, "close", false);

        expect(askedUrls()[0]).toContain("/coins/bitcoin/market_chart/range");
      });
    });

    describe("the day's price (history)", () => {
      it("in close mode, gives the price of the UTC day when the hourly prices are empty", async () => {
        mockFetchWithRetry
          .mockResolvedValueOnce(okResponse({ prices: [] }))
          .mockResolvedValueOnce(okResponse(HISTORY_ANSWER));

        const price = await getPriceFromCoinGecko(
          TEST_TOKEN,
          TEST_UTC_MS,
          "close",
          false,
          TEST_COINGECKO_ID,
        );

        expect(price).toBe(0.006);
        expect(askedUrls()[1]).toBe(
          `https://api.coingecko.com/api/v3/coins/${TEST_COINGECKO_ID}/history?date=01-01-2024`,
        );
      });

      it.each([
        ["answers 404", () => mockFetchWithRetry.mockResolvedValueOnce(null)],
        [
          "is refused",
          () =>
            mockFetchWithRetry.mockResolvedValueOnce({
              ok: false,
              status: 401,
            }),
        ],
        [
          "fails",
          () =>
            mockFetchWithRetry.mockRejectedValueOnce(
              new Error("Network error"),
            ),
        ],
        [
          "answers with bad json",
          () =>
            mockFetchWithRetry.mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => {
                throw new Error("Unexpected token");
              },
            }),
        ],
      ])(
        "in close mode, gives the price of the day when the hourly request %s",
        async (_how, answerRange) => {
          answerRange();
          mockFetchWithRetry.mockResolvedValueOnce(okResponse(HISTORY_ANSWER));

          const price = await getPriceFromCoinGecko(
            TEST_TOKEN,
            TEST_UTC_MS,
            "close",
            false,
            TEST_COINGECKO_ID,
          );

          expect(price).toBe(0.006);
        },
      );

      it.each(["high", "low"])(
        "in %s mode, gives no price when the hourly prices are empty, since the day's single price has neither",
        async (target) => {
          mockFetchWithRetry.mockResolvedValueOnce(okResponse({ prices: [] }));

          const price = await getPriceFromCoinGecko(
            TEST_TOKEN,
            TEST_UTC_MS,
            target,
            false,
            TEST_COINGECKO_ID,
          );

          expect(price).toBeNull();
          expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);
        },
      );

      it.each([
        ["no market data", {}],
        ["market data of null", { market_data: null }],
        ["no USD price", { market_data: { current_price: { eur: 0.005 } } }],
        ["a USD price of 0", { market_data: { current_price: { usd: 0 } } }],
      ])(
        "gives no price when the day's answer has %s",
        async (_what, answer) => {
          mockFetchWithRetry
            .mockResolvedValueOnce(okResponse({ prices: [] }))
            .mockResolvedValueOnce(okResponse(answer));

          const price = await getPriceFromCoinGecko(
            TEST_TOKEN,
            TEST_UTC_MS,
            "close",
            false,
            TEST_COINGECKO_ID,
          );

          expect(price).toBeNull();
        },
      );

      it("gives no price when both requests answer 404", async () => {
        mockFetchWithRetry
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null);

        const price = await getPriceFromCoinGecko(
          TEST_TOKEN,
          TEST_UTC_MS,
          "close",
          false,
          TEST_COINGECKO_ID,
        );

        expect(price).toBeNull();
      });
    });

    describe("api key", () => {
      it("sends the demo key in CoinGecko's header when the run has opened one", async () => {
        setApiKey("coingecko", "test-demo-key");
        mockFetchWithRetry
          .mockResolvedValueOnce(okResponse({ prices: [] }))
          .mockResolvedValueOnce(okResponse(HISTORY_ANSWER));

        await getPriceFromCoinGecko(
          TEST_TOKEN,
          TEST_UTC_MS,
          "close",
          false,
          TEST_COINGECKO_ID,
        );

        const options = mockFetchWithRetry.mock.calls.map(
          ([, requestOptions]) => requestOptions,
        );
        expect(options).toEqual([
          { headers: { "x-cg-demo-api-key": "test-demo-key" } },
          { headers: { "x-cg-demo-api-key": "test-demo-key" } },
        ]);
      });

      it("sends no key when the run has none", async () => {
        mockFetchWithRetry.mockResolvedValueOnce(
          okResponse({ prices: RANGE_PRICES }),
        );

        await getPriceFromCoinGecko(
          TEST_TOKEN,
          TEST_UTC_MS,
          "close",
          false,
          TEST_COINGECKO_ID,
        );

        expect(mockFetchWithRetry.mock.calls[0][1]).toEqual({});
      });
    });

    describe("verbose logging", () => {
      /**
       * Runs a call with console.log captured.
       *
       * @param {function(): Promise<*>} call - The call
       * @returns {Promise<string[]>} The first argument of each line logged
       */
      async function loggedBy(call) {
        const consoleSpy = vi
          .spyOn(console, "log")
          .mockImplementation(() => {});
        try {
          await call();
          return consoleSpy.mock.calls.map((c) => String(c[0]));
        } finally {
          consoleSpy.mockRestore();
        }
      }

      it("logs the hourly prices found when verbose", async () => {
        mockFetchWithRetry.mockResolvedValueOnce(
          okResponse({ prices: RANGE_PRICES }),
        );

        const lines = await loggedBy(() =>
          getPriceFromCoinGecko(
            TEST_TOKEN,
            TEST_UTC_MS,
            "close",
            true,
            TEST_COINGECKO_ID,
          ),
        );

        expect(
          lines.some(
            (line) =>
              line.includes("[VERBOSE") &&
              line.includes("market_chart/range success"),
          ),
        ).toBe(true);
      });

      it("logs the day's price found when verbose", async () => {
        mockFetchWithRetry
          .mockResolvedValueOnce(okResponse({ prices: [] }))
          .mockResolvedValueOnce(okResponse(HISTORY_ANSWER));

        const lines = await loggedBy(() =>
          getPriceFromCoinGecko(
            TEST_TOKEN,
            TEST_UTC_MS,
            "close",
            true,
            TEST_COINGECKO_ID,
          ),
        );

        expect(lines.some((line) => line.includes("history success"))).toBe(
          true,
        );
      });

      it("logs when both dated sources fail, when verbose", async () => {
        mockFetchWithRetry
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null);

        const lines = await loggedBy(() =>
          getPriceFromCoinGecko(
            TEST_TOKEN,
            TEST_UTC_MS,
            "close",
            true,
            TEST_COINGECKO_ID,
          ),
        );

        expect(
          lines.some((line) => line.includes("both dated sources failed")),
        ).toBe(true);
      });

      it("logs nothing when not verbose", async () => {
        mockFetchWithRetry.mockResolvedValueOnce(
          okResponse({ prices: RANGE_PRICES }),
        );

        const lines = await loggedBy(() =>
          getPriceFromCoinGecko(
            TEST_TOKEN,
            TEST_UTC_MS,
            "close",
            false,
            TEST_COINGECKO_ID,
          ),
        );

        expect(lines.filter((line) => line.includes("[VERBOSE"))).toHaveLength(
          0,
        );
      });
    });

    describe("edge cases", () => {
      it("keeps very small prices", async () => {
        mockFetchWithRetry.mockResolvedValueOnce(
          okResponse({ prices: [[TEST_UTC_MS, 0.000000001]] }),
        );

        const price = await getPriceFromCoinGecko(
          TEST_TOKEN,
          TEST_UTC_MS,
          "close",
          false,
          TEST_COINGECKO_ID,
        );

        expect(price).toBe(0.000000001);
      });

      it("defaults to close", async () => {
        mockFetchWithRetry.mockResolvedValueOnce(
          okResponse({ prices: RANGE_PRICES }),
        );

        const price = await getPriceFromCoinGecko(
          TEST_TOKEN,
          TEST_UTC_MS,
          undefined,
          false,
          TEST_COINGECKO_ID,
        );

        expect(price).toBe(0.0061);
      });
    });
  });
});
