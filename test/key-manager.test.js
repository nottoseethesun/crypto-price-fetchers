/**
 * Tests for the key store's services, a project's key list, and the key
 * manager: `api-key-store/services.js`, `project-keys.js`,
 * `key-manager.js`, and this project's `manage-api-keys.js`.
 * @module test/key-manager.test
 *
 * The services answer through a stand-in fetch (`helpers/stand-in-web.js`)
 * or are stand-ins themselves, so nothing outside the computer is asked.
 * Each test's project folder and key file are in a temp folder of their
 * own, removed afterwards, and every environment a test passes names its
 * key file and holds no `API_KEYS_PASSWORD` it did not set, so no test
 * reads the owner's keys, even from a terminal that has unlocked them.
 */

import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  keyFileFor,
  loadEncryptedKey,
  readNeededKeys,
  runKeyManager,
  saveEncryptedKey,
  SERVICES,
  serviceNamed,
  unlockProjectKeys,
} from "../api-key-store/index.js";
import { capturedOutput } from "./helpers/captured-output.js";
import { standInFetch } from "./helpers/stand-in-web.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

/** The repo's top folder. */
const REPO_TOP = fileURLToPath(new URL("..", import.meta.url));

after(removeTempFolders);

/**
 * Makes a project folder whose `config.json` lists the services given.
 *
 * @param {Array<string>|undefined} apiKeys - The services, or undefined for a config.json without the list
 * @returns {string} The folder
 */
function makeProject(apiKeys) {
  const folder = makeTempFolder("key-manager");
  fs.writeFileSync(
    path.join(folder, "config.json"),
    JSON.stringify(apiKeys === undefined ? {} : { apiKeys }),
  );
  return folder;
}

/**
 * Stand-in services, alpha and beta, whose checks take any key but those
 * named `refused-key`.
 *
 * @returns {Object<string, Object>} The services, by name
 */
function standInServices() {
  const check = async (key) => (key === "refused-key" ? "invalid" : "valid");
  return {
    alpha: { service: "alpha", name: "Alpha", check },
    beta: { service: "beta", name: "Beta", check },
  };
}

/**
 * Answers the prompts in turn from `answers`, keeping what was asked.
 *
 * @param {string[]} answers - What is typed at each prompt
 * @returns {function(string): Promise<string>} The stand-in prompt, with the prompts in `asked`
 */
function typing(answers) {
  const queue = [...answers];
  const ask = async (prompt) => {
    ask.asked.push(prompt);
    if (queue.length === 0) assert.fail(`Asked ${prompt} with no answer left`);
    return queue.shift();
  };
  ask.asked = [];
  return ask;
}

