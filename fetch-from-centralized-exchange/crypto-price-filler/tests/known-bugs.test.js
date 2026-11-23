/**
 * Tests of the bugs known in the repo's code, each declared with `it.fails`.
 * @module tests/known-bugs.test
 *
 * Each test checks the behavior the code should have, so it fails while
 * the bug is there, and `it.fails` turns that failure into a pass. A fix
 * makes the test pass, so `it.fails` fails it: the same change declares the
 * test with `it` and moves it to `regressions-command-line.test.js` for the
 * repo's command lines, to `regressions-lib.test.js` for the repo's
 * shared helpers in `lib/`, to `regressions-sheets.test.js` for a test
 * that runs a Sheets script in the test's thread, or to
 * `regressions.test.js` for any other, and removes the bug's row from the
 * table in the repo's CLAUDE.md, which lists each test here.
 *
 * The Sheets scripts run unchanged in the test's thread, through
 * `tests/helpers/sheets-script.js`, with a stand-in for the Apps Script
 * service their tests are about: the script lock, or a fetch that
 * answers as CoinGecko does, or not at all. The tests of the command
 * lines run each in a child process, or in the test's thread with
 * stand-in streams; the tests of shared code call it in the test's
 * thread, with stand-in answers and temp folders of the test's own.
 */

import { describe, it, expect } from "vitest";
import { spawn, spawnSync } from "child_process";
import path from "path";
import {
  CUSTOM_FUNCTION_LIMIT_MS,
  busyLockService,
  loadSheetsScript,
} from "./helpers/sheets-script.js";
import fs from "fs";
import os from "os";
import { writeSummCsv } from "../../../summ-csv/index.js";
import { runSummCsv } from "../../../summ-csv/command-line.js";
import {
  cellTime,
  gitIgnores,
  runCommandLine,
  SHEETS_SCRIPT_PATH,
} from "./helpers/regression-runs.js";
import { parseTimeZone, setupCommander } from "../commander.js";
import { setupBackfillCommander } from "../backfill.js";
import { runCommandLine as runPastPriceCommandLine } from "../../../bin/getCryptoPriceFromCentralizedExchange.js";
import { PassThrough } from "stream";
import { askLine } from "../../../lib/ask-line.js";
import { askPassword } from "../../../api-key-store/index.js";
import { runKeyManager } from "../../../api-key-store/key-manager.js";
import { blockAt, moralisSettings } from "../../../dex-prices/moralis.js";
import { Linter } from "eslint";
import noSecretLogging from "../../../eslint-rules/no-secret-logging.js";
import { openCryptoPriceFetchers } from "../../../bin/crypto-price-fetchers.js";
import { requestSettings } from "../../../dex-prices/web-request.js";
import {
  geckoTerminalSettings,
  tokenInfo,
} from "../../../dex-prices/geckoterminal.js";

/** The DexTools script, at the repo's top. */
const DEXTOOLS_SCRIPT = path.resolve(
  __dirname,
  "../../../crypto-price-fetchers/src/crypto-price-fetchers.gs",
);

/** Summ's template header, as the repo's copy of the owner's has it. */
const SUMM_TEMPLATE = path.resolve(
  __dirname,
  "../../../test/fixtures/summ-template.csv",
);

/** A row summ-csv takes: HEX received on PulseChain. */
const SUMM_ROW = {
  timestamp: 1763800000,
  type: "income",
  baseCurrency: "HEX",
  baseAmount: "1.5",
  from: `0x${"11".repeat(20)}`,
  to: `0x${"22".repeat(20)}`,
  blockchain: "pulsechain",
  id: `0x${"ab".repeat(32)}`,
  contractAddress: `0x${"33".repeat(20)}`,
};

describe("waits inside a custom function", () => {
  it.fails(
    "dexToolsGetTokenPrice waits for the script lock no longer than Google lets a custom function run",
    () => {
      const waits = [];
      const script = loadSheetsScript(DEXTOOLS_SCRIPT, () => null, {
        services: { LockService: busyLockService(waits) },
      });
      script.dexToolsGetTokenPrice(
        "pulse",
        "0xF84b84dAAce6Ac00DbBAed26CA32Ff3570Aaf66C",
      );
      expect(waits.length).toBeGreaterThan(0);
      expect(Math.max(...waits)).toBeLessThanOrEqual(CUSTOM_FUNCTION_LIMIT_MS);
    },
  );
});

describe("the Summ csv utility's file", () => {
  it.fails(
    "writeSummCsv, told to replace a folder, leaves nothing beside it",
    () => {
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
    },
  );

  it.fails(
    "npm run summ-csv refuses a folder as --out, naming --out, before it reads the rows",
    () => {
      const top = fs.mkdtempSync(path.join(os.tmpdir(), "summ-csv-"));
      try {
        fs.mkdirSync(path.join(top, "csv"));
        let stderr = "";
        const exitCode = runSummCsv(
          [
            "node",
            "bin/summ-csv.js",
            "--rows",
            path.join(top, "no-such-rows.json"),
            "--template",
            SUMM_TEMPLATE,
            "--out",
            path.join(top, "csv"),
            "--replace",
          ],
          {
            stdout: { write: () => true },
            stderr: { write: (text) => (stderr += text) },
          },
        );
        expect(exitCode).toBe(1);
        expect(stderr).toBe(
          `error: option '--out <file>' argument '${path.join(top, "csv")}' is invalid. It is a folder, not a file.\n`,
        );
        expect(fs.readdirSync(top)).toEqual(["csv"]);
      } finally {
        fs.rmSync(top, { recursive: true, force: true });
      }
    },
  );
});

