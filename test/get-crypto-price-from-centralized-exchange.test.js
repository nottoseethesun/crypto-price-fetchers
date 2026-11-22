/**
 * Tests for bin/getCryptoPriceFromCentralizedExchange.js,
 * the Node version of src/getCryptoPriceFromCentralizedExchange.gs.
 * @module test/get-crypto-price-from-centralized-exchange.test
 *
 * The real `.gs` runs under the real runner. Its requests go to a stand-in
 * fetch (`helpers/stand-in-web.js`) that answers as MEXC and CoinGecko
 * answer, so the tests ask nothing outside the computer. The script waits
 * its 200 milliseconds before each lookup, as in the sheet.
 *
 * The command line's key file is one in a temp folder, removed afterwards,
 * and every environment a test passes names that file and holds no
 * `API_KEYS_PASSWORD` the test did not set, so no test opens the owner's
 * saved key; the password prompt answers from the test.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveEncryptedKey } from "../api-key-store/index.js";
import {
  keyConfig,
  openCentralizedExchangePrices,
  openCentralizedExchangeSources,
  runCommandLine,
} from "../bin/getCryptoPriceFromCentralizedExchange.js";
import { capturedOutput } from "./helpers/captured-output.js";
import { mexcKlines } from "./helpers/stand-in-mexc.js";
import { standInFetch } from "./helpers/stand-in-web.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

const MEXC = "https://api.mexc.com/api/v3";
const COINGECKO = "https://api.coingecko.com/api/v3";
const COINPAPRIKA_PRO = "https://api-pro.coinpaprika.com/v1";

/** 12:30 UTC on 2025-06-15, the time the tests ask about. */
const ROW_UTC_MS = Date.UTC(2025, 5, 15, 12, 30, 0);
const ROW_TIME = "2025-06-15 12:30:00";

/**
 * Answers as MEXC does for XTM, a pair it lists: the candle of the minute
 * asked (`helpers/stand-in-mexc.js`), with open 1.00, high 1.50, low 0.80
 * and close 1.10.
 *
 * @param {{url: string}} request - The request
 * @returns {Object|Array|null} The json body, or null for a 404
 */
function answerMexcCandle({ url }) {
  if (url === `${MEXC}/exchangeInfo`)
    return {
      symbols: [{ symbol: "XTMUSDT", baseAsset: "XTM", quoteAsset: "USDT" }],
    };
  if (url.startsWith(`${MEXC}/klines?symbol=XTMUSDT&interval=1m&`)) {
    return mexcKlines(url, ["1.00", "1.50", "0.80", "1.10", "10"]);
  }
  return null;
}

/**
 * Answers for when MEXC lists no XTM pair and CoinGecko's hourly prices
 * around the time are 2.00 and 2.50. CoinGecko's ping takes the key
 * `gecko-key` alone.
 *
 * @param {{url: string, headers: Object<string, string>}} request - The request
 * @returns {*} The response (`standInFetch`)
 */
function answerCoinGeckoRange({ url, headers }) {
  if (url === `${MEXC}/exchangeInfo`) return { symbols: [] };
  if (url === `${COINGECKO}/ping`) {
    return headers["x-cg-demo-api-key"] === "gecko-key"
      ? { gecko_says: "(V3) To the Moon!" }
      : { status: 401, text: "{}" };
  }
  if (url.startsWith(`${COINGECKO}/coins/minotari/market_chart/range?`)) {
    return {
      prices: [
        [ROW_UTC_MS - 3600000, 2.0],
        [ROW_UTC_MS + 3600000, 2.5],
      ],
    };
  }
  return null;
}

/**
 * Answers for when MEXC lists no XTM pair, CoinGecko has no hourly prices,
 * and only CoinPaprika's paid server, asked with the key `paprika-key`,
 * gives XTM's candle of 2025-06-15, with high 2.50. The paid server's key
 * facts take that key alone.
 *
 * @param {{url: string, headers: Object<string, string>}} request - The request
 * @returns {*} The response (`standInFetch`)
 */
