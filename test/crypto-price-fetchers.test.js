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
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCryptoPriceFetchers, runCommandLine } from '../crypto-price-fetchers.js';
import { capturedOutput } from './helpers/captured-output.js';
import { standInFetch } from './helpers/stand-in-web.js';

const DEXTOOLS = 'https://public-api.dextools.io/standard/v2';
const X1_NINJA = 'https://api.x1.ninja/v1';
const TOKEN = '0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39';
const POOL = '0x69D91B94f0AaF8e8A2586909fA77A5c2c89818d5';
const X1_POOL = 'CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR';
const X1_MINT = 'So11111111111111111111111111111111111111112';
const KEYS = { CONFIG: { API_KEY: 'dextools-key' }, X1_CONFIG: { API_KEY: 'x1-ninja-key' } };

/**
 * Answers as DexTools and x1.ninja do for the tests' token and pools.
 *
 * @param {{url: string}} request - The request
 * @returns {Object|null} The json body, or null for a 404
 */
function answerAsDexToolsAndX1Ninja({ url }) {
  if (url === `${DEXTOOLS}/token/ether/${TOKEN}/price`) return { statusCode: 200, data: { price: 1.23 } };
  if (url === `${DEXTOOLS}/pool/ether/${POOL}/price`) return { statusCode: 200, data: { price: 4.56 } };
  if (url === `${DEXTOOLS}/token/pulse/${TOKEN}/info`) return { statusCode: 200, data: { fdv: 5000000 } };
  if (url === `${X1_NINJA}/pools/${X1_POOL}`) return { pool: { address: X1_POOL, priceUsd: '0.27', fdv: 123456 } };
  return null;
}

/**
 * Opens the Node version with the tests' keys and the stand-in fetch, runs
 * `use` on it, and closes it.
 *
 * @param {function(Object, function): Promise<void>} use - Takes the open functions and the stand-in fetch
 * @param {Object} [config=KEYS] - The config values
 * @returns {Promise<void>} Settles once closed
 */
async function withFetchers(use, config = KEYS) {
  const fetch = standInFetch(answerAsDexToolsAndX1Ninja);
  const fetchers = await openCryptoPriceFetchers({ config, fetch });
  try {
    await use(fetchers, fetch);
  } finally {
    await fetchers.close();
  }
}

describe('openCryptoPriceFetchers', () => {
  it('prices a token from DexTools, sending the DexTools key from the config', async () => {
    await withFetchers(async (fetchers, fetch) => {
      assert.equal(await fetchers.dexToolsGetTokenPrice('ether', TOKEN), 1.23);
      assert.equal(fetch.requests[0].headers['x-api-key'], 'dextools-key');
    });
  });

  it('prices a token in the pool given, as a Sheets range gives it', async () => {
    await withFetchers(async (fetchers) => {
      assert.equal(await fetchers.dexToolsGetTokenPrice('ether', TOKEN, [[POOL, 0]]), 4.56);
    });
  });

  it("gives a token's FDV from DexTools", async () => {
    await withFetchers(async (fetchers) => {
      assert.equal(await fetchers.dexToolsGetTokenFDV('pulse', TOKEN), 5000000);
    });
  });

  it('prices an X1 pool through x1.ninja, sending the x1.ninja key from the config', async () => {
    await withFetchers(async (fetchers, fetch) => {
      assert.equal(await fetchers.dexToolsGetTokenPrice('x1', X1_MINT, [[X1_POOL, 0]]), 0.27);
      assert.equal(fetch.requests[0].headers.authorization, 'Bearer x1-ninja-key');
    });
  });

  it('gives 0 when DexTools has no price for the token, as the sheet does', async () => {
    await withFetchers(async (fetchers) => {
      assert.equal(await fetchers.dexToolsGetTokenPrice('bsc', TOKEN), 0);
    });
  });

  it('sends the key written in the script when the config sets none', async () => {
    await withFetchers(async (fetchers, fetch) => {
      await fetchers.dexToolsGetTokenPrice('ether', TOKEN);
      assert.equal(fetch.requests[0].headers['x-api-key'], 'paste_your_dextools_api_key_here');
    }, {});
  });

  it("opens with config-example.json, whose fields are all the script's", async () => {
    const example = fileURLToPath(new URL('../config-example.json', import.meta.url));
    const fetchers = await openCryptoPriceFetchers({ configFile: example, fetch: standInFetch(() => null) });
    await fetchers.close();
  });
});

describe('crypto-price-fetchers.js, the command line', () => {
  let folder;
  let configFile;

  before(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-price-fetchers-test-cli-'));
    configFile = path.join(folder, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify(KEYS));
  });

  after(() => {
    fs.rmSync(folder, { recursive: true, force: true });
  });

  /**
   * Runs the command line with the stand-in fetch.
   *
   * @param {string[]} args - The arguments after the file's name
   * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>} What it did
   */
  async function run(args) {
    const stdout = capturedOutput();
    const stderr = capturedOutput();
    const exitCode = await runCommandLine(['node', 'crypto-price-fetchers.js', ...args], {
      fetch: standInFetch(answerAsDexToolsAndX1Ninja),
      stdout,
      stderr
    });
    return { exitCode, stdout: stdout.text, stderr: stderr.text };
  }

  it('prints the price, with exit code 0', async () => {
    assert.deepEqual(await run(['price', 'ether', TOKEN, '--config', configFile]), {
      exitCode: 0,
      stdout: '1.23\n',
      stderr: ''
    });
  });

  it("prints an X1 pool's FDV", async () => {
    const result = await run(['fdv', 'x1', X1_MINT, '--pool', X1_POOL, '--config', configFile]);
    assert.equal(result.stdout, '123456\n');
    assert.equal(result.exitCode, 0);
  });

  it("shows the script's log on stderr with --verbose", async () => {
    const result = await run(['price', 'ether', TOKEN, '--config', configFile, '--verbose']);
    assert.match(result.stderr, /^log: \[PRICE\] Fetching: https:\/\/public-api\.dextools\.io/m);
    assert.equal(result.stdout, '1.23\n');
  });

  it('answers --help on stdout, with exit code 0', async () => {
    const result = await run(['--help']);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Usage: crypto-price-fetchers/);
    assert.match(result.stdout, /price .*<chain> <token>/);
    assert.match(result.stdout, /fdv .*<chain> <token>/);
    assert.match(result.stdout, /Exit codes:/);
    assert.equal(result.stderr, '');
  });

  it('refuses a missing argument on stderr, with exit code 1', async () => {
    const result = await run(['price', 'ether', '--config', configFile]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /missing required argument 'token'/);
  });

  it('refuses an empty argument, naming it', async () => {
    const result = await run(['price', ' ', TOKEN, '--config', configFile]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /is invalid for argument 'chain'\. It is empty\./);
  });

  it('refuses a config file named on purpose that is missing', async () => {
    const result = await run(['price', 'ether', TOKEN, '--config', path.join(folder, 'missing.json')]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Cannot read the config file/);
  });

  it('runs as a program: node crypto-price-fetchers.js --help', () => {
    const file = fileURLToPath(new URL('../crypto-price-fetchers.js', import.meta.url));
    const output = execFileSync(process.execPath, [file, '--help'], { encoding: 'utf8', timeout: 15000 });
    assert.match(output, /Usage: crypto-price-fetchers/);
  });
});
