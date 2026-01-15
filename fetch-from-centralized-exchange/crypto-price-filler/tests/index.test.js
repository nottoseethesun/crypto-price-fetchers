import { describe, it, expect } from 'vitest';
import { parse, isValid } from 'date-fns';
import { getTimezoneOffsetHours, parseInputToUtcMs } from '../index.js';

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
      const result = parseInputToUtcMs('2025-12-19 00:17:00', 0);
      expect(result).toBeTypeOf('number');
      const date = new Date(result);
      expect(date.getUTCFullYear()).toBe(2025);
      expect(date.getUTCMonth()).toBe(11);
      expect(date.getUTCDate()).toBe(19);
      expect(date.getUTCHours()).toBe(0);   // Local 00:17 = UTC 00:17
      expect(date.getUTCMinutes()).toBe(17);
    });

    it('correctly applies negative timezone offset (CDT = -5)', () => {
      const result = parseInputToUtcMs('2025-12-19 00:17:00', -5);
      expect(result).toBeTypeOf('number');
      const date = new Date(result);
      expect(date.getUTCHours()).toBe(5);   // Local 00:17 in CDT → UTC 05:17
      expect(date.getUTCMinutes()).toBe(17);
    });

    it('returns null for invalid date', () => {
      expect(parseInputToUtcMs('invalid', 0)).toBeNull();
      expect(parseInputToUtcMs('', 0)).toBeNull();
    });
  });
});
