/**
 * Tests of the helpers the command line uses, the time zones and the
 * parsing of a date, and of the command line itself, run as a program of
 * its own.
 * @module tests/index.test
 */

import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  canonicalTimeZone,
  parseInputToUtcMs,
  validTimeZones,
} from "../utils/date.js";
import fs from "fs";
import { parse as csvParse } from "csv-parse/sync";

const verbose = process.env.VERBOSE === "1";

describe("Crypto Price Filler Helpers", () => {
  describe("canonicalTimeZone", () => {
    it("takes a zone named in full, or UTC, in any letter case, and spells it as the list does", () => {
      expect(canonicalTimeZone("America/Chicago")).toBe("America/Chicago");
      expect(canonicalTimeZone("america/chicago")).toBe("America/Chicago");
      expect(canonicalTimeZone("utc")).toBe("UTC");
      expect(validTimeZones()).toContain("Europe/London");
    });

    it("refuses abbreviations, unknown names and non-strings", () => {
      expect(canonicalTimeZone("CDT")).toBeNull();
      expect(canonicalTimeZone("EST")).toBeNull();
      expect(canonicalTimeZone("INVALID")).toBeNull();
      expect(canonicalTimeZone("")).toBeNull();
      expect(canonicalTimeZone(null)).toBeNull();
    });
  });

  describe("parseInputToUtcMs", () => {
    it("parses valid date in UTC", () => {
      if (verbose) console.log("[TEST] Starting UTC parse test");
      const result = parseInputToUtcMs("2025-12-19 00:17:00", "UTC", verbose);
      expect(result).toBeTypeOf("number");
      const dt = DateTime.fromMillis(result, { zone: "utc" });
      if (verbose)
        console.log("[TEST] Parsed UTC time (offset 0):", dt.toISO());
      expect(dt.year).toBe(2025);
      expect(dt.month).toBe(12);
      expect(dt.day).toBe(19);
      expect(dt.hour).toBe(0);
      expect(dt.minute).toBe(17);
    });

    it("applies the offset the zone had then: Chicago is UTC-6 in December", () => {
      if (verbose) console.log("[TEST] Starting Chicago winter parse test");
      const result = parseInputToUtcMs(
        "2025-12-19 00:17:00",
        "America/Chicago",
        verbose,
      );
      expect(result).toBeTypeOf("number");
      const dt = DateTime.fromMillis(result, { zone: "utc" });
      if (verbose)
        console.log("[TEST] Parsed UTC time (Chicago, winter):", dt.toISO());
      expect(dt.hour).toBe(6);
      expect(dt.minute).toBe(17);
    });

    it("returns null for invalid date", () => {
      if (verbose) console.log("[TEST] Testing invalid date");
      expect(parseInputToUtcMs("invalid", "UTC", verbose)).toBeNull();
      expect(parseInputToUtcMs("", "UTC", verbose)).toBeNull();
    });

    it("refuses a time zone that is not named in full or UTC", () => {
      expect(() => parseInputToUtcMs("2025-12-19 00:17:00", "CDT")).toThrow(
        /Not a valid time zone: CDT/,
      );
    });
  });

  describe("CSV Parsing", () => {
    it("parses tests/mock-input.csv correctly", () => {
      const csvContent = fs.readFileSync("tests/mock-input.csv", "utf8");
      const records = csvParse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        delimiter: ",",
        quote: '"',
        relax_column_count: true,
      });

      expect(records.length).toBeGreaterThan(0);
      expect(records[0]["date (UTC)"]).toBe("2025-02-01 00:00:00");
      expect(records[0]["amount"]).toBe("10.5");
    });
  });

  // Smoke/integration test for the CLI entry point (index.js)
  describe("CLI entry point (index.js) smoke/integration test", () => {
    const { execSync } = require("child_process");
    const path = require("path");

    const indexPath = path.resolve(__dirname, "../index.js");

    it("parses and runs --help without crashing (exit 0 expected)", () => {
      const output = execSync(`node ${indexPath} --help`, {
        encoding: "utf8",
        stdio: "pipe",
        timeout: 2000,
      });

      expect(output).toContain("crypto-price-filler");
      expect(output).toContain("--token");
    });

    it("fails gracefully on missing required args (exit 1 expected)", () => {
      let exitedWithError = false;
      let exitCode = 0;

      try {
        execSync(`node ${indexPath}`, { stdio: "ignore", timeout: 2000 });
      } catch (err) {
        exitedWithError = true;
        exitCode = err.status;
      }

      expect(exitedWithError).toBe(true);
      expect(exitCode).toBe(1);
    });

    it("parses minimal valid args without crashing (quick smoke)", () => {
      let exitedWithError = false;
      let exitCode = 0;

      try {
        execSync(
          `node ${indexPath} --token=xtm --input=/dev/null --output=/dev/null`,
          {
            stdio: "ignore",
            timeout: 1500,
          },
        );
      } catch (err) {
        exitedWithError = true;
        exitCode = err.status;
      }

      expect(exitedWithError).toBe(true);
      expect(exitCode).toBe(1); // Expect graceful exit 1 on invalid/empty CSV
    });
  });
});
