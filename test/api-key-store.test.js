/**
 * Tests for `api-key-store/`, the reusable store of api keys encrypted
 * with a password.
 * @module test/api-key-store.test
 *
 * Each test's key file is in a temp folder of its own, removed afterwards,
 * so no test reads or writes the owner's `api-keys.json`. The password
 * prompt reads from a stand-in input stream. LP Ranger's own code wrote
 * `fixtures/lp-ranger-api-keys.json`, which the store must open. The flows
 * that open and save keys are tested in `key-prompts.test.js`.
 *
 * Every key is encrypted at 600,000 rounds of PBKDF2, a few tenths of a
 * second each, so the tests save and open no more keys than they check.
 */

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  askPassword,
  checkPasswordOpensKeys,
  decryptKey,
  encryptKey,
  getApiKey,
  hasEncryptedKey,
  loadEncryptedKey,
  openSecretPrompt,
  PBKDF2_ITERATIONS,
  saveEncryptedKey,
  savedServices,
  setApiKey,
} from "../api-key-store/index.js";
import { capturedOutput } from "./helpers/captured-output.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

/** The key file LP Ranger's own code wrote, for its service `moralis`. */
const LP_RANGER_FILE = fileURLToPath(
  new URL("./fixtures/lp-ranger-api-keys.json", import.meta.url),
);

/** The key and password that file was written with. */
const LP_RANGER_KEY = "stand-in-api-key-not-real";
const LP_RANGER_PASSWORD = "stand-in password, not a real one";

after(removeTempFolders);

/**
 * A stand-in for the terminal: an input to type into and an output that
 * keeps what is written, in `output.text`.
 *
 * @returns {{input: PassThrough, output: {write: function(string): boolean, text: string}}} The streams
 */
function standInTerminal() {
  return { input: new PassThrough(), output: capturedOutput() };
}

describe("encryptKey and decryptKey", () => {
  let entry;

  before(async () => {
    entry = await encryptKey("the-key", "a password");
  });

  it("writes LP Ranger's entry: AES-256-GCM, with a key from PBKDF2-SHA512 at 600,000 rounds", () => {
    assert.equal(entry.version, 1);
    assert.deepEqual(Object.keys(entry.kdfParams), [
      "digest",
      "iterations",
      "saltHex",
    ]);
    assert.equal(entry.kdfParams.digest, "sha512");
    assert.equal(entry.kdfParams.iterations, PBKDF2_ITERATIONS);
    assert.equal(PBKDF2_ITERATIONS, 600000);
    assert.match(entry.kdfParams.saltHex, /^[0-9a-f]{32}$/);
    assert.match(entry.ivHex, /^[0-9a-f]{24}$/);
    assert.match(entry.authTagHex, /^[0-9a-f]{32}$/);
    assert.match(entry.ciphertextHex, /^[0-9a-f]+$/);
    assert.ok(
      !JSON.stringify(entry).includes("the-key"),
      "the entry holds the key in plain text",
    );
  });

  it("opens the entry with its password", async () => {
    assert.equal(await decryptKey(entry, "a password"), "the-key");
  });

  it("draws a new salt and IV for every encryption", async () => {
    const again = await encryptKey("the-key", "a password");
    assert.notEqual(again.kdfParams.saltHex, entry.kdfParams.saltHex);
    assert.notEqual(again.ivHex, entry.ivHex);
    assert.notEqual(again.ciphertextHex, entry.ciphertextHex);
  });

  it("refuses a wrong password", async () => {
    await assert.rejects(
      decryptKey(entry, "another password"),
      /does not open the saved key/,
    );
  });

  it("refuses an entry changed on disk", async () => {
    const last = entry.ciphertextHex.at(-1) === "0" ? "1" : "0";
    const changed = {
      ...entry,
      ciphertextHex: `${entry.ciphertextHex.slice(0, -1)}${last}`,
    };
    await assert.rejects(
      decryptKey(changed, "a password"),
      /does not open the saved key, or the key was changed on disk/,
    );
  });

  it("refuses an entry in another format, saying so, before it derives anything", async () => {
    const formats = [
      { ...entry, version: 2 },
      { ...entry, kdfParams: { ...entry.kdfParams, iterations: 100000 } },
      { ...entry, kdfParams: { ...entry.kdfParams, digest: "sha256" } },
      { ...entry, kdfParams: null },
      null,
    ];
    for (const other of formats) {
      await assert.rejects(
        decryptKey(other, "a password"),
        /not in the format this reads: version 1, PBKDF2-SHA512/,
      );
    }
    await assert.rejects(
      decryptKey({ ...entry, ivHex: "abc" }, "a password"),
      /IV is not 12 bytes of hex/,
    );
  });

  it("refuses an empty key or password", async () => {
    await assert.rejects(encryptKey("", "a password"), TypeError);
    await assert.rejects(encryptKey("the-key", ""), TypeError);
    await assert.rejects(decryptKey(entry, ""), TypeError);
  });
});

