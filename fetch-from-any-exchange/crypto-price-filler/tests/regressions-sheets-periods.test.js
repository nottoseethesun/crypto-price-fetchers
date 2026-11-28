/**
 * Tests that guard fixed bugs of the period a price of the exchange
 * script comes from: a period not yet over, whose candle can still
 * change, and the end of a day that closes it. Each runs the exchange
 * script in the test's thread; a fix moves its known-bug test here from
 * `known-bugs.test.js` when it is about such a period (see the repo's
 * `docs/engineering.md`, Known Bugs).
 * @module tests/regressions-sheets-periods.test
 *
 * The exchange script runs unchanged in the test's thread, through
 * `tests/helpers/sheets-script.js`, against a stand-in MEXC, which answers
 * as MEXC does (`test/helpers/stand-in-mexc.js`), a stand-in CoinGecko, a
 * stand-in CoinPaprika and a stand-in clock.
 */

import { describe, it, expect } from "vitest";
import { loadSheetsScript, noResponse } from "./helpers/sheets-script.js";
import {
  SHEETS_SCRIPT_PATH,
  answerMexcCandle,
  answerPaprikaCandleOfTheDay,
  cellTime,
  dateAt,
} from "./helpers/regression-runs.js";
import { mexcKlines } from "../../../test/helpers/stand-in-mexc.js";

/** The stand-in clock's present: 13:30:20 UTC on 2026-11-24. */
const NOW_MS = Date.UTC(2026, 10, 24, 13, 30, 20);

describe("the exchange script, for a time less than 12 hours ago", () => {
  it("gives no CoinGecko price from a window that is not over, saying when to ask again, once CoinGecko shows it prices the coin", () => {
    const asked = [];
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
      asked.push(url);
      if (url.includes("/market_chart/range"))
        return { prices: [[Date.now() - 7200000, 2]] };
      return null;
    });
    expect(
      script.getCryptoPrice("grc", cellTime(Date.now() - 3600000), "UTC"),
    ).toMatch(
      /^Too recent for a final price: ask again after \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/,
    );
    const coinGecko = asked.filter((url) => url.includes("coingecko"));
    expect(coinGecko).toHaveLength(1);
    const to = Number(new URL(coinGecko[0]).searchParams.get("to")) * 1000;
    expect(Math.abs(to - Date.now())).toBeLessThan(60000);
  });

  it("asks CoinPaprika, as for an older time, for a recent time of a coin CoinGecko has no prices of, once the time's UTC day is over", () => {
    const asked = [];
    const script = loadSheetsScript(
      SHEETS_SCRIPT_PATH,
      (url) => {
        asked.push(url);
        return null;
      },
      { services: { Date: dateAt(Date.UTC(2026, 10, 24, 6)) } },
    );
    expect(
      script.getCryptoPrice("xtm", "2026-11-23 23:00:00", "UTC", "close"),
    ).toBe("No data available from any source");
    expect(asked.filter((url) => url.includes("coingecko"))).toHaveLength(1);
    expect(asked.some((url) => url.includes("coinpaprika"))).toBe(true);
  });

  it("gives no data, not when to ask again, for a ticker CoinGecko has no prices of, once the time's UTC day is over", () => {
    const asked = [];
    const script = loadSheetsScript(
      SHEETS_SCRIPT_PATH,
      (url) => {
        asked.push(url);
        return null;
      },
      { services: { Date: dateAt(Date.UTC(2026, 10, 24, 6)) } },
    );
    expect(
      script.getCryptoPrice("btcc", "2026-11-23 23:00:00", "UTC", "close"),
    ).toBe("No data available from any source");
    expect(asked.filter((url) => url.includes("coingecko"))).toHaveLength(1);
  });

  it("says it is busy, asking CoinPaprika nothing, when the request for CoinGecko's prices so far was cut short, once the time's UTC day is over", () => {
    const asked = [];
    const script = loadSheetsScript(
      SHEETS_SCRIPT_PATH,
      (url) => {
        asked.push(url);
        if (url.includes("/exchangeInfo")) return { symbols: [] };
        if (url.includes("coingecko")) return noResponse("timed out");
        return answerPaprikaCandleOfTheDay(url);
      },
      { services: { Date: dateAt(Date.UTC(2026, 10, 24, 6)) } },
    );
    expect(
      script.getCryptoPrice("xtm", "2026-11-23 23:00:00", "UTC", "close"),
    ).toBe("Rate limit busy - retry later");
    expect(asked.some((url) => url.includes("coinpaprika"))).toBe(false);
  });

  it("says it is busy, not when to ask again, when MEXC's request for a recent time was cut short", () => {
    const asked = [];
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
      asked.push(url);
      if (url.includes("mexc")) return noResponse("timed out");
      if (url.includes("/market_chart/range"))
        return { prices: [[Date.now() - 7200000, 2]] };
      return null;
    });
    expect(
      script.getCryptoPrice("btc", cellTime(Date.now() - 3600000), "UTC"),
    ).toBe("Rate limit busy - retry later");
    expect(asked.filter((url) => url.includes("coingecko"))).toEqual([]);
  });
});

