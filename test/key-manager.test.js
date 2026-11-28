/**
 * Tests for a project's key list and the key manager:
 * `api-key-store/project-keys.js`, `key-manager.js`, and this project's
 * `bin/end-user/manage-api-keys.js`. The services' own checks are tested
 * in `key-services.test.js`.
 * @module test/key-manager.test
 *
 * The services answer through a stand-in fetch (`helpers/stand-in-web.js`)
 * or are stand-ins themselves, so nothing outside the computer is asked.
 * Each test's project folder and key file are in a temp folder of their
 * own, removed afterwards, and every environment a test passes names its
 * key file and holds no `API_KEYS_PASSWORD` it did not set, so no test
 * reads the owner's keys, even from a terminal that has unlocked them. The
 * manager runs through `helpers/key-manager-runs.js`, whose visible
 * question answers from the test; its order of priority is tested in
 * `key-ranking.test.js`.
 */

import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  encryptKey,
  keyFileFor,
  loadEncryptedKey,
  readNeededKeys,
  saveEncryptedKey,
  savedKeyType,
  savePriority,
  unlockProjectKeys,
} from "../api-key-store/index.js";
import {
  makeProject,
  runManager,
  standInServices,
  typing,
} from "./helpers/key-manager-runs.js";
import { standInFetch } from "./helpers/stand-in-web.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

/** The repo's top folder. */
const REPO_TOP = fileURLToPath(new URL("..", import.meta.url));