describe("the services", () => {
  /**
   * Answers with the status `status`.
   *
   * @param {number} status - The status
   * @returns {function} The stand-in fetch
   */
  function answering(status) {
    return standInFetch(() =>
      status === 200 ? { ok: true } : { status, text: "{}" },
    );
  }

  it("check CoinGecko's key at its ping, in the x-cg-demo-api-key header and in no url", async () => {
    const fetch = answering(200);
    assert.equal(
      await SERVICES.coingecko.check("gecko-key", { fetch }),
      "valid",
    );
    assert.deepEqual(
      fetch.requests.map((request) => [
        request.url,
        request.headers["x-cg-demo-api-key"],
      ]),
      [["https://api.coingecko.com/api/v3/ping", "gecko-key"]],
    );
    assert.equal(
      await SERVICES.coingecko.check("gecko-key", { fetch: answering(401) }),
      "invalid",
    );
    assert.equal(
      await SERVICES.coingecko.check("gecko-key", { fetch: answering(400) }),
      "invalid",
    );
    await assert.rejects(
      SERVICES.coingecko.check("gecko-key", { fetch: answering(503) }),
      /CoinGecko answered with status 503/,
    );
  });

  it("check DexTools' key plan by plan, 1.1 seconds apart, until one takes it", async () => {
    const waits = [];
    const sleep = async (ms) => waits.push(ms);
    const fetch = standInFetch(({ url }) =>
      url.includes("/advanced/")
        ? { ok: true }
        : { status: 403, text: '{"message":"Forbidden"}' },
    );
    assert.equal(
      await SERVICES.dextools.check("dex-key", { fetch, sleep }),
      "valid",
    );
    assert.deepEqual(
      fetch.requests.map((request) => new URL(request.url).pathname),
      [
        "/standard/v2/blockchain",
        "/trial/v2/blockchain",
        "/free/v2/blockchain",
        "/advanced/v2/blockchain",
      ],
    );
    assert.ok(
      fetch.requests.every(
        (request) => request.headers["x-api-key"] === "dex-key",
      ),
    );
    assert.deepEqual(waits, [1100, 1100, 1100]);
  });

  it("refuse DexTools' key when every plan answers 403, and throw on another answer", async () => {
    const sleep = async () => {};
    assert.equal(
      await SERVICES.dextools.check("dex-key", {
        fetch: answering(403),
        sleep,
      }),
      "invalid",
    );
    await assert.rejects(
      SERVICES.dextools.check("dex-key", { fetch: answering(429), sleep }),
      /DexTools answered with status 429/,
    );
  });

  it("check x1.ninja's key by reading a pool with it, as a bearer token", async () => {
    const fetch = answering(200);
    assert.equal(await SERVICES.x1ninja.check("x1_key", { fetch }), "valid");
    assert.equal(
      fetch.requests[0].url,
      "https://api.x1.ninja/v1/pools/CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR",
    );
    assert.equal(fetch.requests[0].headers.authorization, "Bearer x1_key");
    assert.equal(
      await SERVICES.x1ninja.check("x1_key", { fetch: answering(401) }),
      "invalid",
    );
    await assert.rejects(
      SERVICES.x1ninja.check("x1_key", { fetch: answering(404) }),
      /x1.ninja answered with status 404/,
    );
  });

  it("check Moralis's key by asking its api version, which names no chain, with the key in the X-API-Key header and in no url", async () => {
    const fetch = answering(200);
    assert.equal(
      await SERVICES.moralis.check("moralis-key", { fetch }),
      "valid",
    );
    assert.equal(
      fetch.requests[0].url,
      "https://deep-index.moralis.io/api/v2.2/web3/version",
    );
    assert.equal(fetch.requests[0].url.includes("chain"), false);
    assert.equal(fetch.requests[0].headers["x-api-key"], "moralis-key");
    assert.equal(fetch.requests[0].url.includes("moralis-key"), false);
    assert.equal(
      await SERVICES.moralis.check("moralis-key", { fetch: answering(401) }),
      "invalid",
    );
    await assert.rejects(
      SERVICES.moralis.check("moralis-key", { fetch: answering(500) }),
      /Moralis answered with status 500/,
    );
  });

  it("check CoinPaprika's key at its paid server's key facts, as the whole Authorization header and in no url", async () => {
    const fetch = answering(200);
    assert.equal(
      await SERVICES.coinpaprika.check("paprika-key", { fetch }),
      "valid",
    );
    assert.equal(
      fetch.requests[0].url,
      "https://api-pro.coinpaprika.com/v1/key/info",
    );
    assert.equal(fetch.requests[0].headers.authorization, "paprika-key");
    assert.equal(fetch.requests[0].url.includes("paprika-key"), false);
    for (const status of [401, 403]) {
      assert.equal(
        await SERVICES.coinpaprika.check("paprika-key", {
          fetch: answering(status),
        }),
        "invalid",
      );
    }
    await assert.rejects(
      SERVICES.coinpaprika.check("paprika-key", { fetch: answering(402) }),
      /CoinPaprika answered with status 402/,
    );
  });

  it("are found by name, and an unknown name is refused, naming those known", () => {
    assert.equal(serviceNamed("dextools").name, "DexTools");
    assert.equal(serviceNamed("moralis").name, "Moralis");
    assert.equal(serviceNamed("coinpaprika").name, "CoinPaprika");
    assert.throws(
      () => serviceNamed("dexscreener"),
      /No service is named "dexscreener"; the services are coingecko, coinpaprika, dextools, moralis, x1ninja/,
    );
  });
});

