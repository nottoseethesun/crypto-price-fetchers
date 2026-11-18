/**
 * Tests for `api-key-store/`, the reusable store of api keys encrypted
 * with a password.
 * @module test/api-key-store.test
 *
 * Each test's key file is in a temp folder of its own, removed afterwards,
 * so no test reads or writes the owner's `api-keys.json`. The prompts read
 * from a stand-in input stream, and the services' checks are functions the
 * tests give, so nothing outside the computer is asked. LP Ranger's own
 * code wrote `fixtures/lp-ranger-api-keys.json`, which the store must open.
 *
 * Every key is encrypted at 600,000 rounds of PBKDF2, a few tenths of a
 * second each, so the tests save and open no more keys than they check.
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  askPassword,
  decryptKey,
  encryptKey,
  enterApiKey,
  getApiKey,
  hasEncryptedKey,
  keyRefused,
  loadEncryptedKey,
  openSecretPrompt,
  PBKDF2_ITERATIONS,
  saveEncryptedKey,
  savedServices,
  setApiKey,
  unlockApiKey
} from '../api-key-store/index.js';

/** The key file LP Ranger's own code wrote, for its service `moralis`. */
const LP_RANGER_FILE = fileURLToPath(new URL('./fixtures/lp-ranger-api-keys.json', import.meta.url));

/** The key and password that file was written with. */
const LP_RANGER_KEY = 'stand-in-api-key-not-real';
const LP_RANGER_PASSWORD = 'stand-in password, not a real one';

/** The temp folders the tests made, removed once they have run. */
const folders = [];

after(() => {
  for (const folder of folders) fs.rmSync(folder, { recursive: true, force: true });
});

/**
 * Makes a temp folder for a test, removed once the tests have run.
 *
 * @returns {string} The folder
 */
function makeFolder() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-price-fetchers-test-api-keys-'));
  folders.push(folder);
  return folder;
}

/**
 * A stand-in for the terminal: an input to type into and an output that
 * keeps what is written.
 *
 * @returns {{input: PassThrough, output: {write: function(string): void}, written: function(): string}} The streams, and what the output holds
 */
function standInTerminal() {
  let text = '';
  return {
    input: new PassThrough(),
    output: {
      write(chunk) {
        text += chunk;
      }
    },
    written: () => text
  };
}

describe('encryptKey and decryptKey', () => {
  let entry;

  before(async () => {
    entry = await encryptKey('the-key', 'a password');
  });

  it("writes LP Ranger's entry: AES-256-GCM, with a key from PBKDF2-SHA512 at 600,000 rounds", () => {
    assert.equal(entry.version, 1);
    assert.deepEqual(Object.keys(entry.kdfParams), ['digest', 'iterations', 'saltHex']);
    assert.equal(entry.kdfParams.digest, 'sha512');
    assert.equal(entry.kdfParams.iterations, PBKDF2_ITERATIONS);
    assert.equal(PBKDF2_ITERATIONS, 600000);
    assert.match(entry.kdfParams.saltHex, /^[0-9a-f]{32}$/);
    assert.match(entry.ivHex, /^[0-9a-f]{24}$/);
    assert.match(entry.authTagHex, /^[0-9a-f]{32}$/);
    assert.match(entry.ciphertextHex, /^[0-9a-f]+$/);
    assert.ok(!JSON.stringify(entry).includes('the-key'), 'the entry holds the key in plain text');
  });

  it('opens the entry with its password', async () => {
    assert.equal(await decryptKey(entry, 'a password'), 'the-key');
  });

  it('draws a new salt and IV for every encryption', async () => {
    const again = await encryptKey('the-key', 'a password');
    assert.notEqual(again.kdfParams.saltHex, entry.kdfParams.saltHex);
    assert.notEqual(again.ivHex, entry.ivHex);
    assert.notEqual(again.ciphertextHex, entry.ciphertextHex);
  });

  it('refuses a wrong password', async () => {
    await assert.rejects(decryptKey(entry, 'another password'), /does not open the saved key/);
  });

  it('refuses an entry changed on disk', async () => {
    const last = entry.ciphertextHex.at(-1) === '0' ? '1' : '0';
    const changed = { ...entry, ciphertextHex: `${entry.ciphertextHex.slice(0, -1)}${last}` };
    await assert.rejects(decryptKey(changed, 'a password'), /does not open the saved key, or the key was changed on disk/);
  });

  it('refuses an entry in another format, saying so, before it derives anything', async () => {
    const formats = [
      { ...entry, version: 2 },
      { ...entry, kdfParams: { ...entry.kdfParams, iterations: 100000 } },
      { ...entry, kdfParams: { ...entry.kdfParams, digest: 'sha256' } },
      { ...entry, kdfParams: null },
      null
    ];
    for (const other of formats) {
      await assert.rejects(decryptKey(other, 'a password'), /not in the format this reads: version 1, PBKDF2-SHA512/);
    }
    await assert.rejects(decryptKey({ ...entry, ivHex: 'abc' }, 'a password'), /IV is not 12 bytes of hex/);
  });

  it('refuses an empty key or password', async () => {
    await assert.rejects(encryptKey('', 'a password'), TypeError);
    await assert.rejects(encryptKey('the-key', ''), TypeError);
    await assert.rejects(decryptKey(entry, ''), TypeError);
  });
});