function answerPaprikaPaid({ url, headers }) {
  if (url === `${MEXC}/exchangeInfo`) return { symbols: [] };
  if (url.startsWith(`${COINGECKO}/coins/minotari/market_chart/range?`))
    return { prices: [] };
  if (!url.startsWith(COINPAPRIKA_PRO)) return null;
  if (headers.authorization !== "paprika-key")
    return { status: 403, text: "{}" };
  if (url === `${COINPAPRIKA_PRO}/key/info`) return { plan: "starter" };
  if (url.startsWith(`${COINPAPRIKA_PRO}/coins/xtm-tari/ohlcv/historical?`)) {
    return [
      {
        time_open: "2025-06-15T00:00:00Z",
        time_close: "2025-06-15T23:59:59Z",
        high: 2.5,
        low: 2.0,
        close: 2.2,
      },
    ];
  }
  return null;
}

/**
 * The CoinGecko key each request to CoinGecko carried, by its path.
 *
 * @param {function} fetch - The stand-in fetch
 * @returns {Array<Array<string>>} Each request's path and key (null when it had none)
 */
function coinGeckoKeysSent(fetch) {
  return fetch.requests
    .filter((request) => request.url.startsWith(COINGECKO))
    .map((request) => [
      new URL(request.url).pathname,
      request.headers["x-cg-demo-api-key"] ?? null,
    ]);
}

/**
 * Opens the Node version with a stand-in fetch, runs `use` on it, and
 * closes it.
 *
 * @param {function({url: string}): *} answer - The stand-in's answers
 * @param {function(Object, function): Promise<void>} use - Takes the open function and the stand-in fetch
 * @param {Object} [options={}] - More options for `openCentralizedExchangePrices`, such as the CoinGecko key
 * @returns {Promise<void>} Settles once closed
 */
async function withPrices(answer, use, options = {}) {
  const fetch = standInFetch(answer);
  const prices = await openCentralizedExchangePrices({
    config: {},
    ...options,
    fetch,
  });
  try {
    await use(prices, fetch);
  } finally {
    await prices.close();
  }
}

describe("openCentralizedExchangePrices", () => {
  it("gives the high of MEXC's candle for the time", async () => {
    await withPrices(answerMexcCandle, async (prices) => {
      assert.equal(
        await prices.getCryptoPrice("xtm", ROW_TIME, "UTC", "high"),
        1.5,
      );
    });
  });

  it("gives the low of MEXC's candle for the time", async () => {
    await withPrices(answerMexcCandle, async (prices) => {
      assert.equal(
        await prices.getCryptoPrice("xtm", ROW_TIME, "UTC", "low"),
        0.8,
      );
    });
  });

  it("gives the close of MEXC's candle for the time", async () => {
    await withPrices(answerMexcCandle, async (prices) => {
      assert.equal(
        await prices.getCryptoPrice("xtm", ROW_TIME, "UTC", "close"),
        1.1,
      );
    });
  });

  it("takes the time as a Date, as a date cell gives it", async () => {
    await withPrices(answerMexcCandle, async (prices) => {
      assert.equal(
        await prices.getCryptoPrice("xtm", new Date(ROW_UTC_MS), "UTC", "high"),
        1.5,
      );
    });
  });

  it("falls back to CoinGecko's hourly prices, sending the key it is given in CoinGecko's header and in no url", async () => {
    await withPrices(
      answerCoinGeckoRange,
      async (prices, fetch) => {
        assert.equal(
          await prices.getCryptoPrice("xtm", ROW_TIME, "UTC", "high"),
          2.5,
        );
        assert.deepEqual(coinGeckoKeysSent(fetch), [
          ["/api/v3/coins/minotari/market_chart/range", "gecko-key"],
        ]);
        assert.ok(
          fetch.requests.every((request) => !request.url.includes("gecko-key")),
          "a url holds the key",
        );
      },
      { apiKeys: { coingecko: "gecko-key" } },
    );
  });

  it("asks CoinGecko without a key when it is given none", async () => {
    await withPrices(answerCoinGeckoRange, async (prices, fetch) => {
      assert.equal(
        await prices.getCryptoPrice("xtm", ROW_TIME, "UTC", "high"),
        2.5,
      );
      assert.deepEqual(coinGeckoKeysSent(fetch), [
        ["/api/v3/coins/minotari/market_chart/range", null],
      ]);
    });
  });

  it("gives the message the cell would show when no source has a price", async () => {
    await withPrices(
      () => null,
      async (prices) => {
        assert.equal(
          await prices.getCryptoPrice("xtm", ROW_TIME, "UTC", "high"),
          "No data available from any source",
        );
      },
    );
  });

  it("lays the keys it is given over the config's values", async () => {
    await withPrices(
      answerCoinGeckoRange,
      async (prices, fetch) => {
        await prices.getCryptoPrice("xtm", ROW_TIME, "UTC", "high");
        assert.deepEqual(coinGeckoKeysSent(fetch), [
          ["/api/v3/coins/minotari/market_chart/range", "gecko-key"],
        ]);
      },
      {
        config: { CONFIG: { COINGECKO_API_KEY: "" } },
        apiKeys: { coingecko: "gecko-key" },
      },
    );
  });

  it("asks CoinPaprika's paid server with the CoinPaprika key it is given, the whole Authorization header", async () => {
    await withPrices(
      answerPaprikaPaid,
      async (prices, fetch) => {
        assert.equal(
          await prices.getCryptoPrice("xtm", ROW_TIME, "UTC", "high"),
          2.5,
        );
        const paprika = fetch.requests.filter((request) =>
          request.url.startsWith(COINPAPRIKA_PRO),
        );
        assert.equal(paprika.length, 1);
        assert.equal(paprika[0].headers.authorization, "paprika-key");
        assert.ok(
          !paprika[0].url.includes("paprika-key"),
          "a url holds the key",
        );
      },
      { apiKeys: { coinpaprika: "paprika-key" } },
    );
  });
});

