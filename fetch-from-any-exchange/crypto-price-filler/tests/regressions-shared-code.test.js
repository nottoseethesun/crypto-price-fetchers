/**
 * Tests that guard fixed bugs in the code the projects that install this
 * repo use: the runner, which runs a Sheets script under Node, and its
 * services; the Summ csv utility; the key store's password prompt, and its
 * manager's check of a CoinGecko key; the clients in `dex-prices/` and
 * their shared requests; and the security lint's rule `no-secret-logging`. The repo's `docs/engineering.md` (Known Bugs) lists the other
 * files of fixed bugs' tests; a bug found later gets its test in
 * `known-bugs.test.js`, declared with `it.fails` while the bug is there,
 * and its fix moves the test to one of them.
 * @module tests/regressions-shared-code.test
 *
 * The code runs in the test's thread, with stand-in answers in place of
 * the services, a clock and a record of requests of the test's own for
 * GeckoTerminal's budget, files in temp folders of the test's own, and an
 * input the test ends for the password prompt. The test of the runner's
 * check of a config object asks it to open the current-price script's
 * Node version, which refuses the object before it starts a worker
 * thread, and closes the version only if it opens. The test of an answer
 * piped in after the key store's password runs crypto-price-filler's
 * command line in a child process with the stand-in fetch preload, and a
 * key file and password of the test's own. The test of the manager's check
 * of a CoinGecko key runs the manager in the test's thread, with a project
 * folder and key file of its own and a stand-in CoinGecko.
 */

import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { PassThrough } from "stream";
import { pathToFileURL } from "url";
import { Linter } from "eslint";
import {
  COMMAND_LINE,
  FILLER_DIR,
  KEY_RUN_TIMEOUT_MS,
  SUMM_ROW,
  SUMM_TEMPLATE,
} from "./helpers/regression-runs.js";
import { STAND_IN_GECKO_KEY } from "./helpers/stand-in-coingecko-key.js";
import {
  askPassword,
  loadEncryptedKey,
  runKeyManager,
  saveEncryptedKey,
  savedKeyType,
} from "../../../api-key-store/index.js";
import noSecretLogging from "../../../eslint-rules/no-secret-logging.js";
import { createAppsScriptServices } from "../../../apps-script-runner/apps-script-services.js";
import { loadAppsScript } from "../../../apps-script-runner/load-apps-script.js";
import { openCryptoPriceFetchers } from "../../../bin/end-user/crypto-price-fetchers.js";
import {
  blockAt,
  moralisSettings,
  pairCandles,
} from "../../../dex-prices/moralis.js";
import {
  geckoTerminalSettings,
  tokenInfo,
} from "../../../dex-prices/geckoterminal.js";
import { requestSettings } from "../../../dex-prices/web-request.js";
import { summCsvText, writeSummCsv } from "../../../summ-csv/index.js";

describe("the runner's Apps Script services", () => {
  it("the runner's cache has getAll, putAll and removeAll, as Apps Script's has", () => {
    const source = [
      "function rememberAndForget() {",
      "  const cache = CacheService.getScriptCache();",
      '  cache.putAll({ price: "1.5", pool: "0xabc" }, 60);',
      '  const found = cache.getAll(["price", "pool", "missing"]);',
      '  cache.removeAll(["price"]);',
      '  return JSON.stringify([found, cache.get("price"), cache.get("pool")]);',
      "}",
    ].join("\n");
    const context = loadAppsScript(
      [{ source, filename: "cache-check.gs" }],
      createAppsScriptServices({ fetchSync: () => ({ failure: "no web" }) }),
    );
    expect(JSON.parse(context.rememberAndForget())).toEqual([
      { price: "1.5", pool: "0xabc" },
      null,
      "0xabc",
    ]);
  });
});

describe("the Summ csv utility's times", () => {
  it("refuses a time past 9999-12-31, as a time in milliseconds given for seconds is, rather than write a timestamp Summ cannot read", () => {
    const header = fs.readFileSync(SUMM_TEMPLATE, "utf8").split(/\r?\n/)[0];
    const row = (timestamp) => ({ ...SUMM_ROW, timestamp });
    expect(summCsvText([row(1763800000)], header)).toContain(
      "2025-11-22 08:26:40",
    );
    expect(() => summCsvText([row(1763800000000)], header)).toThrow(
      /Timestamp/,
    );
    expect(() => summCsvText([row(253402300800)], header)).toThrow(/Timestamp/);
  });
});

describe("the Summ csv utility's file", () => {
  it("writeSummCsv, told to replace a folder, leaves nothing beside it", () => {
    const top = fs.mkdtempSync(path.join(os.tmpdir(), "summ-csv-"));
    try {
      fs.mkdirSync(path.join(top, "csv"));
      expect(() =>
        writeSummCsv({
          rows: [SUMM_ROW],
          templatePath: SUMM_TEMPLATE,
          outPath: path.join(top, "csv"),
          replace: true,
        }),
      ).toThrow();
      expect(fs.readdirSync(top)).toEqual(["csv"]);
    } finally {
      fs.rmSync(top, { recursive: true, force: true });
    }
  });
});

