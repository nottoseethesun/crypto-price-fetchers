/**
 * Tests for the services' order of priority: how the key manager asks for
 * it and saves it (`api-key-store/key-ranking.js`, `key-manager.js`), and
 * how a program gets it (`projectPriority` and `unlockProjectKeys`,
 * `project-keys.js`, and `getApiKeyPriority`, `key-holder.js`).
 * @module test/key-ranking.test
 *
 * Each test's project folder and key file are in a temp folder of their
 * own, removed afterwards, and every environment a test passes names its
 * key file, so no test reads the owner's. The manager runs on stand-in
 * services (`helpers/key-manager-runs.js`), and the question of the order
 * answers from lists the tests give.
 */

import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  askPriority,
  getApiKeyPriority,
  loadEncryptedKey,
  projectPriority,
  saveEncryptedKey,
  savedPriority,
  savePriority,
  setApiKeyPriority,
  typedOrder,
  unlockProjectKeys,
} from "../api-key-store/index.js";
import { capturedOutput } from "./helpers/captured-output.js";
import {
  makeProject,
  runManager,
  standInServices,
  typing,
} from "./helpers/key-manager-runs.js";
import { removeTempFolders } from "./helpers/temp-folders.js";

after(removeTempFolders);

/** The stand-in services, as the manager gets them. */
const KNOWN = standInServices();

describe("typedOrder", () => {
  it("reads each number from 1 to the count once, spaces or commas between, as places from 0", () => {
    assert.deepEqual(typedOrder("2 1 3", 3), [1, 0, 2]);
    assert.deepEqual(typedOrder(" 3, 1,2 ", 3), [2, 0, 1]);
  });

  it("refuses a number missing, twice, out of range or not a whole number, and words", () => {
    for (const typed of ["2 1", "2 2 1", "0 1 2", "1 2 4", "1 2 2.5", "a b c"])
      assert.equal(typedOrder(typed, 3), null, typed);
  });
});

describe("askPriority", () => {
  let file;

  beforeEach(() => {
    file = path.join(makeProject(["alpha"]), "api-keys.json");
  });

  /**
   * Asks for an order of the three stand-in services, answering from
   * `answers`.
   *
   * @param {Array<?string>} answers - What is typed at each question; null for an input that ended
   * @param {boolean} saved - Whether the order shown is the one saved
   * @returns {Promise<{exitCode: number, said: string, asked: string[]}>} The exit code, what it wrote, and the questions it asked
   */
  async function ask(answers, saved = false) {
    const stderr = capturedOutput();
    const askLine = typing(answers);
    const exitCode = await askPriority(
      { file, stderr, askLine },
      [KNOWN.alpha, KNOWN.beta, KNOWN.gamma],
      saved,
    );
    return { exitCode, said: stderr.text, asked: askLine.asked };
  }

  it("shows the services numbered, and saves the order shown for Enter alone", async () => {
    const result = await ask([""]);
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.said,
      "No order of priority is saved for these services. Where more than one can do one job, the programs ask them in this order until one is:\n" +
        "  1. Alpha\n  2. Beta\n  3. Gamma\n" +
        `The order of priority is saved in ${file}: Alpha, Beta, Gamma.\n`,
    );
    assert.deepEqual(result.asked, [
      "Order of priority, highest first, by number, such as 2 1 3 (Enter alone keeps the order above): ",
    ]);
    assert.deepEqual(savedPriority(file), ["alpha", "beta", "gamma"]);
  });

  it("saves the order typed, keeping the keys saved", async () => {
    await saveEncryptedKey(file, "alpha", "a-key", "pw");
    assert.equal((await ask(["3 1 2"], true)).exitCode, 0);
    assert.deepEqual(savedPriority(file), ["gamma", "alpha", "beta"]);
    assert.equal(
      (await ask(["2 1 3"], true)).said.split("\n")[0],
      `The services' order of priority, saved in ${file}:`,
    );
    assert.deepEqual(savedPriority(file), ["beta", "alpha", "gamma"]);
    assert.equal(await loadEncryptedKey(file, "alpha", "pw"), "a-key");
  });

  it("refuses an order that does not hold each number once, saying so, and asks again", async () => {
    const result = await ask(["1 1 2", "2 3 1"]);
    assert.equal(result.exitCode, 0);
    assert.match(
      result.said,
      /Type each number from 1 to 3 once, highest priority first, or Enter alone to keep the order above\.\n/,
    );
    assert.equal(result.asked.length, 2);
    assert.deepEqual(savedPriority(file), ["beta", "gamma", "alpha"]);
  });

  it("saves nothing, with exit code 1, when the input ends before an order is typed", async () => {
    const result = await ask([null]);
    assert.equal(result.exitCode, 1);
    assert.match(
      result.said,
      /The input ended before an order of priority was typed, so none was saved\.\n$/,
    );
    assert.equal(savedPriority(file), null);
  });
});

