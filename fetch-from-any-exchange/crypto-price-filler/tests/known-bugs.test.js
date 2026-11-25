/**
 * Tests of the bugs known in the repo's code, each declared with `it.fails`.
 * @module tests/known-bugs.test
 *
 * Each test checks the behavior the code should have, so it fails while
 * the bug is there, and `it.fails` turns that failure into a pass. A fix
 * makes the test pass, so `it.fails` fails it: the same change declares the
 * test with `it` and moves it to the regression file of its area, as the
 * repo's CLAUDE.md lists them, and removes the bug's row from the table
 * there, which lists each test here.
 *
 * The exchange script runs unchanged in the test's thread, through
 * `tests/helpers/sheets-script.js`, against a stand-in MEXC, which answers
 * as MEXC does (`test/helpers/stand-in-mexc.js`), a stand-in CoinGecko and
 * a stand-in clock. GeckoTerminal's source runs with the shared client for
 * real against a stand-in fetch (`helpers/stand-in-fetch.js`), with no
 * waits, the stand-in clock's present as the client's clock, and the
 * committed settings. The command line runs in a child
 * process with the stand-in fetch preload, and a key file and password of
 * the test's own.
 */

import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Linter } from "eslint";
import { loadSheetsScript } from "./helpers/sheets-script.js";
import {
  COMMAND_LINE,
  FILLER_DIR,
  SHEETS_SCRIPT_PATH,
  answerMexcCandle,
  cellTime,
  dateAt,
} from "./helpers/regression-runs.js";
import { answerWith } from "./helpers/stand-in-fetch.js";
import { STAND_IN_GECKO_KEY } from "./helpers/stand-in-coingecko-key.js";
import { mexcKlines } from "../../../test/helpers/stand-in-mexc.js";
import { getPriceFromGeckoTerminal } from "../sources/geckoterminal.js";
import { clearCache } from "../utils/cache.js";
import { saveEncryptedKey } from "../../../api-key-store/index.js";
import noSecretLogging from "../../../eslint-rules/no-secret-logging.js";

/** The stand-in clock's present: 13:30:20 UTC on 2026-11-24. */
const NOW_MS = vi.hoisted(() => Date.UTC(2026, 10, 24, 13, 30, 20));

// The shared client, asking the stand-in fetch, at the stand-in clock's present
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
        now: () => NOW_MS,
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

describe("MEXC's candle of a period not yet over", () => {
  it.fails(
    "getCryptoPrice gives no price from the minute not yet over, and says when to ask again",
    () => {
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, answerMexcCandle, {
        services: { Date: dateAt(NOW_MS) },
      });
      expect(
        script.getCryptoPrice(
          "xtm",
          cellTime(NOW_MS - 10000),
          "UTC",
          "close",
          0,
        ),
      ).toBe(
        "Too recent for a final price: ask again after 2026-11-24 13:31 UTC",
      );
    },
  );

  it.fails(
    "getPriceFromMEXC gives no price from the hour not yet over, for a minute in which nothing traded",
    () => {
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
      expect(
        script.getPriceFromMEXC("xtm", NOW_MS - 120000, "close"),
      ).toBeNull();
    },
  );

  it.fails(
    "getPriceFromMEXC gives no price from the minute not yet over, as crypto-price-filler asks it",
    () => {
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, answerMexcCandle, {
        services: { Date: dateAt(NOW_MS) },
      });
      expect(
        script.getPriceFromMEXC("xtm", NOW_MS - 10000, "close"),
      ).toBeNull();
    },
  );

  it.fails(
    "getPriceFromMEXC gives no price from the hour not yet over, when MEXC gives no candle of the minute",
    () => {
      const script = loadSheetsScript(
        SHEETS_SCRIPT_PATH,
        (url) => {
          if (url.includes("/exchangeInfo")) return answerMexcCandle(url);
          if (new URL(url).searchParams.get("interval") === "1m") return [];
          return mexcKlines(url, ["1.00", "1.50", "0.80", "1.10", "10"]);
        },
        { services: { Date: dateAt(NOW_MS) } },
      );
      expect(
        script.getPriceFromMEXC("xtm", NOW_MS - 120000, "close"),
      ).toBeNull();
    },
  );
});