describe("CoinPaprika's UTC day of a time, while it is not over", () => {
  it("CoinPaprika's source gives no price from the day's candle, which can still change", () => {
    const asked = [];
    const script = loadSheetsScript(
      SHEETS_SCRIPT_PATH,
      (url) => {
        asked.push(url);
        return answerPaprikaCandleOfTheDay(url);
      },
      { services: { Date: dateAt(Date.UTC(2026, 10, 24, 13)) } },
    );
    expect(
      script.getPriceFromCoinPaprika(
        "xtm-tari",
        Date.UTC(2026, 10, 24, 12),
        "close",
      ),
    ).toBeNull();
    expect(asked).toEqual([]);
  });

  it("the exchange script says when to ask again, asking CoinPaprika nothing", () => {
    const asked = [];
    const script = loadSheetsScript(
      SHEETS_SCRIPT_PATH,
      (url) => {
        asked.push(url);
        return answerPaprikaCandleOfTheDay(url);
      },
      { services: { Date: dateAt(Date.UTC(2026, 10, 24, 13)) } },
    );
    expect(
      script.getCryptoPrice("xtm", "2026-11-24 00:30:00", "UTC", "close"),
    ).toBe(
      "Too recent for a final price: ask again after 2026-11-25 00:00 UTC",
    );
    expect(asked.some((url) => url.includes("coinpaprika"))).toBe(false);
  });

  it("the exchange script says no source has a price, not when to ask again, for a token CoinPaprika lists as inactive", () => {
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, () => null, {
      services: { Date: dateAt(Date.UTC(2026, 10, 24, 13)) },
    });
    expect(
      script.getCryptoPrice("grc", "2026-11-24 00:30:00", "UTC", "close"),
    ).toBe("No data available from any source");
  });

  it("the exchange script says it is busy, not when to ask again, when an earlier request of the call was cut short", () => {
    const script = loadSheetsScript(
      SHEETS_SCRIPT_PATH,
      (url) => (url.includes("mexc") ? noResponse("timed out") : null),
      { services: { Date: dateAt(Date.UTC(2026, 10, 24, 13)) } },
    );
    expect(
      script.getCryptoPrice("xtm", "2026-11-24 00:30:00", "UTC", "close"),
    ).toBe("Rate limit busy - retry later");
  });
});