describe("the key file", () => {
  let folder;
  let file;

  beforeEach(() => {
    folder = makeTempFolder("api-keys");
    file = path.join(folder, "api-keys.json");
  });

  it("opens a key LP Ranger saved", async () => {
    assert.equal(
      await loadEncryptedKey(LP_RANGER_FILE, "moralis", LP_RANGER_PASSWORD),
      LP_RANGER_KEY,
    );
  });

  it("holds no key for a file that does not exist yet, and asks no password of it", async () => {
    assert.equal(hasEncryptedKey(file, "coingecko"), false);
    assert.deepEqual(savedServices(file), []);
    assert.equal(await loadEncryptedKey(file, "coingecko", ""), null);
  });

  it("saves a key, readable by its owner alone, written whole through a temp file", async () => {
    await saveEncryptedKey(file, "coingecko", "gecko-key", "pw");
    assert.equal(hasEncryptedKey(file, "coingecko"), true);
    assert.deepEqual(savedServices(file), ["coingecko"]);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, "utf8"))), [
      "coingeckoEncrypted",
    ]);
    assert.deepEqual(fs.readdirSync(folder), ["api-keys.json"]);
    if (process.platform !== "win32")
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(await loadEncryptedKey(file, "coingecko", "pw"), "gecko-key");
  });

  it("saves a second service's key under the same password, and replaces a key, keeping the others", async () => {
    await saveEncryptedKey(file, "coingecko", "first-key", "pw");
    await saveEncryptedKey(file, "dextools", "dex-key", "pw");
    await saveEncryptedKey(file, "coingecko", "second-key", "pw");
    assert.deepEqual(savedServices(file).sort(), ["coingecko", "dextools"]);
    assert.equal(await loadEncryptedKey(file, "coingecko", "pw"), "second-key");
    assert.equal(await loadEncryptedKey(file, "dextools", "pw"), "dex-key");
  });

  it("refuses a key under a password other than that of the keys already saved, leaving the file as it was", async () => {
    await saveEncryptedKey(file, "coingecko", "gecko-key", "pw");
    const before = fs.readFileSync(file, "utf8");
    await assert.rejects(
      saveEncryptedKey(file, "dextools", "dex-key", "other"),
      /does not open the other keys saved in/,
    );
    assert.equal(fs.readFileSync(file, "utf8"), before);
  });

  it("refuses to read, or write over, a file that is not valid JSON", async () => {
    fs.writeFileSync(file, "{ not json");
    assert.throws(
      () => hasEncryptedKey(file, "coingecko"),
      /is not valid JSON, so no key in it can be read/,
    );
    await assert.rejects(
      saveEncryptedKey(file, "coingecko", "gecko-key", "pw"),
      /is not valid JSON/,
    );
    assert.equal(fs.readFileSync(file, "utf8"), "{ not json");
    fs.writeFileSync(file, "[]");
    assert.throws(() => savedServices(file), /holds no JSON object/);
  });

  it("refuses a service whose name is not letters and digits", () => {
    for (const service of ["", "../coingecko", "coin gecko", "1inch", null]) {
      assert.throws(() => hasEncryptedKey(file, service), TypeError);
    }
  });
});

describe("askPassword and openSecretPrompt", () => {
  it("show nothing of what is typed: only the prompt and the line break after the answer", async () => {
    const terminal = standInTerminal();
    const answer = askPassword("Password: ", terminal);
    terminal.input.write("a secret\n");
    assert.equal(await answer, "a secret");
    assert.equal(terminal.output.text, "Password: \n");
  });

  it("ask several questions in a row, each answer kept for its question when typed together", async () => {
    const terminal = standInTerminal();
    const prompt = openSecretPrompt(terminal);
    try {
      terminal.input.write("the key\nthe password\n");
      assert.equal(await prompt.ask("Key: "), "the key");
      assert.equal(await prompt.ask("Password: "), "the password");
    } finally {
      prompt.close();
    }
    assert.equal(terminal.output.text, "Key: \nPassword: \n");
  });

  it("stop a question when the input ends before an answer", async () => {
    const terminal = standInTerminal();
    const answer = askPassword("Password: ", terminal);
    terminal.input.end();
    await assert.rejects(answer, /The input ended before an answer was typed/);
  });

  it("stop a question at Ctrl+C", async () => {
    const terminal = standInTerminal();
    const answer = askPassword("Password: ", terminal);
    terminal.input.write("\u0003");
    await assert.rejects(answer, /Stopped at the prompt/);
  });
});

describe("setApiKey and getApiKey", () => {
  it("keep a key for the run, give null for a service with none, and forget a key set to null", () => {
    setApiKey("holdertest", "held-key");
    assert.equal(getApiKey("holdertest"), "held-key");
    assert.equal(getApiKey("nonesaved"), null);
    setApiKey("holdertest", null);
    assert.equal(getApiKey("holdertest"), null);
  });

  it("refuse a key that is not a string that is not empty", () => {
    assert.throws(() => setApiKey("holdertest", ""), TypeError);
    assert.throws(() => setApiKey("holdertest", 42), TypeError);
  });
});

describe("checkPasswordOpensKeys", () => {
  it("counts the keys a password opens: none for a file with no key", async () => {
    const file = path.join(makeTempFolder("api-keys"), "api-keys.json");
    assert.equal(await checkPasswordOpensKeys(file, "pw"), 0);
    await saveEncryptedKey(file, "alpha", "a-key", "pw");
    await saveEncryptedKey(file, "beta", "b-key", "pw");
    assert.equal(await checkPasswordOpensKeys(file, "pw"), 2);
    await assert.rejects(
      checkPasswordOpensKeys(file, "other"),
      /does not open the saved key/,
    );
  });
});
