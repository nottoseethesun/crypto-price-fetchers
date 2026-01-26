/**
 * Unit tests for backfill price functionality
 * @module tests/backfill.test
 */

import { describe, it, expect, vi } from 'vitest';
import { backfillPrices, logv, isPriceEmpty, DEFAULT_COLUMNS } from '../utils/backfill.js';

// Helper to create test rows
function createRow(price, amount = '10') {
  return {
    '$usd price': price,
    'amount': amount,
    '$usd amount': '',
    'grand total ($usd)': ''
  };
}

// Default options for backfillPrices
const defaultOptions = {
  priceColName: '$usd price',
  amountColName: 'amount',
  usdAmountColName: '$usd amount',
  grandTotalColName: 'grand total ($usd)',
  useHighest: true,
  verbose: false
};

describe('utils/backfill', () => {
  describe('logv', () => {
    it('logs when shouldLog is true and level >= 1', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logv(true, 1, 'Test message', 'arg1', 'arg2');

      expect(consoleSpy).toHaveBeenCalledWith('[VERBOSE:1] Test message', 'arg1', 'arg2');
      consoleSpy.mockRestore();
    });

    it('does not log when shouldLog is false', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logv(false, 1, 'Test message');

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('does not log when level is 0', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logv(true, 0, 'Test message');

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('logs with correct level prefix', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logv(true, 3, 'Level 3 message');

      expect(consoleSpy).toHaveBeenCalledWith('[VERBOSE:3] Level 3 message');
      consoleSpy.mockRestore();
    });
  });

  describe('isPriceEmpty', () => {
    it('returns true for empty string', () => {
      expect(isPriceEmpty('')).toBe(true);
    });

    it('returns true for "Error"', () => {
      expect(isPriceEmpty('Error')).toBe(true);
    });

    it('returns true for null', () => {
      expect(isPriceEmpty(null)).toBe(true);
    });

    it('returns true for undefined', () => {
      expect(isPriceEmpty(undefined)).toBe(true);
    });

    it('returns false for valid price number', () => {
      expect(isPriceEmpty(10.5)).toBe(false);
    });

    it('returns false for price string', () => {
      expect(isPriceEmpty('10.5')).toBe(false);
    });

    it('returns false for zero', () => {
      expect(isPriceEmpty(0)).toBe(false);
    });
  });

  describe('DEFAULT_COLUMNS', () => {
    it('has expected column names', () => {
      expect(DEFAULT_COLUMNS.price).toBe('$usd price');
      expect(DEFAULT_COLUMNS.amount).toBe('amount');
      expect(DEFAULT_COLUMNS.usdAmount).toBe('$usd amount');
      expect(DEFAULT_COLUMNS.grandTotal).toBe('grand total ($usd)');
    });
  });

  describe('backfillPrices', () => {
    describe('middle block - highest', () => {
      it('fills empty prices with highest bracketing price', () => {
        const rows = [createRow(10), createRow(''), createRow(20)];

        const stats = backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[0]['$usd price']).toBe(10);
        expect(rows[1]['$usd price']).toBe(20);
        expect(rows[2]['$usd price']).toBe(20);
        expect(stats.emptyRowsFilled).toBe(1);
        expect(stats.blocksFound).toBe(1);
      });

      it('fills multiple empty rows with highest bracketing price', () => {
        const rows = [
          createRow(10), createRow(''), createRow(''), createRow(''), createRow(30)
        ];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[1]['$usd price']).toBe(30);
        expect(rows[2]['$usd price']).toBe(30);
        expect(rows[3]['$usd price']).toBe(30);
      });
    });

    describe('middle block - lowest', () => {
      it('fills empty prices with lowest bracketing price', () => {
        const rows = [createRow(10), createRow(''), createRow(20)];

        backfillPrices(rows, { ...defaultOptions, useHighest: false });

        expect(rows[0]['$usd price']).toBe(10);
        expect(rows[1]['$usd price']).toBe(10);
        expect(rows[2]['$usd price']).toBe(20);
      });

      it('fills multiple empty rows with lowest bracketing price', () => {
        const rows = [createRow(25), createRow(''), createRow(''), createRow(15)];

        backfillPrices(rows, { ...defaultOptions, useHighest: false });

        expect(rows[1]['$usd price']).toBe(15);
        expect(rows[2]['$usd price']).toBe(15);
      });
    });

    describe('empty at beginning', () => {
      it('uses first available price after empty block', () => {
        const rows = [createRow(''), createRow(''), createRow(15)];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[0]['$usd price']).toBe(15);
        expect(rows[1]['$usd price']).toBe(15);
        expect(rows[2]['$usd price']).toBe(15);
      });

      it('works with lowest mode too', () => {
        const rows = [createRow(''), createRow(25)];

        backfillPrices(rows, { ...defaultOptions, useHighest: false });

        expect(rows[0]['$usd price']).toBe(25);
      });
    });

    describe('empty at end', () => {
      it('uses last available price before empty block', () => {
        const rows = [createRow(10), createRow(''), createRow('')];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[0]['$usd price']).toBe(10);
        expect(rows[1]['$usd price']).toBe(10);
        expect(rows[2]['$usd price']).toBe(10);
      });
    });

    describe('Error values', () => {
      it('treats Error values as empty', () => {
        const rows = [createRow(10), createRow('Error'), createRow(20)];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[1]['$usd price']).toBe(20);
      });

      it('treats Error at beginning as empty', () => {
        const rows = [createRow('Error'), createRow(15)];

        backfillPrices(rows, { ...defaultOptions, useHighest: false });

        expect(rows[0]['$usd price']).toBe(15);
      });
    });

    describe('all rows empty', () => {
      it('makes no changes when all rows are empty', () => {
        const rows = [createRow(''), createRow(''), createRow('')];

        const stats = backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[0]['$usd price']).toBe('');
        expect(rows[1]['$usd price']).toBe('');
        expect(rows[2]['$usd price']).toBe('');
        expect(stats.emptyRowsFilled).toBe(0);
      });
    });

    describe('USD amounts and grand totals recalculation', () => {
      it('recalculates USD amounts after backfill', () => {
        const rows = [createRow(10, '5'), createRow('', '10'), createRow(20, '2')];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(parseFloat(rows[0]['$usd amount'])).toBe(50);
        expect(parseFloat(rows[1]['$usd amount'])).toBe(200);
        expect(parseFloat(rows[2]['$usd amount'])).toBe(40);
      });

      it('recalculates grand totals correctly', () => {
        const rows = [createRow(10, '5'), createRow('', '10'), createRow(20, '2')];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(parseFloat(rows[0]['grand total ($usd)'])).toBe(50);
        expect(parseFloat(rows[1]['grand total ($usd)'])).toBe(250);
        expect(parseFloat(rows[2]['grand total ($usd)'])).toBe(290);
      });
    });

    describe('multiple empty blocks', () => {
      it('handles multiple separate empty blocks', () => {
        const rows = [
          createRow(10), createRow(''), createRow(20), createRow(''), createRow(30)
        ];

        const stats = backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[1]['$usd price']).toBe(20);
        expect(rows[3]['$usd price']).toBe(30);
        expect(stats.blocksFound).toBe(2);
        expect(stats.emptyRowsFilled).toBe(2);
      });

      it('handles multiple separate empty blocks with lowest', () => {
        const rows = [
          createRow(10), createRow(''), createRow(20), createRow(''), createRow(5)
        ];

        backfillPrices(rows, { ...defaultOptions, useHighest: false });

        expect(rows[1]['$usd price']).toBe(10);
        expect(rows[3]['$usd price']).toBe(5);
      });
    });

    describe('edge cases', () => {
      it('handles single row with price', () => {
        const rows = [createRow(10)];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[0]['$usd price']).toBe(10);
      });

      it('handles single empty row', () => {
        const rows = [createRow('')];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[0]['$usd price']).toBe('');
      });

      it('handles empty array', () => {
        const rows = [];

        expect(() => {
          backfillPrices(rows, { ...defaultOptions, useHighest: true });
        }).not.toThrow();
      });

      it('handles null and undefined values', () => {
        const rows = [createRow(10), createRow(null), createRow(undefined), createRow(20)];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[1]['$usd price']).toBe(20);
        expect(rows[2]['$usd price']).toBe(20);
      });
    });

    describe('statistics', () => {
      it('returns correct statistics', () => {
        const rows = [
          createRow(10), createRow(''), createRow(''), createRow(20),
          createRow(''), createRow(30)
        ];

        const stats = backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(stats.totalRows).toBe(6);
        expect(stats.blocksFound).toBe(2);
        expect(stats.emptyRowsFilled).toBe(3);
      });
    });

    describe('verbose logging', () => {
      it('logs when verbose is enabled', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const rows = [createRow(10), createRow(''), createRow(20)];

        backfillPrices(rows, { ...defaultOptions, useHighest: true, verbose: true });

        expect(consoleSpy).toHaveBeenCalled();
        const logCalls = consoleSpy.mock.calls.map(c => c[0]);
        expect(logCalls.some(msg => msg.includes('Backfilling rows'))).toBe(true);

        consoleSpy.mockRestore();
      });
    });
  });
});
