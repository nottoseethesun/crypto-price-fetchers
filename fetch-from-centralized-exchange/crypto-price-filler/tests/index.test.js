import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import {
  getTimezoneOffsetHours,
  parseInputToUtcMs
} from '../utils/date.js';
import { getCryptoPrice } from '../sources/price.js'; // the wrapper
import { getCache, setCache } from '../utils/cache.js';
import * as fetchUtils from '../utils/fetch.js'; // for mocking fetchWithRetry
import fs from 'fs';
import { parse as csvParse } from 'csv-parse/sync';

const verbose = process.env.VERBOSE === '1';

// Mock supports BOTH named and default import styles
vi.mock('../utils/fetch.js', () => {
  const mockFn = vi.fn();
  return {
    fetchWithRetry: mockFn,           // for named import { fetchWithRetry }
    default: mockFn                   // for default import fetchWithRetry from ...
  };
});

const mockFetchWithRetry = vi.mocked(fetchUtils.fetchWithRetry);  // works for named
// If needed for default: vi.mocked(fetchUtils.default)

let originalCache;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers(); // Fake timers for backoff simulation
  originalCache = getCache();
  const freshCache = new Map();
  setCache(freshCache);
  // Force the source code to see this exact cache instance
  globalThis.__crypto_price_cache__ = freshCache;

  // Debug: confirm keys right after set
  console.log('[TEST CACHE] Keys after set:', Array.from(getCache().keys()));

  // Safety net: fail loudly on unexpected real network call in test
  mockFetchWithRetry.mockImplementation(() => {
    throw new Error('Unexpected real network call in test – check mock setup');
  });
});

afterEach(() => {
  vi.useRealTimers();
  setCache(originalCache);
});

