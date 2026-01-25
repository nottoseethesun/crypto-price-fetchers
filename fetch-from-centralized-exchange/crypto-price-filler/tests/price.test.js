/**
 * Unit tests for Price fetching orchestration
 * @module tests/price.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCryptoPrice } from '../sources/price.js';
import * as mexc from '../sources/mexc.js';
import * as coingecko from '../sources/coingecko.js';
import * as coinpaprika from '../sources/coinpaprika.js';
import * as cacheModule from '../utils/cache.js';
import fs from 'fs';

// Mock all price source modules
vi.mock('../sources/mexc.js', () => ({
  getPriceFromMEXC: vi.fn()
}));

vi.mock('../sources/coingecko.js', () => ({
  getPriceFromCoinGecko: vi.fn()
}));

vi.mock('../sources/coinpaprika.js', () => ({
  getPriceFromCoinPaprika: vi.fn()
}));

vi.mock('../utils/cache.js', () => ({
  getCache: vi.fn(),
  setCache: vi.fn()
}));

// Mock fs to return test token config
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual.default,
      readFileSync: vi.fn()
    }
  };
});

const mockMexc = vi.mocked(mexc.getPriceFromMEXC);
const mockCoingecko = vi.mocked(coingecko.getPriceFromCoinGecko);
const mockCoinpaprika = vi.mocked(coinpaprika.getPriceFromCoinPaprika);
const mockGetCache = vi.mocked(cacheModule.getCache);
const mockSetCache = vi.mocked(cacheModule.setCache);
const mockReadFileSync = vi.mocked(fs.readFileSync);

// Test token configurations
const TEST_TOKENS_CONFIG = {
  tokens: {
    grc: {
      coingecko_id: 'gridcoin-research',
      coinpaprika_id: 'grc-gridcoin',
      mexc_symbol: null
    },
    xtm: {
      coingecko_id: 'torum',
      coinpaprika_id: null,
      mexc_symbol: 'XTMUSDT'
    },
    btc: {
      coingecko_id: 'bitcoin',
      coinpaprika_id: 'btc-bitcoin',
      mexc_symbol: 'BTCUSDT'
    }
  }
};

beforeEach(() => {
  vi.clearAllMocks();

  // Default mock for fs.readFileSync
  mockReadFileSync.mockReturnValue(JSON.stringify(TEST_TOKENS_CONFIG));

  // Default: all sources return null
  mockMexc.mockResolvedValue(null);
  mockCoingecko.mockResolvedValue(null);
  mockCoinpaprika.mockResolvedValue(null);
  mockGetCache.mockReturnValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Price Fetching Orchestration', () => {
  describe('getCryptoPrice', () => {
    describe('source priority and fallback', () => {
      it('returns MEXC price when available', async () => {
        mockMexc.mockResolvedValueOnce(50000);

        const price = await getCryptoPrice('btc', '2024-01-01 12:00:00', 'UTC', 'high', false);

        expect(price).toBe(50000);
        expect(mockMexc).toHaveBeenCalled();
        expect(mockCoingecko).not.toHaveBeenCalled();
        expect(mockCoinpaprika).not.toHaveBeenCalled();
      });

      it('falls back to CoinGecko when MEXC returns null', async () => {
        mockMexc.mockResolvedValueOnce(null);
        mockCoingecko.mockResolvedValueOnce(49500);

        const price = await getCryptoPrice('btc', '2024-01-01 12:00:00', 'UTC', 'high', false);

        expect(price).toBe(49500);
        expect(mockMexc).toHaveBeenCalled();
        expect(mockCoingecko).toHaveBeenCalled();
      });

      it('falls back to CoinPaprika when MEXC and CoinGecko fail', async () => {
        mockMexc.mockResolvedValueOnce(null);
        mockCoingecko.mockResolvedValueOnce(null);
        mockCoinpaprika.mockResolvedValueOnce(0.006);

        const price = await getCryptoPrice('grc', '2024-01-01 12:00:00', 'UTC', 'close', false);

        expect(price).toBe(0.006);
        expect(mockCoinpaprika).toHaveBeenCalled();
      });

      it('skips MEXC when mexc_symbol is null', async () => {
        mockCoingecko.mockResolvedValueOnce(0.0065);

        const price = await getCryptoPrice('grc', '2024-01-01 12:00:00', 'UTC', 'high', false);

        expect(price).toBe(0.0065);
        expect(mockMexc).not.toHaveBeenCalled();
        expect(mockCoingecko).toHaveBeenCalled();
      });

      it('skips CoinPaprika when coinpaprika_id is null', async () => {
        mockMexc.mockResolvedValueOnce(null);
        mockCoingecko.mockResolvedValueOnce(null);

        const price = await getCryptoPrice('xtm', '2024-01-01 12:00:00', 'UTC', 'high', false);

        expect(price).toBeNull();
        expect(mockCoinpaprika).not.toHaveBeenCalled();
      });
    });

    describe('caching behavior', () => {
      it('returns cached price on cache hit', async () => {
        // getCache is called twice: once for truthiness check, once to get value
        mockGetCache.mockReturnValue(45000);

        const price = await getCryptoPrice('btc', '2024-01-01 12:00:00', 'UTC', 'high', false);

        expect(price).toBe(45000);
        expect(mockMexc).not.toHaveBeenCalled();
        expect(mockCoingecko).not.toHaveBeenCalled();
        expect(mockCoinpaprika).not.toHaveBeenCalled();

        // Reset for other tests
        mockGetCache.mockReturnValue(undefined);
      });

      it('caches fetched price', async () => {
        // Reset all mocks to ensure clean state
        mockMexc.mockReset();
        mockCoingecko.mockReset();
        mockCoinpaprika.mockReset();
        mockGetCache.mockReset();
        mockSetCache.mockReset();

        mockGetCache.mockReturnValue(undefined);
        mockMexc.mockResolvedValueOnce(50000);

        await getCryptoPrice('btc', '2024-01-01 12:00:00', 'UTC', 'high', false);

        expect(mockSetCache).toHaveBeenCalled();
        const cacheCall = mockSetCache.mock.calls[0];
        expect(cacheCall[1]).toBe(50000);
      });

      it('uses test cache when provided', async () => {
        const testCache = new Map();
        testCache.set('price_btc_20240101120000_UTC_high', 48000);

        const price = await getCryptoPrice('btc', '2024-01-01 12:00:00', 'UTC', 'high', false, testCache);

        expect(price).toBe(48000);
        expect(mockGetCache).not.toHaveBeenCalled();
      });

      it('sets value in test cache when provided', async () => {
        const testCache = new Map();
        mockMexc.mockResolvedValueOnce(51000);

        await getCryptoPrice('btc', '2024-01-01 12:00:00', 'UTC', 'high', false, testCache);

        expect(testCache.size).toBe(1);
        expect(mockSetCache).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('returns null for invalid date', async () => {
        const price = await getCryptoPrice('btc', 'not-a-date', 'UTC', 'high', false);

        expect(price).toBeNull();
        expect(mockMexc).not.toHaveBeenCalled();
      });

      it('returns null for future date', async () => {
        const futureDate = new Date(Date.now() + 86400000).toISOString().slice(0, 19).replace('T', ' ');

        const price = await getCryptoPrice('btc', futureDate, 'UTC', 'high', false);

        expect(price).toBeNull();
        expect(mockMexc).not.toHaveBeenCalled();
      });

      it('handles MEXC throwing error', async () => {
        // Reset all mocks to ensure clean state
        mockMexc.mockReset();
        mockCoingecko.mockReset();
        mockCoinpaprika.mockReset();

        mockMexc.mockRejectedValueOnce(new Error('Network error'));
        mockCoingecko.mockResolvedValueOnce(49000);

        const price = await getCryptoPrice('btc', '2024-01-01 12:00:00', 'UTC', 'high', false);

        expect(price).toBe(49000);
      });

      it('handles CoinGecko throwing error', async () => {
        // Reset all mocks to ensure clean state
        mockMexc.mockReset();
        mockCoingecko.mockReset();
        mockCoinpaprika.mockReset();

        // grc has no mexc_symbol, so MEXC is skipped
        mockCoingecko.mockRejectedValueOnce(new Error('API error'));
        mockCoinpaprika.mockResolvedValueOnce(0.0055);

        const price = await getCryptoPrice('grc', '2024-01-01 12:00:00', 'UTC', 'high', false);

        expect(price).toBe(0.0055);
      });

      it('handles CoinPaprika throwing error', async () => {
        // Reset all mocks to ensure clean state
        mockMexc.mockReset();
        mockCoingecko.mockReset();
        mockCoinpaprika.mockReset();

        // grc has no mexc_symbol, so MEXC is skipped
        mockCoingecko.mockResolvedValueOnce(null);
        mockCoinpaprika.mockRejectedValueOnce(new Error('Rate limited'));

        const price = await getCryptoPrice('grc', '2024-01-01 12:00:00', 'UTC', 'high', false);

        expect(price).toBeNull();
      });
    });

    describe('verbose logging', () => {
      it('logs when verbose is enabled', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mockMexc.mockResolvedValueOnce(50000);

        await getCryptoPrice('btc', '2024-01-01 12:00:00', 'UTC', 'high', true);

        expect(consoleSpy).toHaveBeenCalled();
        const logCalls = consoleSpy.mock.calls.map(c => c[0]);
        expect(logCalls.some(msg => msg.includes('[VERBOSE'))).toBe(true);

        consoleSpy.mockRestore();
      });

      it('does not log when verbose is disabled', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mockMexc.mockResolvedValueOnce(50000);

        await getCryptoPrice('btc', '2024-01-01 12:00:00', 'UTC', 'high', false);

        const verboseLogs = consoleSpy.mock.calls.filter(c =>
          c[0] && c[0].includes && c[0].includes('[VERBOSE')
        );
        expect(verboseLogs.length).toBe(0);

        consoleSpy.mockRestore();
      });

      it('logs CoinPaprika success', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mockCoingecko.mockResolvedValueOnce(null);
        mockCoinpaprika.mockResolvedValueOnce(0.006);

        await getCryptoPrice('grc', '2024-01-01 12:00:00', 'UTC', 'high', true);

        const logMessages = consoleSpy.mock.calls.map(c => c[0]);
        expect(logMessages.some(msg => msg.includes('CoinPaprika success'))).toBe(true);

        consoleSpy.mockRestore();
      });
    });

    describe('token configuration', () => {
      it('handles unknown token gracefully', async () => {
        // Reset all mocks to ensure clean state
        mockMexc.mockReset();
        mockCoingecko.mockReset();
        mockCoinpaprika.mockReset();

        // Ensure all sources return null for unknown token
        mockMexc.mockResolvedValue(null);
        mockCoingecko.mockResolvedValue(null);
        mockCoinpaprika.mockResolvedValue(null);

        const price = await getCryptoPrice('unknowntoken', '2024-01-01 12:00:00', 'UTC', 'high', false);

        // Unknown token has no config, so all sources are skipped, returns null
        expect(price).toBeNull();
      });

      it('reads token config from supported-tokens.json', async () => {
        mockMexc.mockResolvedValueOnce(50000);

        await getCryptoPrice('btc', '2024-01-01 12:00:00', 'UTC', 'high', false);

        expect(mockReadFileSync).toHaveBeenCalledWith('./supported-tokens.json', 'utf8');
      });
    });

    describe('price target options', () => {
      it('passes high target to sources', async () => {
        mockMexc.mockResolvedValueOnce(50500);

        await getCryptoPrice('btc', '2024-01-01 12:00:00', 'UTC', 'high', false);

        expect(mockMexc).toHaveBeenCalledWith('BTCUSDT', expect.any(Number), 'high', false);
      });

      it('passes low target to sources', async () => {
        mockMexc.mockResolvedValueOnce(49500);

        await getCryptoPrice('btc', '2024-01-01 12:00:00', 'UTC', 'low', false);

        expect(mockMexc).toHaveBeenCalledWith('BTCUSDT', expect.any(Number), 'low', false);
      });

      it('passes close target to sources', async () => {
        mockMexc.mockResolvedValueOnce(50000);

        await getCryptoPrice('btc', '2024-01-01 12:00:00', 'UTC', 'close', false);

        expect(mockMexc).toHaveBeenCalledWith('BTCUSDT', expect.any(Number), 'close', false);
      });

      it('defaults to high target', async () => {
        mockMexc.mockResolvedValueOnce(50500);

        await getCryptoPrice('btc', '2024-01-01 12:00:00', 'UTC');

        expect(mockMexc).toHaveBeenCalledWith('BTCUSDT', expect.any(Number), 'high', false);
      });
    });
  });
});
