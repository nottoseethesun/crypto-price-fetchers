/**
 * Tests that guard fixed bugs, each running the exchange script in the
 * test's thread. A fix moves its known-bug test here from
 * `known-bugs.test.js` when the test runs the exchange script that way;
 * the current-price script's and the menu's are in
 * `regressions-sheets-price-now.test.js` (see the repo's CLAUDE.md).
 * @module tests/regressions-sheets.test
 *
 * The exchange script runs unchanged in the test's thread, through
 * `tests/helpers/sheets-script.js`, against a stand-in MEXC, which answers
 * as MEXC does (`test/helpers/stand-in-mexc.js`), a stand-in CoinGecko, a
 * stand-in CoinPaprika, a stand-in clock for a day not yet over, and, for
 * the waits, a script lock that is never free.
 */

import { describe, it, expect } from "vitest";
import {
  CUSTOM_FUNCTION_LIMIT_MS,
  busyLockService,
  loadSheetsScript,
  noResponse,
  reply,
} from "./helpers/sheets-script.js";
import {
  DAY_MS,
  ROW_UTC_MS,
  SHEETS_SCRIPT_PATH,
  answerCoinGeckoForPastDay,
  answerPaprikaCandleOfTheDay,
  cellTime,
  dateAt,
} from "./helpers/regression-runs.js";
import { mexcKlines } from "../../../test/helpers/stand-in-mexc.js";

describe("the exchange script's quote currency", () => {
  it("getPriceFromMEXC asks for the pairs quoted in CONFIG.QUOTE_CURRENCY, the token's and BTC's", () => {
    const symbols = [];
    const script = loadSheetsScript(
      SHEETS_SCRIPT_PATH,
      (url) => {
        if (url.includes("/exchangeInfo")) {
          return {
            symbols: [
              { baseAsset: "ABC", quoteAsset: "USDT" },
              { baseAsset: "ABC", quoteAsset: "USDC" },
              { baseAsset: "XYZ", quoteAsset: "BTC" },
              { baseAsset: "BTC", quoteAsset: "USDT" },
              { baseAsset: "BTC", quoteAsset: "USDC" },
            ],
          };
        }
        symbols.push(new URL(url).searchParams.get("symbol"));
        return mexcKlines(url, ["1.20", "1.60", "0.60", "1.20", "5"]);
      },
      { config: { CONFIG: { QUOTE_CURRENCY: "USDC" } } },
    );
    const time = Date.UTC(2025, 5, 15, 12, 30);
    script.getPriceFromMEXC("abc", time, "close");
    script.getPriceFromMEXC("xyz", time, "close");
    expect([...new Set(symbols)]).toEqual(["ABCUSDC", "XYZBTC", "BTCUSDC"]);
  });
});

describe("the exchange script before MEXC lists a pair", () => {
  it("getCryptoPrice asks CoinGecko for a time before MEXC listed the pair, rather than pricing it from MEXC's later candles", () => {
    const listed = Date.UTC(2025, 8, 1);
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
      if (url.includes("/exchangeInfo"))
        return {
          symbols: [
            { symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" },
          ],
        };
      if (url.includes("/klines"))
        return mexcKlines(url, (open) =>
          open >= listed ? ["0.10", "0.30", "0.10", "0.20", "10"] : null,
        );
      return answerCoinGeckoForPastDay(url);
    });
    expect(
      script.getCryptoPrice("xtm", "2025-06-15 12:30:00", "UTC", "close"),
    ).toBe(1.23);
  });

  it("getPriceFromMEXC still prices a time after the listing from the larger window in which something traded", () => {
    const listed = Date.UTC(2025, 8, 1);
    const intervals = [];
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
      if (url.includes("/exchangeInfo"))
        return {
          symbols: [
            { symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" },
          ],
        };
      if (url.includes("/klines")) {
        const interval = new URL(url).searchParams.get("interval");
        intervals.push(interval);
        return mexcKlines(url, (open) => {
          if (open < listed || interval === "1m") return null;
          return interval === "60m"
            ? ["0.20", "0.20", "0.20", "0.20", "0"]
            : ["0.10", "0.50", "0.10", "0.30", "10"];
        });
      }
      return null;
    });
    expect(
      script.getPriceFromMEXC("xtm", Date.UTC(2025, 9, 15, 12, 30), "close"),
    ).toBeCloseTo(0.3, 10);
    expect(intervals).toEqual(["1m", "60m", "60m", "4h"]);
  });
});

