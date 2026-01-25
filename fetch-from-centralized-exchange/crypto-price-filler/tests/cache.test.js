/**
 * Unit tests for Cache utility
 * @module tests/cache.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCache, setCache, clearCache, replaceCache, cacheSize } from '../utils/cache.js';

describe('Cache Utils', () => {
  beforeEach(() => {
    clearCache();
  });

  afterEach(() => {
    clearCache();
  });

  describe('getCache', () => {
    it('returns the entire Map when no key is provided', () => {
      const cache = getCache();
      expect(cache instanceof Map).toBe(true);
    });

    it('returns undefined for non-existent key', () => {
      const value = getCache('non-existent-key');
      expect(value).toBeUndefined();
    });

    it('returns cached value for existing key', () => {
      setCache('test-key', 42.5);
      const value = getCache('test-key');
      expect(value).toBe(42.5);
    });

    it('returns null value when null was cached', () => {
      setCache('null-key', null);
      const value = getCache('null-key');
      expect(value).toBeNull();
    });
  });

  describe('setCache', () => {
    it('sets a value without TTL', () => {
      setCache('price-key', 100.25);
      expect(getCache('price-key')).toBe(100.25);
    });

    it('sets a value with TTL', () => {
      setCache('ttl-key', 50.5, 10000); // 10 second TTL
      expect(getCache('ttl-key')).toBe(50.5);
    });

    it('overwrites existing value', () => {
      setCache('overwrite-key', 10);
      setCache('overwrite-key', 20);
      expect(getCache('overwrite-key')).toBe(20);
    });
  });

  describe('TTL expiration', () => {
    it('returns value before TTL expires', () => {
      vi.useFakeTimers();
      setCache('ttl-test', 123.45, 5000); // 5 second TTL

      // Advance 3 seconds - should still be valid
      vi.advanceTimersByTime(3000);
      expect(getCache('ttl-test')).toBe(123.45);

      vi.useRealTimers();
    });

    it('returns undefined and deletes entry after TTL expires', () => {
      vi.useFakeTimers();
      setCache('expired-key', 999.99, 1000); // 1 second TTL

      // Advance past expiration
      vi.advanceTimersByTime(1500);
      const value = getCache('expired-key');

      expect(value).toBeUndefined();

      // Verify it was deleted from cache
      const cache = getCache();
      expect(cache.has('expired-key')).toBe(false);

      vi.useRealTimers();
    });

    it('does not expire entries without TTL', () => {
      vi.useFakeTimers();
      setCache('no-ttl-key', 777.77); // No TTL

      // Advance a long time
      vi.advanceTimersByTime(1000000);
      expect(getCache('no-ttl-key')).toBe(777.77);

      vi.useRealTimers();
    });
  });

  describe('clearCache', () => {
    it('removes all entries', () => {
      setCache('key1', 1);
      setCache('key2', 2);
      setCache('key3', 3);

      clearCache();

      expect(getCache('key1')).toBeUndefined();
      expect(getCache('key2')).toBeUndefined();
      expect(getCache('key3')).toBeUndefined();
    });

    it('results in empty cache', () => {
      setCache('some-key', 123);
      clearCache();
      expect(cacheSize()).toBe(0);
    });
  });

  describe('replaceCache', () => {
    it('replaces the cache with a new Map', () => {
      setCache('old-key', 'old-value');

      const newMap = new Map();
      newMap.set('new-key', { value: 'new-value', expires: null });

      const result = replaceCache(newMap);

      expect(result).toBe(newMap);
    });

    it('returns the new cache', () => {
      const newMap = new Map();
      const result = replaceCache(newMap);
      expect(result).toBe(newMap);
    });
  });

  describe('cacheSize', () => {
    it('returns 0 for empty cache', () => {
      clearCache();
      expect(cacheSize()).toBe(0);
    });

    it('returns correct count after adding entries', () => {
      setCache('a', 1);
      setCache('b', 2);
      setCache('c', 3);
      expect(cacheSize()).toBe(3);
    });

    it('returns correct count after removing entries', () => {
      setCache('x', 1);
      setCache('y', 2);
      clearCache();
      expect(cacheSize()).toBe(0);
    });
  });
});
