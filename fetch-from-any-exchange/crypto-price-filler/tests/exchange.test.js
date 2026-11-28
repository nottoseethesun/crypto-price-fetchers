/**
 * Tests of `sources/exchange.js`: the Sheets script's price sources, opened
 * once per run with the run's api keys, and closed at its end.
 * @module tests/exchange.test
 *
 * The script's Node version, which opens the script in a worker, is a
 * stand-in here, as is the key holder; `regressions.test.js` and
 * `xtm-coingecko-id.test.js` run the real script in its worker.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { closeExchangeSources, exchangeSources } from "../sources/exchange.js";
import { openCentralizedExchangeSources } from "../../../bin/end-user/getCryptoPriceFromCentralizedExchange.js";
import {
  getApiKey,
  getApiKeyPriority,
  getApiKeyType,
} from "../../../api-key-store/index.js";
import { logLines } from "./helpers/log-lines.js";

vi.mock(
  "../../../bin/end-user/getCryptoPriceFromCentralizedExchange.js",
  () => ({
    openCentralizedExchangeSources: vi.fn(),
  }),
);

vi.mock("../../../api-key-store/index.js", () => ({
  getApiKey: vi.fn(),
  getApiKeyPriority: vi.fn(),
  getApiKeyType: vi.fn(),
}));

const mockOpen = vi.mocked(openCentralizedExchangeSources);
const mockGetApiKey = vi.mocked(getApiKey);
const mockGetApiKeyType = vi.mocked(getApiKeyType);
const mockGetApiKeyPriority = vi.mocked(getApiKeyPriority);

/** The opened sources the stand-in opener gives. */
const opened = {
  getPriceFromMEXC: vi.fn(),
  getPriceFromCoinGecko: vi.fn(),
  getPriceFromCoinPaprika: vi.fn(),
  close: vi.fn(async () => {}),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockOpen.mockResolvedValue(opened);
  mockGetApiKey.mockImplementation((service) =>
    service === "coingecko" ? "gecko-key" : null,
  );
  mockGetApiKeyType.mockImplementation((service) =>
    service === "coingecko" ? "paid" : null,
  );
  mockGetApiKeyPriority.mockReturnValue(["coinpaprika", "coingecko"]);
});

afterEach(async () => {
  await closeExchangeSources();
});

describe("exchangeSources", () => {
  it("opens the script once, at the first call, and gives the same sources after", async () => {
    expect(await exchangeSources()).toBe(opened);
    expect(await exchangeSources()).toBe(opened);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it("hands the script the CoinGecko and CoinPaprika keys the run opened, with the CoinGecko key's type and the run's order of priority", async () => {
    await exchangeSources();
    expect(mockOpen.mock.calls[0][0].apiKeys).toEqual({
      coingecko: "gecko-key",
      coingeckoKeyType: "paid",
      coinpaprika: null,
      priority: ["coinpaprika", "coingecko"],
    });
  });

  it("prints the script's lines, marked as the script's, when verbose", async () => {
    const printed = logLines();
    await exchangeSources(true);
    mockOpen.mock.calls[0][0].onLog({ level: "info", text: "Trying MEXC" });
    expect(printed).toHaveBeenCalledWith(
      "[VERBOSE:2] [Sheets script] Trying MEXC",
    );
  });

  it("drops the script's lines when not verbose", async () => {
    await exchangeSources(false);
    expect(mockOpen.mock.calls[0][0].onLog).toBeNull();
  });
});

describe("closeExchangeSources", () => {
  it("closes the opened script, and the next call opens it again", async () => {
    await exchangeSources();
    await closeExchangeSources();
    expect(opened.close).toHaveBeenCalledTimes(1);
    await exchangeSources();
    expect(mockOpen).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the script was never opened", async () => {
    await closeExchangeSources();
    expect(opened.close).not.toHaveBeenCalled();
  });

  it("settles when the script could not be opened", async () => {
    mockOpen.mockRejectedValueOnce(new Error("no worker"));
    await expect(exchangeSources()).rejects.toThrow("no worker");
    await expect(closeExchangeSources()).resolves.toBeUndefined();
    expect(opened.close).not.toHaveBeenCalled();
  });
});
