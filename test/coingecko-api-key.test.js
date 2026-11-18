/**
 * Tests for `coingecko-api-key.js`, the CoinGecko key both tools send, and
 * `save-api-key.js`, the command line that saves it.
 * @module test/coingecko-api-key.test
 *
 * CoinGecko is a stand-in fetch (`helpers/stand-in-web.js`) whose ping
 * takes the key `good-key` alone, so nothing outside the computer is
 * asked. Each test's key file is in a temp folder of its own, removed
 * afterwards, so no test touches the owner's `api-keys.json`.
 */

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getApiKey, loadEncryptedKey, saveEncryptedKey, setApiKey } from '../api-key-store/index.js';
import {
  apiKeysFile,
  checkCoinGeckoKey,
  COINGECKO_KEY_HEADER,
  COINGECKO_SERVICE,
  SAVE_COMMAND,
  saveCoinGeckoKey,
  unlockCoinGeckoKey
} from '../coingecko-api-key.js';
import { runSaveApiKey } from '../save-api-key.js';
import { capturedOutput } from './helpers/captured-output.js';
import { standInFetch } from './helpers/stand-in-web.js';

/** The repo's top folder. */
const REPO_TOP = fileURLToPath(new URL('..', import.meta.url));

/** The temp folders the tests made, removed once they have run. */
const folders = [];

after(() => {
  for (const folder of folders) fs.rmSync(folder, { recursive: true, force: true });
});

/**
 * Names a key file in a temp folder of its own, which does not exist yet.
 *
 * @returns {string} The file's path
 */
function newKeyFile() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-price-fetchers-test-coingecko-key-'));
  folders.push(folder);
  return path.join(folder, 'api-keys.json');
}

/**
 * Answers as CoinGecko's ping does: 200 for the key `good-key`, 401 for
 * any other.
 *
 * @param {{url: string, headers: Object<string, string>}} request - The request
 * @returns {*} The response (`standInFetch`)
 */
function answerPing({ url, headers }) {
  if (!url.endsWith('/ping')) return null;
  if (headers[COINGECKO_KEY_HEADER] === 'good-key') return { gecko_says: '(V3) To the Moon!' };
  return { status: 401, text: JSON.stringify({ status: { error_code: 10002, error_message: 'Invalid API Key' } }) };
}

/**
 * Answers the prompts in turn from `answers`.
 *
 * @param {string[]} answers - What is typed at each prompt
 * @returns {function(string): Promise<string>} The stand-in prompt
 */
function typing(answers) {
  const queue = [...answers];
  return async (prompt) => {
    if (queue.length === 0) assert.fail(`Asked ${prompt} with no answer left`);
    return queue.shift();
  };
}

beforeEach(() => {
  setApiKey(COINGECKO_SERVICE, null);
});

describe('apiKeysFile', () => {
  it("names api-keys.json at the repo's top, unless API_KEYS_FILE_PATH names another file", () => {
    assert.equal(apiKeysFile({}), path.join(REPO_TOP, 'api-keys.json'));
    assert.equal(apiKeysFile({ API_KEYS_FILE_PATH: '' }), path.join(REPO_TOP, 'api-keys.json'));
    assert.equal(apiKeysFile({ API_KEYS_FILE_PATH: '/elsewhere/keys.json' }), '/elsewhere/keys.json');
  });

  it('is a file git ignores, as is the temp file it is written through', () => {
    for (const ignored of ['api-keys.json', 'api-keys.json.tmp']) {
      const check = spawnSync('git', ['check-ignore', '-q', ignored], { cwd: REPO_TOP });
      assert.equal(check.status, 0, `git does not ignore ${ignored}`);
    }
  });
});

describe('checkCoinGeckoKey', () => {
  it("asks CoinGecko's ping, with the key in its header and in no url", async () => {
    const fetch = standInFetch(answerPing);
    assert.equal(await checkCoinGeckoKey('good-key', { fetch }), 'valid');
    assert.deepEqual(
      fetch.requests.map((request) => [request.url, request.headers[COINGECKO_KEY_HEADER]]),
      [['https://api.coingecko.com/api/v3/ping', 'good-key']]
    );
  });

  it('answers invalid for a key CoinGecko refuses', async () => {
    assert.equal(await checkCoinGeckoKey('stale-key', { fetch: standInFetch(answerPing) }), 'invalid');
  });

  it('asks the CoinGecko api it is given', async () => {
    const fetch = standInFetch(answerPing);
    await checkCoinGeckoKey('good-key', { fetch, baseUrl: 'http://stand-in.test/api/v3' });
    assert.equal(fetch.requests[0].url, 'http://stand-in.test/api/v3/ping');
  });

  it('throws when CoinGecko answers with another status', async () => {
    const fetch = standInFetch(() => ({ status: 503, text: 'down for maintenance' }));
    await assert.rejects(checkCoinGeckoKey('good-key', { fetch }), /CoinGecko answered with status 503/);
  });
});

