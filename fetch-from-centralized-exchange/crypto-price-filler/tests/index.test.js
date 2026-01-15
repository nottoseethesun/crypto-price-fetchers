import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import { getTimezoneOffsetHours, parseInputToUtcMs, getCryptoPrice, CONFIG, getCache, setCache } from '../index.js';
import fetch from 'node-fetch'; // Required for vi.mocked(fetch)
import fs from 'fs';
import { parse as csvParse } from 'csv-parse/sync';

// Verbose from env var (set by test:verbose script)
const verbose = process.env.VERBOSE === '1';

// Mock node-fetch globally
vi.mock('node-fetch', () => ({
  default: vi.fn()
}));

const mockFetch = vi.mocked(fetch);

let originalCache;

beforeEach(() => {
  vi.clearAllMocks();
  originalCache = getCache();
  setCache(new Map());
});

afterEach(() => {
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
      const result = parseInputToUtcMs('2025-12-19 00:17:00', 0, verbose);
      expect(result).toBeTypeOf('number');
      const dt = DateTime.fromMillis(result, { zone: 'utc' });
      expect(dt.year).toBe(2025);
      expect(dt.month).toBe(12);
      expect(dt.day).toBe(19);
      expect(dt.hour).toBe(0);
      expect(dt.minute).toBe(17);
    });

    it('correctly applies negative offset (CDT = -5)', () => {
      const result = parseInputToUtcMs('2025-12-19 00:17:00', -5, verbose);
      expect(result).toBeTypeOf('number');
      const dt = DateTime.fromMillis(result, { zone: 'utc' });
      expect(dt.hour).toBe(5);
      expect(dt.minute).toBe(17);
    });

    it('returns null for invalid date', () => {
      expect(parseInputToUtcMs('invalid', 0, verbose)).toBeNull();
      expect(parseInputToUtcMs('', 0, verbose)).toBeNull();
    });
  });

  describe('getCryptoPrice', () => {
    it('returns cached price if available', async () => {
      getCache().set('price_xtm_20251219001700_UTC_high', 42.5);

      mockFetch.mockResolvedValue({ ok: false });

      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose);
      expect(price).toBe(42.5);
    });

    it('tries MEXC first and returns price when successful', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            symbols: [{ baseAsset: 'XTM', quoteAsset: 'USDT' }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [[1766103360000, 0, 50.0, 40.0, 45.0, 1000]]
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [[0, 0, 50.0, 40.0, 45.0, 1000]]
        });

      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose);
      expect(price).toBe(50.0);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('falls back to CoinGecko when MEXC fails', async () => {
      mockFetch.mockReset(); // Clear any previous chain

      mockFetch
        .mockResolvedValueOnce({ ok: false }) // MEXC exchangeInfo fails completely
        .mockResolvedValueOnce({ ok: false }) // CoinGecko tickers fails
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            market_data: { current_price: { usd: 42.7 } }
          })
        }); // CoinGecko history succeeds

      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose);
      expect(price).toBe(42.7);
    });

    it('returns null when all sources fail', async () => {
      mockFetch.mockResolvedValue({ ok: false });

      const price = await getCryptoPrice('xtm', '2025-12-19 00:17:00', 'UTC', 'high', verbose);
      expect(price).toBeNull();
    });

    it('skips future dates', async () => {
      const future = DateTime.now().plus({ days: 1 }).toFormat('yyyy-MM-dd HH:mm:ss');
      const price = await getCryptoPrice('xtm', future, 'UTC', 'high', verbose);
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
