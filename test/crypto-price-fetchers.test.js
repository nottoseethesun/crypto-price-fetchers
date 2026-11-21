/**
 * Tests for crypto-price-fetchers.js, the Node version of
 * crypto-price-fetchers.gs (item 14).
 * @module test/crypto-price-fetchers.test
 *
 * The real `.gs` runs under the real runner. Its requests go to a stand-in
 * fetch (`helpers/stand-in-web.js`) that answers as DexTools and x1.ninja
 * answer, so the tests ask nothing outside the computer. Each test opens
 * the script afresh, so the script's spacing of calls, 0.7 seconds after
 * the last one, never waits.
 *
 * The command line's keys are in a key file in a temp folder, removed
 * afterwards, and every environment a test passes names that file and
 * holds no `API_KEYS_PASSWORD` the test did not set, so no test opens the
 * owner's keys.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveEncryptedKey } from "../api-key-store/index.js";
import {
  openCryptoPriceFetchers,
  runCommandLine,
} from "../crypto-price-fetchers.js";
import { capturedOutput } from "./helpers/captured-output.js";
import { standInFetch } from "./helpers/stand-in-web.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

const DEXTOOLS = "https://public-api.dextools.io/standard/v2";
const X1_NINJA = "https://api.x1.ninja/v1";
const TOKEN = "0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39";
const POOL = "0x69D91B94f0AaF8e8A2586909fA77A5c2c89818d5";
const X1_POOL = "CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR";
const X1_MINT = "So11111111111111111111111111111111111111112";
const KEYS = { dextools: "dextools-key", x1ninja: "x1-ninja-key" };

/**
 * Answers as DexTools and x1.ninja do for the tests' token and pools. The
 * DexTools key check, its list of blockchains, takes the key
 * `dextools-key` alone.
 *
 * @param {{url: string, headers: Object<string, string>}} request - The request
 * @returns {*} The response (`standInFetch`)
 */
function answerAsDexToolsAndX1Ninja({ url, headers }) {
  if (url === `${DEXTOOLS}/blockchain?sort=name&order=asc`) {
    return headers["x-api-key"] === "dextools-key"
      ? { statusCode: 200, data: [] }
      : { status: 403, text: '{"message":"Forbidden"}' };
  }
  if (url === `${DEXTOOLS}/token/ether/${TOKEN}/price`)
    return { statusCode: 200, data: { price: 1.23 } };
  if (url === `${DEXTOOLS}/pool/ether/${POOL}/price`)
    return { statusCode: 200, data: { price: 4.56 } };
  if (url === `${DEXTOOLS}/token/pulse/${TOKEN}/info`)
    return { statusCode: 200, data: { fdv: 5000000 } };
  if (url === `${X1_NINJA}/pools/${X1_POOL}`)
    return { pool: { address: X1_POOL, priceUsd: "0.27", fdv: 123456 } };
  return null;
}

/**
 * Opens the Node version with the keys given and the stand-in fetch, runs
 * `use` on it, and closes it.
 *
 * @param {function(Object, function): Promise<void>} use - Takes the open functions and the stand-in fetch
 * @param {Object} [apiKeys=KEYS] - The keys the script sends
 * @returns {Promise<void>} Settles once closed
 */
async function withFetchers(use, apiKeys = KEYS) {
  const fetch = standInFetch(answerAsDexToolsAndX1Ninja);
  const fetchers = await openCryptoPriceFetchers({
    config: {},
    apiKeys,
    fetch,
  });
  try {
    await use(fetchers, fetch);
  } finally {
    await fetchers.close();
  }
}