describe('unlockCoinGeckoKey and saveCoinGeckoKey', () => {
  it('save a key CoinGecko takes, which the next run opens with its password and checks once', async () => {
    const file = newKeyFile();
    const saved = await saveCoinGeckoKey({
      file,
      ask: typing(['good-key', 'pw', 'pw']),
      fetch: standInFetch(answerPing),
      say: () => {}
    });
    assert.equal(saved, 'good-key');
    assert.equal(await loadEncryptedKey(file, COINGECKO_SERVICE, 'pw'), 'good-key');
    setApiKey(COINGECKO_SERVICE, null);
    const fetch = standInFetch(answerPing);
    assert.equal(await unlockCoinGeckoKey({ file, ask: typing(['pw']), fetch }), 'good-key');
    assert.equal(getApiKey(COINGECKO_SERVICE), 'good-key');
    assert.equal(fetch.requests.length, 1);
  });

  it('stop the run when CoinGecko refuses the saved key, naming the command that saves a new one', async () => {
    const file = newKeyFile();
    await saveEncryptedKey(file, COINGECKO_SERVICE, 'stale-key', 'pw');
    await assert.rejects(unlockCoinGeckoKey({ file, ask: typing(['pw']), fetch: standInFetch(answerPing) }), {
      keyRefused: true,
      message: `CoinGecko refused the api key saved in ${file}. Save a new one: ${SAVE_COMMAND}`
    });
  });

  it('name the command that saves a key so that it runs from any folder', () => {
    assert.equal(SAVE_COMMAND, `node "${path.join(REPO_TOP, 'save-api-key.js')}" coingecko`);
  });
});

describe('save-api-key.js, the command line', () => {
  /**
   * Runs the command line with stand-ins.
   *
   * @param {string[]} args - The arguments after the file's name
   * @param {Object} deps - The stand-ins (`runSaveApiKey`), stdout and stderr aside
   * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>} What it did
   */
  async function run(args, deps) {
    const stdout = capturedOutput();
    const stderr = capturedOutput();
    const exitCode = await runSaveApiKey(['node', 'save-api-key.js', ...args], { ...deps, stdout, stderr });
    return { exitCode, stdout: stdout.text, stderr: stderr.text };
  }

  it('saves the CoinGecko key, saying where, with exit code 0', async () => {
    const file = newKeyFile();
    const result = await run(['coingecko'], { file, ask: typing(['good-key', 'pw', 'pw']), fetch: standInFetch(answerPing) });
    assert.deepEqual(result, {
      exitCode: 0,
      stdout: `The CoinGecko api key is saved in ${file}, encrypted with that password.\n`,
      stderr: ''
    });
    assert.equal(await loadEncryptedKey(file, COINGECKO_SERVICE, 'pw'), 'good-key');
  });

  it('saves nothing when CoinGecko refuses the key, saying so on stderr, with exit code 1', async () => {
    const file = newKeyFile();
    const result = await run(['coingecko'], { file, ask: typing(['stale-key', 'pw', 'pw']), fetch: standInFetch(answerPing) });
    assert.deepEqual(result, {
      exitCode: 1,
      stdout: '',
      stderr: 'CoinGecko refused the api key, so it was not saved. Enter the key as CoinGecko shows it.\n'
    });
    assert.equal(fs.existsSync(file), false);
  });

  it('refuses a service it keeps no key for', async () => {
    const result = await run(['dexscreener'], { ask: typing([]) });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Allowed choices are coingecko/);
  });

  it('answers --help on stdout, with exit code 0, asking nothing', async () => {
    const result = await run(['--help'], { ask: typing([]) });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Usage: save-api-key \[options\] <service>/);
    assert.match(result.stdout, /Exit codes:/);
  });

  it('runs as a program: node save-api-key.js --help', () => {
    const output = execFileSync(process.execPath, [path.join(REPO_TOP, 'save-api-key.js'), '--help'], {
      encoding: 'utf8',
      timeout: 15000
    });
    assert.match(output, /Usage: save-api-key/);
  });
});
