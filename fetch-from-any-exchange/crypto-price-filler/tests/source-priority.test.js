/**
 * Tests of the order the exchange script and crypto-price-filler ask their
 * sources in: the script's rule (`sourcesInPriority`), the sheet's sources
 * in the order of priority `CONFIG.API_KEY_PRIORITY` gives, and the
 * filler's sources in the run's order of priority (`sourceOrder`,
 * `sources/price.js`).
 * @module tests/source-priority.test
 *
 * The script runs unchanged in the test's thread
 * (`tests/helpers/sheets-script.js`), against a stand-in MEXC that lists
 * no pair, a stand-in CoinGecko and a stand-in CoinPaprika, and, where a
 * day's end matters, a stand-in clock (`dateAt`); two builds of it can
 * share one stand-in cache, as one Apps Script project keeps its cache
 * when a new build is pasted into it. The filler's order
 * comes from the script in its worker, opened through the Node version as
 * a run opens it, and closed after each test. Nothing outside the computer
 * is asked.
 */

import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "url";
import { createAppsScriptServices } from "../../../apps-script-runner/apps-script-services.js";
import { loadSheetsScript } from "./helpers/sheets-script.js";
import {
  SHEETS_SCRIPT_PATH,
  ROW_UTC_MS,
  answerPaprikaCandleOfTheDay,
  cellTime,
  dateAt,
} from "./helpers/regression-runs.js";
import { closeExchangeSources } from "../sources/exchange.js";
import { sourceOrder } from "../sources/price.js";
import {
  readNeededKeys,
  setApiKeyPriority,
} from "../../../api-key-store/index.js";

/** The repo's top folder, whose config.json lists the services. */
const REPO_TOP = fileURLToPath(new URL("../../..", import.meta.url));

/** The message of a cell no source priced, when CoinPaprika needs a key. */
const KEY_MESSAGE =
  "No data available from any source; CoinPaprika gives average, high and low only with an api key";

/**
 * Sources as the filler declares its own: two families, each with one
 * source that takes no key.
 */
const FAMILIES = [
  { name: "Moralis", service: "moralis" },
  { name: "GeckoTerminal", after: "moralis" },
  { name: "MEXC", before: ["coingecko", "coinpaprika"] },
  { name: "CoinGecko", service: "coingecko" },
  { name: "CoinPaprika", service: "coinpaprika" },
];

/**
 * Loads the script with a stand-in exchange that records each url asked:
 * MEXC lists no pair; CoinGecko's hourly prices around ROW_UTC_MS are 2.0
 * and 2.5, or none; CoinPaprika's candle of the day has a high of 3.
 *
 * @param {Object<string, *>} config - Fields of the script's CONFIG
 * @param {Object} [options] - What else differs
 * @param {boolean} [options.geckoHasPrices=true] - Whether CoinGecko has the hourly prices
 * @param {number} [options.nowMs] - The stand-in clock's present; the real one when absent
 * @returns {{script: Object, asked: string[]}} The script, and the urls asked
 */
function scriptWith(config, { geckoHasPrices = true, nowMs } = {}) {
  const asked = [];
  const script = loadSheetsScript(
    SHEETS_SCRIPT_PATH,
    (url) => {
      asked.push(url);
      if (url.includes("/exchangeInfo")) return { symbols: [] };
      if (url.includes("/market_chart/range")) {
        return {
          prices: geckoHasPrices
            ? [
                [ROW_UTC_MS - 3600000, 2.0],
                [ROW_UTC_MS + 3600000, 2.5],
              ]
            : [],
        };
      }
      return answerPaprikaCandleOfTheDay(url);
    },
    {
      config: { CONFIG: config },
      services: nowMs === undefined ? {} : { Date: dateAt(nowMs) },
    },
  );
  return { script, asked };
}

/**
 * Whether any url asked is CoinGecko's or CoinPaprika's.
 *
 * @param {string[]} asked - The urls asked
 * @param {string} service - 'coingecko' or 'coinpaprika'
 * @returns {boolean} Whether one is
 */
function askedOf(asked, service) {
  return asked.some((url) => url.includes(service));
}

describe("sourcesInPriority, the script's rule", () => {
  const { script } = scriptWith({});

  it("keeps the order the sources are given in when the order of priority names none of them", () => {
    expect(script.sourcesInPriority(FAMILIES, [])).toEqual([
      "Moralis",
      "GeckoTerminal",
      "MEXC",
      "CoinGecko",
      "CoinPaprika",
    ]);
  });

  it("asks the sources that take a key in the order of priority, each that takes none next to its family's", () => {
    expect(
      script.sourcesInPriority(FAMILIES, [
        "coingecko",
        "moralis",
        "coinpaprika",
      ]),
    ).toEqual(["MEXC", "CoinGecko", "Moralis", "GeckoTerminal", "CoinPaprika"]);
  });

  it("puts a service the order of priority does not name after those it names", () => {
    expect(script.sourcesInPriority(FAMILIES, ["coinpaprika"])).toEqual([
      "MEXC",
      "CoinPaprika",
      "Moralis",
      "GeckoTerminal",
      "CoinGecko",
    ]);
  });
});

