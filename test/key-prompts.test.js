/**
 * Tests for `api-key-store/key-prompts.js`, the flows that open the saved
 * api keys with one password, and save a key once its service takes it.
 * @module test/key-prompts.test
 *
 * Each test's key file is in a temp folder of its own, removed afterwards,
 * so no test reads or writes the owner's `api-keys.json`. The prompts
 * answer from lists the tests give, and the services' checks are
 * functions the tests give, or CoinGecko's own, asking a stand-in fetch
 * (`helpers/stand-in-web.js`), so nothing outside the computer is asked.
 *
 * Every key is encrypted at 600,000 rounds of PBKDF2, a few tenths of a
 * second each, so the tests save and open no more keys than they check.
 */

import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  enterApiKey,
  getApiKey,
  getApiKeyType,
  hasEncryptedKey,
  keyRefused,
  loadEncryptedKey,
  saveEncryptedKey,
  savingPassword,
  SERVICES,
  setApiKey,
  unlockApiKeys,
} from "../api-key-store/index.js";
import { standInFetch } from "./helpers/stand-in-web.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

after(removeTempFolders);

/**
 * A stand-in service, whose check records each key it is asked about and
 * answers `verdict`, or throws it when it is an Error.
 *
 * @param {string} service - Its name in the key file
 * @param {Array<Array<string>>} checked - Where each check is recorded, as [service, key]
 * @param {string|Error} [verdict='valid'] - What it says of every key
 * @returns {import('../api-key-store/services.js').Service} The service
 */
function standInService(service, checked, verdict = "valid") {
  return {
    service,
    name: `Service ${service}`,
    check: async (key) => {
      checked.push([service, key]);
      if (verdict instanceof Error) throw verdict;
      return verdict;
    },
  };
}

/**
 * A key store spec whose prompts answer in turn from `answers`.
 *
 * @param {string} file - The key file
 * @param {Object} [options] - The answers, and the environment
 * @param {string[]} [options.answers=[]] - What is typed at each prompt
 * @param {Object<string, string>} [options.env={}] - The environment
 * @returns {Object} The spec, with what it said in `said` and the prompts it asked in `asked`
 */
function standInSpec(file, { answers = [], env = {} } = {}) {
  const queue = [...answers];
  const spec = {
    file,
    env,
    said: [],
    asked: [],
    ask: async (prompt) => {
      spec.asked.push(prompt);
      if (queue.length === 0)
        assert.fail(`Asked ${prompt} with no answer left`);
      return queue.shift();
    },
  };
  spec.say = (line) => spec.said.push(line);
  return spec;
}