describe("crypto-price-filler's GeckoTerminal source", () => {
  const contract = "0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39";

  /**
   * The source's price at a time, from the one trading pool GeckoTerminal
   * lists for the token, whose candles of each timeframe `candles` gives.
   *
   * @param {number} utcMs - The time, in UTC milliseconds
   * @param {{minute: Array, hour: Array}} candles - The ohlcv list of each timeframe; none where it gives none
   * @returns {Promise<number|null>} The price, or null when the source gives none
   */
  async function priceAt(utcMs, candles) {
    clearCache();
    answerWith((url) => {
      if (url.includes(`/tokens/${contract}/pools`)) {
        const side = (id) => ({ data: { id: `pulsechain_${id}` } });
        return {
          data: [
            {
              attributes: {
                address: "0x2222222222222222222222222222222222222222",
                name: "HEX / WPLS",
                reserve_in_usd: "3000000",
                volume_usd: { h24: "25000" },
              },
              relationships: {
                base_token: side(contract.toLowerCase()),
                quote_token: side(`0x${"a1".repeat(20)}`),
              },
            },
          ],
        };
      }
      const timeframe = /\/ohlcv\/(minute|hour)/.exec(url)?.[1];
      if (timeframe === undefined) return null;
      return {
        data: { attributes: { ohlcv_list: candles[timeframe] ?? [] } },
        meta: { base: { address: contract }, quote: { address: "0xa1" } },
      };
    });
    try {
      return await getPriceFromGeckoTerminal(
        { contract, network: "pulsechain", moralisChain: "0x171" },
        utcMs,
        "close",
      );
    } finally {
      answerWith(() => null);
    }
  }

  it.fails("gives no price from the minute not yet over", async () => {
    const minuteOpen = Math.floor(NOW_MS / 60000) * 60;
    expect(
      await priceAt(NOW_MS - 10000, {
        minute: [[minuteOpen, 0.004, 0.0045, 0.0038, 0.0042, 100]],
      }),
    ).toBeNull();
  });

  it.fails(
    "gives no price from the hour not yet over, for a minute in which nothing traded",
    async () => {
      const hourOpen = Math.floor(NOW_MS / 3600000) * 3600;
      expect(
        await priceAt(NOW_MS - 120000, {
          minute: [],
          hour: [[hourOpen, 0.005, 0.0055, 0.0048, 0.0051, 100]],
        }),
      ).toBeNull();
    },
  );
});

describe("CoinGecko's price of a day for close", () => {
  it.fails("is its price at 00:00 UTC the next day, which ends the day", () => {
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

  it.fails(
    "asks CoinGecko nothing before 00:50 UTC the next day, when it serves the price that ends the day",
    () => {
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
        script.getPriceFromCoinGecko(
          "tezos",
          Date.UTC(2026, 10, 24, 6),
          "close",
        ),
      ).toBeNull();
      expect(asked.filter((url) => url.includes("/history"))).toEqual([]);
    },
  );
});

describe("the message that CoinPaprika needs a key", () => {
  it.fails(
    "is kept for the cell, as no data is, so asking again asks nothing",
    () => {
      const asked = [];
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
        asked.push(url);
        if (url.includes("/exchangeInfo")) return { symbols: [] };
        if (url.includes("/market_chart/range")) return { prices: [] };
        return null;
      });
      const ask = () =>
        script.getCryptoPrice(
          "xtm",
          "2025-06-15 12:30:00",
          "UTC",
          "average",
          0,
        );
      expect(ask()).toMatch(/CoinPaprika gives average, high and low only/);
      const before = asked.length;
      expect(ask()).toMatch(/CoinPaprika gives average, high and low only/);
      expect(asked.slice(before)).toEqual([]);
    },
  );
});

describe("crypto-price-filler's question without a CoinPaprika key", () => {
  it.fails(
    "takes an answer piped in after the key store's password",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "known-bug-piped-"));
      try {
        const keyFile = path.join(dir, "api-keys.json");
        const password = "a-password-of-the-test";
        await saveEncryptedKey(
          keyFile,
          "coingecko",
          STAND_IN_GECKO_KEY,
          password,
        );
        const input = path.join(dir, "in.csv");
        const output = path.join(dir, "out.csv");
        fs.writeFileSync(input, "date (UTC),amount\n2025-06-15 12:30:00,10\n");
        const run = spawnSync(
          process.execPath,
          [
            "--import",
            pathToFileURL(
              path.join(FILLER_DIR, "tests/helpers/stand-in-fetch-preload.js"),
            ).href,
            COMMAND_LINE,
            "--token=xtm",
            `--input=${input}`,
            `--output=${output}`,
            "--mode=high",
          ],
          {
            cwd: FILLER_DIR,
            env: {
              ...process.env,
              NODE_ENV: "test",
              API_KEYS_FILE_PATH: keyFile,
              API_KEYS_PASSWORD: "",
            },
            input: `${password}\ny\n`,
            encoding: "utf8",
            timeout: 50000,
          },
        );
        expect(run.status).toBe(0);
        expect(fs.existsSync(output)).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("the security lint's no-secret-logging", () => {
  it.fails(
    "refuses a key printed through an assignment that adds to it or defaults it, or a key written as a template literal",
    () => {
      const linter = new Linter();
      const refused = (code) =>
        linter.verify(code, {
          languageOptions: { ecmaVersion: "latest", sourceType: "module" },
          plugins: {
            local: { rules: { "no-secret-logging": noSecretLogging } },
          },
          rules: { "local/no-secret-logging": "error" },
        }).length;
      for (const code of [
        "console.log((apiKey += ''))",
        "console.log((apiKey ||= 'none'))",
        "console.log((apiKey ??= 'none'))",
        "console.log(keys[`apiKey`])",
      ])
        expect(refused(code), code).toBe(1);
    },
  );
});
