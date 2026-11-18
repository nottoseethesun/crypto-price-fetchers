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
  checkPasswordOpensKeys,
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
  savingPassword,
  setApiKey,
  unlockApiKeys
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

/**
 * A stand-in service, whose check records each key it is asked about and
 * answers `verdict`, or throws it when it is an Error.
 *
 * @param {string} service - Its name in the key file
 * @param {Array<Array<string>>} checked - Where each check is recorded, as [service, key]
 * @param {string|Error} [verdict='valid'] - What it says of every key
 * @returns {import('../api-key-store/services.js').Service} The service
 */
function standInService(service, checked, verdict = 'valid') {
  return {
    service,
    name: `Service ${service}`,
    check: async (key) => {
      checked.push([service, key]);
      if (verdict instanceof Error) throw verdict;
      return verdict;
    }
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
      if (queue.length === 0) assert.fail(`Asked ${prompt} with no answer left`);
      return queue.shift();
    }
  };
  spec.say = (line) => spec.said.push(line);
  return spec;
}

describe('unlockApiKeys', () => {
  let file;
  let checked;
  let alpha;
  let beta;

  beforeEach(async () => {
    file = path.join(makeFolder(), 'api-keys.json');
    checked = [];
    alpha = standInService('alpha', checked);
    beta = standInService('beta', checked);
    setApiKey('alpha', null);
    setApiKey('beta', null);
  });

  it('answers null for each service, and asks nothing, when no key is saved', async () => {
    const spec = standInSpec(file);
    assert.deepEqual(await unlockApiKeys(spec, [alpha, beta]), { alpha: null, beta: null });
    assert.deepEqual(spec.asked, []);
    assert.deepEqual(checked, []);
  });

  it('opens every saved key with one typed password, has each service check its key once, and keeps them', async () => {
    await saveEncryptedKey(file, 'alpha', 'a-key', 'pw');
    await saveEncryptedKey(file, 'beta', 'b-key', 'pw');
    const spec = standInSpec(file, { answers: ['pw'] });
    assert.deepEqual(await unlockApiKeys(spec, [alpha, beta]), { alpha: 'a-key', beta: 'b-key' });
    assert.deepEqual(spec.asked, [`Password for the api keys in ${file}: `]);
    assert.deepEqual(checked, [
      ['alpha', 'a-key'],
      ['beta', 'b-key']
    ]);
    assert.equal(getApiKey('alpha'), 'a-key');
    assert.equal(getApiKey('beta'), 'b-key');
  });

  it('opens the keys with the password in API_KEYS_PASSWORD, asking nothing', async () => {
    await saveEncryptedKey(file, 'alpha', 'a-key', 'pw');
    const spec = standInSpec(file, { env: { API_KEYS_PASSWORD: 'pw' } });
    assert.deepEqual(await unlockApiKeys(spec, [alpha, beta]), { alpha: 'a-key', beta: null });
    assert.deepEqual(spec.asked, []);
  });

  it('stops the run, saying how to unlock again, when API_KEYS_PASSWORD does not open the keys', async () => {
    await saveEncryptedKey(file, 'alpha', 'a-key', 'pw');
    const failure = await unlockApiKeys(standInSpec(file, { env: { API_KEYS_PASSWORD: 'other' } }), [alpha]).then(
      () => assert.fail('It opened the key with a wrong password'),
      (error) => error
    );
    assert.equal(failure.keyRefused, true);
    assert.match(failure.message, /^Could not open the Service alpha api key saved in .* with the password in API_KEYS_PASSWORD: /);
    assert.match(failure.message, /In the project's top folder, keep the right one with: source \.\/unlock-api-keys\.sh$/);
    assert.equal(getApiKey('alpha'), null);
  });

  it('stops the run when a typed password does not open the keys', async () => {
    await saveEncryptedKey(file, 'alpha', 'a-key', 'pw');
    await assert.rejects(unlockApiKeys(standInSpec(file, { answers: ['other'] }), [alpha]), {
      keyRefused: true,
      message: /with the password typed: The password does not open the saved key.*Run again with the password the keys were saved with\.$/
    });
  });

  it('stops the run, keeping no key, when a service refuses its key', async () => {
    await saveEncryptedKey(file, 'alpha', 'a-key', 'pw');
    await saveEncryptedKey(file, 'beta', 'b-key', 'pw');
    const refusing = standInService('beta', checked, 'invalid');
    await assert.rejects(unlockApiKeys(standInSpec(file, { answers: ['pw'] }), [alpha, refusing]), {
      keyRefused: true,
      message: `Service beta refused the api key saved in ${file}. Save a new one, in the project's top folder: npm run api-keys -- set beta`
    });
    assert.equal(getApiKey('alpha'), null);
  });

  it('uses a key unchecked, saying so, when its service does not answer', async () => {
    await saveEncryptedKey(file, 'alpha', 'a-key', 'pw');
    const silent = standInService('alpha', checked, new Error('timed out'));
    const spec = standInSpec(file, { answers: ['pw'] });
    assert.deepEqual(await unlockApiKeys(spec, [silent]), { alpha: 'a-key' });
    assert.deepEqual(spec.said, ['Service alpha did not answer the check of its api key (timed out), so the run uses the key unchecked.']);
  });
});

describe('enterApiKey and savingPassword', () => {
  let file;
  let checked;

  beforeEach(() => {
    file = path.join(makeFolder(), 'api-keys.json');
    checked = [];
    setApiKey('alpha', null);
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
    for (const service of services) entered.push(await enterApiKey(spec, service, password, spec.ask));
    return entered;
  }

  it('asks for the key, then a new password twice, and saves the key once the service takes it', async () => {
    const spec = standInSpec(file, { answers: ['  typed-key  ', 'pw', 'pw'] });
    assert.deepEqual(await enterAll(spec, [standInService('alpha', checked)]), ['typed-key']);
    assert.deepEqual(spec.asked, [
      'Service alpha api key (Enter alone skips it): ',
      'Password to encrypt the api keys with: ',
      'That password again: '
    ]);
    assert.deepEqual(checked, [['alpha', 'typed-key']]);
    assert.equal(await loadEncryptedKey(file, 'alpha', 'pw'), 'typed-key');
    assert.equal(getApiKey('alpha'), 'typed-key');
    assert.deepEqual(spec.said, [`The Service alpha api key is saved, encrypted, in ${file}.`]);
  });

  it('asks for the password once in a run that enters several keys', async () => {
    const spec = standInSpec(file, { answers: ['a-key', 'pw', 'pw', 'b-key'] });
    await enterAll(spec, [standInService('alpha', checked), standInService('beta', checked)]);
    assert.equal(spec.asked.filter((prompt) => prompt.startsWith('Password')).length, 1);
    assert.equal(await loadEncryptedKey(file, 'beta', 'pw'), 'b-key');
  });

  it('asks for the password once, and checks that it opens the keys saved, when the file holds keys', async () => {
    await saveEncryptedKey(file, 'beta', 'b-key', 'pw');
    const spec = standInSpec(file, { answers: ['a-key', 'pw'] });
    await enterAll(spec, [standInService('alpha', checked)]);
    assert.deepEqual(spec.asked, ['Service alpha api key (Enter alone skips it): ', `Password for the api keys in ${file}: `]);
    assert.equal(await loadEncryptedKey(file, 'alpha', 'pw'), 'a-key');
  });

  it('saves with the password in API_KEYS_PASSWORD, asking for none', async () => {
    const spec = standInSpec(file, { answers: ['a-key'], env: { API_KEYS_PASSWORD: 'pw' } });
    await enterAll(spec, [standInService('alpha', checked)]);
    assert.deepEqual(spec.asked, ['Service alpha api key (Enter alone skips it): ']);
    assert.equal(await loadEncryptedKey(file, 'alpha', 'pw'), 'a-key');
  });

  it('skips a key left empty, saving nothing and asking for no password', async () => {
    const spec = standInSpec(file, { answers: ['   '] });
    assert.deepEqual(await enterAll(spec, [standInService('alpha', checked)]), [null]);
    assert.deepEqual(spec.said, ['No Service alpha api key was entered, so none was saved.']);
    assert.equal(fs.existsSync(file), false);
  });

  it('saves nothing for want of a password: empty, typed two ways, or not opening the keys saved', async () => {
    const cases = [
      [{ answers: ['a-key', ''] }, 'No password was entered, so no key was saved.'],
      [{ answers: ['a-key', 'pw', 'pw2'] }, 'The two passwords differ, so no key was saved.']
    ];
    for (const [options, message] of cases) {
      await assert.rejects(enterAll(standInSpec(file, options), [standInService('alpha', checked)]), {
        keyRefused: true,
        passwordRefused: true,
        message
      });
    }
    await saveEncryptedKey(file, 'beta', 'b-key', 'pw');
    await assert.rejects(
      enterAll(standInSpec(file, { answers: ['a-key'], env: { API_KEYS_PASSWORD: 'other' } }), [standInService('alpha', checked)]),
      { passwordRefused: true, message: /^The password in API_KEYS_PASSWORD does not open the api keys saved in .*, so no key was saved\.$/ }
    );
    assert.equal(hasEncryptedKey(file, 'alpha'), false);
    assert.deepEqual(checked, []);
  });

  it('saves nothing when the service refuses the key or does not answer', async () => {
    const cases = [
      ['invalid', 'Service alpha refused the api key, so it was not saved. Enter the key as Service alpha shows it.'],
      [new Error('timed out'), 'Service alpha did not answer the check of the api key (timed out), so it was not saved. Try again later.']
    ];
    for (const [verdict, message] of cases) {
      const failure = await enterAll(standInSpec(file, { answers: ['a-key', 'pw', 'pw'] }), [
        standInService('alpha', checked, verdict)
      ]).then(
        () => assert.fail('It saved a key the service did not take'),
        (error) => error
      );
      assert.equal(failure.keyRefused, true);
      assert.equal(failure.passwordRefused, undefined);
      assert.equal(failure.message, message);
    }
    assert.equal(fs.existsSync(file), false);
    assert.equal(getApiKey('alpha'), null);
  });

  it('keyRefused builds an error that says what to do and marks the key refused', () => {
    const error = keyRefused('Save a new key.');
    assert.equal(error.message, 'Save a new key.');
    assert.equal(error.keyRefused, true);
  });
});

describe('checkPasswordOpensKeys', () => {
  it('counts the keys a password opens: none for a file with no key', async () => {
    const file = path.join(makeFolder(), 'api-keys.json');
    assert.equal(await checkPasswordOpensKeys(file, 'pw'), 0);
    await saveEncryptedKey(file, 'alpha', 'a-key', 'pw');
    await saveEncryptedKey(file, 'beta', 'b-key', 'pw');
    assert.equal(await checkPasswordOpensKeys(file, 'pw'), 2);
    await assert.rejects(checkPasswordOpensKeys(file, 'other'), /does not open the saved key/);
  });
});