describe("the sheet's sources, CoinPaprika ranked before CoinGecko", () => {
  const RANKED = { API_KEY_PRIORITY: ["coinpaprika", "coingecko"] };

  it("asks CoinPaprika first, and CoinGecko nothing once CoinPaprika gives a price", () => {
    const { script, asked } = scriptWith({
      ...RANKED,
      COINPAPRIKA_API_KEY: "paprika-key",
    });
    expect(
      script.getCryptoPrice("xtm", cellTime(ROW_UTC_MS), "UTC", "high"),
    ).toBe(3);
    expect(askedOf(asked, "coingecko")).toBe(false);
  });

  it("goes on to CoinGecko when CoinPaprika needs a key for the high", () => {
    const { script, asked } = scriptWith(RANKED);
    expect(
      script.getCryptoPrice("xtm", cellTime(ROW_UTC_MS), "UTC", "high"),
    ).toBe(2.5);
    expect(askedOf(asked, "coinpaprika")).toBe(false);
  });

  it("says CoinPaprika needs a key when no later source has a price either", () => {
    const { script } = scriptWith(RANKED, { geckoHasPrices: false });
    expect(
      script.getCryptoPrice("xtm", cellTime(ROW_UTC_MS), "UTC", "high"),
    ).toBe(KEY_MESSAGE);
  });

  it("says when to ask again, asking CoinGecko nothing, while CoinPaprika's day is not over", () => {
    const nowMs = Date.UTC(2026, 10, 24, 13, 30, 20);
    const { script, asked } = scriptWith(
      { ...RANKED, COINPAPRIKA_API_KEY: "paprika-key" },
      { nowMs },
    );
    expect(
      script.getCryptoPrice("xtm", cellTime(nowMs - 7200000), "UTC", "high"),
    ).toMatch(/^Too recent for a final price: ask again after /);
    expect(askedOf(asked, "coingecko")).toBe(false);
  });
});

describe("the sheet's price cache", () => {
  /**
   * The high of XTM at ROW_UTC_MS, from builds that share one cache, as one
   * Apps Script project keeps its cache when a new build is pasted into it.
   * MEXC lists no pair; CoinGecko's hourly prices around the time are 2.0
   * and 2.5; CoinPaprika's candle of the day, which it gives the high of
   * only with a key, has a high of 3.
   *
   * @returns {function(Object<string, *>): (number|string)} Gives the cell's answer from a build with the CONFIG fields given
   */
  function buildsSharingOneCache() {
    const { CacheService } = createAppsScriptServices({
      fetchSync: () => ({ failure: "the cache asks nothing" }),
    });
    const answer = (url) => {
      if (url.includes("/exchangeInfo")) return { symbols: [] };
      if (url.includes("/market_chart/range")) {
        return {
          prices: [
            [ROW_UTC_MS - 3600000, 2.0],
            [ROW_UTC_MS + 3600000, 2.5],
          ],
        };
      }
      return answerPaprikaCandleOfTheDay(url);
    };
    return (config) =>
      loadSheetsScript(SHEETS_SCRIPT_PATH, answer, {
        config: { CONFIG: config },
        services: { CacheService },
      }).getCryptoPrice("xtm", cellTime(ROW_UTC_MS), "UTC", "high");
  }

  it("gives a price from the order of priority of the build that runs, not one kept under another order", () => {
    const highFrom = buildsSharingOneCache();
    const paprikaKey = { COINPAPRIKA_API_KEY: "paprika-key" };
    expect(
      highFrom({
        ...paprikaKey,
        API_KEY_PRIORITY: ["coingecko", "coinpaprika"],
      }),
    ).toBe(2.5);
    expect(
      highFrom({
        ...paprikaKey,
        API_KEY_PRIORITY: ["coinpaprika", "coingecko"],
      }),
    ).toBe(3);
  });

  it("gives a price from the keys of the build that runs, not one kept from a build without a key saved since", () => {
    const highFrom = buildsSharingOneCache();
    const ranked = { API_KEY_PRIORITY: ["coinpaprika", "coingecko"] };
    expect(highFrom({ ...ranked, COINPAPRIKA_API_KEY: "" })).toBe(2.5);
    expect(highFrom({ ...ranked, COINPAPRIKA_API_KEY: "paprika-key" })).toBe(3);
  });
});

describe("the filler's sources", () => {
  afterEach(async () => {
    setApiKeyPriority(null);
    await closeExchangeSources();
  });

  it("are asked in the run's order of priority, each that takes no key next to its family's", async () => {
    setApiKeyPriority(["coingecko", "moralis", "coinpaprika", "dextools"]);
    expect(await sourceOrder(false)).toEqual([
      "MEXC",
      "CoinGecko",
      "Moralis",
      "GeckoTerminal",
      "CoinPaprika",
    ]);
  });

  it("are asked, before a run opens its keys, in the order config.json's order of priority gives", async () => {
    const declared = await sourceOrder(false);
    expect(declared).toEqual([
      "Moralis",
      "GeckoTerminal",
      "MEXC",
      "CoinGecko",
      "CoinPaprika",
    ]);
    setApiKeyPriority(
      readNeededKeys(REPO_TOP).map((service) => service.service),
    );
    expect(await sourceOrder(false)).toEqual(declared);
  });
});
