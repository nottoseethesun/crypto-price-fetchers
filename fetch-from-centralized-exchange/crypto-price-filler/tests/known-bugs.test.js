/**
 * Known bugs in the Node tool and its Sheets script, as tests.
 * @module tests/known-bugs.test
 *
 * Each test states what the tool should do and is declared with `it.fails`:
 * vitest passes it while the tool still does the wrong thing, and fails it
 * once the tool does the right thing. That failure is the cue to declare the
 * test with `it` instead, in the same change as the fix, so it then guards
 * the fix. The item numbers are those of the list of known bugs in the
 * repo's CLAUDE.md.
 *
 * The tests drive the real code, with the price services standing in at the
 * http layer (see `tests/helpers/`): `fetchWithRetry` for the Node tool's
 * functions, a preloaded fetch for its command line, run in a child process,
 * and `UrlFetchApp` for the Sheets script, which runs unchanged under Node.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { getPriceFromMEXC } from '../sources/mexc.js';
import { getPriceFromCoinGecko } from '../sources/coingecko.js';
import { getCryptoPrice } from '../sources/price.js';
import { getTimezoneOffsetHours, parseInputToUtcMs } from '../utils/date.js';
import * as fetchUtils from '../utils/fetch.js';
import { answeringFetchWithRetry } from './helpers/fetch-with-retry.js';
import { loadSheetsScript } from './helpers/sheets-script.js';

vi.mock('../utils/fetch.js', () => {
  const mockFn = vi.fn();
  return {
    fetchWithRetry: mockFn,
    default: mockFn
  };
});

const mockFetchWithRetry = vi.mocked(fetchUtils.fetchWithRetry);

const FILLER_DIR = path.resolve(__dirname, '..');
const SHEETS_SCRIPT_PATH = path.resolve(__dirname, '../../getCryptoPriceFromCentralizedExchange.gs');
const PRELOAD_URL = pathToFileURL(path.resolve(__dirname, 'helpers/stand-in-fetch-preload.js')).href;

const ROW_UTC_MS = Date.UTC(2025, 5, 15, 12, 30, 0);
const PAST_UTC_MS = Date.UTC(2025, 2, 15, 3, 0, 0);
const LIVE_PRICE = 9.99;
const DATED_PRICE = 1.23;

/**
 * Answers as MEXC does for XTM, a pair it lists: one candle per request,
 * with open 1.00, high 1.50, low 0.80 and close 1.10.
 *
 * @param {string} url - The requested url
 * @returns {Object|Array|null} The json body, or null for a 404
 */
function answerMexcCandle(url) {
  if (url.includes('/exchangeInfo')) {
    return { symbols: [{ symbol: 'XTMUSDT', baseAsset: 'XTM', quoteAsset: 'USDT' }] };
  }
  if (url.includes('/klines')) return [[ROW_UTC_MS - 30000, '1.00', '1.50', '0.80', '1.10', '10']];
  return null;
}

/**
 * Answers for a coin MEXC does not list and CoinGecko lists against USD,
 * as it does Tezos: CoinGecko's live ticker says 9.99, and its price for
 * the day asked says 1.23. Its hourly range has no prices, so the Sheets
 * script falls back from it. The tickers carry both the Node tool's field
 * (`last`) and the Sheets script's (`converted_last`).
 *
 * @param {string} url - The requested url
 * @returns {Object|null} The json body, or null for a 404
 */
function answerCoinGeckoWithUsdTicker(url) {
  if (url.includes('/exchangeInfo')) return { symbols: [] };
  if (url.includes('/market_chart/range')) return { prices: [] };
  if (url.includes('/tickers')) {
    return {
      tickers: [{ target: 'USD', last: LIVE_PRICE, converted_last: { usd: LIVE_PRICE }, volume: 100, is_stale: false }]
    };
  }
  if (url.includes('/history')) return { market_data: { current_price: { usd: DATED_PRICE } } };
  return null;
}

/**
 * Runs the command line, `index.js`, over one XTM row (12:30 on 2025-06-15)
 * in a child process, with the stand-in MEXC of
 * `helpers/stand-in-fetch-preload.js`, in a temp folder removed afterwards.
 *
 * @param {string[]} options - Options beyond --token, --input and --output
 * @returns {{price: string, candleUtc: string}} The row's price as written, and the UTC end time of the candle asked for
 */