describe("openCryptoPriceFetchers", () => {
  it("prices a token from DexTools, sending the DexTools key it is given", async () => {
    await withFetchers(async (fetchers, fetch) => {
      assert.equal(await fetchers.dexToolsGetTokenPrice("ether", TOKEN), 1.23);
      assert.equal(fetch.requests[0].headers["x-api-key"], "dextools-key");
    });
  });

  it("prices a token in the pool given, as a Sheets range gives it", async () => {
    await withFetchers(async (fetchers) => {
      assert.equal(
        await fetchers.dexToolsGetTokenPrice("ether", TOKEN, [[POOL, 0]]),
        4.56,
      );
    });
  });

  it("gives a token's FDV from DexTools", async () => {
    await withFetchers(async (fetchers) => {
      assert.equal(await fetchers.dexToolsGetTokenFDV("pulse", TOKEN), 5000000);
    });
  });

  it("prices an X1 pool through x1.ninja, sending the x1.ninja key it is given", async () => {
    await withFetchers(async (fetchers, fetch) => {
      assert.equal(
        await fetchers.dexToolsGetTokenPrice("x1", X1_MINT, [[X1_POOL, 0]]),
        0.27,
      );
      assert.equal(
        fetch.requests[0].headers.authorization,
        "Bearer x1-ninja-key",
      );
    });
  });

  it("gives 0 when DexTools has no price for the token, as the sheet does", async () => {
    await withFetchers(async (fetchers) => {
      assert.equal(await fetchers.dexToolsGetTokenPrice("bsc", TOKEN), 0);
    });
  });

  it("sends the placeholder written in the script when it is given no key", async () => {
    await withFetchers(async (fetchers, fetch) => {
      await fetchers.dexToolsGetTokenPrice("ether", TOKEN);
      assert.equal(
        fetch.requests[0].headers["x-api-key"],
        "set_by_the_build_step",
      );
    }, {});
  });

  it("opens with this project's config.json, which lists the keys and sets no field of the script", async () => {
    const fetchers = await openCryptoPriceFetchers({
      fetch: standInFetch(() => null),
    });
    await fetchers.close();
  });
});