describe("crypto-price-filler's exit code", () => {
  it.fails(
    "is 1, not 0, when the program reading its log stops before the file is written",
    async () => {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), "filler-log-"));
      try {
        const input = path.join(folder, "in.csv");
        const output = path.join(folder, "out.csv");
        fs.writeFileSync(input, "date (UTC),amount\n2025-06-15 10:30:00,1\n");
        const child = spawn(
          process.execPath,
          [
            "--import",
            path.join(__dirname, "helpers/stand-in-fetch-preload.js"),
            path.resolve(__dirname, "../../../bin/crypto-price-filler.js"),
            "--token=xtm",
            `--input=${input}`,
            `--output=${output}`,
          ],
          { stdio: ["ignore", "pipe", "ignore"] },
        );
        child.stdout.destroy();
        const exitCode = await new Promise((resolve) =>
          child.on("exit", resolve),
        );
        expect(fs.existsSync(output)).toBe(false);
        expect(exitCode).toBe(1);
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    },
  );
});

describe("crypto-price-filler's --output", () => {
  it.fails(
    "refuses a file in a folder that does not exist, naming --output, before it asks anything",
    () => {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), "filler-output-"));
      try {
        const input = path.join(folder, "in.csv");
        fs.writeFileSync(input, "date (UTC),amount\n2025-06-15 10:30:00,1\n");
        const missing = path.join(folder, "no-such-folder");
        const run = runCommandLine([
          "--token=xtm",
          `--input=${input}`,
          `--output=${path.join(missing, "out.csv")}`,
        ]);
        expect(run.status).toBe(1);
        expect(run.stderr).toBe(
          `error: option '--output <path>' argument '${path.join(missing, "out.csv")}' is invalid. Its folder, ${missing}, does not exist.\n`,
        );
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    },
  );
});

describe("crypto-price-filler's --tz", () => {
  it.fails(
    "takes a zone's current name, as the zone the list spells, and still refuses an abbreviation",
    () => {
      expect(parseTimeZone("Asia/Kolkata")).toBe("Asia/Calcutta");
      expect(parseTimeZone("Europe/Kyiv")).toBe("Europe/Kiev");
      expect(() => parseTimeZone("EST")).toThrow(/not a valid time zone/);
    },
  );
});

describe("the Node versions of the Sheets scripts", () => {
  it.fails(
    "answer --help when node is started with the file's name without .js",
    () => {
      const run = spawnSync(
        process.execPath,
        ["bin/crypto-price-fetchers", "--help"],
        { cwd: path.resolve(__dirname, "../../.."), encoding: "utf8" },
      );
      expect(run.status).toBe(0);
      expect(run.stdout).toMatch(/^Usage: crypto-price-fetchers /);
    },
  );
});

describe("answers piped in together", () => {
  /** An input that has given `text` and ended, and an output that drops what it is given. */
  const piped = (text) => {
    const input = new PassThrough();
    input.end(text);
    return { input, output: { write: () => true } };
  };

  it.fails("askLine gives a last answer that has no line end", async () => {
    const streams = piped("n\ny");
    const answers = [
      await askLine("First? ", streams),
      await askLine("Second? ", streams),
    ];
    expect(answers).toEqual(["n", "y"]);
  });

  it.fails(
    "the key store's password prompt takes the line askLine read past its answer",
    async () => {
      const streams = piped("n\npw\n");
      expect(await askLine("Include? ", streams)).toBe("n");
      const password = await askPassword("Password: ", streams).catch(
        (error) => error.message,
      );
      expect(password).toBe("pw");
    },
  );
});

describe("the key manager's command line", () => {
  it.fails(
    "refuses a command it does not know, asking for no key",
    async () => {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), "key-manager-"));
      try {
        fs.writeFileSync(
          path.join(folder, "config.json"),
          JSON.stringify({ apiKeys: ["dextools"] }),
        );
        let stderr = "";
        const asked = [];
        const exitCode = await runKeyManager(
          ["node", "bin/manage-api-keys.js", "chek-password"],
          { projectTop: folder },
          {
            env: { API_KEYS_FILE_PATH: path.join(folder, "api-keys.json") },
            ask: async (prompt) => {
              asked.push(prompt);
              return "";
            },
            stdout: { write: () => true },
            stderr: { write: (text) => (stderr += text) },
          },
        );
        expect(asked).toEqual([]);
        expect(exitCode).toBe(1);
        expect(stderr).toMatch(/^error: too many arguments/);
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    },
  );
});