describe("the exchange script on the day MEXC lists a pair", () => {
  it("getCryptoPrice asks CoinGecko for a time before the first trade on the listing day, rather than pricing it from the later trades of the 4 hours that hold it", () => {
    const firstTrade = Date.UTC(2025, 8, 1, 14, 0);
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
      if (url.includes("/exchangeInfo"))
        return {
          symbols: [
            { symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" },
          ],
        };
      if (url.includes("/klines"))
        return mexcKlines(url, (open, end) =>
          end >= firstTrade ? ["0.10", "0.30", "0.10", "0.20", "10"] : null,
        );
      return answerCoinGeckoForPastDay(url);
    });
    expect(
      script.getCryptoPrice("xtm", "2025-09-01 13:30:00", "UTC", "close"),
    ).toBe(1.23);
  });
});

describe("the exchange script in the hour MEXC lists a pair", () => {
  it("getCryptoPrice asks CoinGecko for a recent time in the listing hour before the first trade, rather than pricing it from the hour's later trades", () => {
    const hour = Math.floor((Date.now() - 2 * 86400000) / 3600000) * 3600000;
    const firstTrade = hour + 20 * 60000;
    const time = new Date(hour + 10 * 60000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
      if (url.includes("/exchangeInfo"))
        return {
          symbols: [
            { symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" },
          ],
        };
      if (url.includes("/klines"))
        return mexcKlines(url, (open, end) =>
          end >= firstTrade ? ["0.10", "0.30", "0.10", "0.20", "10"] : null,
        );
      return answerCoinGeckoForPastDay(url);
    });
    expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.23);
  });
});

/** A MEXC candle in which something traded: open, high, low, close, volume. */
const TRADED = ["1.00", "1.50", "0.80", "1.20", "10"];

/**
 * Loads the exchange script with a stand-in MEXC that lists XTMUSDT and
 * answers its klines with `klines`, and CoinGecko's answer for a past day.
 *
 * @param {function(string): *} klines - Answers a klines url
 * @param {Object} [options] - More for `loadSheetsScript`, such as `sleep`
 * @returns {Object} The script's global scope
 */
function exchangeScriptWith(klines, options = {}) {
  return loadSheetsScript(
    SHEETS_SCRIPT_PATH,
    (url) => {
      if (url.includes("/exchangeInfo"))
        return {
          symbols: [
            { symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" },
          ],
        };
      if (url.includes("/klines")) return klines(url);
      return answerCoinGeckoForPastDay(url);
    },
    options,
  );
}

describe("MEXC's minute candles", () => {
  it("getCryptoPrice prices a recent time from MEXC's hour when the request for its minute fails, rather than taking the failure for a minute before the pair's first trade", () => {
    const script = exchangeScriptWith((url) => {
      const asked = new URL(url).searchParams;
      if (asked.get("interval") === "1m" && asked.get("limit") === "1")
        return reply(503, null);
      return mexcKlines(url, () => TRADED);
    });
    const time = cellTime(Date.now() - 2 * 86400000);
    expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.2);
  });

  it("getCryptoPrice prices a time in the hour MEXC's minute candles begin in from MEXC's hour, rather than taking the minutes MEXC let go for minutes before the pair's first trade", () => {
    const hour = Math.floor((Date.now() - 30 * 86400000) / 3600000) * 3600000;
    const keptFrom = hour + 30 * 60000;
    const script = exchangeScriptWith((url) =>
      mexcKlines(url, (open, end, interval) =>
        interval === "1m" && open < keptFrom ? null : TRADED,
      ),
    );
    const time = cellTime(hour + 10 * 60000);
    expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.2);
  });
});

/**
 * Whether a klines url asks for a day's candle, and for which day.
 *
 * @param {string} url - The url
 * @param {number} dayStart - The day's first ms
 * @returns {boolean} Whether it asks for that day
 */
