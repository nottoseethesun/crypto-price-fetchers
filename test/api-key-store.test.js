/**
 * Tests for `api-key-store/`, the reusable store of api keys encrypted
 * with a password.
 * @module test/api-key-store.test
 *
 * Each test's key file is in a temp folder of its own, removed afterwards,
 * so no test reads or writes the owner's `api-keys.json`. The password
 * prompt reads from a stand-in input stream. LP Ranger's own code wrote
 * `fixtures/lp-ranger-api-keys.json`, which the store must open. Files
 * written by hand hold what the store refuses to read. The flows that open
 * and save keys are tested in `key-prompts.test.js`.
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
  getApiKeyType,
  hasEncryptedKey,
  loadEncryptedKey,
  openSecretPrompt,
  PBKDF2_ITERATIONS,
  saveEncryptedKey,
  savedKeyType,
  savedPriority,
  savedServices,
  savePriority,
  setApiKey,
  setApiKeyPriority,
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

  it("saves a key, with its type, readable by its owner alone, leaving no other file beside it", async () => {
    await saveEncryptedKey(file, "coingecko", "gecko-key", "pw", "demo");
    assert.equal(hasEncryptedKey(file, "coingecko"), true);
    assert.deepEqual(savedServices(file), ["coingecko"]);
    assert.equal(savedKeyType(file, "coingecko"), "demo");
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, "utf8"))), [
      "coingeckoEncrypted",
      "coingeckoKeyType",
    ]);
    assert.deepEqual(fs.readdirSync(folder), ["api-keys.json"]);
    if (process.platform !== "win32")
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(await loadEncryptedKey(file, "coingecko", "pw"), "gecko-key");
  });

  it("saves a second service's key under the same password, and replaces a key and its type, keeping the others", async () => {
    await saveEncryptedKey(file, "coingecko", "first-key", "pw", "demo");
    await saveEncryptedKey(file, "dextools", "dex-key", "pw");
    await saveEncryptedKey(file, "coingecko", "second-key", "pw", "paid");
    assert.deepEqual(savedServices(file).sort(), ["coingecko", "dextools"]);
    assert.equal(await loadEncryptedKey(file, "coingecko", "pw"), "second-key");
    assert.equal(savedKeyType(file, "coingecko"), "paid");
    assert.equal(await loadEncryptedKey(file, "dextools", "pw"), "dex-key");
    assert.equal(savedKeyType(file, "dextools"), null);
  });

  it("refuses a key under a password other than that of the keys already saved, leaving the file as it was", async () => {
    await saveEncryptedKey(file, "coingecko", "gecko-key", "pw", "demo");
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
      /api-keys\.json is not valid JSON: /,
    );
    await assert.rejects(
      saveEncryptedKey(file, "coingecko", "gecko-key", "pw", "demo"),
      /is not valid JSON/,
    );
    assert.equal(fs.readFileSync(file, "utf8"), "{ not json");
    fs.writeFileSync(file, "[]");
    assert.throws(() => savedServices(file), /holds no JSON object/);
  });

  it("refuses to save a CoinGecko key with no type, or with a type CoinGecko does not give, writing nothing", async () => {
    await assert.rejects(
      saveEncryptedKey(file, "coingecko", "gecko-key", "pw"),
      (error) =>
        error.message ===
        `${file} → coingeckoKeyType is missing, since coingeckoEncrypted is set`,
    );
    await assert.rejects(
      saveEncryptedKey(file, "coingecko", "gecko-key", "pw", "pro"),
      (error) =>
        error.message ===
        `${file} → coingeckoKeyType must be "demo" or "paid", the type of the CoinGecko key; it is "pro"`,
    );
    assert.equal(fs.existsSync(file), false);
  });

  it("refuses to read a file that breaks its schema, naming every problem, but no value of a key's entry, which may be a key typed in by hand: an entry of no kind it keeps, an entry that is no object, and a type with no key", () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        coingeckoKeyType: "paid",
        dextoolsEncrypted: "not an entry",
        notes: "kept by hand",
      }),
    );
    assert.throws(
      () => savedServices(file),
      (error) =>
        error.message ===
        [
          `${file} → notes is not a setting this tool reads`,
          `${file} → dextoolsEncrypted must be an object, a key encrypted with the password in LP Ranger's format`,
          `${file} → coingeckoEncrypted is missing, since coingeckoKeyType is set`,
        ].join("\n"),
    );
  });

  it("refuses an order of priority that names a service twice, or is no list, writing nothing", () => {
    assert.throws(
      () => savePriority(file, ["alpha", "alpha"]),
      (error) =>
        error.message ===
        `${file} → priority must be a list of the services' names, each once, highest priority first; it is ["alpha","alpha"]`,
    );
    fs.writeFileSync(file, JSON.stringify({ priority: "alpha" }));
    assert.throws(
      () => savedPriority(file),
      /→ priority must be a list of the services' names, each once, highest priority first; it is "alpha"$/,
    );
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

  it("keep each answer piped in for its question when the input ends while the prompt waits between two questions, as on a service's check of a key", async () => {
    const input = new PassThrough();
    input.end("first-key\nsecond-key\n");
    const prompt = openSecretPrompt({ input, output: capturedOutput() });
    try {
      assert.equal(await prompt.ask("First key: "), "first-key");
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(await prompt.ask("Second key: "), "second-key");
    } finally {
      prompt.close();
    }
  });
});

describe("setApiKey, getApiKey and getApiKeyType", () => {
  it("keep a key for the run, give null for a service with none, and forget a key set to null", () => {
    setApiKey("holdertest", "held-key");
    assert.equal(getApiKey("holdertest"), "held-key");
    assert.equal(getApiKeyType("holdertest"), null);
    assert.equal(getApiKey("nonesaved"), null);
    setApiKey("holdertest", null);
    assert.equal(getApiKey("holdertest"), null);
  });

  it("keep a key's type with it, and forget the type with the key, or when the key is set again with none", () => {
    setApiKey("holdertest", "held-key", "paid");
    assert.equal(getApiKeyType("holdertest"), "paid");
    setApiKey("holdertest", "other-key");
    assert.equal(getApiKeyType("holdertest"), null);
    setApiKey("holdertest", "held-key", "demo");
    setApiKey("holdertest", null);
    assert.equal(getApiKeyType("holdertest"), null);
  });

  it("refuse a key that is not a string that is not empty, and a type that is neither that nor null", () => {
    assert.throws(() => setApiKey("holdertest", ""), TypeError);
    assert.throws(() => setApiKey("holdertest", 42), TypeError);
    assert.throws(() => setApiKey("holdertest", "held-key", ""), TypeError);
    assert.throws(() => setApiKey("holdertest", "held-key", 1), TypeError);
    assert.throws(() => setApiKeyPriority("alpha"), TypeError);
    assert.throws(() => setApiKeyPriority(["alpha", ""]), TypeError);
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
