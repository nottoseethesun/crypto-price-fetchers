/**
 * Tests of `sources/geckoterminal.js`: a token that trades in pools, priced
 * from the GeckoTerminal candle that holds a row's time.
 * @module tests/geckoterminal-source.test
 *
 * The shared GeckoTerminal client (`dex-prices/geckoterminal.js`) runs for
 * real against a stand-in fetch (`helpers/stand-in-fetch.js`), with no
 * waits and a budget of its own for each lookup; the settings are the
 * committed ones, whatever a `config.json` holds.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPriceFromGeckoTerminal } from "../sources/geckoterminal.js";
import { clearCache } from "../utils/cache.js";
import { answerWith, requests } from "./helpers/stand-in-fetch.js";
import { reply } from "./helpers/sheets-script.js";

// The shared client, asking the stand-in fetch and waiting for nothing
vi.mock("../../../dex-prices/geckoterminal.js", async (importOriginal) => {
  const real = await importOriginal();
  const { standInFetch } = await import("./helpers/stand-in-fetch.js");
  return {
    ...real,
    geckoTerminalSettings: (settings = {}) =>
      real.geckoTerminalSettings({
        ...settings,
        fetch: standInFetch,
        sleep: async () => {},
        requestLog: [],
      }),
  };
});

// The committed settings, whatever a config.json holds
vi.mock("../config.js", async () => {
  const { readFileSync } = await import("node:fs");
  const committed = JSON.parse(
    readFileSync(new URL("../config-example.json", import.meta.url), "utf8"),
  );
  return { loadConfig: () => committed };
});

const CONTRACT = "0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39";
const PHEX = {
  contract: CONTRACT,
  network: "pulsechain",
  moralisChain: "0x171",
};
const DEEP_IDLE_POOL = "0x1111111111111111111111111111111111111111";
const TRADING_POOL = "0x2222222222222222222222222222222222222222";

/** 12:00:30 UTC on 2026-10-01: in the minute that opens at 12:00:00. */
const TIME_MS = Date.UTC(2026, 9, 1, 12, 0, 30);
const MINUTE_OPEN = Math.floor(TIME_MS / 1000) - 30;
const HOUR_OPEN = MINUTE_OPEN;

/**
 * A pool as GeckoTerminal lists it.
 *
 * @param {string} address - The pool's address
 * @param {number} liquidity - Its value, in USD
 * @param {number} volume - What traded in it over the last day, in USD
 * @param {string} side - The side pHEX is on: 'base' or 'quote'
 * @returns {Object} The pool
 */
function pool(address, liquidity, volume, side) {
  const phex = { data: { id: `pulsechain_${CONTRACT.toLowerCase()}` } };
  const other = {
    data: { id: "pulsechain_0xa1077a294dde1b09bb078844df40758a5d0f9a27" },
  };
  return {
    attributes: {
      address,
      name: "HEX / WPLS",
      reserve_in_usd: String(liquidity),
      volume_usd: { h24: String(volume) },
    },
    relationships: {
      base_token: side === "base" ? phex : other,
      quote_token: side === "base" ? other : phex,
    },
  };
}

/**
 * Answers as GeckoTerminal does: two pools for pHEX, the deeper one idle
 * for a day, and candles of the trading one from `candles`.
 *
 * @param {function(string): Array} candles - The ohlcv list for a candle url's timeframe
 * @param {string} [side='base'] - The side pHEX is on in the trading pool
 * @returns {function(string): *} The answer function
 */
function geckoAnswering(candles, side = "base") {
  return (url) => {
    if (url.includes(`/tokens/${CONTRACT}/pools`)) {
      return {
        data: [
          pool(DEEP_IDLE_POOL, 9000000, 0, "base"),
          pool(TRADING_POOL, 3000000, 25000, side),
        ],
      };
    }
    if (url.includes("/ohlcv/")) {
      return {
        data: { attributes: { ohlcv_list: candles(url) } },
        meta: { base: { address: CONTRACT }, quote: { address: "0xa1" } },
      };
    }
    return null;
  };
}

/** The minute's candle: open 0.0040, high 0.0045, low 0.0038, close 0.0042. */
const MINUTE_CANDLE = [MINUTE_OPEN, 0.004, 0.0045, 0.0038, 0.0042, 100];

