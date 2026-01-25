/**
 * Unit tests for CoinGecko price fetching
 * @module tests/coingecko.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPriceFromCoinGecko } from '../sources/coingecko.js';
import * as fetchUtils from '../utils/fetch.js';

// Mock fetchWithRetry
vi.mock('../utils/fetch.js', () => {
  const mockFn = vi.fn();
  return {
    fetchWithRetry: mockFn,
    default: mockFn
  };
});

const mockFetchWithRetry = vi.mocked(fetchUtils.fetchWithRetry);

// Test constants
const TEST_TOKEN = 'GRC';
const TEST_COINGECKO_ID = 'gridcoin-research';
const TEST_UTC_MS = 1704067200000; // 2024-01-01 00:00:00 UTC

// Mock response data
const MOCK_TICKERS_DATA = {
  tickers: [
    { base: 'GRC', target: 'BTC', last: 0.00000025 },
    { base: 'GRC', target: 'USD', last: 0.0065 }
  ]
};

const MOCK_HISTORY_DATA = {
  market_data: {
    current_price: { usd: 0.006 },
    high_24h: { usd: 0.0065 },
    low_24h: { usd: 0.0055 }
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchWithRetry.mockReset();

  // Default: fail on unexpected calls
  mockFetchWithRetry.mockImplementation(() => {
    throw new Error('Unexpected fetchWithRetry call - check mock setup');
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CoinGecko Price Fetching', () => {
  describe('getPriceFromCoinGecko', () => {
    describe('successful tickers endpoint fetch', () => {
      it('returns price from tickers when USD ticker found', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_TICKERS_DATA
        });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        expect(price).toBe(0.0065);
        expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);
      });

      it('finds ticker with base USD', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            tickers: [
              { base: 'USD', target: 'GRC', last: 0.007 }
            ]
          })
        });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        expect(price).toBe(0.007);
      });
    });

    describe('fallback to history endpoint', () => {
      it('falls back to history when no USD ticker in tickers response', async () => {
        // Tickers returns no USD ticker
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            tickers: [
              { base: 'GRC', target: 'BTC', last: 0.00000025 }
            ]
          })
        });
        // History returns data
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_HISTORY_DATA
        });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        expect(price).toBe(0.006);
        expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);
      });

      it('falls back to history when tickers request fails', async () => {
        // Tickers throws error
        mockFetchWithRetry.mockRejectedValueOnce(new Error('Network error'));
        // History returns data
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_HISTORY_DATA
        });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        expect(price).toBe(0.006);
        expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);
      });

      it('falls back to history when tickers response is not ok', async () => {
        // Tickers returns not ok
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: false,
          status: 404
        });
        // History returns data
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_HISTORY_DATA
        });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        expect(price).toBe(0.006);
      });

      it('returns high price from history when target is high', async () => {
        // Tickers fails
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: false
        });
        // History returns data
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_HISTORY_DATA
        });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'high', false, TEST_COINGECKO_ID);

        expect(price).toBe(0.0065);
      });

      it('returns low price from history when target is low', async () => {
        // Tickers fails
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: false
        });
        // History returns data
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_HISTORY_DATA
        });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'low', false, TEST_COINGECKO_ID);

        expect(price).toBe(0.0055);
      });
    });

    describe('daily fallback path', () => {
      it('uses daily fallback when history has no market_data', async () => {
        // Tickers fails
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        // History returns no market_data
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => ({}) // No market_data
        });
        // Daily fallback returns data
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_HISTORY_DATA
        });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        expect(price).toBe(0.006);
        expect(mockFetchWithRetry).toHaveBeenCalledTimes(3);
      });

      it('returns high price from daily fallback', async () => {
        // Tickers fails
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        // History fails
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        // Daily fallback returns data
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_HISTORY_DATA
        });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'high', false, TEST_COINGECKO_ID);

        expect(price).toBe(0.0065);
      });

      it('returns low price from daily fallback', async () => {
        // Tickers fails
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        // History fails
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        // Daily fallback returns data
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_HISTORY_DATA
        });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'low', false, TEST_COINGECKO_ID);

        expect(price).toBe(0.0055);
      });

      it('uses daily fallback when history request throws', async () => {
        // Tickers fails
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        // History throws
        mockFetchWithRetry.mockRejectedValueOnce(new Error('Timeout'));
        // Daily fallback returns data
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_HISTORY_DATA
        });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        expect(price).toBe(0.006);
      });
    });

    describe('failure cases', () => {
      it('returns null when all endpoints fail', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false }); // Tickers
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false }); // History
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false }); // Daily fallback

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        expect(price).toBeNull();
      });

      it('returns null when tickers has empty array', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ tickers: [] })
        });
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        expect(price).toBeNull();
      });

      it('returns null when market_data has no USD price', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            market_data: {
              current_price: { eur: 0.005 } // No USD
            }
          })
        });
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        expect(price).toBeNull();
      });

      it('returns null when daily fallback throws', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        mockFetchWithRetry.mockRejectedValueOnce(new Error('Network error'));

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        expect(price).toBeNull();
      });
    });

    describe('URL construction', () => {
      it('constructs correct tickers URL with coingecko ID', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_TICKERS_DATA
        });

        await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        const calledUrl = mockFetchWithRetry.mock.calls[0][0];
        expect(calledUrl).toContain('api.coingecko.com');
        expect(calledUrl).toContain(TEST_COINGECKO_ID);
        expect(calledUrl).toContain('/tickers');
      });

      it('constructs correct history URL with date', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false }); // Tickers fails
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_HISTORY_DATA
        });

        await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        const historyUrl = mockFetchWithRetry.mock.calls[1][0];
        expect(historyUrl).toContain('/history');
        expect(historyUrl).toMatch(/date=\d{2}-\d{2}-\d{4}/); // DD-MM-YYYY format
      });

      it('uses token as coingecko ID when not provided', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_TICKERS_DATA
        });

        await getPriceFromCoinGecko('BITCOIN', TEST_UTC_MS, 'close', false);

        const calledUrl = mockFetchWithRetry.mock.calls[0][0];
        expect(calledUrl).toContain('bitcoin'); // lowercase
      });
    });

    describe('verbose logging', () => {
      it('logs when verbose is enabled', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_TICKERS_DATA
        });

        await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', true, TEST_COINGECKO_ID);

        expect(consoleSpy).toHaveBeenCalled();
        const logCalls = consoleSpy.mock.calls.map(c => c[0]);
        expect(logCalls.some(msg => msg.includes('[VERBOSE'))).toBe(true);

        consoleSpy.mockRestore();
      });

      it('does not log when verbose is disabled', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_TICKERS_DATA
        });

        await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        const verboseLogs = consoleSpy.mock.calls.filter(c =>
          c[0] && c[0].includes && c[0].includes('[VERBOSE')
        );
        expect(verboseLogs.length).toBe(0);

        consoleSpy.mockRestore();
      });

      it('logs tickers success message', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_TICKERS_DATA
        });

        await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', true, TEST_COINGECKO_ID);

        const logMessages = consoleSpy.mock.calls.map(c => c[0]);
        expect(logMessages.some(msg => msg.includes('tickers success'))).toBe(true);

        consoleSpy.mockRestore();
      });

      it('logs history success message', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_HISTORY_DATA
        });

        await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', true, TEST_COINGECKO_ID);

        const logMessages = consoleSpy.mock.calls.map(c => c[0]);
        expect(logMessages.some(msg => msg.includes('history success'))).toBe(true);

        consoleSpy.mockRestore();
      });

      it('logs daily fallback success message', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_HISTORY_DATA
        });

        await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', true, TEST_COINGECKO_ID);

        const logMessages = consoleSpy.mock.calls.map(c => c[0]);
        expect(logMessages.some(msg => msg.includes('daily fallback success'))).toBe(true);

        consoleSpy.mockRestore();
      });

      it('logs failure message when all paths fail', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });

        await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', true, TEST_COINGECKO_ID);

        const logMessages = consoleSpy.mock.calls.map(c => c[0]);
        expect(logMessages.some(msg => msg.includes('both paths failed'))).toBe(true);

        consoleSpy.mockRestore();
      });
    });

    describe('edge cases', () => {
      it('handles zero price correctly', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            tickers: [{ target: 'USD', last: 0 }]
          })
        });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        // Zero is falsy but should still be returned
        expect(price).toBe(0);
      });

      it('handles very small prices correctly', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            tickers: [{ target: 'USD', last: 0.000000001 }]
          })
        });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        expect(price).toBe(0.000000001);
      });

      it('handles missing tickers array in response', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => ({}) // No tickers array
        });
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_HISTORY_DATA
        });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, 'close', false, TEST_COINGECKO_ID);

        expect(price).toBe(0.006);
      });

      it('defaults to close target', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({ ok: false });
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_HISTORY_DATA
        });

        const price = await getPriceFromCoinGecko(TEST_TOKEN, TEST_UTC_MS, undefined, false, TEST_COINGECKO_ID);

        expect(price).toBe(0.006); // current_price.usd (close)
      });
    });
  });
});