describe("the Summ csv utility's new file", () => {
  it("removes a new file it could not write whole, and throws", () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "summ-csv-half-"));
    const outPath = path.join(folder, "out.csv");
    /*-
     *  TEST-ONLY global swap: writeSummCsv writes through Node's
     *  `fs.writeFileSync` and offers no seam for it; the spy answers one
     *  call, and the test restores it.
     */
    const write = vi
      .spyOn(fs, "writeFileSync")
      .mockImplementationOnce((file) => {
        fs.closeSync(fs.openSync(file, "wx"));
        throw Object.assign(
          new Error("ENOSPC: no space left on device, write"),
          { code: "ENOSPC" },
        );
      });
    try {
      expect(() =>
        writeSummCsv({
          rows: [SUMM_ROW],
          templatePath: SUMM_TEMPLATE,
          outPath,
        }),
      ).toThrow(/ENOSPC/);
      expect(fs.existsSync(outPath)).toBe(false);
    } finally {
      write.mockRestore();
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("Moralis's candles", () => {
  it("drops a candle with a field Moralis gives as null, rather than read it as 0", async () => {
    const settings = moralisSettings({
      fetch: async () =>
        new Response(
          JSON.stringify({
            tokenAddress: "0xabc",
            result: [
              {
                timestamp: "2026-11-01T00:00:00.000Z",
                open: "1",
                high: null,
                low: "0.9",
                close: "1.1",
                volume: "5",
              },
              {
                timestamp: "2026-11-02T00:00:00.000Z",
                open: "1.1",
                high: "1.3",
                low: "1",
                close: "1.2",
                volume: "4",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    const answer = await pairCandles(
      {
        chain: "0x171",
        pair: "0xpair",
        timeframe: "1d",
        fromSeconds: 1761955200,
        toSeconds: 1762128000,
      },
      "stand-in-key",
      settings,
    );
    expect(answer.candles.map((candle) => candle.close)).toEqual([1.2]);
  });
});

describe("the key store's password prompt", () => {
  it("askPassword rejects at once a question asked after its input has ended", async () => {
    const input = new PassThrough();
    const output = { write: () => true };
    input.resume();
    input.end();
    await new Promise((resolve) => input.once("end", resolve));
    let timer;
    const waited = new Promise((resolve) => {
      timer = setTimeout(resolve, 1000, "no answer after 1 second");
    });
    const answer = await Promise.race([
      askPassword("Password: ", { input, output }).catch(
        (error) => error.message,
      ),
      waited,
    ]);
    clearTimeout(timer);
    expect(answer).toBe("The input ended before an answer was typed");
  });
});

describe("the price clients' answers", () => {
  it("Moralis's blockAt gives null, not block 0, for an answer whose block is null", async () => {
    const settings = moralisSettings({
      fetch: async () =>
        new Response(JSON.stringify({ block: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(
      await blockAt({ chain: "0x171", seconds: 1773574725 }, "key", settings),
    ).toBeNull();
  });
});

describe("the security lint's no-secret-logging", () => {
  it("refuses a key printed through Apps Script's Logger, tell or logv, or inside a call, an object or ??", () => {
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
      "Logger.log(CONFIG.COINGECKO_API_KEY)",
      "run.tell(apiKey)",
      'logv(true, 1, "key:", apiKey)',
      "console.log(apiKey.slice(0, 4))",
      "console.log({ apiKey })",
      "console.log(JSON.stringify(apiKey))",
      "console.log(apiKeys.dextools)",
      'console.log(password ?? "none")',
      "console.log(shown ? apiKey : 0)",
      "console.log([apiKey])",
      "console.log(...[apiKey])",
      "console.log(await apiKey)",
      "console.log(keys?.apiKey)",
    ])
      expect(refused(code), code).toBe(1);
  });
});

describe("the security lint's no-secret-logging, on the forms a print can take", () => {
  /**
   * How many prints of a code the rule refuses.
   *
   * @param {string} code - The code
   * @returns {number} The refusals
   */
  function refused(code) {
    return new Linter().verify(code, {
      languageOptions: { ecmaVersion: "latest", sourceType: "module" },
      plugins: { local: { rules: { "no-secret-logging": noSecretLogging } } },
      rules: { "local/no-secret-logging": "error" },
    }).length;
  }

  it("refuses a key printed inside a new, a tagged template, a key written as a string, an assignment or a sequence", () => {
    for (const code of [
      "console.error(new Error(`key ${apiKey} refused`))",
      'console.log(keys["apiKey"])',
      "console.log(String.raw`${apiKey}`)",
      "console.log((note = apiKey))",
      "console.log((0, apiKey))",
    ])
      expect(refused(code), code).toBe(1);
  });

  it("refuses a key printed through an assignment that adds to it or defaults it, or a key written as a template literal", () => {
    for (const code of [
      "console.log((apiKey += ''))",
      "console.log((apiKey ||= 'none'))",
      "console.log((apiKey ??= 'none'))",
      "console.log(keys[`apiKey`])",
    ])
      expect(refused(code), code).toBe(1);
  });

  it("passes a print of a name that holds no secret, written in those forms", () => {
    for (const code of [
      "console.error(new Error(`key ${service.name} refused`))",
      'console.log(keys["name"])',
      "console.log(String.raw`${service.name}`)",
      "console.log((note = service.name))",
      "console.log((apiKey, 0))",
      'console.log(new Error("refused"))',
      "console.log((count += 1))",
      "console.log((count ||= 1))",
      "console.log((count ??= 1))",
      "console.log(keys[`name`])",
    ])
      expect(refused(code), code).toBe(0);
  });
});

describe("the runner's config", () => {
  it("checks a config object against the Node version's schemas, as it checks a file", async () => {
    const outcome = await openCryptoPriceFetchers({
      config: { DEXTOOLS_CONFIG: { API_HOST: "https://elsewhere.example" } },
      fetch: async () => new Response("{}"),
    }).then(
      async (functions) => {
        await functions.close();
        return "opened";
      },
      (error) => error.message,
    );
    expect(outcome).toMatch(
      /DEXTOOLS_CONFIG\.API_HOST is not a setting this tool reads/,
    );
  });
});

describe("the shared request settings", () => {
  it("keep a default for a setting given as undefined", () => {
    expect(typeof requestSettings({ sleep: undefined }).sleep).toBe("function");
  });
});

describe("GeckoTerminal's budget", () => {
  it("counts no more than 20 requests in 60 seconds when two calls wait at once", async () => {
    let clock = 1_000_000;
    const requestLog = [];
    for (let i = 0; i < 20; i += 1) requestLog.push(clock - 50_000 + i);
    const settings = geckoTerminalSettings({
      now: () => clock,
      sleep: async (ms) => {
        const end = clock + ms;
        await Promise.resolve();
        clock = Math.max(clock, end);
      },
      requestLog,
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: { attributes: { name: "X", symbol: "X" } },
          }),
        ),
    });
    await Promise.all(
      ["0x1", "0x2"].map((token) =>
        tokenInfo({ network: "pulsechain", token }, settings),
      ),
    );
    const last = requestLog.at(-1);
    expect(
      requestLog.filter((at) => at > last - 60_000).length,
    ).toBeLessThanOrEqual(20);
  });
});

describe("crypto-price-filler's question without a CoinPaprika key", () => {
  it(
    "takes an answer piped in after the key store's password",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "piped-answer-"));
      try {
        const keyFile = path.join(dir, "api-keys.json");
        const password = "a-password-of-the-test";
        await saveEncryptedKey(
          keyFile,
          "coingecko",
          STAND_IN_GECKO_KEY,
          password,
          "demo",
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
            timeout: KEY_RUN_TIMEOUT_MS,
          },
        );
        expect(run.status).toBe(0);
        expect(fs.existsSync(output)).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    KEY_RUN_TIMEOUT_MS,
  );
});

describe("the key manager's check of a CoinGecko key", () => {
  /** The paid plan's key the stand-in CoinGecko takes. */
  const PAID_KEY = "CG-a-paid-plans-key-of-the-test";

  /**
   * Answers as CoinGecko does for a key of one of its paid plans: its Pro
   * api's ping takes the key in its header; its public api refuses it,
   * with status 400 and error 10010, which asks for the Pro api's root.
   *
   * @param {string} url - The url
   * @param {Object} init - The request's options
   * @returns {Promise<Response>} The answer
   */
  async function paidCoinGecko(url, init) {
    if (
      url === "https://pro-api.coingecko.com/api/v3/ping" &&
      init.headers["x-cg-pro-api-key"] === PAID_KEY
    )
      return new Response('{"gecko_says":"(V3) To the Moon!"}');
    if (url.startsWith("https://api.coingecko.com/"))
      return new Response(
        '{"error_code":10010,"status":{"error_message":"If you are using Pro API key, please change your root URL from api.coingecko.com to pro-api.coingecko.com"}}',
        { status: 400 },
      );
    return new Response('{"status":{"error_code":10002}}', { status: 401 });
  }

  it("saves a paid plan's key, which CoinGecko's Pro api takes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paid-gecko-key-"));
    try {
      fs.writeFileSync(
        path.join(dir, "config.json"),
        JSON.stringify({ apiKeys: ["coingecko"] }),
      );
      const keyFile = path.join(dir, "api-keys.json");
      const answers = [PAID_KEY, "pw", "pw"];
      const said = [];
      const exitCode = await runKeyManager(
        ["node", "manage-api-keys", "set", "coingecko"],
        { projectTop: dir },
        {
          env: { API_KEYS_FILE_PATH: keyFile, API_KEYS_PASSWORD: "" },
          ask: async () => answers.shift(),
          checkOptions: { fetch: paidCoinGecko },
          stdout: { write: (text) => said.push(text) },
          stderr: { write: (text) => said.push(text) },
        },
      );
      expect(said.join("")).toContain(
        `The CoinGecko api key is saved, encrypted, in ${keyFile}, as a paid plan's key.`,
      );
      expect(exitCode).toBe(0);
      expect(await loadEncryptedKey(keyFile, "coingecko", "pw")).toBe(PAID_KEY);
      expect(savedKeyType(keyFile, "coingecko")).toBe("paid");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
