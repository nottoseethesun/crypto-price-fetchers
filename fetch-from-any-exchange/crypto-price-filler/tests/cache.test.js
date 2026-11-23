/**
 * Unit tests for Cache utility
 * @module tests/cache.test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getCache,
  setCache,
  clearCache,
  cacheSize,
  setCacheClockForTests,
} from "../utils/cache.js";

/**
 * Sets the cache's clock to one a test moves by hand, starting at the
 * system's time, through the cache's seam.
 *
 * @returns {{advance: function(number): void}} Moves the clock on by the ms given
 */
function testClock() {
  let nowMs = Date.now();
  setCacheClockForTests(() => nowMs);
  return {
    advance(milliseconds) {
      nowMs += milliseconds;
    },
  };
}

describe("Cache Utils", () => {
  beforeEach(() => {
    clearCache();
  });

  afterEach(() => {
    setCacheClockForTests(null);
    clearCache();
  });

  describe("getCache", () => {
    it("returns undefined for non-existent key", () => {
      const value = getCache("non-existent-key");
      expect(value).toBeUndefined();
    });

    it("returns cached value for existing key", () => {
      setCache("test-key", 42.5);
      const value = getCache("test-key");
      expect(value).toBe(42.5);
    });

    it("returns null value when null was cached", () => {
      setCache("null-key", null);
      const value = getCache("null-key");
      expect(value).toBeNull();
    });
  });

  describe("setCache", () => {
    it("sets a value without TTL", () => {
      setCache("price-key", 100.25);
      expect(getCache("price-key")).toBe(100.25);
    });

    it("sets a value with TTL", () => {
      setCache("ttl-key", 50.5, 10000); // 10 second TTL
      expect(getCache("ttl-key")).toBe(50.5);
    });

    it("overwrites existing value", () => {
      setCache("overwrite-key", 10);
      setCache("overwrite-key", 20);
      expect(getCache("overwrite-key")).toBe(20);
    });
  });

  describe("TTL expiration", () => {
    it("returns value before TTL expires", () => {
      const clock = testClock();
      setCache("ttl-test", 123.45, 5000); // 5 second TTL

      // Advance 3 seconds - should still be valid
      clock.advance(3000);
      expect(getCache("ttl-test")).toBe(123.45);
    });

    it("returns undefined and deletes entry after TTL expires", () => {
      const clock = testClock();
      setCache("expired-key", 999.99, 1000); // 1 second TTL

      // Advance past expiration
      clock.advance(1500);
      const value = getCache("expired-key");

      expect(value).toBeUndefined();

      // The expired entry left the cache when it was asked for
      expect(cacheSize()).toBe(0);
    });

    it("does not expire entries without TTL", () => {
      const clock = testClock();
      setCache("no-ttl-key", 777.77); // No TTL

      // Advance a long time
      clock.advance(1000000);
      expect(getCache("no-ttl-key")).toBe(777.77);
    });
  });

  describe("clearCache", () => {
    it("removes all entries", () => {
      setCache("key1", 1);
      setCache("key2", 2);
      setCache("key3", 3);

      clearCache();

      expect(getCache("key1")).toBeUndefined();
      expect(getCache("key2")).toBeUndefined();
      expect(getCache("key3")).toBeUndefined();
    });

    it("results in empty cache", () => {
      setCache("some-key", 123);
      clearCache();
      expect(cacheSize()).toBe(0);
    });
  });

  describe("cacheSize", () => {
    it("returns 0 for empty cache", () => {
      clearCache();
      expect(cacheSize()).toBe(0);
    });

    it("returns correct count after adding entries", () => {
      setCache("a", 1);
      setCache("b", 2);
      setCache("c", 3);
      expect(cacheSize()).toBe(3);
    });

    it("returns correct count after removing entries", () => {
      setCache("x", 1);
      setCache("y", 2);
      clearCache();
      expect(cacheSize()).toBe(0);
    });
  });
});