describe("MEXC's candle of a period not yet over", () => {
  it("getCryptoPrice gives no price from the minute not yet over, and says when to ask again", () => {
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, answerMexcCandle, {
      services: { Date: dateAt(NOW_MS) },
    });
    expect(
      script.getCryptoPrice("xtm", cellTime(NOW_MS - 10000), "UTC", "close", 0),
    ).toBe(
      "Too recent for a final price: ask again after 2026-11-24 13:31 UTC",
    );
  });

  it("getPriceFromMEXC gives no price from the hour not yet over, for a minute in which nothing traded", () => {
    const script = loadSheetsScript(
      SHEETS_SCRIPT_PATH,
      (url) => {
        if (url.includes("/exchangeInfo")) return answerMexcCandle(url);
        const minute = new URL(url).searchParams.get("interval") === "1m";
        return mexcKlines(url, [
          "1.00",
          "1.50",
          "0.80",
          "1.10",
          minute ? "0" : "10",
        ]);
      },
      { services: { Date: dateAt(NOW_MS) } },
    );
    expect(script.getPriceFromMEXC("xtm", NOW_MS - 120000, "close")).toBeNull();
  });

  it("getPriceFromMEXC gives no price from the minute not yet over, as crypto-price-filler asks it", () => {
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, answerMexcCandle, {
      services: { Date: dateAt(NOW_MS) },
    });
    expect(script.getPriceFromMEXC("xtm", NOW_MS - 10000, "close")).toBeNull();
  });

  it("getPriceFromMEXC gives no price from the hour not yet over, when MEXC gives no candle of the minute", () => {
    const script = loadSheetsScript(
      SHEETS_SCRIPT_PATH,
      (url) => {
        if (url.includes("/exchangeInfo")) return answerMexcCandle(url);
        if (new URL(url).searchParams.get("interval") === "1m") return [];
        return mexcKlines(url, ["1.00", "1.50", "0.80", "1.10", "10"]);
      },
      { services: { Date: dateAt(NOW_MS) } },
    );
    expect(script.getPriceFromMEXC("xtm", NOW_MS - 120000, "close")).toBeNull();
  });

  it("getCryptoPrice says when CoinGecko's hours end, not when the minute ends, for a coin MEXC is not asked about", () => {
    const script = loadSheetsScript(
      SHEETS_SCRIPT_PATH,
      (url) =>
        url.includes("/market_chart/range")
          ? { prices: [[NOW_MS - 7200000, 2]] }
          : null,
      { services: { Date: dateAt(NOW_MS) } },
    );
    expect(
      script.getCryptoPrice("grc", cellTime(NOW_MS - 10000), "UTC", "close", 0),
    ).toBe(
      "Too recent for a final price: ask again after 2026-11-25 01:31 UTC",
    );
  });
});

describe("CoinGecko's price of a day for close", () => {
  it("is its price at 00:00 UTC the next day, which ends the day", () => {
    const prices = new Map([
      ["15-06-2025", 100],
      ["16-06-2025", 110],
    ]);
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
      if (url.includes("/exchangeInfo")) return { symbols: [] };
      if (url.includes("/market_chart/range")) return { prices: [] };
      if (url.includes("/history")) {
        const price = prices.get(new URL(url).searchParams.get("date"));
        return price === undefined
          ? null
          : { market_data: { current_price: { usd: price } } };
      }
      return null;
    });
    expect(
      script.getCryptoPrice("tezos", "2025-06-15 23:30:00", "UTC", "close", 0),
    ).toBe(110);
  });

  it("asks CoinGecko nothing before 00:50 UTC the next day, when it serves the price that ends the day", () => {
    const asked = [];
    const script = loadSheetsScript(
      SHEETS_SCRIPT_PATH,
      (url) => {
        asked.push(url);
        if (url.includes("/market_chart/range")) return { prices: [] };
        if (url.includes("/history"))
          return { market_data: { current_price: { usd: 7 } } };
        return null;
      },
      { services: { Date: dateAt(Date.UTC(2026, 10, 25, 0, 10)) } },
    );
    expect(
      script.getPriceFromCoinGecko("tezos", Date.UTC(2026, 10, 24, 6), "close"),
    ).toBeNull();
    expect(asked.filter((url) => url.includes("/history"))).toEqual([]);
  });
});