function runCommandLineForOneRow(options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-price-filler-test-'));
  try {
    const input = path.join(dir, 'in.csv');
    const output = path.join(dir, 'out.csv');
    const askedPath = path.join(dir, 'asked.json');
    fs.writeFileSync(input, 'date (UTC),amount,description\n2025-06-15 12:30:00,10,one XTM reward\n');
    execFileSync(
      process.execPath,
      ['--import', PRELOAD_URL, 'index.js', '--token=xtm', `--input=${input}`, `--output=${output}`, ...options],
      { cwd: FILLER_DIR, env: { ...process.env, NODE_ENV: 'test', STAND_IN_ASKED: askedPath }, stdio: 'pipe' }
    );
    const row = fs.readFileSync(output, 'utf8').trim().split('\n')[1].split(',');
    const candleUrl = JSON.parse(fs.readFileSync(askedPath, 'utf8')).find((url) => url.includes('/klines'));
    const candleUtc = new Date(Number(new URL(candleUrl).searchParams.get('endTime'))).toISOString();
    return { price: row[3], candleUtc };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Calls a Sheets script function and gives back its result, or the error it
 * threw, since Sheets shows a thrown error in the cell as an error.
 *
 * @param {function(): *} call - The call
 * @returns {*} The result, or the error thrown
 */
function resultOrError(call) {
  try {
    return call();
  } catch (error) {
    return error;
  }
}

describe('known bugs', () => {
  beforeEach(() => {
    mockFetchWithRetry.mockReset();
  });

  describe('item 1: close mode returns the candle close, not its high', () => {
    it.fails('MEXC, in close mode, gives the candle close', async () => {
      mockFetchWithRetry.mockImplementation(answeringFetchWithRetry(answerMexcCandle));
      expect(await getPriceFromMEXC('xtm', ROW_UTC_MS, 'close')).toBe(1.1);
    });

    it.fails('the provider chain, in close mode, gives the candle close', async () => {
      mockFetchWithRetry.mockImplementation(answeringFetchWithRetry(answerMexcCandle));
      expect(await getCryptoPrice('xtm', '2025-06-15 12:30:00', 'UTC', 'close', false, new Map())).toBe(1.1);
    });

    it.fails('the command line, with --mode=close, writes the candle close', () => {
      expect(runCommandLineForOneRow(['--mode=close', '--tz=UTC']).price).toBe('1.1');
    });
  });

  describe('item 2: a past date gets the price of that day, not the live one', () => {
    it.fails('CoinGecko gives its price for 2025-03-15', async () => {
      mockFetchWithRetry.mockImplementation(answeringFetchWithRetry(answerCoinGeckoWithUsdTicker));
      expect(await getPriceFromCoinGecko('xtz', PAST_UTC_MS, 'close', false, 'tezos')).toBe(DATED_PRICE);
    });

    it.fails('the provider chain gives the price for 2025-03-15 when MEXC lacks the pair', async () => {
      mockFetchWithRetry.mockImplementation(answeringFetchWithRetry(answerCoinGeckoWithUsdTicker));
      expect(await getCryptoPrice('xtz', '2025-03-15 03:00:00', 'UTC', 'close', false, new Map())).toBe(DATED_PRICE);
    });

    it.fails("the Sheets script gives the day's price once CoinGecko's hourly range is empty", () => {
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, answerCoinGeckoWithUsdTicker);
      expect(script.getPriceFromCoinGecko('tezos', PAST_UTC_MS, 'high')).toBeCloseTo(DATED_PRICE * 1.015, 10);
    });
  });

  describe("item 3: CoinGecko's day is the UTC day, whatever the computer's clock", () => {
    it.fails('on a computer set to Chicago time, 03:00 UTC on 2025-03-15 asks for 15-03-2025', async () => {
      mockFetchWithRetry.mockImplementation(
        answeringFetchWithRetry((url) => (url.includes('/tickers') ? { tickers: [] } : null))
      );
      const zone = process.env.TZ;
      /*-
       *  TEST-ONLY global swap: the day under test comes from the time zone
       *  the computer is set to, and the tool offers no seam for it.
       *  Restored pristine in the `finally` below, immediately after the call
       *  that needed it.
       */
      process.env.TZ = 'America/Chicago';
      try {
        await getPriceFromCoinGecko('xtz', PAST_UTC_MS, 'close', false, 'tezos');
      } finally {
        if (zone === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = zone;
        }
      }
      const days = mockFetchWithRetry.mock.calls
        .map(([url]) => url)
        .filter((url) => url.includes('/history'))
        .map((url) => new URL(url).searchParams.get('date'));
      expect(days).not.toHaveLength(0);
      for (const day of days) expect(day).toBe('15-03-2025');
    });
  });

  describe('item 4: rows are read in the time zone named, daylight saving included', () => {
    it.fails('Chicago time reads as UTC-5 in March and UTC-6 in January', () => {
      const offset = getTimezoneOffsetHours('America/Chicago');
      expect(new Date(parseInputToUtcMs('2025-03-15 21:00:00', offset)).toISOString()).toBe('2025-03-16T02:00:00.000Z');
      expect(new Date(parseInputToUtcMs('2025-01-15 12:00:00', offset)).toISOString()).toBe('2025-01-15T18:00:00.000Z');
    });

    it.fails('a time zone the tool does not know is refused, not read as UTC', () => {
      expect(() => getTimezoneOffsetHours('CTS')).toThrow();
    });

    it.fails('the command line, with --tz=America/Chicago, asks for the candle at 17:30 UTC', () => {
      expect(runCommandLineForOneRow(['--mode=high', '--tz=America/Chicago']).candleUtc).toBe('2025-06-15T17:30:00.000Z');
    });

    it.fails('the Sheets script gives no price for a time zone it does not know', () => {
      const script = loadSheetsScript(SHEETS_SCRIPT_PATH, answerMexcCandle);
      const result = resultOrError(() => script.getCryptoPrice('xtm', '2025-06-15 12:30:00', 'CTS', 'high', 0));
      expect(typeof result).not.toBe('number');
    });
  });

  describe('item 5: no CoinGecko api key committed', () => {
    /*-
     *  The fix moves the Node tool's key out of the tracked config.json into
     *  a gitignored one, which may then hold a real key on this computer, so
     *  only the Sheets script is checked here.
     */
    it.fails('the Sheets script carries no CoinGecko api key', () => {
      expect(fs.readFileSync(SHEETS_SCRIPT_PATH, 'utf8')).not.toMatch(/CG-[A-Za-z0-9]{20,}/);
    });
  });
});