function asksForDay(url, dayStart) {
  const asked = new URL(url).searchParams;
  return (
    asked.get("interval") === "1d" &&
    Number(asked.get("startTime")) === dayStart
  );
}

describe("MEXC's requests that fail", () => {
  it("getCryptoPrice asks CoinGecko for a recent time with no minute candle when the request for the day before fails, since nothing then tells whether the time comes before the pair's first trade", () => {
    const hour = Math.floor((Date.now() - 30 * DAY_MS) / 3600000) * 3600000;
    const keptFrom = hour + 30 * 60000;
    const dayBefore = Math.floor(hour / DAY_MS) * DAY_MS - DAY_MS;
    const script = exchangeScriptWith((url) =>
      asksForDay(url, dayBefore)
        ? reply(503, null)
        : mexcKlines(url, (open, end, interval) =>
            interval === "1m" && open < keptFrom ? null : TRADED,
          ),
    );
    const time = cellTime(hour + 10 * 60000);
    expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.23);
  });

  it("getCryptoPrice asks CoinGecko for a time with no hour candle when the request for the day before fails, since nothing then tells whether the time comes before the pair's first trade", () => {
    const time = Date.now() - 60 * DAY_MS;
    const dayBefore = Math.floor(time / DAY_MS) * DAY_MS - DAY_MS;
    const script = exchangeScriptWith((url) =>
      asksForDay(url, dayBefore)
        ? reply(503, null)
        : mexcKlines(url, (open, end, interval) =>
            ["1m", "60m", "4h"].includes(interval) ? null : TRADED,
          ),
    );
    expect(script.getCryptoPrice("xtm", cellTime(time), "UTC", "close")).toBe(
      1.23,
    );
  });

  it("getCryptoPrice goes on up to the week when the request for the day fails, rather than taking the failure for no candle of the day", () => {
    const time = Date.now() - 60 * DAY_MS;
    const day = Math.floor(time / DAY_MS) * DAY_MS;
    const script = exchangeScriptWith((url) =>
      asksForDay(url, day)
        ? reply(503, null)
        : mexcKlines(url, (open, end, interval) =>
            ["1m", "60m", "4h"].includes(interval) ? null : TRADED,
          ),
    );
    expect(script.getCryptoPrice("xtm", cellTime(time), "UTC", "close")).toBe(
      1.15,
    );
  });

  it("getCryptoPrice asks the next source when MEXC gives no response at all, as a timeout or a refused connection gives, rather than show the error", () => {
    const script = exchangeScriptWith(() =>
      noResponse("The operation was aborted due to timeout"),
    );
    const time = cellTime(Date.now() - 2 * DAY_MS);
    expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.23);
  });

  it("getCryptoPrice gives no MEXC price for a time on the day MEXC listed the pair when the request for the day before fails, rather than price it from the day's later trades", () => {
    const listingDay = Math.floor((Date.now() - 60 * DAY_MS) / DAY_MS) * DAY_MS;
    const firstTrade = listingDay + 12 * 3600000;
    const script = exchangeScriptWith((url) =>
      asksForDay(url, listingDay - DAY_MS)
        ? reply(503, null)
        : mexcKlines(url, (open, end) =>
            end < firstTrade ? null : ["5.00", "9.00", "5.00", "8.00", "1000"],
          ),
    );
    const time = cellTime(listingDay + 6 * 3600000);
    expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.23);
  });
});

/** What a cell shows when the call got no lock, or no source priced it and a request was cut short. */
const BUSY = "Rate limit busy - retry later";