describe("crypto-price-fetchers.js, the command line", () => {
  let folder;
  let configFile;
  let keyFile;

  before(async () => {
    folder = makeTempFolder("cli");
    configFile = path.join(folder, "config.json");
    fs.writeFileSync(configFile, JSON.stringify({}));
    keyFile = path.join(folder, "api-keys.json");
    await saveEncryptedKey(keyFile, "dextools", KEYS.dextools, "pw");
    await saveEncryptedKey(keyFile, "x1ninja", KEYS.x1ninja, "pw");
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
   * Runs the command line with the stand-in fetch, and the key file and
   * password given.
   *
   * @param {string[]} args - The arguments after the file's name
   * @param {Object} [keys] - The environment and the password prompt: by default the tests' key file, unlocked
   * @param {function} [answer=answerAsDexToolsAndX1Ninja] - The stand-in's answers
   * @returns {Promise<{exitCode: number, stdout: string, stderr: string, fetch: function}>} What it did, and the stand-in fetch
   */
  async function run(args, keys = {}, answer = answerAsDexToolsAndX1Ninja) {
    const stdout = capturedOutput();
    const stderr = capturedOutput();
    const fetch = standInFetch(answer);
    const exitCode = await runCommandLine(
      ["node", "crypto-price-fetchers.js", ...args],
      {
        fetch,
        stdout,
        stderr,
        env: keys.env ?? {
          API_KEYS_FILE_PATH: keyFile,
          API_KEYS_PASSWORD: "pw",
        },
        ask: keys.ask ?? askNothing,
        sleep: async () => {},
      },
    );
    return { exitCode, stdout: stdout.text, stderr: stderr.text, fetch };
  }

  /**
   * What a run printed, without its stand-in fetch.
   *
   * @param {{exitCode: number, stdout: string, stderr: string}} result - What `run` gave
   * @returns {{exitCode: number, stdout: string, stderr: string}} The exit code and what it printed
   */
  function printed({ exitCode, stdout, stderr }) {
    return { exitCode, stdout, stderr };
  }

  it("prints the price, with exit code 0, sending the DexTools key it opened with API_KEYS_PASSWORD", async () => {
    const result = await run(["price", "ether", TOKEN, "--config", configFile]);
    assert.deepEqual(printed(result), {
      exitCode: 0,
      stdout: "1.23\n",
      stderr: "",
    });
    assert.deepEqual(
      result.fetch.requests.map((request) => [
        new URL(request.url).pathname,
        request.headers["x-api-key"],
      ]),
      [
        ["/standard/v2/blockchain", "dextools-key"],
        [`/standard/v2/token/ether/${TOKEN}/price`, "dextools-key"],
      ],
    );
  });

  it("asks for the password when API_KEYS_PASSWORD is not set", async () => {
    const asked = [];
    const ask = async (prompt) => {
      asked.push(prompt);
      return "pw";
    };
    const result = await run(
      ["price", "ether", TOKEN, "--config", configFile],
      { env: { API_KEYS_FILE_PATH: keyFile }, ask },
    );
    assert.equal(result.stdout, "1.23\n");
    assert.deepEqual(asked, [`Password for the api keys in ${keyFile}: `]);
  });

  it("stops before asking a price, with exit code 1, when DexTools refuses the saved key", async () => {
    const refusing = (request) =>
      request.url.includes("/blockchain?")
        ? { status: 403, text: '{"message":"Forbidden"}' }
        : answerAsDexToolsAndX1Ninja(request);
    const result = await run(
      ["price", "ether", TOKEN, "--config", configFile],
      {},
      refusing,
    );
    assert.equal(result.exitCode, 1);
    assert.match(
      result.stderr,
      /^DexTools refused the api key saved in .*api-keys\.json\. Save a new one, in the project's top folder: npm run api-keys -- set dextools\n$/,
    );
    assert.ok(
      result.fetch.requests.every((request) =>
        request.url.includes("/blockchain?"),
      ),
    );
  });

  it("sends the placeholder written in the script, asking nothing, when no key is saved", async () => {
    const env = {
      API_KEYS_FILE_PATH: path.join(folder, "no-such-api-keys.json"),
    };
    const result = await run(
      ["price", "ether", TOKEN, "--config", configFile],
      { env },
    );
    assert.equal(
      result.fetch.requests[0].headers["x-api-key"],
      "set_by_the_build_step",
    );
  });

  it("prints an X1 pool's FDV, sending x1.ninja's key and opening no DexTools key", async () => {
    const result = await run([
      "fdv",
      "x1",
      X1_MINT,
      "--pool",
      X1_POOL,
      "--config",
      configFile,
    ]);
    assert.equal(result.stdout, "123456\n");
    assert.equal(result.exitCode, 0);
    assert.ok(
      result.fetch.requests.every((request) =>
        request.url.startsWith(X1_NINJA),
      ),
    );
    assert.ok(
      result.fetch.requests.every(
        (request) => request.headers.authorization === "Bearer x1-ninja-key",
      ),
    );
  });

  it("shows the script's log on stderr with --verbose", async () => {
    const result = await run([
      "price",
      "ether",
      TOKEN,
      "--config",
      configFile,
      "--verbose",
    ]);
    assert.match(
      result.stderr,
      /^log: \[PRICE\] Fetching: https:\/\/public-api\.dextools\.io/m,
    );
    assert.equal(result.stdout, "1.23\n");
  });

  it("answers --help on stdout, with exit code 0, asking no password", async () => {
    const result = await run(["--help"], {
      env: { API_KEYS_FILE_PATH: keyFile },
      ask: askNothing,
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Usage: crypto-price-fetchers/);
    assert.match(result.stdout, /price .*<chain> <token>/);
    assert.match(result.stdout, /fdv .*<chain> <token>/);
    assert.match(result.stdout, /Api keys:/);
    assert.match(result.stdout, /Exit codes:/);
    assert.equal(result.stderr, "");
  });

  it("refuses a missing argument on stderr, with exit code 1", async () => {
    const result = await run(["price", "ether", "--config", configFile]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /missing required argument 'token'/);
  });

  it("refuses an empty argument, naming it", async () => {
    const result = await run(["price", " ", TOKEN, "--config", configFile]);
    assert.equal(result.exitCode, 1);
    assert.match(
      result.stderr,
      /is invalid for argument 'chain'\. It is empty\./,
    );
  });

  it("refuses a config file named on purpose that is missing", async () => {
    const result = await run([
      "price",
      "ether",
      TOKEN,
      "--config",
      path.join(folder, "missing.json"),
    ]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Cannot read the config file/);
  });

  it("runs as a program: node crypto-price-fetchers.js --help", () => {
    const file = fileURLToPath(
      new URL("../crypto-price-fetchers.js", import.meta.url),
    );
    const output = execFileSync(process.execPath, [file, "--help"], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.match(output, /Usage: crypto-price-fetchers/);
  });
});