describe("a project's key list and key file", () => {
  it("name the key file api-keys.json in the project's top folder, unless API_KEYS_FILE_PATH names another", () => {
    assert.equal(
      keyFileFor("/project", {}),
      path.join("/project", "api-keys.json"),
    );
    assert.equal(
      keyFileFor("/project", { API_KEYS_FILE_PATH: "" }),
      path.join("/project", "api-keys.json"),
    );
    assert.equal(
      keyFileFor("/project", { API_KEYS_FILE_PATH: "/elsewhere/keys.json" }),
      "/elsewhere/keys.json",
    );
  });

  it("read the services config.json lists under apiKeys, in order", () => {
    const top = makeProject(["x1ninja", "coingecko"]);
    assert.deepEqual(
      readNeededKeys(top).map((service) => service.service),
      ["x1ninja", "coingecko"],
    );
  });

  it("refuse a config.json that is missing, lists no apiKeys, lists one twice, or names an unknown service, as its schema says", () => {
    assert.throws(
      () => readNeededKeys(path.join(os.tmpdir(), "no-such-project")),
      /: Cannot read \S*no-such-project\/config\.json: ENOENT/,
    );
    assert.throws(
      () => readNeededKeys(makeProject(undefined)),
      /config\.json → apiKeys is missing$/,
    );
    assert.throws(
      () => readNeededKeys(makeProject(["dextools", "dextools"])),
      /config\.json → apiKeys must be a list of the services the project's programs use, each once; it is \["dextools","dextools"\]$/,
    );
    assert.throws(
      () => readNeededKeys(makeProject(["dexscreener"])),
      /config\.json → apiKeys\[0\] must be a service the key store knows: coingecko, coinpaprika, dextools, moralis, x1ninja; it is "dexscreener"$/,
    );
  });

  it("refuse to open a key config.json does not list, so the manager offers every key a program uses", () => {
    const top = makeProject(["coingecko"]);
    assert.throws(
      () =>
        unlockProjectKeys({
          projectTop: top,
          services: ["dextools"],
          env: { API_KEYS_FILE_PATH: path.join(top, "api-keys.json") },
        }),
      /config\.json does not list dextools under apiKeys, which a program uses/,
    );
  });

  it("list in this project's config.json the services its programs use", () => {
    assert.deepEqual(
      readNeededKeys(REPO_TOP).map((service) => service.service),
      ["coingecko", "coinpaprika", "dextools", "moralis", "x1ninja"],
    );
  });

  it("keep the key file where git ignores it, as it does the temp file it is written through", () => {
    for (const ignored of ["api-keys.json", "api-keys.json.tmp"]) {
      const check = spawnSync("git", ["check-ignore", "-q", ignored], {
        cwd: REPO_TOP,
      });
      assert.equal(check.status, 0, `git does not ignore ${ignored}`);
    }
  });
});

describe("runKeyManager", () => {
  let top;
  let file;
  let env;

  beforeEach(() => {
    top = makeProject(["alpha", "beta"]);
    file = path.join(top, "api-keys.json");
    env = { API_KEYS_FILE_PATH: file };
  });

  /**
   * Runs the manager on the stand-in project.
   *
   * @param {string[]} args - The arguments after the file's name
   * @param {Object} deps - The prompt and the environment (`runKeyManager`), stdout and stderr aside
   * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>} What it did
   */
  async function manage(args, deps) {
    const stdout = capturedOutput();
    const stderr = capturedOutput();
    const exitCode = await runKeyManager(
      ["node", "manage-api-keys.js", ...args],
      { projectTop: top, known: standInServices() },
      { env, ...deps, stdout, stderr },
    );
    return { exitCode, stdout: stdout.text, stderr: stderr.text };
  }

  it("lists each key not saved, asks for each, and saves those the services take, showing none of their characters", async () => {
    const ask = typing(["alpha-secret-key", "pw", "pw", "beta-secret-key"]);
    const result = await manage([], { ask });
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout,
      `Api keys of the services config.json lists, kept in ${file}:\n  Alpha  not saved\n  Beta   not saved\n`,
    );
    assert.equal(
      await loadEncryptedKey(file, "alpha", "pw"),
      "alpha-secret-key",
    );
    assert.equal(await loadEncryptedKey(file, "beta", "pw"), "beta-secret-key");
    for (const shown of [result.stdout, result.stderr]) {
      assert.ok(!shown.includes("secret"), "a key was shown");
    }
  });

  it("lists every key saved, and asks nothing", async () => {
    await saveEncryptedKey(file, "alpha", "a-key", "pw");
    await saveEncryptedKey(file, "beta", "b-key", "pw");
    const result = await manage([], { ask: typing([]) });
    assert.deepEqual(result, {
      exitCode: 0,
      stdout: `Api keys of the services config.json lists, kept in ${file}:\n  Alpha  saved\n  Beta   saved\nEvery key is saved. To replace one: npm run api-keys -- set <service>\n`,
      stderr: "",
    });
  });

  it("skips a key left empty, and asks for the next one", async () => {
    const ask = typing(["", "b-key", "pw", "pw"]);
    const result = await manage([], { ask });
    assert.equal(result.exitCode, 0);
    assert.match(
      result.stderr,
      /No Alpha api key was entered, so none was saved\./,
    );
    assert.equal(await loadEncryptedKey(file, "alpha", "pw"), null);
    assert.equal(await loadEncryptedKey(file, "beta", "pw"), "b-key");
  });

  it("reports a key its service refuses, asks for the next one, and ends with exit code 1", async () => {
    const result = await manage([], {
      ask: typing(["refused-key", "pw", "pw", "b-key"]),
    });
    assert.equal(result.exitCode, 1);
    assert.match(
      result.stderr,
      /Alpha refused the api key, so it was not saved\./,
    );
    assert.equal(await loadEncryptedKey(file, "beta", "pw"), "b-key");
  });

  it("asks for no more keys once the password does not open the keys saved", async () => {
    await saveEncryptedKey(file, "other", "o-key", "pw");
    const ask = typing(["a-key", "wrong"]);
    const result = await manage([], { ask });
    assert.equal(result.exitCode, 1);
    assert.match(
      result.stderr,
      /That password does not open the api keys saved in .*, so no key was saved\./,
    );
    assert.deepEqual(ask.asked, [
      "Alpha api key (Enter alone skips it): ",
      `Password for the api keys in ${file}: `,
    ]);
  });

  it("saves keys with the password in API_KEYS_PASSWORD, asking for none", async () => {
    env.API_KEYS_PASSWORD = "pw";
    const ask = typing(["a-key", "b-key"]);
    assert.equal((await manage([], { ask })).exitCode, 0);
    assert.equal(await loadEncryptedKey(file, "beta", "pw"), "b-key");
  });

  it("set <service> replaces one saved key, and refuses a service config.json does not list", async () => {
    await saveEncryptedKey(file, "alpha", "old-key", "pw");
    assert.equal(
      (await manage(["set", "alpha"], { ask: typing(["new-key", "pw"]) }))
        .exitCode,
      0,
    );
    assert.equal(await loadEncryptedKey(file, "alpha", "pw"), "new-key");
    assert.deepEqual(await manage(["set", "gamma"], { ask: typing([]) }), {
      exitCode: 1,
      stdout: "",
      stderr:
        'The project\'s config.json lists no service "gamma" under apiKeys.\n',
    });
  });

  it("check-password says whether API_KEYS_PASSWORD opens the keys saved", async () => {
    assert.deepEqual(await manage(["check-password"], {}), {
      exitCode: 1,
      stdout: "",
      stderr:
        "API_KEYS_PASSWORD is not set. source ./unlock-api-keys.sh asks for the password and sets it.\n",
    });
    env.API_KEYS_PASSWORD = "pw";
    assert.deepEqual(await manage(["check-password"], {}), {
      exitCode: 0,
      stdout: `No api key is saved in ${file} yet; npm run api-keys saves them with this password.\n`,
      stderr: "",
    });
    await saveEncryptedKey(file, "alpha", "a-key", "pw");
    await saveEncryptedKey(file, "beta", "b-key", "pw");
    assert.equal(
      (await manage(["check-password"], {})).stdout,
      `The password opens the 2 api keys saved in ${file}.\n`,
    );
    env.API_KEYS_PASSWORD = "other";
    const wrong = await manage(["check-password"], {});
    assert.equal(wrong.exitCode, 1);
    assert.match(
      wrong.stderr,
      /^That password does not open the api keys saved in /,
    );
  });

  it("says so when config.json lists no service", async () => {
    fs.writeFileSync(
      path.join(top, "config.json"),
      JSON.stringify({ apiKeys: [] }),
    );
    assert.deepEqual(await manage([], { ask: typing([]) }), {
      exitCode: 0,
      stdout:
        "The project's config.json lists no service, so it keeps no api key.\n",
      stderr: "",
    });
  });

  it("answers --help on stdout, with exit code 0, asking nothing", async () => {
    const result = await manage(["--help"], { ask: typing([]) });
    assert.equal(result.exitCode, 0);
    assert.match(
      result.stdout,
      /Usage: manage-api-keys \[options\] \[command\]/,
    );
    assert.match(result.stdout, /check-password/);
    assert.match(result.stdout, /Exit codes:/);
  });
});

