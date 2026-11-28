/**
 * Unit tests for Price fetching orchestration
 * @module tests/price.test
 *
 * `getCryptoPrice` asks the pool sources (Moralis, then GeckoTerminal) for
 * a token that names a contract, and the Sheets script's sources (MEXC,
 * CoinGecko, CoinPaprika, through `exchange.js`), each skipped when the
 * token's entry names no id for it, in the order the script's rule gives
 * (`sourcesInPriority`). Every source is a stand-in here, the rule among
 * them, which gives today's order unless a test says otherwise, as are
 * the cache and the token list; `source-priority.test.js` runs the real
 * rule.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCryptoPrice } from "../sources/price.js";
import * as exchange from "../sources/exchange.js";
import * as moralis from "../sources/moralis.js";
import * as geckoterminal from "../sources/geckoterminal.js";
import * as cacheModule from "../utils/cache.js";
import fs from "fs";
import { logLines } from "./helpers/log-lines.js";

vi.mock("../sources/exchange.js", () => ({
  exchangeSources: vi.fn(),
}));

vi.mock("../sources/moralis.js", () => ({
  getPriceFromMoralis: vi.fn(),
}));

vi.mock("../sources/geckoterminal.js", () => ({
  getPriceFromGeckoTerminal: vi.fn(),
}));

vi.mock("../utils/cache.js", () => ({
  getCache: vi.fn(),
  setCache: vi.fn(),
}));

// Mock fs to return test token config
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual.default,
      readFileSync: vi.fn(),
    },
  };
});

const mockExchangeSources = vi.mocked(exchange.exchangeSources);
const mockMoralis = vi.mocked(moralis.getPriceFromMoralis);
const mockGeckoTerminal = vi.mocked(geckoterminal.getPriceFromGeckoTerminal);
const mockGetCache = vi.mocked(cacheModule.getCache);
const mockSetCache = vi.mocked(cacheModule.setCache);
const mockReadFileSync = vi.mocked(fs.readFileSync);

/** The Sheets script's sources, and its rule for their order, as `exchangeSources` gives them. */
const sources = {
  getPriceFromMEXC: vi.fn(),
  getPriceFromCoinGecko: vi.fn(),
  getPriceFromCoinPaprika: vi.fn(),
  sourcesInPriority: vi.fn(),
};

/** The order the stand-in rule gives unless a test says otherwise: the one with no order of priority saved. */
const TODAYS_ORDER = [
  "Moralis",
  "GeckoTerminal",
  "MEXC",
  "CoinGecko",
  "CoinPaprika",
];

const PHEX_CONTRACT = "0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39";

// Test token configurations
const TEST_TOKENS_CONFIG = {
  tokens: {
    grc: {
      name: "Gridcoin",
      coingecko_id: "gridcoin-research",
      coinpaprika_id: "grc-gridcoin",
      mexc_symbol: null,
    },
    xtm: {
      name: "Minotari",
      coingecko_id: "minotari",
      coinpaprika_id: null,
      mexc_symbol: "XTM",
    },
    btc: {
      name: "Bitcoin",
      coingecko_id: "bitcoin",
      coinpaprika_id: "btc-bitcoin",
      mexc_symbol: "BTC",
    },
    nogecko: {
      name: "A token CoinGecko does not list",
      coingecko_id: null,
      coinpaprika_id: "ngk-nogecko",
      mexc_symbol: null,
    },
    phex: {
      name: "HEX on PulseChain",
      coingecko_id: "hex-pulsechain",
      coinpaprika_id: "hex-hex-pulsechain",
      mexc_symbol: null,
      contract: PHEX_CONTRACT,
      geckoterminal_network: "pulsechain",
      moralis_chain: "0x171",
    },
    nomoralis: {
      name: "A token with no Moralis chain",
      coingecko_id: null,
      coinpaprika_id: null,
      mexc_symbol: null,
      contract: PHEX_CONTRACT,
      geckoterminal_network: "pulsechain",
    },
    nogeckoterminal: {
      name: "A token with no GeckoTerminal network",
      coingecko_id: null,
      coinpaprika_id: null,
      mexc_symbol: null,
      contract: PHEX_CONTRACT,
      moralis_chain: "0x171",
    },
  },
};

const AT = "2024-01-01 12:00:00";
const AT_MS = Date.UTC(2024, 0, 1, 12, 0, 0);

/**
 * Prices a token at AT in UTC.
 *
 * @param {string} token - The token
 * @param {string} [target='high'] - The price target
 * @param {Object} [more] - verbose and testCache
 * @returns {Promise<number|null>} The price
 */
