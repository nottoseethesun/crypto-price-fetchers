/**
 * Tests for fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js,
 * the Node version of getCryptoPriceFromCentralizedExchange.gs (item 15).
 * @module test/get-crypto-price-from-centralized-exchange.test
 *
 * The real `.gs` runs under the real runner. Its requests go to a stand-in
 * fetch (`helpers/stand-in-web.js`) that answers as MEXC and CoinGecko
 * answer, so the tests ask nothing outside the computer. The script waits
 * its 200 milliseconds before each lookup, as in the sheet.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openCentralizedExchangePrices,
  runCommandLine
} from '../fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js';
import { capturedOutput } from './helpers/captured-output.js';
import { standInFetch } from './helpers/stand-in-web.js';

const MEXC = 'https://api.mexc.com/api/v3';
const COINGECKO = 'https://api.coingecko.com/api/v3';

/** 12:30 UTC on 2025-06-15, the time the tests ask about. */
const ROW_UTC_MS = Date.UTC(2025, 5, 15, 12, 30, 0);
const ROW_TIME = '2025-06-15 12:30:00';

/**
 * Answers as MEXC does for XTM, a pair it lists: one candle per request,
 * with open 1.00, high 1.50, low 0.80 and close 1.10.
 *
 * @param {{url: string}} request - The request
 * @returns {Object|Array|null} The json body, or null for a 404
 */
function answerMexcCandle({ url }) {
  if (url === `${MEXC}/exchangeInfo`) return { symbols: [{ symbol: 'XTMUSDT', baseAsset: 'XTM', quoteAsset: 'USDT' }] };
  if (url.startsWith(`${MEXC}/klines?symbol=XTMUSDT&interval=1m&`)) {
    return [[ROW_UTC_MS - 30000, '1.00', '1.50', '0.80', '1.10', '10']];
  }
  return null;
}

/**
 * Answers for when MEXC lists no XTM pair and CoinGecko's hourly prices
 * around the time are 2.00 and 2.50.
 *
 * @param {{url: string}} request - The request
 * @returns {Object|null} The json body, or null for a 404
 */
function answerCoinGeckoRange({ url }) {
  if (url === `${MEXC}/exchangeInfo`) return { symbols: [] };
  if (url.startsWith(`${COINGECKO}/coins/minotari/market_chart/range?`)) {
    return { prices: [[ROW_UTC_MS - 3600000, 2.0], [ROW_UTC_MS + 3600000, 2.5]] };
  }
  return null;
}

/**
 * Opens the Node version with a stand-in fetch, runs `use` on it, and
 * closes it.
 *
 * @param {function({url: string}): *} answer - The stand-in's answers
 * @param {function(Object, function): Promise<void>} use - Takes the open function and the stand-in fetch
 * @param {Object} [config={}] - The config values
 * @returns {Promise<void>} Settles once closed
 */
async function withPrices(answer, use, config = {}) {
  const fetch = standInFetch(answer);
  const prices = await openCentralizedExchangePrices({ config, fetch });
  try {
    await use(prices, fetch);
  } finally {
    await prices.close();
  }
}

describe('openCentralizedExchangePrices', () => {
  it("gives the high of MEXC's candle for the time", async () => {
    await withPrices(answerMexcCandle, async (prices) => {
      assert.equal(await prices.getCryptoPrice('xtm', ROW_TIME, 'UTC', 'high'), 1.5);
    });
  });

  it("gives the low of MEXC's candle for the time", async () => {
    await withPrices(answerMexcCandle, async (prices) => {
      assert.equal(await prices.getCryptoPrice('xtm', ROW_TIME, 'UTC', 'low'), 0.8);
    });
  });

  it('takes the time as a Date, as a date cell gives it', async () => {
    await withPrices(answerMexcCandle, async (prices) => {
      assert.equal(await prices.getCryptoPrice('xtm', new Date(ROW_UTC_MS), 'UTC', 'high'), 1.5);
    });
  });

  it("falls back to CoinGecko's hourly prices, sending the CoinGecko key from the config", async () => {
    const config = { CONFIG: { COINGECKO_API_KEY: 'gecko-key' } };
    await withPrices(
      answerCoinGeckoRange,
      async (prices, fetch) => {
        assert.equal(await prices.getCryptoPrice('xtm', ROW_TIME, 'UTC', 'high'), 2.5);
        const range = fetch.requests.find((request) => request.url.includes('/market_chart/range?'));
        assert.match(range.url, /&x_cg_demo_api_key=gecko-key$/);
      },
      config
    );
  });

  it('gives the message the cell would show when no source has a price', async () => {
    await withPrices(
      () => null,
      async (prices) => {
        assert.equal(await prices.getCryptoPrice('xtm', ROW_TIME, 'UTC', 'high'), 'No data available from any source');
      }
    );
  });

  it("opens with config-example.json, whose fields are all the script's", async () => {
    const example = fileURLToPath(new URL('../fetch-from-centralized-exchange/config-example.json', import.meta.url));
    const prices = await openCentralizedExchangePrices({ configFile: example, fetch: standInFetch(() => null) });
    await prices.close();
  });
});

describe('getCryptoPriceFromCentralizedExchange.js, the command line', () => {
  let folder;
  let configFile;

  before(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-price-fetchers-test-cex-'));
    configFile = path.join(folder, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ CONFIG: { COINGECKO_API_KEY: 'gecko-key' } }));
  });

  after(() => {
    fs.rmSync(folder, { recursive: true, force: true });
  });

  /**
   * Runs the command line with a stand-in fetch.
   *
   * @param {string[]} args - The arguments after the file's name
   * @param {function({url: string}): *} [answer=answerMexcCandle] - The stand-in's answers
   * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>} What it did
   */
  async function run(args, answer = answerMexcCandle) {
    const stdout = capturedOutput();
    const stderr = capturedOutput();
    const argv = ['node', 'getCryptoPriceFromCentralizedExchange.js', ...args, '--config', configFile];
    const exitCode = await runCommandLine(argv, { fetch: standInFetch(answer), stdout, stderr });
    return { exitCode, stdout: stdout.text, stderr: stderr.text };
  }

  it('prints the high in UTC unless told otherwise, with exit code 0', async () => {
    assert.deepEqual(await run(['xtm', ROW_TIME]), { exitCode: 0, stdout: '1.5\n', stderr: '' });
  });

  it('prints the low with --mode low', async () => {
    assert.deepEqual(await run(['xtm', ROW_TIME, '--mode', 'low', '--tz', 'UTC']), {
      exitCode: 0,
      stdout: '0.8\n',
      stderr: ''
    });
  });

  it("prints the script's message on stderr when there is no price, with exit code 1", async () => {
    assert.deepEqual(await run(['xtm', ROW_TIME], () => null), {
      exitCode: 1,
      stdout: '',
      stderr: 'No data available from any source\n'
    });
  });

  it('refuses a mode other than high or low', async () => {
    const result = await run(['xtm', ROW_TIME, '--mode', 'middle']);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Allowed choices are high, low/);
  });

  it('answers --help on stdout, with exit code 0', async () => {
    const result = await run(['--help']);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Usage: getCryptoPriceFromCentralizedExchange \[options\] <token> <date>/);
    assert.match(result.stdout, /Exit codes:/);
  });

  it('runs as a program: node getCryptoPriceFromCentralizedExchange.js --help', () => {
    const file = fileURLToPath(
      new URL('../fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js', import.meta.url)
    );
    const output = execFileSync(process.execPath, [file, '--help'], { encoding: 'utf8', timeout: 15000 });
    assert.match(output, /Usage: getCryptoPriceFromCentralizedExchange/);
  });
});