describe("a project's order of priority", () => {
  let top;
  let file;
  let env;

  beforeEach(() => {
    top = makeProject(["alpha", "beta", "gamma"]);
    file = path.join(top, "api-keys.json");
    env = { API_KEYS_FILE_PATH: file, API_KEYS_PASSWORD: "pw" };
    setApiKeyPriority(null);
  });

  it("is the order config.json lists the services in until one is saved, then the one saved", () => {
    assert.deepEqual(projectPriority(top, { env, known: KNOWN }), {
      services: ["alpha", "beta", "gamma"],
      saved: false,
    });
    savePriority(file, ["gamma", "alpha", "beta"]);
    assert.deepEqual(projectPriority(top, { env, known: KNOWN }), {
      services: ["gamma", "alpha", "beta"],
      saved: true,
    });
  });

  it("is config.json's order when the order saved does not rank exactly the services it lists", () => {
    savePriority(file, ["beta", "alpha"]);
    assert.deepEqual(projectPriority(top, { env, known: KNOWN }), {
      services: ["alpha", "beta", "gamma"],
      saved: false,
    });
  });

  it("comes with the keys a program opens, and is kept for the run", async () => {
    await saveEncryptedKey(file, "alpha", "a-key", "pw");
    savePriority(file, ["beta", "gamma", "alpha"]);
    assert.deepEqual(
      await unlockProjectKeys({
        projectTop: top,
        services: ["alpha"],
        env,
        known: KNOWN,
        say: () => {},
      }),
      { alpha: "a-key", priority: ["beta", "gamma", "alpha"] },
    );
    assert.deepEqual(getApiKeyPriority(), ["beta", "gamma", "alpha"]);
  });
});

describe("the key manager's order of priority", () => {
  let top;
  let file;
  let env;

  beforeEach(() => {
    top = makeProject(["alpha", "beta", "gamma"]);
    file = path.join(top, "api-keys.json");
    env = { API_KEYS_FILE_PATH: file, API_KEYS_PASSWORD: "pw" };
  });

  /**
   * Runs the manager on the stand-in project.
   *
   * @param {string[]} args - The arguments after the file's name
   * @param {Object} deps - The prompts (`runKeyManager`)
   * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>} What it did
   */
  function manage(args, deps) {
    return runManager(
      args,
      { projectTop: top, known: KNOWN },
      { env, ...deps },
    );
  }

  it("asks for an order once the keys are asked for, when none is saved, and saves it", async () => {
    const askLine = typing(["3 1 2"]);
    const result = await manage([], { ask: typing(["", "", ""]), askLine });
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout,
      `Api keys of the services config.json lists, in their order of priority, kept in ${file}:\n` +
        "  1. Alpha  not saved\n  2. Beta   not saved\n  3. Gamma  not saved\n",
    );
    assert.equal(askLine.asked.length, 1);
    assert.deepEqual(savedPriority(file), ["gamma", "alpha", "beta"]);
  });

  it("asks for an order when every key is saved and none is, saying no more", async () => {
    for (const service of ["alpha", "beta", "gamma"])
      await saveEncryptedKey(file, service, `${service}-key`, "pw");
    const result = await manage([], { ask: typing([]), askLine: typing([""]) });
    assert.equal(result.exitCode, 0);
    assert.doesNotMatch(result.stdout, /Every key is saved/);
    assert.deepEqual(savedPriority(file), ["alpha", "beta", "gamma"]);
  });

  it("lists the services in the order saved, and asks for none", async () => {
    savePriority(file, ["beta", "gamma", "alpha"]);
    const result = await manage([], { ask: typing(["", "", ""]) });
    assert.equal(result.exitCode, 0);
    assert.match(
      result.stdout,
      /\n {2}1\. Beta {3}not saved\n {2}2\. Gamma {2}not saved\n {2}3\. Alpha {2}not saved\n$/,
    );
  });

  it("ends with exit code 1 when the input ends before an order is typed", async () => {
    const result = await manage([], {
      ask: typing(["", "", ""]),
      askLine: typing([null]),
    });
    assert.equal(result.exitCode, 1);
    assert.equal(savedPriority(file), null);
  });

  it("set <service> asks for an order after the key, when none is saved", async () => {
    const askLine = typing(["2 1 3"]);
    const result = await manage(["set", "alpha"], {
      ask: typing(["a-key"]),
      askLine,
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(savedPriority(file), ["beta", "alpha", "gamma"]);
  });

  it("rank shows the order saved and saves the one typed, or keeps it for Enter alone", async () => {
    savePriority(file, ["gamma", "beta", "alpha"]);
    const changed = await manage(["rank"], { askLine: typing(["3 2 1"]) });
    assert.equal(changed.exitCode, 0);
    assert.match(
      changed.stderr,
      /^The services' order of priority, saved in \S+:\n {2}1\. Gamma\n {2}2\. Beta\n {2}3\. Alpha\n/,
    );
    assert.deepEqual(savedPriority(file), ["alpha", "beta", "gamma"]);
    assert.equal(
      (await manage(["rank"], { askLine: typing([""]) })).exitCode,
      0,
    );
    assert.deepEqual(savedPriority(file), ["alpha", "beta", "gamma"]);
  });

  it("rank asks nothing for a project that lists fewer than two services", async () => {
    const lone = makeProject(["alpha"]);
    const result = await runManager(
      ["rank"],
      { projectTop: lone, known: KNOWN },
      { env: { API_KEYS_FILE_PATH: path.join(lone, "api-keys.json") } },
    );
    assert.deepEqual(result, {
      exitCode: 0,
      stdout:
        "The project's config.json lists fewer than two services, so they need no order of priority.\n",
      stderr: "",
    });
  });

  it("rank answers --help with how to type an order, an example and its exit codes", async () => {
    const result = await manage(["rank", "--help"], {});
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Usage: manage-api-keys rank \[options\]/);
    assert.match(result.stdout, /\$ npm run api-keys -- rank\n/);
    assert.match(result.stdout, /Exit codes:/);
  });
});