describe('the key file', () => {
  let folder;
  let file;

  beforeEach(() => {
    folder = makeFolder();
    file = path.join(folder, 'api-keys.json');
  });

  it('opens a key LP Ranger saved', async () => {
    assert.equal(await loadEncryptedKey(LP_RANGER_FILE, 'moralis', LP_RANGER_PASSWORD), LP_RANGER_KEY);
  });

  it('holds no key for a file that does not exist yet, and asks no password of it', async () => {
    assert.equal(hasEncryptedKey(file, 'coingecko'), false);
    assert.deepEqual(savedServices(file), []);
    assert.equal(await loadEncryptedKey(file, 'coingecko', ''), null);
  });

  it('saves a key, readable by its owner alone, written whole through a temp file', async () => {
    await saveEncryptedKey(file, 'coingecko', 'gecko-key', 'pw');
    assert.equal(hasEncryptedKey(file, 'coingecko'), true);
    assert.deepEqual(savedServices(file), ['coingecko']);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))), ['coingeckoEncrypted']);
    assert.deepEqual(fs.readdirSync(folder), ['api-keys.json']);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(await loadEncryptedKey(file, 'coingecko', 'pw'), 'gecko-key');
  });

  it("saves a second service's key under the same password, and replaces a key, keeping the others", async () => {
    await saveEncryptedKey(file, 'coingecko', 'first-key', 'pw');
    await saveEncryptedKey(file, 'dextools', 'dex-key', 'pw');
    await saveEncryptedKey(file, 'coingecko', 'second-key', 'pw');
    assert.deepEqual(savedServices(file).sort(), ['coingecko', 'dextools']);
    assert.equal(await loadEncryptedKey(file, 'coingecko', 'pw'), 'second-key');
    assert.equal(await loadEncryptedKey(file, 'dextools', 'pw'), 'dex-key');
  });

  it('refuses a key under a password other than that of the keys already saved, leaving the file as it was', async () => {
    await saveEncryptedKey(file, 'coingecko', 'gecko-key', 'pw');
    const before = fs.readFileSync(file, 'utf8');
    await assert.rejects(saveEncryptedKey(file, 'dextools', 'dex-key', 'other'), /does not open the other keys saved in/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });

  it('refuses to read, or write over, a file that is not valid JSON', async () => {
    fs.writeFileSync(file, '{ not json');
    assert.throws(() => hasEncryptedKey(file, 'coingecko'), /is not valid JSON, so no key in it can be read/);
    await assert.rejects(saveEncryptedKey(file, 'coingecko', 'gecko-key', 'pw'), /is not valid JSON/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
    fs.writeFileSync(file, '[]');
    assert.throws(() => savedServices(file), /holds no JSON object/);
  });

  it('refuses a service whose name is not letters and digits', () => {
    for (const service of ['', '../coingecko', 'coin gecko', '1inch', null]) {
      assert.throws(() => hasEncryptedKey(file, service), TypeError);
    }
  });
});