after(removeTempFolders);

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

  it("refuse to open a key config.json does not list, so the manager offers every key a program uses", async () => {
    const top = makeProject(["coingecko"]);
    await assert.rejects(
      unlockProjectKeys({
        projectTop: top,
        services: ["dextools"],
        env: { API_KEYS_FILE_PATH: path.join(top, "api-keys.json") },
      }),
      /config\.json does not list dextools under apiKeys, which a program uses/,
    );
  });

  it("list in this project's config.json the services its programs use, in the order of priority they keep until the owner ranks them", () => {
    assert.deepEqual(
      readNeededKeys(REPO_TOP).map((service) => service.service),
      ["moralis", "coingecko", "coinpaprika", "dextools", "x1ninja"],
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

describe("runKeyManager, with CoinGecko's two types of key", () => {
  /** A paid plan's key, which the stand-in CoinGecko's Pro api takes. */
  const PAID_KEY = "paid-secret-key";

  /** A Demo key, which the stand-in CoinGecko's public api takes. */
  const DEMO_KEY = "demo-secret-key";

  let top;
  let file;

  beforeEach(() => {
    top = makeProject(["coingecko"]);
    file = path.join(top, "api-keys.json");
  });

  /**
   * Answers as CoinGecko does: its public api's ping takes the Demo key,
   * in the Demo key's header, and refuses any other with status 400,
   * error 10010, which asks for the Pro api's root; its Pro api's ping
   * takes the paid plan's key, in the paid key's header, and refuses any
   * other with status 401.
   *
   * @param {{url: string, headers: Object<string, string>}} request - The request
   * @returns {*} The response (`standInFetch`)
   */
  function coinGecko({ url, headers }) {
    if (url === "https://api.coingecko.com/api/v3/ping") {
      return headers["x-cg-demo-api-key"] === DEMO_KEY
        ? { ok: true }
        : { status: 400, text: '{"error_code":10010}' };
    }
    if (url === "https://pro-api.coingecko.com/api/v3/ping") {
      return headers["x-cg-pro-api-key"] === PAID_KEY
        ? { ok: true }
        : { status: 401, text: '{"status":{"error_code":10002}}' };
    }
    return null;
  }

  /**
   * Runs the manager on the project, with the services it knows, which
   * ask the stand-in fetch given.
   *
   * @param {string[]} args - The arguments after the file's name
   * @param {string[]} answers - What is typed at each prompt
   * @param {function(Object): *} [answer=coinGecko] - The stand-in's answers
   * @returns {Promise<{exitCode: number, stdout: string, stderr: string, requests: Array<Object>}>} What it did, and the requests it made
   */
  async function manage(args, answers, answer = coinGecko) {
    const fetch = standInFetch(answer);
    const result = await runManager(
      args,
      { projectTop: top },
      {
        env: { API_KEYS_FILE_PATH: file },
        ask: typing(answers),
        checkOptions: { fetch },
      },
    );
    return { ...result, requests: fetch.requests };
  }

  it("saves a paid plan's key, which the public api refuses and the Pro api takes, with its type, which the list shows", async () => {
    const result = await manage(["set", "coingecko"], [PAID_KEY, "pw", "pw"]);
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stderr,
      `The CoinGecko api key is saved, encrypted, in ${file}, as a paid plan's key.\n`,
    );
    assert.deepEqual(
      result.requests.map((request) => request.url),
      [
        "https://api.coingecko.com/api/v3/ping",
        "https://pro-api.coingecko.com/api/v3/ping",
      ],
    );
    assert.ok(
      result.requests.every((request) => !request.url.includes(PAID_KEY)),
      "a url holds the key",
    );
    assert.equal(await loadEncryptedKey(file, "coingecko", "pw"), PAID_KEY);
    assert.equal(savedKeyType(file, "coingecko"), "paid");
    const listed = await manage([], []);
    assert.equal(
      listed.stdout,
      `Api keys of the services config.json lists, in their order of priority, kept in ${file}:\n  1. CoinGecko  saved, a paid plan's key\nEvery key is saved. To replace one: npm run api-keys -- set <service>\n`,
    );
    assert.deepEqual(listed.requests, []);
  });

  it("saves a Demo key, which the public api takes, asking the Pro api nothing", async () => {
    const result = await manage(["set", "coingecko"], [DEMO_KEY, "pw", "pw"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stderr, /, as a Demo key\.\n$/);
    assert.deepEqual(
      result.requests.map((request) => request.url),
      ["https://api.coingecko.com/api/v3/ping"],
    );
    assert.equal(savedKeyType(file, "coingecko"), "demo");
  });

  it("refuses a key CoinGecko refuses as both types, naming both, saving nothing and showing none of it", async () => {
    const result = await manage(
      ["set", "coingecko"],
      ["refused-secret-key", "pw", "pw"],
    );
    assert.equal(result.exitCode, 1);
    assert.equal(
      result.stderr,
      "CoinGecko refused the api key as a Demo key and as a paid plan's key, so it was not saved. Enter the key as CoinGecko shows it.\n",
    );
    assert.equal(fs.existsSync(file), false);
    assert.ok(!result.stderr.includes("secret"), "a key was shown");
  });

  it("saves nothing when CoinGecko does not answer as one type and refuses the key as the other", async () => {
    const result = await manage(
      ["set", "coingecko"],
      [PAID_KEY, "pw", "pw"],
      ({ url }) =>
        url.startsWith("https://pro-api.")
          ? { status: 503, text: "{}" }
          : { status: 401, text: "{}" },
    );
    assert.equal(result.exitCode, 1);
    assert.equal(
      result.stderr,
      "CoinGecko did not answer the check of the api key (CoinGecko answered with status 503), so it was not saved. Try again later.\n",
    );
    assert.equal(fs.existsSync(file), false);
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
    savePriority(file, ["alpha", "beta"]);
  });

  /**
   * Runs the manager on the stand-in project, whose order of priority is
   * saved, so it asks for none.
   *
   * @param {string[]} args - The arguments after the file's name
   * @param {Object} deps - The prompt and the environment (`runKeyManager`), stdout and stderr aside
   * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>} What it did
   */
  function manage(args, deps) {
    return runManager(
      args,
      { projectTop: top, known: standInServices() },
      { env, ...deps },
    );
  }

  it("lists each key not saved, asks for each, and saves those the services take, showing none of their characters", async () => {
    const ask = typing(["alpha-secret-key", "pw", "pw", "beta-secret-key"]);
    const result = await manage([], { ask });
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout,
      `Api keys of the services config.json lists, in their order of priority, kept in ${file}:\n  1. Alpha  not saved\n  2. Beta   not saved\n`,
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
      stdout: `Api keys of the services config.json lists, in their order of priority, kept in ${file}:\n  1. Alpha  saved\n  2. Beta   saved\nEvery key is saved. To replace one: npm run api-keys -- set <service>; to change their order of priority: npm run api-keys -- rank\n`,
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
        "error: command-argument value 'gamma' is invalid for argument 'service'. " +
        'The project\'s config.json lists no service "gamma" under apiKeys.\n',
    });
  });

  it("check-password says whether API_KEYS_PASSWORD opens the keys saved", async () => {
    assert.deepEqual(await manage(["check-password"], {}), {
      exitCode: 1,
      stdout: "",
      stderr:
        "API_KEYS_PASSWORD is not set. source ./bin/unlock-api-keys.sh asks for the password and sets it.\n",
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
    assert.match(result.stdout, /rank +shows the services' order of priority/);
    assert.match(result.stdout, /Exit codes:/);
  });
});

describe("runKeyManager and a key file its schema refuses", () => {
  it("says what the file lacks, and not that the password does not open the keys, on check-password and on set with API_KEYS_PASSWORD", async () => {
    const top = makeProject(["coingecko"]);
    const file = path.join(top, "api-keys.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ coingeckoEncrypted: await encryptKey("k", "pw") }),
    );
    for (const args of [["check-password"], ["set", "coingecko"]]) {
      const result = await runManager(
        args,
        { projectTop: top },
        {
          env: { API_KEYS_FILE_PATH: file, API_KEYS_PASSWORD: "pw" },
          ask: typing(["a-new-key"]),
          checkOptions: {
            fetch: async () => assert.fail("A check asked the web"),
          },
        },
      );
      assert.equal(result.exitCode, 1, args.join(" "));
      assert.match(
        result.stderr,
        /coingeckoKeyType is missing, since coingeckoEncrypted is set/,
      );
      assert.doesNotMatch(result.stdout + result.stderr, /does not open/);
    }
  });
});

describe("bin/end-user/manage-api-keys.js, as a program", () => {
  /**
   * Runs `node bin/end-user/manage-api-keys.js`, with a key file of its own and no
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
      [path.join(REPO_TOP, "bin", "end-user", "manage-api-keys.js"), ...args],
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

  it("lists this project's keys and takes answers typed on its stdin: Enter alone skips each, and keeps the order of priority shown", () => {
    const run = runProgram([], "\n\n\n\n\n\n");
    assert.equal(run.status, 0, run.stderr);
    assert.match(
      run.stdout,
      /1\. Moralis {6}not saved\n {2}2\. CoinGecko {4}not saved\n {2}3\. CoinPaprika {2}not saved\n {2}4\. DexTools {5}not saved\n {2}5\. x1\.ninja {5}not saved\n$/,
    );
    assert.match(
      run.stderr,
      /No x1\.ninja api key was entered, so none was saved\./,
    );
    assert.match(
      run.stderr,
      /The order of priority is saved in \S*api-keys\.json: Moralis, CoinGecko, CoinPaprika, DexTools, x1\.ninja\.\n$/,
    );
  });
});
