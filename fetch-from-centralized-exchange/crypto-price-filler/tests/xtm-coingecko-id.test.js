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
 * `TOKEN_TO_ID`, so the second test runs
 * `getCryptoPriceFromCentralizedExchange.gs` unchanged under Node, with
 * stand-ins for the Apps Script services it calls, and drives its provider
 * chain the same way. Both stand-ins are in `tests/helpers/`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { getCryptoPrice } from '../sources/price.js';
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

describe("XTM priced from CoinGecko under Minotari's id", () => {
  beforeEach(() => {
    mockFetchWithRetry.mockReset();
    mockFetchWithRetry.mockImplementation(answeringFetchWithRetry(answerWithoutMexcCandle));
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
    const sheets = loadSheetsScript(SHEETS_SCRIPT_PATH, (url) => {
      asked.push(url);
      return answerWithoutMexcCandle(url);
    });
    const price = sheets.fetchPriceFromProviders('xtm', ROW_UTC_MS, 'high');

    expect(asked.some((url) => url.includes('/coins/minotari/'))).toBe(true);
    expect(price).toBe(MINOTARI_PRICE);
  });
});