describe('askPassword and openSecretPrompt', () => {
  it('show nothing of what is typed: only the prompt and the line break after the answer', async () => {
    const terminal = standInTerminal();
    const answer = askPassword('Password: ', terminal);
    terminal.input.write('a secret\n');
    assert.equal(await answer, 'a secret');
    assert.equal(terminal.written(), 'Password: \n');
  });

  it('ask several questions in a row, each answer kept for its question when typed together', async () => {
    const terminal = standInTerminal();
    const prompt = openSecretPrompt(terminal);
    try {
      terminal.input.write('the key\nthe password\n');
      assert.equal(await prompt.ask('Key: '), 'the key');
      assert.equal(await prompt.ask('Password: '), 'the password');
    } finally {
      prompt.close();
    }
    assert.equal(terminal.written(), 'Key: \nPassword: \n');
  });

  it('stop a question when the input ends before an answer', async () => {
    const terminal = standInTerminal();
    const answer = askPassword('Password: ', terminal);
    terminal.input.end();
    await assert.rejects(answer, /The input ended before an answer was typed/);
  });

  it('stop a question at Ctrl+C', async () => {
    const terminal = standInTerminal();
    const answer = askPassword('Password: ', terminal);
    terminal.input.write('\u0003');
    await assert.rejects(answer, /Stopped at the prompt/);
  });
});

describe('setApiKey and getApiKey', () => {
  it('keep a key for the run, give null for a service with none, and forget a key set to null', () => {
    setApiKey('holdertest', 'held-key');
    assert.equal(getApiKey('holdertest'), 'held-key');
    assert.equal(getApiKey('nonesaved'), null);
    setApiKey('holdertest', null);
    assert.equal(getApiKey('holdertest'), null);
  });

  it('refuse a key that is not a string that is not empty', () => {
    assert.throws(() => setApiKey('holdertest', ''), TypeError);
    assert.throws(() => setApiKey('holdertest', 42), TypeError);
  });
});