describe('Crypto Price Filler Helpers', () => {
  describe('getTimezoneOffsetHours', () => {
    it('returns correct offset for known timezones', () => {
      expect(getTimezoneOffsetHours('CDT')).toBe(-5);
      expect(getTimezoneOffsetHours('UTC')).toBe(0);
      expect(getTimezoneOffsetHours('PST')).toBe(-8);
      expect(getTimezoneOffsetHours('EDT')).toBe(-4);
    });

    it('returns 0 for unknown/empty timezone', () => {
      expect(getTimezoneOffsetHours('INVALID')).toBe(0);
      expect(getTimezoneOffsetHours('')).toBe(0);
      expect(getTimezoneOffsetHours(null)).toBe(0);
    });
  });

  describe('parseInputToUtcMs', () => {
    it('parses valid date in UTC (offset 0)', () => {
      if (verbose) console.log('[TEST] Starting UTC offset 0 parse test');
      const result = parseInputToUtcMs('2025-12-19 00:17:00', 0, verbose);
      expect(result).toBeTypeOf('number');
      const dt = DateTime.fromMillis(result, { zone: 'utc' });
      if (verbose) console.log('[TEST] Parsed UTC time (offset 0):', dt.toISO());
      expect(dt.year).toBe(2025);
      expect(dt.month).toBe(12);
      expect(dt.day).toBe(19);
      expect(dt.hour).toBe(0);
      expect(dt.minute).toBe(17);
    });

    it('correctly applies negative offset (CDT = -5)', () => {
      if (verbose) console.log('[TEST] Starting CDT offset -5 parse test');
      const result = parseInputToUtcMs('2025-12-19 00:17:00', -5, verbose);
      expect(result).toBeTypeOf('number');
      const dt = DateTime.fromMillis(result, { zone: 'utc' });
      if (verbose) console.log('[TEST] Parsed UTC time (CDT adjusted):', dt.toISO());
      expect(dt.hour).toBe(5);
      expect(dt.minute).toBe(17);
    });

    it('returns null for invalid date', () => {
      if (verbose) console.log('[TEST] Testing invalid date');
      expect(parseInputToUtcMs('invalid', 0, verbose)).toBeNull();
      expect(parseInputToUtcMs('', 0, verbose)).toBeNull();
    });
  });

  describe('getCryptoPrice', () => {
    it('returns cached price if available', async () => {
      if (verbose) console.log('[TEST] Setting cache for cached price test');

      // Create and set cache explicitly for this test
      const testCache = new Map();
      testCache.set('price_xtm_20251219001700_UTC_high', 42.5);

      // Debug: confirm set worked in this scope
      console.log('[TEST CACHE] Keys in test scope:', Array.from(testCache.keys()));

      mockFetchWithRetry.mockResolvedValue({ ok: false });

      if (verbose) console.log('[TEST] Calling getCryptoPrice with explicit cache');

      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose, testCache);

      if (verbose) console.log('[TEST] getCryptoPrice returned:', price);

      expect(price).toBe(42.5);
    });

    it('tries MEXC first and returns price when successful', async () => {
      if (verbose) console.log('[TEST] Starting MEXC success test');
      mockFetchWithRetry
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ symbols: [{ baseAsset: 'XTM', quoteAsset: 'USDT' }] })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [[1766103360000, 0, 50.0, 40.0, 45.0, 1000]]
        });

      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose);
      if (verbose) console.log('[TEST] getCryptoPrice returned:', price);
      expect(price).toBe(50.0);
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);
    });

    it('falls back to CoinGecko when MEXC fails', async () => {
      if (verbose) console.log('[TEST] Starting CoinGecko fallback test');

      mockFetchWithRetry.mockReset();
      mockFetchWithRetry.mockClear();

      mockFetchWithRetry.mockImplementation(async (url) => {
        if (verbose) console.log('[MOCK] Fetch called for URL:', url);

        if (url.includes('mexc.com')) {
          return { ok: false, status: 500 };
        }

        if (url.includes('/tickers')) {
          return { ok: false, status: 404 };
        }

        if (url.includes('/history')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              market_data: {
                current_price: { usd: 42.7 }
              }
            })
          };
        }

        return { ok: false, status: 404 };
      });

      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose);
      if (verbose) console.log('[TEST] getCryptoPrice returned:', price);
      expect(price).toBe(42.7);
    });

    it('returns null when all sources fail', async () => {
      if (verbose) console.log('[TEST] Starting all-sources-fail test');
      mockFetchWithRetry.mockResolvedValue({ ok: false, status: 500 });
      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose);
      if (verbose) console.log('[TEST] getCryptoPrice returned:', price);
      expect(price).toBeNull();
    });

    it('skips future dates', async () => {
      if (verbose) console.log('[TEST] Starting future date skip test');
      const future = DateTime.now().plus({ days: 1 }).toFormat('yyyy-MM-dd HH:mm:ss');
      const price = await getCryptoPrice('xtm', future, 'UTC', 'high', verbose);
      if (verbose) console.log('[TEST] getCryptoPrice returned:', price);
      expect(price).toBeNull();
    });

    it('handles invalid token (no symbol in MEXC + no fallback)', async () => {
      if (verbose) console.log('[TEST] Starting invalid token test');
      mockFetchWithRetry
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ symbols: [] })
        })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 500 });

      const price = await getCryptoPrice('unknown_token', '2025-12-19 00:17:00', 'UTC', 'high', verbose);
      if (verbose) console.log('[TEST] getCryptoPrice returned:', price);
      expect(price).toBeNull();
    });

    it('handles low price mode correctly', async () => {
      if (verbose) console.log('[TEST] Starting low price mode test');

      // Reset mocks completely for this test
      mockFetchWithRetry.mockReset();
      mockFetchWithRetry.mockClear();

      mockFetchWithRetry.mockImplementation(async (url, verbose) => {
        if (verbose) console.log('[MOCK] Fetch called for URL:', url); // debug to see order

        if (url.includes('exchangeInfo')) {
          return {
            ok: true,
            status: 200,
            json: async () => {
              return {
                symbols: [
                  { baseAsset: 'XTM', quoteAsset: 'USDT' }
                ]
              };
            }
          };
        }

        if (url.includes('klines')) {
          return {
            ok: true,
            status: 200,
            json: async () => {
              return [[1766103360000, 0, 60.0, 40.0, 50.0, 1000]];
            }
          };
        }

        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'Not mocked' })
        };
      });

      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'low', verbose);
      if (verbose) console.log('[TEST] getCryptoPrice returned:', price);

      expect(price).toBe(40.0);
    });

    it('handles BTC pair adjustment', async () => {
      if (verbose) console.log('[TEST] Starting BTC pair adjustment test');
      mockFetchWithRetry
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ symbols: [{ baseAsset: 'XTM', quoteAsset: 'BTC' }] })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [[1766103360000, 0, 0.0005, 0.0004, 0.00045, 1000]]
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ bitcoin: { usd: 100000 } })
        });

      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose);
      if (verbose) console.log('[TEST] getCryptoPrice returned:', price);
      expect(price).toBeCloseTo(50.0, 2);
    });

    it('handles rate limit retry (mock 429)', async () => {
      mockFetchWithRetry
        .mockImplementationOnce(async (url, verbose) => {
          if (verbose) console.log('[DEBUG] Mock call 1 - initial failure with status 429 - URL:', url);
          return new Response(null, { status: 429, ok: false });
        })
        .mockImplementationOnce(async (url, verbose) => {
          if (verbose) console.log('[DEBUG] Mock call 2 - retry exchangeInfo success - URL:', url);
          return {
            ok: true,
            status: 200,
            json: async () => ({ symbols: [{ baseAsset: 'XTM', quoteAsset: 'USDT' }] })
          };
        })
        .mockImplementationOnce(async (url, verbose) => {
          if (verbose) console.log('[DEBUG] Mock call 3 - retry klines success - URL:', url);
          return {
            ok: true,
            status: 200,
            json: async () => [[1766103360000, 0, 50.0, 40.0, 45.0, 1000]]
          };
        })
        .mockImplementationOnce(async (url, verbose) => {
          if (verbose) console.log('[DEBUG] Mock call 4 - CoinPaprika fallback failure - URL:', url);
          return { ok: false, status: 500 };
        });

      if (verbose) console.log('[VERBOSE] Starting rate limit test promise...');

      const pricePromise = getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose);

      if (verbose) {
        console.log('[DEBUG] Pending timers before flush:', vi.getTimerCount());
        console.log('[DEBUG] Mock calls before flush:', mockFetchWithRetry.mock.calls.length);
      }

      if (verbose) console.log('[VERBOSE] Running all timers to flush backoff (step 1)');
      vi.runAllTimers();
      await Promise.resolve(); // Flush microtasks

      if (verbose) {
        console.log('[DEBUG] Pending timers after flush 1:', vi.getTimerCount());
        console.log('[DEBUG] Mock calls after flush 1:', mockFetchWithRetry.mock.calls.length);
      }

      if (verbose) console.log('[VERBOSE] Running all timers to flush backoff (step 2)');
      vi.runAllTimers();
      await Promise.resolve();

      if (verbose) {
        console.log('[DEBUG] Pending timers after flush 2:', vi.getTimerCount());
        console.log('[DEBUG] Mock calls after flush 2:', mockFetchWithRetry.mock.calls.length);
      }

      if (verbose) console.log('[VERBOSE] Running all timers to flush backoff (step 3)');
      vi.runAllTimers();
      await Promise.resolve();

      if (verbose) {
        console.log('[DEBUG] Pending timers after flush 3:', vi.getTimerCount());
        console.log('[DEBUG] Mock calls after flush 3:', mockFetchWithRetry.mock.calls.length);
      }

      if (verbose) console.log('[VERBOSE] All timers flushed - awaiting price...');
      const price = await pricePromise;

      if (verbose) console.log(`[VERBOSE] Rate limit test completed with price: ${price}`);

      expect(price).toBe(50.0);
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(3); // 3 calls (fallback skipped)
    }, 30000); // 30s timeout - generous buffer

    // === NEW TESTS TO BOOST coingecko.js COVERAGE ===

    it('falls back to history when CoinGecko tickers have only stale or low-volume entries', async () => {
      if (verbose) console.log('[TEST] Starting stale/low-volume tickers fallback test');

      mockFetchWithRetry.mockReset();
      mockFetchWithRetry.mockClear();

      mockFetchWithRetry.mockImplementation(async (url) => {
        if (verbose) console.log('[MOCK] Fetch called for URL:', url);

        if (url.includes('mexc.com')) {
          return { ok: false, status: 500 };
        }

        if (url.includes('/tickers')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              tickers: [
                { volume: 10, converted_last: { usd: 100 }, is_stale: true },
                { volume: 5, converted_last: { usd: 90 }, is_stale: true }
              ]
            })
          };
        }

        if (url.includes('/history')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              market_data: {
                current_price: { usd: 42.7 }
              }
            })
          };
        }

        return { ok: false, status: 404 };
      });

      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose);
      if (verbose) console.log('[TEST] getCryptoPrice returned:', price);
      expect(price).toBe(42.7);
    });

    it('returns null when both CoinGecko endpoints return 404', async () => {
      mockFetchWithRetry
        .mockResolvedValueOnce({ ok: false, status: 500 }) // MEXC fails
        .mockResolvedValueOnce({ ok: false, status: 404 }) // tickers 404
        .mockResolvedValueOnce({ ok: false, status: 404 }); // history 404

      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose);
      expect(price).toBeNull();
    });

    it('returns null when CoinGecko history is missing market_data key', async () => {
      mockFetchWithRetry
        .mockResolvedValueOnce({ ok: false, status: 500 }) // MEXC fails
        .mockResolvedValueOnce({ ok: false, status: 404 }) // tickers fail
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ market_data: null }) // missing / null
        });

      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose);
      expect(price).toBeNull();
    });

    it('returns null when CoinGecko history is missing current_price.usd', async () => {
      mockFetchWithRetry
        .mockResolvedValueOnce({ ok: false, status: 500 }) // MEXC fails
        .mockResolvedValueOnce({ ok: false, status: 404 }) // tickers fail
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            market_data: {
              current_price: { eur: 39.5 } // usd missing
            }
          })
        }); // history missing usd

      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose);
      expect(price).toBeNull();
    });

    it('handles invalid response object from CoinGecko (no .json method)', async () => {
      mockFetchWithRetry
        .mockResolvedValueOnce({ ok: false, status: 500 }) // MEXC fails
        .mockResolvedValueOnce({}) // invalid response (no json)
        .mockResolvedValueOnce({}); // invalid again for history

      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose);
      expect(price).toBeNull();
    });

    it('handles JSON parse error in CoinGecko responses', async () => {
      mockFetchWithRetry
        .mockResolvedValueOnce({ ok: false, status: 500 }) // MEXC fails
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => { throw new Error('Simulated parse error'); }
        }) // tickers parse error
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => { throw new Error('Simulated parse error'); }
        }); // history parse error

      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose);
      expect(price).toBeNull();
    });
  });

  describe('CSV Parsing', () => {
    it('parses tests/input.csv correctly', () => {
      const csvContent = fs.readFileSync('tests/input.csv', 'utf8');
      const records = csvParse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        delimiter: ',',
        quote: '"',
        relax_column_count: true
      });

      expect(records.length).toBeGreaterThan(0);
      expect(records[0]['date (UTC)']).toBe('2025-12-19 00:17:00');
      expect(records[0]['amount']).toBe('200.24');
    });
  });
});
