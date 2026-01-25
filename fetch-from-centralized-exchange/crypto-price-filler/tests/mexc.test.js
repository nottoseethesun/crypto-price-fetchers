/**
 * Unit tests for MEXC price fetching module
 * @module tests/mexc.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPriceFromMEXC } from '../sources/mexc.js';
import * as fetchModule from '../utils/fetch.js';
import * as btcModule from '../sources/utils/btc.js';

// Mock fetch and BTC modules
vi.mock('../utils/fetch.js', () => ({
  fetchWithRetry: vi.fn()
}));

vi.mock('../sources/utils/btc.js', () => ({
  getBTCUSDTPrice: vi.fn()
}));

const mockFetch = vi.mocked(fetchModule.fetchWithRetry);
const mockGetBTCPrice = vi.mocked(btcModule.getBTCUSDTPrice);

// Mock exchange info with BTC pair only (no USDT pair)
const mockExchangeInfoBTCOnly = {
  symbols: [
    { symbol: 'XTMBTC', baseAsset: 'XTM', quoteAsset: 'BTC' }
  ]
};

// Mock exchange info with USDT pair
const mockExchangeInfoUSDT = {
  symbols: [
    { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' }
  ]
};

// Mock kline data
const mockKlineData = [
  [1704110400000, '0.00001', '0.000012', '0.000008', '0.000011', '1000000']
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MEXC Price Fetching', () => {
  describe('getPriceFromMEXC', () => {
    describe('skipped tokens', () => {
      it('returns null for GRC token (in skip list)', async () => {
        const price = await getPriceFromMEXC('grc', Date.now(), 'high', false);
        expect(price).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('returns null for GRC regardless of case', async () => {
        const price = await getPriceFromMEXC('GRC', Date.now(), 'high', false);
        expect(price).toBeNull();
      });
    });

    describe('cache behavior', () => {
      it('returns cached value when cache hit', async () => {
        const testCache = new Map();
        const utcMs = new Date('2024-01-01T12:00:00Z').getTime();
        testCache.set('price_btc_20240101120000_UTC_high', 50000);

        const price = await getPriceFromMEXC('btc', utcMs, 'high', false, testCache);

        expect(price).toBe(50000);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('sets cache when price is fetched with provided cache', async () => {
        const testCache = new Map();
        const utcMs = new Date('2024-01-01T12:00:00Z').getTime();

        // Mock successful fetch
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [[utcMs, '50000', '50500', '49500', '50200', '1000']]
          });

        const price = await getPriceFromMEXC('btc', utcMs, 'high', false, testCache);

        expect(price).toBe(50500);
        expect(testCache.size).toBe(1);
        expect(testCache.get('price_btc_20240101120000_UTC_high')).toBe(50500);
      });
    });

    describe('BTC pair handling', () => {
      it('converts BTC pair price to USD using BTC price', async () => {
        const utcMs = new Date('2024-01-01T12:00:00Z').getTime();

        // Mock exchange info returning only BTC pair
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoBTCOnly
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [[utcMs, '0.00001', '0.000012', '0.000008', '0.000011', '1000']]
          });

        // Mock BTC price
        mockGetBTCPrice.mockResolvedValueOnce(50000);

        const price = await getPriceFromMEXC('xtm', utcMs, 'high', false);

        // Price should be 0.000012 * 50000 = 0.6
        expect(price).toBeCloseTo(0.6, 5);
        expect(mockGetBTCPrice).toHaveBeenCalled();
      });

      it('returns null when BTC price fetch fails', async () => {
        const utcMs = new Date('2024-01-01T12:00:00Z').getTime();

        // Mock exchange info returning only BTC pair
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoBTCOnly
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [[utcMs, '0.00001', '0.000012', '0.000008', '0.000011', '1000']]
          });

        // Mock BTC price fetch failure
        mockGetBTCPrice.mockResolvedValueOnce(null);

        const price = await getPriceFromMEXC('xtm', utcMs, 'high', false);

        expect(price).toBeNull();
        expect(mockGetBTCPrice).toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('returns null when no symbol found', async () => {
        const utcMs = Date.now();

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ symbols: [] })
        });

        const price = await getPriceFromMEXC('unknowntoken', utcMs, 'high', false);

        expect(price).toBeNull();
      });

      it('returns null when exchange info JSON parse fails', async () => {
        const utcMs = Date.now();

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => { throw new Error('Invalid JSON'); }
        });

        const price = await getPriceFromMEXC('btc', utcMs, 'high', false);

        expect(price).toBeNull();
      });

      it('returns null when klines JSON parse fails', async () => {
        const utcMs = new Date('2024-01-01T12:00:00Z').getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => { throw new Error('Invalid JSON'); }
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => { throw new Error('Invalid JSON'); }
          });

        const price = await getPriceFromMEXC('btc', utcMs, 'high', false);

        expect(price).toBeNull();
      });

      it('returns null when exchange info request fails after retries', async () => {
        const utcMs = Date.now();

        // Return failed response for all retry attempts
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        });

        const price = await getPriceFromMEXC('btc', utcMs, 'high', false);

        expect(price).toBeNull();
      });

      it('returns null when price is NaN', async () => {
        const utcMs = new Date('2024-01-01T12:00:00Z').getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [[utcMs, 'invalid', 'invalid', 'invalid', 'invalid', '1000']]
          });

        const price = await getPriceFromMEXC('btc', utcMs, 'high', false);

        expect(price).toBeNull();
      });
    });

    describe('price target selection', () => {
      it('returns high price when target is high', async () => {
        const utcMs = new Date('2024-01-01T12:00:00Z').getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [[utcMs, '50000', '50500', '49500', '50200', '1000']]
          });

        const price = await getPriceFromMEXC('btc', utcMs, 'high', false);

        expect(price).toBe(50500); // candle[2] is high
      });

      it('returns low price when target is low', async () => {
        const utcMs = new Date('2024-01-01T12:00:00Z').getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [[utcMs, '50000', '50500', '49500', '50200', '1000']]
          });

        const price = await getPriceFromMEXC('btc', utcMs, 'low', false);

        expect(price).toBe(49500); // candle[3] is low
      });
    });

    describe('fallback interval', () => {
      it('uses fallback interval when 1m klines return empty', async () => {
        const utcMs = new Date('2024-01-01T12:00:00Z').getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT
          })
          // 1m klines returns empty
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => []
          })
          // 60m fallback klines returns data
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [[utcMs, '50000', '50500', '49500', '50200', '1000']]
          });

        const price = await getPriceFromMEXC('btc', utcMs, 'high', false);

        expect(price).toBe(50500);
        expect(mockFetch).toHaveBeenCalledTimes(3);
      });

      it('returns null when both intervals fail', async () => {
        const utcMs = new Date('2024-01-01T12:00:00Z').getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => []
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => []
          });

        const price = await getPriceFromMEXC('btc', utcMs, 'high', false);

        expect(price).toBeNull();
      });
    });

    describe('verbose logging', () => {
      it('logs when verbose is enabled', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const utcMs = new Date('2024-01-01T12:00:00Z').getTime();

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockExchangeInfoUSDT
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [[utcMs, '50000', '50500', '49500', '50200', '1000']]
          });

        await getPriceFromMEXC('btc', utcMs, 'high', true);

        expect(consoleSpy).toHaveBeenCalled();
        const logCalls = consoleSpy.mock.calls.map(c => c[0]);
        expect(logCalls.some(msg => msg && msg.includes('[VERBOSE'))).toBe(true);

        consoleSpy.mockRestore();
      });
    });
  });
});
