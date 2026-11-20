/**
 * Tests of `sources/moralis.js`: a token that trades in pools, priced by
 * Moralis at the block its chain had at a row's time.
 * @module tests/moralis-source.test
 *
 * The shared Moralis client (`dex-prices/moralis.js`) runs for real against
 * a stand-in fetch (`helpers/stand-in-fetch.js`), with no waits; the key
 * holder is a stand-in.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPriceFromMoralis } from "../sources/moralis.js";
import { getApiKey } from "../../../api-key-store/index.js";
import { MORALIS_API_URL } from "../../../dex-prices/moralis.js";
import { answerWith, requests } from "./helpers/stand-in-fetch.js";
import { reply } from "./helpers/sheets-script.js";

vi.mock("../../../api-key-store/index.js", () => ({
  getApiKey: vi.fn(),
}));

// The shared client, asking the stand-in fetch and waiting for nothing
vi.mock("../../../dex-prices/moralis.js", async (importOriginal) => {
  const real = await importOriginal();
  const { standInFetch } = await import("./helpers/stand-in-fetch.js");
  return {
    ...real,
    moralisSettings: (settings = {}) =>
      real.moralisSettings({
        ...settings,
        fetch: standInFetch,
        sleep: async () => {},
      }),
  };
});

const mockGetApiKey = vi.mocked(getApiKey);

const PHEX = {
  contract: "0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39",
  network: "pulsechain",
  moralisChain: "0x171",
};
const TIME_MS = Date.UTC(2026, 9, 1, 12, 0, 30);
const TIME_SECONDS = Math.floor(TIME_MS / 1000);

/**
 * Answers as Moralis does: block 24000000 for the time, and pHEX's price
 * at that block.
 *
 * @param {string} url - The url asked
 * @returns {*} The answer
 */
function answerMoralis(url) {
  if (url.includes("/dateToBlock")) return { block: 24000000 };
  if (url.includes("/price")) return { usdPrice: 0.0042 };
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetApiKey.mockImplementation((service) =>
    service === "moralis" ? "moralis-key" : null,
  );
  answerWith(answerMoralis);
});

describe("getPriceFromMoralis", () => {
  it("asks for the block the chain had at the time, then the price at that block, with the key in its header and in no url", async () => {
    expect(await getPriceFromMoralis(PHEX, TIME_MS, "close")).toBe(0.0042);
    expect(requests.map((request) => request.url)).toEqual([
      `${MORALIS_API_URL}/dateToBlock?chain=0x171&date=${TIME_SECONDS}`,
      `${MORALIS_API_URL}/erc20/${PHEX.contract}/price?chain=0x171&to_block=24000000`,
    ]);
    for (const request of requests) {
      expect(request.headers["x-api-key"]).toBe("moralis-key");
      expect(request.url).not.toContain("moralis-key");
    }
  });

  it("answers the close only: a block's price has no high or low", async () => {
    expect(await getPriceFromMoralis(PHEX, TIME_MS, "high")).toBeNull();
    expect(await getPriceFromMoralis(PHEX, TIME_MS, "low")).toBeNull();
    expect(requests).toEqual([]);
  });

  it("asks nothing when no Moralis key is saved", async () => {
    mockGetApiKey.mockReturnValue(null);
    expect(await getPriceFromMoralis(PHEX, TIME_MS, "close")).toBeNull();
    expect(requests).toEqual([]);
  });

  it("gives null when Moralis has no block for the time, or no price at it", async () => {
    answerWith((url) =>
      url.includes("/dateToBlock") ? null : { usdPrice: 1 },
    );
    expect(await getPriceFromMoralis(PHEX, TIME_MS, "close")).toBeNull();
    expect(requests).toHaveLength(1);
    answerWith((url) =>
      url.includes("/dateToBlock") ? { block: 24000000 } : null,
    );
    expect(await getPriceFromMoralis(PHEX, TIME_MS, "close")).toBeNull();
  });

  it("gives null, and says why when verbose, when Moralis answers with an error", async () => {
    answerWith(() => reply(401, { message: "Invalid key" }));
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await getPriceFromMoralis(PHEX, TIME_MS, "close", true)).toBeNull();
    const lines = consoleSpy.mock.calls.map(([line]) => line);
    expect(
      lines.some((line) => line.startsWith("[VERBOSE:1] Moralis failed:")),
    ).toBe(true);
    expect(lines.some((line) => line.includes("moralis-key"))).toBe(false);
    consoleSpy.mockRestore();
  });
});