function priceOf(token, target = "high", { verbose = false, testCache } = {}) {
  return getCryptoPrice(token, AT, "UTC", target, verbose, testCache);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadFileSync.mockReturnValue(JSON.stringify(TEST_TOKENS_CONFIG));
  mockExchangeSources.mockResolvedValue(sources);
  sources.getPriceFromMEXC.mockResolvedValue(null);
  sources.getPriceFromCoinGecko.mockResolvedValue(null);
  sources.getPriceFromCoinPaprika.mockResolvedValue(null);
  sources.sourcesInPriority.mockResolvedValue(TODAYS_ORDER);
  mockMoralis.mockResolvedValue(null);
  mockGeckoTerminal.mockResolvedValue(null);
  mockGetCache.mockReturnValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Price Fetching Orchestration", () => {
  describe("getCryptoPrice", () => {
    describe("the Sheets script's sources, in order", () => {
      it("returns MEXC's price when it has one, under the token's MEXC symbol", async () => {
        sources.getPriceFromMEXC.mockResolvedValueOnce(50000);
        expect(await priceOf("btc")).toBe(50000);
        expect(sources.getPriceFromMEXC).toHaveBeenCalledWith(
          "BTC",
          AT_MS,
          "high",
        );
        expect(sources.getPriceFromCoinGecko).not.toHaveBeenCalled();
        expect(sources.getPriceFromCoinPaprika).not.toHaveBeenCalled();
      });

      it("falls back to CoinGecko, under the token's CoinGecko id, when MEXC has none", async () => {
        sources.getPriceFromCoinGecko.mockResolvedValueOnce(49500);
        expect(await priceOf("btc")).toBe(49500);
        expect(sources.getPriceFromCoinGecko).toHaveBeenCalledWith(
          "bitcoin",
          AT_MS,
          "high",
        );
      });

      it("falls back to CoinPaprika, under its id, when MEXC and CoinGecko have none", async () => {
        sources.getPriceFromCoinPaprika.mockResolvedValueOnce(0.006);
        expect(await priceOf("grc")).toBe(0.006);
        expect(sources.getPriceFromCoinPaprika).toHaveBeenCalledWith(
          "grc-gridcoin",
          AT_MS,
          "high",
        );
      });

      it("skips each source the token's entry names no id for", async () => {
        await priceOf("grc");
        expect(sources.getPriceFromMEXC).not.toHaveBeenCalled();
        sources.getPriceFromCoinPaprika.mockClear();
        await priceOf("xtm");
        expect(sources.getPriceFromCoinPaprika).not.toHaveBeenCalled();
        sources.getPriceFromCoinGecko.mockClear();
        await priceOf("nogecko");
        expect(sources.getPriceFromCoinGecko).not.toHaveBeenCalled();
      });

      it("opens the script's sources with the run's verbose setting", async () => {
        await priceOf("btc", "high", { verbose: true });
        expect(mockExchangeSources).toHaveBeenCalledWith(true);
      });

      it("asks the sources in the order the script's rule gives, from the filler's sources and the run's order of priority", async () => {
        sources.sourcesInPriority.mockResolvedValueOnce([
          "CoinPaprika",
          "MEXC",
          "CoinGecko",
          "Moralis",
          "GeckoTerminal",
        ]);
        sources.getPriceFromCoinPaprika.mockResolvedValueOnce(51000);
        sources.getPriceFromMEXC.mockResolvedValue(50000);
        expect(await priceOf("btc")).toBe(51000);
        expect(sources.getPriceFromMEXC).not.toHaveBeenCalled();
        const [given, priority] = sources.sourcesInPriority.mock.calls[0];
        expect(given.map((source) => source.name)).toEqual(TODAYS_ORDER);
        expect(priority).toEqual([]);
      });

      it("passes over an answer that is not a finite number", async () => {
        sources.getPriceFromMEXC.mockResolvedValueOnce(Number.NaN);
        sources.getPriceFromCoinGecko.mockResolvedValueOnce("49500");
        sources.getPriceFromCoinPaprika.mockResolvedValueOnce(48000);
        expect(await priceOf("btc")).toBe(48000);
      });
    });

    describe("a token that trades in pools", () => {
      it("is asked of Moralis first, with its contract and chains", async () => {
        mockMoralis.mockResolvedValueOnce(0.0042);
        expect(await priceOf("phex", "close")).toBe(0.0042);
        expect(mockMoralis).toHaveBeenCalledWith(
          {
            contract: PHEX_CONTRACT,
            network: "pulsechain",
            moralisChain: "0x171",
          },
          AT_MS,
          "close",
          false,
        );
        expect(mockGeckoTerminal).not.toHaveBeenCalled();
        expect(sources.getPriceFromMEXC).not.toHaveBeenCalled();
        expect(sources.getPriceFromCoinGecko).not.toHaveBeenCalled();
        expect(sources.getPriceFromCoinPaprika).not.toHaveBeenCalled();
      });

      it("is asked of GeckoTerminal when Moralis has no price", async () => {
        mockGeckoTerminal.mockResolvedValueOnce(0.0041);
        expect(await priceOf("phex", "high")).toBe(0.0041);
        expect(mockGeckoTerminal).toHaveBeenCalledWith(
          expect.objectContaining({ contract: PHEX_CONTRACT }),
          AT_MS,
          "high",
          false,
        );
      });

      it("falls back to CoinGecko and CoinPaprika when neither pool source has a price", async () => {
        sources.getPriceFromCoinPaprika.mockResolvedValueOnce(0.004);
        expect(await priceOf("phex", "close")).toBe(0.004);
        expect(sources.getPriceFromCoinGecko).toHaveBeenCalledWith(
          "hex-pulsechain",
          AT_MS,
          "close",
        );
        expect(sources.getPriceFromCoinPaprika).toHaveBeenCalledWith(
          "hex-hex-pulsechain",
          AT_MS,
          "close",
        );
      });

      it("skips Moralis without a Moralis chain, and GeckoTerminal without a network", async () => {
        await priceOf("nomoralis");
        expect(mockMoralis).not.toHaveBeenCalled();
        expect(mockGeckoTerminal).toHaveBeenCalledTimes(1);
        mockGeckoTerminal.mockClear();
        await priceOf("nogeckoterminal");
        expect(mockMoralis).toHaveBeenCalledTimes(1);
        expect(mockGeckoTerminal).not.toHaveBeenCalled();
      });

      it("asks neither pool source for a token that names no contract", async () => {
        await priceOf("btc");
        expect(mockMoralis).not.toHaveBeenCalled();
        expect(mockGeckoTerminal).not.toHaveBeenCalled();
      });
    });

    describe("caching behavior", () => {
      it("returns cached price on cache hit, asking no source", async () => {
        mockGetCache.mockReturnValue(48000);
        expect(await priceOf("btc")).toBe(48000);
        expect(mockExchangeSources).not.toHaveBeenCalled();
      });

      it("caches fetched price", async () => {
        sources.getPriceFromMEXC.mockResolvedValueOnce(50000);
        await priceOf("btc");
        expect(mockSetCache).toHaveBeenCalledWith(
          "price_btc_20240101120000_UTC_high",
          50000,
        );
      });

      it("uses the test cache when one is given, and sets its value", async () => {
        const testCache = new Map([["price_btc_20240101120000_UTC_low", 1]]);
        expect(await priceOf("btc", "low", { testCache })).toBe(1);
        expect(mockGetCache).not.toHaveBeenCalled();
        sources.getPriceFromMEXC.mockResolvedValueOnce(50000);
        await priceOf("btc", "high", { testCache });
        expect(testCache.get("price_btc_20240101120000_UTC_high")).toBe(50000);
        expect(mockSetCache).not.toHaveBeenCalled();
      });
    });

    describe("error handling", () => {
      it("returns null for invalid date", async () => {
        expect(
          await getCryptoPrice("btc", "not a date", "UTC", "high"),
        ).toBeNull();
      });

      it("returns null for future date, asking no source", async () => {
        const future = new Date(Date.now() + 86400000 * 30)
          .toISOString()
          .slice(0, 19)
          .replace("T", " ");
        expect(await getCryptoPrice("btc", future, "UTC", "high")).toBeNull();
        expect(mockExchangeSources).not.toHaveBeenCalled();
      });

      it("goes on to the next source when one throws", async () => {
        sources.getPriceFromMEXC.mockRejectedValueOnce(new Error("down"));
        sources.getPriceFromCoinGecko.mockRejectedValueOnce(new Error("down"));
        sources.getPriceFromCoinPaprika.mockResolvedValueOnce(47000);
        expect(await priceOf("btc")).toBe(47000);
      });

      it("gives null when the script's sources cannot be opened", async () => {
        mockExchangeSources.mockRejectedValue(new Error("no worker"));
        expect(await priceOf("btc")).toBeNull();
      });
    });

    describe("verbose logging", () => {
      it("logs which source answered when verbose is enabled", async () => {
        const printed = logLines();
        sources.getPriceFromCoinPaprika.mockResolvedValueOnce(0.006);
        await priceOf("grc", "high", { verbose: true });
        const lines = printed.mock.calls.map(([line]) => line);
        expect(lines).toContain("[VERBOSE:1] MEXC skipped since set to null");
        expect(lines).toContain(
          "[VERBOSE:1] CoinPaprika success - price: 0.006",
        );
      });

      it("does not log when verbose is disabled", async () => {
        const printed = logLines();
        await priceOf("btc");
        expect(printed).not.toHaveBeenCalled();
      });
    });

    describe("token configuration", () => {
      it("asks no source for a token supported-tokens.json does not list", async () => {
        expect(await priceOf("unknown")).toBeNull();
        expect(sources.getPriceFromMEXC).not.toHaveBeenCalled();
        expect(mockMoralis).not.toHaveBeenCalled();
      });

      it("reads token config from the supported-tokens.json in the tool's folder", async () => {
        await priceOf("btc");
        expect(mockReadFileSync).toHaveBeenCalledWith(
          expect.stringMatching(
            /crypto-price-filler[\\/]supported-tokens\.json$/,
          ),
          "utf8",
        );
      });
    });

    describe("price target options", () => {
      it("passes the target to the sources", async () => {
        for (const target of ["high", "low", "close"]) {
          sources.getPriceFromMEXC.mockClear();
          await priceOf("btc", target);
          expect(sources.getPriceFromMEXC).toHaveBeenCalledWith(
            "BTC",
            AT_MS,
            target,
          );
        }
      });
    });
  });
});
