/**
 * Unit tests for CoinPaprika price fetching
 * @module tests/coinpaprika.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPriceFromCoinPaprika } from '../sources/coinpaprika.js';
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
const TEST_ID = 'grc-gridcoin';
const TEST_UTC_MS = 1704067200000; // 2024-01-01 00:00:00 UTC
const MOCK_OHLCV_DATA = [
  {
    time_open: '2024-01-01T00:00:00Z',
    time_close: '2024-01-01T23:59:59Z',
    open: 0.005,
    high: 0.0065,
    low: 0.0045,
    close: 0.006,
    volume: 10000,
    market_cap: 5000000
  }
];

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

describe('CoinPaprika Price Fetching', () => {
  describe('getPriceFromCoinPaprika', () => {
    describe('successful precise OHLCV fetch', () => {
      it('returns close price when target is close', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OHLCV_DATA
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        expect(price).toBe(0.006);
        expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);
      });

      it('returns high price when target is high', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OHLCV_DATA
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'high', false);

        expect(price).toBe(0.0065);
      });

      it('returns low price when target is low', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OHLCV_DATA
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'low', false);

        expect(price).toBe(0.0045);
      });
    });

    describe('fallback to daily granularity', () => {
      it('falls back to daily when precise returns empty array', async () => {
        // First call (precise) returns empty
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });
        // Second call (daily) returns data
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OHLCV_DATA
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        expect(price).toBe(0.006);
        expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);
      });

      it('falls back to daily when precise returns null response', async () => {
        // First call (precise) returns null
        mockFetchWithRetry.mockResolvedValueOnce(null);
        // Second call (daily) returns data
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OHLCV_DATA
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        expect(price).toBe(0.006);
        expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);
      });

      it('falls back to daily when precise response is not ok', async () => {
        // First call (precise) returns not ok
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: false,
          status: 404
        });
        // Second call (daily) returns data
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OHLCV_DATA
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'high', false);

        expect(price).toBe(0.0065);
        expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);
      });

      it('falls back to daily when precise JSON parse fails', async () => {
        // First call (precise) - JSON parse throws
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => { throw new Error('Invalid JSON'); }
        });
        // Second call (daily) returns data
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OHLCV_DATA
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        expect(price).toBe(0.006);
        expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);
      });
    });

    describe('failure cases', () => {
      it('returns null when both precise and daily return empty', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        expect(price).toBeNull();
      });

      it('returns null when both precise and daily fail', async () => {
        mockFetchWithRetry.mockResolvedValueOnce(null);
        mockFetchWithRetry.mockResolvedValueOnce(null);

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        expect(price).toBeNull();
      });

      it('returns null when daily JSON parse fails', async () => {
        // Precise returns empty
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });
        // Daily JSON parse fails
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => { throw new Error('Invalid JSON'); }
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        expect(price).toBeNull();
      });

      it('returns null when daily response is not ok', async () => {
        // Precise returns empty
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });
        // Daily returns not ok
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: false,
          status: 500
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        expect(price).toBeNull();
      });

      it('returns null when price field is missing', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => [{ open: 0.005 }] // missing close, high, low
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        expect(price).toBeNull();
      });

      it('returns null when price is NaN', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => [{ close: 'not-a-number', high: 'invalid', low: 'bad' }]
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        expect(price).toBeNull();
      });

      it('returns null for unknown price target', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OHLCV_DATA
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'unknown', false);

        expect(price).toBeNull();
      });
    });

    describe('URL construction', () => {
      it('constructs correct precise OHLCV URL with timestamps', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OHLCV_DATA
        });

        await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        const calledUrl = mockFetchWithRetry.mock.calls[0][0];
        expect(calledUrl).toContain('coinpaprika.com');
        expect(calledUrl).toContain(TEST_ID);
        expect(calledUrl).toContain('start=');
        expect(calledUrl).toContain('end=');
      });

      it('constructs correct daily OHLCV URL with date strings', async () => {
        // Precise returns empty to trigger daily fallback
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OHLCV_DATA
        });

        await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        const dailyUrl = mockFetchWithRetry.mock.calls[1][0];
        expect(dailyUrl).toContain('2024-01-01'); // Date string format
      });
    });

    describe('verbose logging', () => {
      it('logs when verbose is enabled', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OHLCV_DATA
        });

        await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', true);

        expect(consoleSpy).toHaveBeenCalled();
        const logCalls = consoleSpy.mock.calls.map(c => c[0]);
        expect(logCalls.some(msg => msg.includes('[VERBOSE'))).toBe(true);

        consoleSpy.mockRestore();
      });

      it('does not log when verbose is disabled', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OHLCV_DATA
        });

        await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        const verboseLogs = consoleSpy.mock.calls.filter(c =>
          c[0] && c[0].includes && c[0].includes('[VERBOSE')
        );
        expect(verboseLogs.length).toBe(0);

        consoleSpy.mockRestore();
      });

      it('logs fallback message when falling back to daily', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OHLCV_DATA
        });

        await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', true);

        const logMessages = consoleSpy.mock.calls.map(c => c[0]);
        expect(logMessages.some(msg => msg.includes('daily granularity'))).toBe(true);

        consoleSpy.mockRestore();
      });

      it('logs success message with price', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OHLCV_DATA
        });

        await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'high', true);

        const logMessages = consoleSpy.mock.calls.map(c => c[0]);
        expect(logMessages.some(msg => msg.includes('success') && msg.includes('0.0065'))).toBe(true);

        consoleSpy.mockRestore();
      });

      it('logs empty data message when no data found', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });

        await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', true);

        const logMessages = consoleSpy.mock.calls.map(c => c[0]);
        expect(logMessages.some(msg => msg.includes('empty after fallback'))).toBe(true);

        consoleSpy.mockRestore();
      });
    });

    describe('edge cases', () => {
      it('handles zero price correctly', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => [{ close: 0, high: 0, low: 0 }]
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        // Zero is a valid price
        expect(price).toBe(0);
      });

      it('handles very small prices correctly', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => [{ close: 0.000000001, high: 0.000000002, low: 0.0000000005 }]
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        expect(price).toBe(0.000000001);
      });

      it('handles string numbers in response', async () => {
        mockFetchWithRetry.mockResolvedValueOnce({
          ok: true,
          json: async () => [{ close: '0.006', high: '0.0065', low: '0.0045' }]
        });

        const price = await getPriceFromCoinPaprika(TEST_ID, TEST_UTC_MS, 'close', false);

        expect(price).toBe(0.006);
      });
    });
  });
});
