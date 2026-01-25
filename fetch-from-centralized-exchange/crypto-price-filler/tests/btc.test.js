/**
 * Unit tests for BTC price utility
 * @module tests/btc.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getBTCUSDTPrice } from '../sources/utils/btc.js';
import * as fetchModule from '../utils/fetch.js';

// Mock fetch module
vi.mock('../utils/fetch.js', () => ({
  fetchWithRetry: vi.fn()
}));

const mockFetch = vi.mocked(fetchModule.fetchWithRetry);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('BTC Price Utility', () => {
  describe('getBTCUSDTPrice', () => {
    it('returns BTC price from CoinGecko', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bitcoin: { usd: 50000 } })
      });

      const price = await getBTCUSDTPrice(false);

      expect(price).toBe(50000);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('returns null when fetch fails', async () => {
      mockFetch.mockResolvedValueOnce(null);

      const price = await getBTCUSDTPrice(false);

      expect(price).toBeNull();
    });

    it('returns null when JSON parse fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new Error('Invalid JSON'); }
      });

      const price = await getBTCUSDTPrice(false);

      expect(price).toBeNull();
    });

    it('returns undefined when bitcoin.usd is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bitcoin: {} })
      });

      const price = await getBTCUSDTPrice(false);

      expect(price).toBeUndefined();
    });

    it('returns undefined when bitcoin object is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });

      const price = await getBTCUSDTPrice(false);

      expect(price).toBeUndefined();
    });

    describe('verbose logging', () => {
      it('logs when verbose is enabled', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ bitcoin: { usd: 50000 } })
        });

        await getBTCUSDTPrice(true);

        expect(consoleSpy).toHaveBeenCalled();
        const logCalls = consoleSpy.mock.calls.map(c => c[0]);
        expect(logCalls.some(msg => msg && msg.includes('[VERBOSE'))).toBe(true);

        consoleSpy.mockRestore();
      });

      it('logs JSON parse error when verbose is enabled', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => { throw new Error('Parse failed'); }
        });

        await getBTCUSDTPrice(true);

        expect(consoleSpy).toHaveBeenCalled();
        const logCalls = consoleSpy.mock.calls.map(c => c[0]);
        expect(logCalls.some(msg => msg && msg.includes('JSON parse FAILED'))).toBe(true);

        consoleSpy.mockRestore();
      });

      it('does not log when verbose is disabled', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ bitcoin: { usd: 50000 } })
        });

        await getBTCUSDTPrice(false);

        const verboseLogs = consoleSpy.mock.calls.filter(c =>
          c[0] && c[0].includes && c[0].includes('[VERBOSE')
        );
        expect(verboseLogs.length).toBe(0);

        consoleSpy.mockRestore();
      });
    });
  });
});