describe('unlockApiKey and enterApiKey', () => {
  let file;
  let said;
  let checked;

  /**
   * Builds a key spec for the service `example`, whose prompts answer in
   * turn from `answers` and whose check answers `verdict`, or throws when
   * the verdict is an Error.
   *
   * @param {string[]} answers - What is typed at each prompt
   * @param {string|Error} [verdict='valid'] - What the service says of the key
   * @returns {Object} The spec, with the prompts it asked in `asked`
   */
  function exampleSpec(answers, verdict = 'valid') {
    const asked = [];
    const queue = [...answers];
    return {
      file,
      service: 'example',
      name: 'Example',
      saveCommand: 'npm run save-api-key -- example',
      check: async (key) => {
        checked.push(key);
        if (verdict instanceof Error) throw verdict;
        return verdict;
      },
      ask: async (prompt) => {
        asked.push(prompt);
        if (queue.length === 0) assert.fail(`Asked ${prompt} with no answer left`);
        return queue.shift();
      },
      say: (line) => said.push(line),
      asked
    };
  }

  beforeEach(() => {
    file = path.join(makeFolder(), 'api-keys.json');
    said = [];
    checked = [];
    setApiKey('example', null);
  });

  it('unlockApiKey answers null and asks nothing when no key is saved', async () => {
    const spec = exampleSpec([]);
    assert.equal(await unlockApiKey(spec), null);
    assert.deepEqual(spec.asked, []);
    assert.deepEqual(checked, []);
  });

  it('unlockApiKey opens the saved key with its password, asks the service once, and keeps the key for the run', async () => {
    await saveEncryptedKey(file, 'example', 'saved-key', 'pw');
    const spec = exampleSpec(['pw']);
    assert.equal(await unlockApiKey(spec), 'saved-key');
    assert.deepEqual(spec.asked, ['Password for the Example api key: ']);
    assert.deepEqual(checked, ['saved-key']);
    assert.equal(getApiKey('example'), 'saved-key');
    assert.deepEqual(said, []);
  });

  it('unlockApiKey stops the run, saying what to do, when the password does not open the key', async () => {
    await saveEncryptedKey(file, 'example', 'saved-key', 'pw');
    const failure = await unlockApiKey(exampleSpec(['wrong'])).then(
      () => assert.fail('It opened the key with a wrong password'),
      (error) => error
    );
    assert.equal(failure.keyRefused, true);
    assert.match(failure.message, /^Could not open the Example api key saved in .*: The password does not open/);
    assert.match(failure.message, /or save the key again: npm run save-api-key -- example$/);
    assert.equal(getApiKey('example'), null);
  });

  it('unlockApiKey stops the run when the service refuses the saved key', async () => {
    await saveEncryptedKey(file, 'example', 'saved-key', 'pw');
    await assert.rejects(unlockApiKey(exampleSpec(['pw'], 'invalid')), {
      keyRefused: true,
      message: `Example refused the api key saved in ${file}. Save a new one: npm run save-api-key -- example`
    });
    assert.equal(getApiKey('example'), null);
  });

  it('unlockApiKey uses the saved key, saying so, when the service does not answer', async () => {
    await saveEncryptedKey(file, 'example', 'saved-key', 'pw');
    assert.equal(await unlockApiKey(exampleSpec(['pw'], new Error('timed out'))), 'saved-key');
    assert.deepEqual(said, ['Example did not answer the check of its api key (timed out), so the run uses the key unchecked.']);
  });

  it('enterApiKey asks for the key, then the password twice, and saves the key once the service takes it', async () => {
    const spec = exampleSpec(['  typed-key  ', 'pw', 'pw']);
    assert.equal(await enterApiKey(spec), 'typed-key');
    assert.deepEqual(spec.asked, ['Example api key: ', 'Password to encrypt the Example api key with: ', 'That password again: ']);
    assert.deepEqual(checked, ['typed-key']);
    assert.equal(await loadEncryptedKey(file, 'example', 'pw'), 'typed-key');
    assert.equal(getApiKey('example'), 'typed-key');
    assert.deepEqual(said, [`The Example api key is saved in ${file}, encrypted with that password.`]);
  });

  it('enterApiKey saves nothing for an empty key or password, or passwords that differ', async () => {
    const cases = [
      [['  ', 'pw', 'pw'], 'No Example api key was entered, so none was saved.'],
      [['typed-key', '', ''], 'No password was entered, so the key was not saved.'],
      [['typed-key', 'pw', 'pw2'], 'The two passwords differ, so the key was not saved.']
    ];
    for (const [answers, message] of cases) {
      await assert.rejects(enterApiKey(exampleSpec(answers)), { keyRefused: true, message });
    }
    assert.deepEqual(checked, []);
    assert.equal(hasEncryptedKey(file, 'example'), false);
  });

  it('enterApiKey saves nothing when the service refuses the key or does not answer', async () => {
    await assert.rejects(enterApiKey(exampleSpec(['typed-key', 'pw', 'pw'], 'invalid')), {
      keyRefused: true,
      message: 'Example refused the api key, so it was not saved. Enter the key as Example shows it.'
    });
    await assert.rejects(enterApiKey(exampleSpec(['typed-key', 'pw', 'pw'], new Error('timed out'))), {
      keyRefused: true,
      message: 'Example did not answer the check of the api key (timed out), so it was not saved. Try again later.'
    });
    assert.equal(hasEncryptedKey(file, 'example'), false);
    assert.equal(getApiKey('example'), null);
  });

  it('enterApiKey saves nothing under a password other than that of the keys already saved', async () => {
    await saveEncryptedKey(file, 'other', 'other-key', 'pw');
    await assert.rejects(enterApiKey(exampleSpec(['typed-key', 'pw2', 'pw2'])), {
      keyRefused: true,
      message: /^The Example api key was not saved: That password does not open the other keys saved in/
    });
    assert.equal(hasEncryptedKey(file, 'example'), false);
  });

  it('keyRefused builds an error that says what to do and marks the key refused', () => {
    const error = keyRefused('Save a new key.');
    assert.equal(error.message, 'Save a new key.');
    assert.equal(error.keyRefused, true);
  });
});