describe("openCentralizedExchangeSources", () => {
  it("gives the script's three price sources, each taking an id, a time in milliseconds and a target", async () => {
    const fetch = standInFetch(answerMexcCandle);
    const sources = await openCentralizedExchangeSources({ config: {}, fetch });
    try {
      assert.equal(
        await sources.getPriceFromMEXC("XTM", ROW_UTC_MS, "close"),
        1.1,
      );
      assert.equal(
        await sources.getPriceFromCoinGecko("minotari", ROW_UTC_MS, "high"),
        null,
      );
      assert.equal(
        await sources.getPriceFromCoinPaprika("xtm-tari", ROW_UTC_MS, "high"),
        null,
      );
    } finally {
      await sources.close();
    }
  });

  it("sets each key it is given in the script's CONFIG, and none it is not", () => {
    assert.deepEqual(keyConfig({ coingecko: "g", coinpaprika: "p" }), {
      CONFIG: { COINGECKO_API_KEY: "g", COINPAPRIKA_API_KEY: "p" },
    });
    assert.deepEqual(keyConfig({ coingecko: null }), {});
    assert.deepEqual(keyConfig({}), {});
  });
});

describe("getCryptoPriceFromCentralizedExchange.js, the command line", () => {
  let folder;
  let configFile;
  let noKeysFile;
  let savedKeyFile;
  let paprikaKeyFile;

  before(async () => {
    folder = makeTempFolder("cex");
    configFile = path.join(folder, "config.json");
    fs.writeFileSync(configFile, JSON.stringify({ CONFIG: {} }));
    noKeysFile = path.join(folder, "no-api-keys.json");
    savedKeyFile = path.join(folder, "api-keys.json");
    await saveEncryptedKey(savedKeyFile, "coingecko", "gecko-key", "pw");
    paprikaKeyFile = path.join(folder, "paprika-api-keys.json");
    await saveEncryptedKey(paprikaKeyFile, "coinpaprika", "paprika-key", "pw");
  });

  after(removeTempFolders);

  /**
   * A password prompt that must not be shown.
   *
   * @param {string} prompt - The prompt
   * @returns {Promise<string>} Never: it fails the test
   */
  async function askNothing(prompt) {
    assert.fail(`Asked ${prompt}`);
  }

  /**
   * Runs the command line with a stand-in fetch.
   *
   * @param {string[]} args - The arguments after the file's name
   * @param {function({url: string}): *} [answer=answerMexcCandle] - The stand-in's answers
   * @param {Object} [keys] - The environment and the password prompt: by default, a key file with no key, and no prompt
   * @returns {Promise<{exitCode: number, stdout: string, stderr: string, fetch: function}>} What it did, and the stand-in fetch
   */
  async function run(
    args,
    answer = answerMexcCandle,
    keys = { env: { API_KEYS_FILE_PATH: noKeysFile }, ask: askNothing },
  ) {
    const stdout = capturedOutput();
    const stderr = capturedOutput();
    const fetch = standInFetch(answer);
    const argv = [
      "node",
      "getCryptoPriceFromCentralizedExchange.js",
      ...args,
      "--config",
      configFile,
    ];
    const exitCode = await runCommandLine(argv, {
      fetch,
      stdout,
      stderr,
      ...keys,
    });
    return { exitCode, stdout: stdout.text, stderr: stderr.text, fetch };
  }

  /**
   * What a run did, without its stand-in fetch.
   *
   * @param {{exitCode: number, stdout: string, stderr: string}} result - What `run` gave
   * @returns {{exitCode: number, stdout: string, stderr: string}} The exit code and what it printed
   */
  function printed({ exitCode, stdout, stderr }) {
    return { exitCode, stdout, stderr };
  }

  it("prints the average of the high and the low in UTC unless told otherwise, with exit code 0", async () => {
    assert.deepEqual(printed(await run(["xtm", ROW_TIME])), {
      exitCode: 0,
      stdout: "1.15\n",
      stderr: "",
    });
  });

  it("prints the high with --mode high", async () => {
    assert.deepEqual(printed(await run(["xtm", ROW_TIME, "--mode", "high"])), {
      exitCode: 0,
      stdout: "1.5\n",
      stderr: "",
    });
  });

  it("prints the low with --mode low", async () => {
    assert.deepEqual(
      printed(await run(["xtm", ROW_TIME, "--mode", "low", "--tz", "UTC"])),
      {
        exitCode: 0,
        stdout: "0.8\n",
        stderr: "",
      },
    );
  });

  it("prints the close with --mode close", async () => {
    assert.deepEqual(printed(await run(["xtm", ROW_TIME, "--mode", "close"])), {
      exitCode: 0,
      stdout: "1.1\n",
      stderr: "",
    });
  });

  it("opens a saved CoinPaprika key, has CoinPaprika check it, and sends it to the paid server", async () => {
    const result = await run(["xtm", ROW_TIME], answerPaprikaPaid, {
      env: { API_KEYS_FILE_PATH: paprikaKeyFile, API_KEYS_PASSWORD: "pw" },
      ask: askNothing,
    });
    assert.deepEqual(printed(result), {
      exitCode: 0,
      stdout: "2.25\n",
      stderr: "",
    });
    assert.deepEqual(
      result.fetch.requests
        .filter((request) => request.url.startsWith(COINPAPRIKA_PRO))
        .map((request) => [
          new URL(request.url).pathname,
          request.headers.authorization,
        ]),
      [
        ["/v1/key/info", "paprika-key"],
        ["/v1/coins/xtm-tari/ohlcv/historical", "paprika-key"],
      ],
    );
  });

  it("prints the script's message on stderr when there is no price, with exit code 1", async () => {
    assert.deepEqual(printed(await run(["xtm", ROW_TIME], () => null)), {
      exitCode: 1,
      stdout: "",
      stderr: "No data available from any source\n",
    });
  });

  it("asks for the password of the saved CoinGecko key, has CoinGecko check it, and sends it", async () => {
    const asked = [];
    const ask = async (prompt) => {
      asked.push(prompt);
      return "pw";
    };
    const result = await run(["xtm", ROW_TIME], answerCoinGeckoRange, {
      env: { API_KEYS_FILE_PATH: savedKeyFile },
      ask,
    });
    assert.deepEqual(printed(result), {
      exitCode: 0,
      stdout: "2.25\n",
      stderr: "",
    });
    assert.deepEqual(asked, [`Password for the api keys in ${savedKeyFile}: `]);
    assert.deepEqual(coinGeckoKeysSent(result.fetch), [
      ["/api/v3/ping", "gecko-key"],
      ["/api/v3/coins/minotari/market_chart/range", "gecko-key"],
    ]);
  });

  it("opens the saved key with the password in API_KEYS_PASSWORD, asking nothing", async () => {
    const env = { API_KEYS_FILE_PATH: savedKeyFile, API_KEYS_PASSWORD: "pw" };
    const result = await run(["xtm", ROW_TIME], answerCoinGeckoRange, {
      env,
      ask: askNothing,
    });
    assert.deepEqual(printed(result), {
      exitCode: 0,
      stdout: "2.25\n",
      stderr: "",
    });
  });

  it("stops before asking a price, with exit code 1, when the password does not open the saved key", async () => {
    const keys = {
      env: { API_KEYS_FILE_PATH: savedKeyFile },
      ask: async () => "wrong",
    };
    const result = await run(["xtm", ROW_TIME], answerCoinGeckoRange, keys);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /^Could not open the CoinGecko api key saved in .*api-keys\.json with the password typed: The password does not open/,
    );
    assert.deepEqual(result.fetch.requests, []);
  });

  it("stops before asking a price, with exit code 1, when CoinGecko refuses the saved key", async () => {
    const refusing = (request) =>
      request.url.endsWith("/ping")
        ? { status: 401, text: "{}" }
        : answerMexcCandle(request);
    const result = await run(["xtm", ROW_TIME], refusing, {
      env: { API_KEYS_FILE_PATH: savedKeyFile },
      ask: async () => "pw",
    });
    assert.equal(result.exitCode, 1);
    assert.match(
      result.stderr,
      /^CoinGecko refused the api key saved in .*api-keys\.json\. Save a new one, in the project's top folder: npm run api-keys -- set coingecko\n$/,
    );
    assert.deepEqual(
      result.fetch.requests.map((request) => new URL(request.url).pathname),
      ["/api/v3/ping"],
    );
  });

  it("names --tz with the script's message for a time zone it does not know, never reading it as UTC, and asks nothing", async () => {
    const result = await run(["xtm", ROW_TIME, "--tz", "CTS"]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /^error: option '-z, --tz <abbreviation>' argument 'CTS' is invalid\. Unknown time zone "CTS": use one of UTC, GMT, /,
    );
    assert.deepEqual(result.fetch.requests, []);
  });

  it("refuses a mode other than average, high, low or close", async () => {
    const result = await run(["xtm", ROW_TIME, "--mode", "middle"]);
    assert.equal(result.exitCode, 1);
    assert.match(
      result.stderr,
      /Allowed choices are average, high, low, close/,
    );
  });

  it("answers --help on stdout, with exit code 0, asking no password", async () => {
    const result = await run(["--help"], answerMexcCandle, {
      env: { API_KEYS_FILE_PATH: savedKeyFile },
      ask: askNothing,
    });
    assert.equal(result.exitCode, 0);
    assert.match(
      result.stdout,
      /Usage: getCryptoPriceFromCentralizedExchange \[options\] <token> <date>/,
    );
    assert.match(result.stdout, /Api keys:/);
    assert.match(result.stdout, /Exit codes:/);
  });

  it("runs as a program: node getCryptoPriceFromCentralizedExchange.js --help", () => {
    const file = fileURLToPath(
      new URL(
        "../bin/getCryptoPriceFromCentralizedExchange.js",
        import.meta.url,
      ),
    );
    const output = execFileSync(process.execPath, [file, "--help"], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.match(output, /Usage: getCryptoPriceFromCentralizedExchange/);
  });
});