beforeEach(() => {
  clearCache();
  answerWith(() => null);
});

describe("getPriceFromGeckoTerminal", () => {
  it("reads the minute's candle of the deepest pool that traded in the last day, from pHEX's side", async () => {
    answerWith(geckoAnswering(() => [MINUTE_CANDLE]));
    expect(await getPriceFromGeckoTerminal(PHEX, TIME_MS, "close")).toBe(
      0.0042,
    );
    const candleRequest = new URL(
      requests.find((request) => request.url.includes("/ohlcv/")).url,
    );
    expect(candleRequest.pathname).toBe(
      `/api/v2/networks/pulsechain/pools/${TRADING_POOL}/ohlcv/minute`,
    );
    expect(candleRequest.searchParams.get("before_timestamp")).toBe(
      String(MINUTE_OPEN + 60),
    );
    expect(candleRequest.searchParams.get("currency")).toBe("usd");
    expect(candleRequest.searchParams.get("token")).toBe("base");
  });

  it("gives the candle's high or low for those targets, and asks for the pool once a run", async () => {
    answerWith(geckoAnswering(() => [MINUTE_CANDLE]));
    expect(await getPriceFromGeckoTerminal(PHEX, TIME_MS, "high")).toBe(0.0045);
    expect(await getPriceFromGeckoTerminal(PHEX, TIME_MS, "low")).toBe(0.0038);
    expect(
      requests.filter((request) => request.url.includes("/pools?")),
    ).toHaveLength(1);
  });

  it("reads the quote side when pHEX is the pool's quote token", async () => {
    answerWith(geckoAnswering(() => [MINUTE_CANDLE], "quote"));
    await getPriceFromGeckoTerminal(PHEX, TIME_MS, "close");
    const candleRequest = new URL(
      requests.find((request) => request.url.includes("/ohlcv/")).url,
    );
    expect(candleRequest.searchParams.get("token")).toBe("quote");
  });

  it("reads the hour's candle when nothing traded in the minute", async () => {
    answerWith(
      geckoAnswering((url) =>
        url.includes("/ohlcv/minute")
          ? [[MINUTE_OPEN - 600, 1, 1, 1, 1, 1]]
          : [[HOUR_OPEN, 0.004, 0.0047, 0.0036, 0.0043, 900]],
      ),
    );
    expect(await getPriceFromGeckoTerminal(PHEX, TIME_MS, "high")).toBe(0.0047);
  });

  it("gives null when neither the minute nor the hour has a candle", async () => {
    answerWith(geckoAnswering(() => []));
    expect(await getPriceFromGeckoTerminal(PHEX, TIME_MS, "close")).toBeNull();
  });

  it("gives null, asking for no hour, for a time beyond the public api's 180 days", async () => {
    answerWith((url) =>
      url.includes("/ohlcv/")
        ? reply(401, { errors: [{ title: "only the past 180 days" }] })
        : geckoAnswering(() => [])(url),
    );
    expect(await getPriceFromGeckoTerminal(PHEX, TIME_MS, "close")).toBeNull();
    expect(
      requests.filter((request) => request.url.includes("/ohlcv/")),
    ).toHaveLength(1);
  });

  it("gives null, and keeps that answer for the run, when no pool traded in the last day", async () => {
    answerWith((url) =>
      url.includes("/pools?")
        ? { data: [pool(DEEP_IDLE_POOL, 9000000, 0, "base")] }
        : null,
    );
    expect(await getPriceFromGeckoTerminal(PHEX, TIME_MS, "close")).toBeNull();
    expect(await getPriceFromGeckoTerminal(PHEX, TIME_MS, "close")).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it("gives null, and says why when verbose, when GeckoTerminal answers with an error", async () => {
    answerWith(() => reply(500, {}));
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(
      await getPriceFromGeckoTerminal(PHEX, TIME_MS, "close", true),
    ).toBeNull();
    expect(
      consoleSpy.mock.calls.some(([line]) =>
        line.startsWith("[VERBOSE:1] GeckoTerminal failed:"),
      ),
    ).toBe(true);
    consoleSpy.mockRestore();
  });
});