describe("unlockApiKeys", () => {
  let file;
  let checked;
  let alpha;
  let beta;

  beforeEach(async () => {
    file = path.join(makeTempFolder("api-keys"), "api-keys.json");
    checked = [];
    alpha = standInService("alpha", checked);
    beta = standInService("beta", checked);
    setApiKey("alpha", null);
    setApiKey("beta", null);
    setApiKey("coingecko", null);
  });

  it("answers null for each service, and asks nothing, when no key is saved", async () => {
    const spec = standInSpec(file);
    assert.deepEqual(await unlockApiKeys(spec, [alpha, beta]), {
      alpha: null,
      beta: null,
    });
    assert.deepEqual(spec.asked, []);
    assert.deepEqual(checked, []);
  });

  it("opens every saved key with one typed password, has each service check its key once, and keeps them", async () => {
    await saveEncryptedKey(file, "alpha", "a-key", "pw");
    await saveEncryptedKey(file, "beta", "b-key", "pw");
    const spec = standInSpec(file, { answers: ["pw"] });
    assert.deepEqual(await unlockApiKeys(spec, [alpha, beta]), {
      alpha: "a-key",
      beta: "b-key",
    });
    assert.deepEqual(spec.asked, [`Password for the api keys in ${file}: `]);
    assert.deepEqual(checked, [
      ["alpha", "a-key"],
      ["beta", "b-key"],
    ]);
    assert.equal(getApiKey("alpha"), "a-key");
    assert.equal(getApiKey("beta"), "b-key");
  });

  it("opens the keys with the password in API_KEYS_PASSWORD, asking nothing", async () => {
    await saveEncryptedKey(file, "alpha", "a-key", "pw");
    const spec = standInSpec(file, { env: { API_KEYS_PASSWORD: "pw" } });
    assert.deepEqual(await unlockApiKeys(spec, [alpha, beta]), {
      alpha: "a-key",
      beta: null,
    });
    assert.deepEqual(spec.asked, []);
  });

  it("stops the run, saying how to unlock again, when API_KEYS_PASSWORD does not open the keys", async () => {
    await saveEncryptedKey(file, "alpha", "a-key", "pw");
    const failure = await unlockApiKeys(
      standInSpec(file, { env: { API_KEYS_PASSWORD: "other" } }),
      [alpha],
    ).then(
      () => assert.fail("It opened the key with a wrong password"),
      (error) => error,
    );
    assert.equal(failure.keyRefused, true);
    assert.match(
      failure.message,
      /^Could not open the Service alpha api key saved in .* with the password in API_KEYS_PASSWORD: /,
    );
    assert.match(
      failure.message,
      /In the project's top folder, keep the right one with: source \.\/bin\/unlock-api-keys\.sh$/,
    );
    assert.equal(getApiKey("alpha"), null);
  });

  it("stops the run when a typed password does not open the keys", async () => {
    await saveEncryptedKey(file, "alpha", "a-key", "pw");
    await assert.rejects(
      unlockApiKeys(standInSpec(file, { answers: ["other"] }), [alpha]),
      {
        keyRefused: true,
        message:
          /with the password typed: The password does not open the saved key.*Run again with the password the keys were saved with\.$/,
      },
    );
  });

  it("stops the run, keeping no key, when a service refuses its key", async () => {
    await saveEncryptedKey(file, "alpha", "a-key", "pw");
    await saveEncryptedKey(file, "beta", "b-key", "pw");
    const refusing = standInService("beta", checked, "invalid");
    await assert.rejects(
      unlockApiKeys(standInSpec(file, { answers: ["pw"] }), [alpha, refusing]),
      {
        keyRefused: true,
        message: `Service beta refused the api key saved in ${file}. Save a new one, in the project's top folder: npm run api-keys -- set beta`,
      },
    );
    assert.equal(getApiKey("alpha"), null);
  });

  it("uses a key unchecked, saying so, when its service does not answer", async () => {
    await saveEncryptedKey(file, "alpha", "a-key", "pw");
    const silent = standInService("alpha", checked, new Error("timed out"));
    const spec = standInSpec(file, { answers: ["pw"] });
    assert.deepEqual(await unlockApiKeys(spec, [silent]), { alpha: "a-key" });
    assert.deepEqual(spec.said, [
      "Service alpha did not answer the check of its api key (timed out), so the run uses the key unchecked.",
    ]);
  });

  it("checks a saved CoinGecko key as the type saved with it alone, and gives the type beside the key, keeping both for the run", async () => {
    await saveEncryptedKey(file, "coingecko", "gecko-key", "pw", "paid");
    const spec = standInSpec(file, { env: { API_KEYS_PASSWORD: "pw" } });
    const fetch = standInFetch(({ url, headers }) =>
      url === "https://pro-api.coingecko.com/api/v3/ping" &&
      headers["x-cg-pro-api-key"] === "gecko-key"
        ? { ok: true }
        : { status: 401, text: "{}" },
    );
    spec.checkOptions = { fetch };
    assert.deepEqual(await unlockApiKeys(spec, [SERVICES.coingecko]), {
      coingecko: "gecko-key",
      coingeckoKeyType: "paid",
    });
    assert.deepEqual(
      fetch.requests.map((request) => request.url),
      ["https://pro-api.coingecko.com/api/v3/ping"],
    );
    assert.equal(getApiKey("coingecko"), "gecko-key");
    assert.equal(getApiKeyType("coingecko"), "paid");
  });

  it("stops the run when CoinGecko refuses a saved key as its saved type, naming the type", async () => {
    await saveEncryptedKey(file, "coingecko", "gecko-key", "pw", "demo");
    const spec = standInSpec(file, { env: { API_KEYS_PASSWORD: "pw" } });
    spec.checkOptions = {
      fetch: standInFetch(() => ({ status: 401, text: "{}" })),
    };
    await assert.rejects(
      unlockApiKeys(spec, [SERVICES.coingecko]),
      (error) =>
        error.keyRefused === true &&
        error.message ===
          `CoinGecko refused the api key saved in ${file}, as a Demo key. Save a new one, in the project's top folder: npm run api-keys -- set coingecko`,
    );
    assert.equal(getApiKey("coingecko"), null);
  });
});