describe("waits inside a custom function", () => {
  it("getCryptoPrice waits for the script lock, in all, no longer than Google lets a custom function run", () => {
    const waits = [];
    const sleeps = [];
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, () => null, {
      services: { LockService: busyLockService(waits) },
      sleep: (milliseconds) => sleeps.push(milliseconds),
    });
    script.getCryptoPrice("btc", "2026-01-15 14:30:00", "UTC", "high");
    const waited = [...waits, ...sleeps].reduce((sum, ms) => sum + ms, 0);
    expect(waits.length).toBeGreaterThan(0);
    expect(waited).toBeLessThanOrEqual(CUSTOM_FUNCTION_LIMIT_MS);
  });

  it("getCryptoPrice waits, in all, no longer than Google lets a custom function run when every source refuses every request as one too many, and shows the busy message, keeping nothing", () => {
    const sleeps = [];
    let asked = 0;
    const script = loadSheetsScript(
      SHEETS_SCRIPT_PATH,
      (url) => {
        if (url.includes("/exchangeInfo"))
          return {
            symbols: [
              { symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" },
            ],
          };
        asked += 1;
        return reply(429, {});
      },
      { sleep: (milliseconds) => sleeps.push(milliseconds) },
    );
    const time = cellTime(Date.now() - 2 * DAY_MS);
    expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(BUSY);
    const waited = sleeps.reduce((sum, milliseconds) => sum + milliseconds, 0);
    expect(waited).toBeLessThanOrEqual(CUSTOM_FUNCTION_LIMIT_MS);
    const askedFirst = asked;
    script.getCryptoPrice("xtm", time, "UTC", "close");
    expect(asked).toBeGreaterThan(askedFirst);
  });

  it("getCryptoPrice gives the next source's price when MEXC refuses every request as one too many", () => {
    const script = exchangeScriptWith(() => reply(429, {}));
    const time = cellTime(Date.now() - 2 * DAY_MS);
    expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.23);
  });
});

describe("a call cut short", () => {
  it("getCryptoPrice asks CoinGecko again on the call after one it cut short, rather than keep the cut-short requests' silence as no data", () => {
    let refusing = true;
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
      if (url.includes("api.coingecko.com") && refusing) return reply(429, {});
      return answerCoinGeckoForPastDay(url);
    });
    const time = cellTime(Date.now() - 2 * DAY_MS);
    expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(BUSY);
    refusing = false;
    expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.23);
  });

  it("getCryptoPrice shows the busy message, keeping nothing, when every request gets no response, as when Apps Script's daily quota of web requests is spent", () => {
    let spent = true;
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) =>
      spent
        ? noResponse("Service invoked too many times for one day: urlfetch.")
        : answerCoinGeckoForPastDay(url),
    );
    const time = cellTime(Date.now() - 2 * DAY_MS);
    expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(BUSY);
    spent = false;
    expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.23);
  });

  it("getCryptoPrice shows the busy message, keeping nothing, when every source answers with a server error or a request timeout, which say nothing of whether it has a price", () => {
    for (const status of [503, 408]) {
      let failing = true;
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) =>
        failing ? reply(status, null) : answerCoinGeckoForPastDay(url),
      );
      const time = cellTime(Date.now() - 2 * DAY_MS);
      expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(BUSY);
      failing = false;
      expect(script.getCryptoPrice("xtm", time, "UTC", "close")).toBe(1.23);
    }
  });

  it("getCryptoPrice keeps CoinGecko's lack of an answer when only another source's request was cut short", () => {
    let coinGeckoAsked = 0;
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
      if (url.includes("/exchangeInfo"))
        return noResponse("The operation was aborted due to timeout");
      if (url.includes("api.coingecko.com")) coinGeckoAsked += 1;
      return answerCoinGeckoForPastDay(url);
    });
    const time = cellTime(Date.now() - 2 * DAY_MS);
    expect(script.getCryptoPrice("xtm", time, "UTC", "average")).toBe(BUSY);
    expect(coinGeckoAsked).toBe(1);
    expect(script.getCryptoPrice("xtm", time, "UTC", "average")).toBe(BUSY);
    expect(coinGeckoAsked).toBe(1);
  });
});

describe("CoinGecko's hourly prices are kept for the time asked, not for its day", () => {
  it("the Sheets script asks again for another time of the same day, and gives that time's price", () => {
    const asked = [];
    const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
      asked.push(url);
      const from = Number(new URL(url).searchParams.get("from")) * 1000;
      const centre = from + 43200000;
      return {
        prices: [[centre, centre === ROW_UTC_MS ? 2.4 : 3.1]],
      };
    });
    expect(script.getPriceFromCoinGecko("tezos", ROW_UTC_MS, "high")).toBe(2.4);
    expect(
      script.getPriceFromCoinGecko("tezos", ROW_UTC_MS + 7200000, "high"),
    ).toBe(3.1);
    expect(asked).toHaveLength(2);
  });
});

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