describe("crypto-price-filler's stray words", () => {
  it.fails(
    "crypto-price-filler and backfill refuse a word they do not take",
    () => {
      const quiet = (command) =>
        command.exitOverride().configureOutput({ writeErr: () => {} });
      expect(() =>
        quiet(setupCommander()).parse(
          ["--token=xtm", "--input=in.csv", "backfill-highest"],
          { from: "user" },
        ),
      ).toThrow(/too many arguments/);
      expect(() =>
        quiet(setupBackfillCommander()).parse(["--input=in.csv", "highest"], {
          from: "user",
        }),
      ).toThrow(/too many arguments/);
    },
  );
});

describe("the Node versions' stray words", () => {
  it.fails(
    "a Node version refuses a word past its command's arguments, asking nothing",
    async () => {
      let stderr = "";
      let asked = 0;
      const exitCode = await runPastPriceCommandLine(
        ["node", "x", "btc", "2025-06-15 12:30:00", "extra"],
        {
          fetch: async () => {
            asked += 1;
            return new Response("{}", { status: 404 });
          },
          stdout: { write: () => true },
          stderr: { write: (text) => (stderr += text) },
        },
      );
      expect(asked).toBe(0);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/^error: too many arguments\./);
    },
  );
});

describe("bin/unlock-api-keys.sh in bash", () => {
  it.fails("finds the project's top folder when the shell's cd prints", () => {
    const top = fs.mkdtempSync(path.join(os.tmpdir(), "unlock-"));
    try {
      fs.mkdirSync(path.join(top, "bin"));
      fs.copyFileSync(
        path.resolve(__dirname, "../../../bin/unlock-api-keys.sh"),
        path.join(top, "bin", "unlock-api-keys.sh"),
      );
      fs.writeFileSync(
        path.join(top, "bin", "manage-api-keys.js"),
        "process.exit(0);\n",
      );
      const run = spawnSync(
        "bash",
        [
          "-c",
          'cd() { builtin cd "$@" && echo "now in $PWD"; }; source bin/unlock-api-keys.sh',
        ],
        {
          cwd: top,
          input: "a password\n",
          encoding: "utf8",
        },
      );
      expect(run.stderr).toContain(
        "API_KEYS_PASSWORD is set for this terminal.",
      );
    } finally {
      fs.rmSync(top, { recursive: true, force: true });
    }
  });
});

describe("the price clients' answers", () => {
  it.fails(
    "Moralis's blockAt gives null, not block 0, for an answer whose block is null",
    async () => {
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
    },
  );
});

describe("the current-price script, when a request gets no answer", () => {
  it.fails("gives the script's error message, not 0", () => {
    const script = loadSheetsScript(DEXTOOLS_SCRIPT, () => {
      throw new Error("Service invoked too many times for one day: urlfetch.");
    });
    expect(
      script.dexToolsGetTokenPrice(
        "ether",
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      ),
    ).toBe("⚠️ API error – check logs");
  });
});

describe("the owner's files in the tools' output/ folders", () => {
  it.fails(
    "git ignores a file written directly in output/, as it does one in output/csv/",
    () => {
      expect(gitIgnores("output/csv/prices.csv")).toBe(true);
      expect(gitIgnores("output/prices.csv")).toBe(true);
      expect(gitIgnores("../../summ-csv/output/summ.csv")).toBe(true);
      expect(gitIgnores("output/json/.gitkeep")).toBe(false);
    },
  );
});

describe("the exchange script, for a time less than 12 hours ago", () => {
  it.fails(
    "gives no CoinGecko price from a window that is not over, saying when to ask again",
    () => {
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
      expect(asked.filter((url) => url.includes("coingecko"))).toEqual([]);
    },
  );
});

describe("the security lint's no-secret-logging", () => {
  it.fails(
    "refuses a key printed through Apps Script's Logger, tell or logv, or inside a call, an object or ??",
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
        "Logger.log(CONFIG.COINGECKO_API_KEY)",
        "run.tell(apiKey)",
        'logv(true, 1, "key:", apiKey)',
        "console.log(apiKey.slice(0, 4))",
        "console.log({ apiKey })",
        "console.log(JSON.stringify(apiKey))",
        "console.log(apiKeys.dextools)",
        'console.log(password ?? "none")',
      ])
        expect(refused(code), code).toBe(1);
    },
  );
});

describe("the current-price script's pool argument", () => {
  it.fails("takes a pool named as text, not only as {{address, 0}}", () => {
    const script = loadSheetsScript(DEXTOOLS_SCRIPT, () => null);
    expect(script.poolNamed("0xPool")).toBe("0xPool");
    expect(script.poolNamed([["0xPool", 0]])).toBe("0xPool");
  });
});

describe("the runner's config", () => {
  it.fails(
    "checks a config object against the Node version's schemas, as it checks a file",
    async () => {
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
    },
  );
});

describe("the shared request settings", () => {
  it.fails("keep a default for a setting given as undefined", () => {
    expect(typeof requestSettings({ sleep: undefined }).sleep).toBe("function");
  });
});

describe("GeckoTerminal's budget", () => {
  it.fails(
    "counts no more than 20 requests in 60 seconds when two calls wait at once",
    async () => {
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
    },
  );
});