describe("enterApiKey and savingPassword", () => {
  let file;
  let checked;

  beforeEach(() => {
    file = path.join(makeTempFolder("api-keys"), "api-keys.json");
    checked = [];
    setApiKey("alpha", null);
  });

  /**
   * Enters keys for the services given, in turn, as the manager does.
   *
   * @param {Object} spec - The spec (`standInSpec`)
   * @param {Array<Object>} services - The services
   * @returns {Promise<Array<?string>>} What each `enterApiKey` gave
   */
  async function enterAll(spec, services) {
    const password = savingPassword(spec);
    const entered = [];
    for (const service of services)
      entered.push(await enterApiKey(spec, service, password, spec.ask));
    return entered;
  }

  it("asks for the key, then a new password twice, and saves the key once the service takes it", async () => {
    const spec = standInSpec(file, { answers: ["  typed-key  ", "pw", "pw"] });
    assert.deepEqual(await enterAll(spec, [standInService("alpha", checked)]), [
      "typed-key",
    ]);
    assert.deepEqual(spec.asked, [
      "Service alpha api key (Enter alone skips it): ",
      "Password to encrypt the api keys with: ",
      "That password again: ",
    ]);
    assert.deepEqual(checked, [["alpha", "typed-key"]]);
    assert.equal(await loadEncryptedKey(file, "alpha", "pw"), "typed-key");
    assert.equal(getApiKey("alpha"), "typed-key");
    assert.deepEqual(spec.said, [
      `The Service alpha api key is saved, encrypted, in ${file}.`,
    ]);
  });

  it("asks for the password once in a run that enters several keys", async () => {
    const spec = standInSpec(file, { answers: ["a-key", "pw", "pw", "b-key"] });
    await enterAll(spec, [
      standInService("alpha", checked),
      standInService("beta", checked),
    ]);
    assert.equal(
      spec.asked.filter((prompt) => prompt.startsWith("Password")).length,
      1,
    );
    assert.equal(await loadEncryptedKey(file, "beta", "pw"), "b-key");
  });

  it("asks for the password once, and checks that it opens the keys saved, when the file holds keys", async () => {
    await saveEncryptedKey(file, "beta", "b-key", "pw");
    const spec = standInSpec(file, { answers: ["a-key", "pw"] });
    await enterAll(spec, [standInService("alpha", checked)]);
    assert.deepEqual(spec.asked, [
      "Service alpha api key (Enter alone skips it): ",
      `Password for the api keys in ${file}: `,
    ]);
    assert.equal(await loadEncryptedKey(file, "alpha", "pw"), "a-key");
  });

  it("saves with the password in API_KEYS_PASSWORD, asking for none", async () => {
    const spec = standInSpec(file, {
      answers: ["a-key"],
      env: { API_KEYS_PASSWORD: "pw" },
    });
    await enterAll(spec, [standInService("alpha", checked)]);
    assert.deepEqual(spec.asked, [
      "Service alpha api key (Enter alone skips it): ",
    ]);
    assert.equal(await loadEncryptedKey(file, "alpha", "pw"), "a-key");
  });

  it("skips a key left empty, saving nothing and asking for no password", async () => {
    const spec = standInSpec(file, { answers: ["   "] });
    assert.deepEqual(await enterAll(spec, [standInService("alpha", checked)]), [
      null,
    ]);
    assert.deepEqual(spec.said, [
      "No Service alpha api key was entered, so none was saved.",
    ]);
    assert.equal(fs.existsSync(file), false);
  });

  it("saves nothing for want of a password: empty, typed two ways, or not opening the keys saved", async () => {
    const cases = [
      [
        { answers: ["a-key", ""] },
        "No password was entered, so no key was saved.",
      ],
      [
        { answers: ["a-key", "pw", "pw2"] },
        "The two passwords differ, so no key was saved.",
      ],
    ];
    for (const [options, message] of cases) {
      await assert.rejects(
        enterAll(standInSpec(file, options), [
          standInService("alpha", checked),
        ]),
        {
          keyRefused: true,
          passwordRefused: true,
          message,
        },
      );
    }
    await saveEncryptedKey(file, "beta", "b-key", "pw");
    await assert.rejects(
      enterAll(
        standInSpec(file, {
          answers: ["a-key"],
          env: { API_KEYS_PASSWORD: "other" },
        }),
        [standInService("alpha", checked)],
      ),
      {
        passwordRefused: true,
        message:
          /^The password in API_KEYS_PASSWORD does not open the api keys saved in .*, so no key was saved\.$/,
      },
    );
    assert.equal(hasEncryptedKey(file, "alpha"), false);
    assert.deepEqual(checked, []);
  });

  it("saves nothing when the service refuses the key or does not answer", async () => {
    const cases = [
      [
        "invalid",
        "Service alpha refused the api key, so it was not saved. Enter the key as Service alpha shows it.",
      ],
      [
        new Error("timed out"),
        "Service alpha did not answer the check of the api key (timed out), so it was not saved. Try again later.",
      ],
    ];
    for (const [verdict, message] of cases) {
      const failure = await enterAll(
        standInSpec(file, { answers: ["a-key", "pw", "pw"] }),
        [standInService("alpha", checked, verdict)],
      ).then(
        () => assert.fail("It saved a key the service did not take"),
        (error) => error,
      );
      assert.equal(failure.keyRefused, true);
      assert.equal(failure.passwordRefused, undefined);
      assert.equal(failure.message, message);
    }
    assert.equal(fs.existsSync(file), false);
    assert.equal(getApiKey("alpha"), null);
  });

  it("keyRefused builds an error that says what to do and marks the key refused", () => {
    const error = keyRefused("Save a new key.");
    assert.equal(error.message, "Save a new key.");
    assert.equal(error.keyRefused, true);
  });
});
