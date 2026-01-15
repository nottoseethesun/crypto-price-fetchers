import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { getTimezoneOffsetHours, parseInputToUtcMs, CONFIG } from '../index.js';
import fs from 'fs';
import { parse as csvParse } from 'csv-parse/sync';

// Verbose from env var
const verbose = process.env.VERBOSE === '1';

describe('Crypto Price Filler Helpers', () => {
  describe('getTimezoneOffsetHours', () => {
    it('returns correct offset for known timezones', () => {
      expect(getTimezoneOffsetHours('CDT')).toBe(-5);
      expect(getTimezoneOffsetHours('UTC')).toBe(0);
      expect(getTimezoneOffsetHours('PST')).toBe(-8);
    });

    it('returns 0 for unknown timezone', () => {
      expect(getTimezoneOffsetHours('INVALID')).toBe(0);
      expect(getTimezoneOffsetHours('')).toBe(0);
    });
  });

  describe('parseInputToUtcMs', () => {
    it('parses valid date string correctly in UTC (offset 0)', () => {
      const result = parseInputToUtcMs('2025-12-19 00:17:00', 0, verbose);
      expect(result).toBeTypeOf('number');
      const dt = DateTime.fromMillis(result, { zone: 'utc' });
      expect(dt.year).toBe(2025);
      expect(dt.month).toBe(12);
      expect(dt.day).toBe(19);
      expect(dt.hour).toBe(0);
      expect(dt.minute).toBe(17);
    });

    it('correctly applies negative timezone offset (CDT = -5)', () => {
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