describe("manage-api-keys.js, as a program", () => {
  /**
   * Runs `node manage-api-keys.js`, with a key file of its own and no
   * password kept, typing `typed` on its stdin.
   *
   * @param {string[]} args - The arguments
   * @param {string} typed - What is typed
   * @returns {import('node:child_process').SpawnSyncReturns<string>} How it ended
   */
  function runProgram(args, typed) {
    const folder = makeTempFolder("key-manager");
    const env = {
      ...process.env,
      API_KEYS_FILE_PATH: path.join(folder, "api-keys.json"),
    };
    delete env.API_KEYS_PASSWORD;
    return spawnSync(
      process.execPath,
      [path.join(REPO_TOP, "manage-api-keys.js"), ...args],
      {
        env,
        input: typed,
        encoding: "utf8",
        timeout: 15000,
      },
    );
  }

  it("answers --help", () => {
    const run = runProgram(["--help"], "");
    assert.equal(run.status, 0);
    assert.match(run.stdout, /Usage: manage-api-keys/);
  });

  it("lists this project's keys and takes answers typed on its stdin: Enter alone skips each", () => {
    const run = runProgram([], "\n\n\n\n\n");
    assert.equal(run.status, 0, run.stderr);
    assert.match(
      run.stdout,
      /CoinGecko {4}not saved\n {2}CoinPaprika {2}not saved\n {2}DexTools {5}not saved\n {2}Moralis {6}not saved\n {2}x1\.ninja {5}not saved\n$/,
    );
    assert.match(
      run.stderr,
      /No x1\.ninja api key was entered, so none was saved\./,
    );
  });
});
