/**
 * Regression tests: XTM is priced from CoinGecko under Minotari's CoinGecko id.
 * @module tests/xtm-coingecko-id.test
 *
 * When MEXC has no XTM candle for a row, both tools in this folder fall back
 * to CoinGecko, which they ask for a coin by its CoinGecko id. Minotari's id
 * is `minotari`, the "API ID" on its CoinGecko page; the page's own address,
 * `/en/coins/minotari-tari`, is not the id. Under any other id CoinGecko
 * gives no Minotari price, and the row stays unpriced.
 *
 * The Node tool takes the id from the shipped `supported-tokens.json`, so the
 * first test drives the real provider chain (`getCryptoPrice`, then MEXC, then
 * CoinGecko) over that file, with only the http layer, `fetchWithRetry`,
 * standing in for the services. The Sheets script keeps its own table,
 * `TOKEN_TO_ID`, so the second test loads
 * `getCryptoPriceFromCentralizedExchange.gs` unchanged into a Node `vm`
 * context, with stand-ins for the Apps Script services it calls, and runs its
 * provider chain the same way.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { getCryptoPrice } from '../sources/price.js';
import * as fetchUtils from '../utils/fetch.js';

vi.mock('../utils/fetch.js', () => {
  const mockFn = vi.fn();
  return {
    fetchWithRetry: mockFn,
    default: mockFn
  };
});

const mockFetchWithRetry = vi.mocked(fetchUtils.fetchWithRetry);

const SHEETS_SCRIPT_PATH = path.resolve(__dirname, '../../getCryptoPriceFromCentralizedExchange.gs');
const ROW_UTC_MS = Date.UTC(2025, 5, 15, 12, 30, 0);
const MINOTARI_PRICE = 0.0123;

/**
 * Says what the price services answer for one url on a day MEXC has no XTM
 * candle. MEXC lists the XTMUSDT pair but returns no candles. CoinGecko lists
 * no USD ticker for Minotari, whose markets are USDT pairs, and gives its
 * price only under the id `minotari`. Any other url gets no answer, as a 404
 * gives none.
 *
 * @param {string} url - The requested url
 * @returns {Object|Array|null} The json body, or null for no answer
 */
function answerWithoutMexcCandle(url) {
  if (url.includes('/exchangeInfo')) {
    return { symbols: [{ symbol: 'XTMUSDT', baseAsset: 'XTM', quoteAsset: 'USDT' }] };
  }
  if (url.includes('/klines')) return [];
  if (url.includes('/coins/minotari/tickers')) return { tickers: [] };
  if (url.includes('/coins/minotari/history')) {
    return { market_data: { current_price: { usd: MINOTARI_PRICE } } };
  }
  if (url.includes('/coins/minotari/market_chart/range')) {
    return { prices: [[ROW_UTC_MS - 3600000, 0.012], [ROW_UTC_MS, MINOTARI_PRICE]] };
  }
  return null;
}

/**
 * Loads the Sheets script, unchanged, into a fresh Node `vm` context and
 * returns that context, whose globals are the script's top-level functions.
 * The Apps Script services the script calls are stand-ins: `UrlFetchApp`
 * answers each url from `answer`, where null reads as a 404; the cache starts
 * empty; the lock is always free; and sleeps return at once.
 *
 * @param {function(string): (Object|Array|null)} answer - The json body for a url, or null
 * @returns {Object} The context holding the script's functions
 */
function loadSheetsScript(answer) {
  const cache = new Map();
  const pad = (n) => String(n).padStart(2, '0');
  const context = vm.createContext({
    Logger: { log() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => cache.get(key) ?? null,
        put: (key, value) => { cache.set(key, value); },
        remove: (key) => { cache.delete(key); }
      })
    },
    Utilities: {
      sleep() {},
      formatDate: (date, zone, format) => {
        if (zone !== 'UTC' || format !== 'dd-MM-yyyy') {
          throw new Error(`The stand-in formatDate has no ${zone} ${format}`);
        }
        return `${pad(date.getUTCDate())}-${pad(date.getUTCMonth() + 1)}-${date.getUTCFullYear()}`;
      }
    },
    UrlFetchApp: {
      fetch: (url) => {
        const body = answer(url);
        return {
          getResponseCode: () => (body === null ? 404 : 200),
          getContentText: () => JSON.stringify(body)
        };
      }
    }
  });
  vm.runInContext(fs.readFileSync(SHEETS_SCRIPT_PATH, 'utf8'), context);
  return context;
}

describe("XTM priced from CoinGecko under Minotari's id", () => {
  beforeEach(() => {
    mockFetchWithRetry.mockReset();
    mockFetchWithRetry.mockImplementation(async (url) => {
      const body = answerWithoutMexcCandle(url);
      return body === null ? null : { ok: true, status: 200, json: async () => body };
    });
  });

  it('the Node tool prices an XTM row from CoinGecko when MEXC has no candle', async () => {
    const price = await getCryptoPrice('xtm', '2025-06-15 12:30:00', 'UTC', 'close', false, new Map());
    const coinGeckoUrls = mockFetchWithRetry.mock.calls
      .map(([url]) => url)
      .filter((url) => url.includes('api.coingecko.com'));

    expect(coinGeckoUrls.some((url) => url.includes('/coins/minotari/'))).toBe(true);
    expect(price).toBe(MINOTARI_PRICE);
  });

  it('the Sheets script prices an XTM row from CoinGecko when MEXC has no candle', () => {
    const asked = [];
    const sheets = loadSheetsScript((url) => {
      asked.push(url);
      return answerWithoutMexcCandle(url);
    });
    const price = sheets.fetchPriceFromProviders('xtm', ROW_UTC_MS, 'high');

    expect(asked.some((url) => url.includes('/coins/minotari/'))).toBe(true);
    expect(price).toBe(MINOTARI_PRICE);
  });
});
