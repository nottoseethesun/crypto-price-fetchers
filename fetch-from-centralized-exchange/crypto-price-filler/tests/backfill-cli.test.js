/**
 * Unit tests for backfill.js CLI entry point
 * @module tests/backfill-cli.test
 *
 * `fs` and csv-writer are stand-ins, so no file is read or written, and so
 * is config.js's `loadConfig`, whose settings each test sets.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { runBackfill, setupBackfillCommander } from "../backfill.js";
import { loadConfig } from "../config.js";

// Mock fs module
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual.default,
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// The settings, which each test sets
vi.mock("../config.js", () => ({ loadConfig: vi.fn() }));

// Mock csv-writer
vi.mock("csv-writer", () => ({
  createObjectCsvWriter: vi.fn(() => ({
    writeRecords: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockLoadConfig = vi.mocked(loadConfig);

// Sample CSV content for testing
const sampleCsvContent = `"date (UTC)","amount","$usd price","$usd amount","grand total ($usd)"
"2024-01-01 12:00:00","10","100","1000","1000"
"2024-01-02 12:00:00","20","Error","","1000"
"2024-01-03 12:00:00","15","200","3000","4000"`;

const sampleConfig = {
  BACKFILL_HIGHEST: false,
  BACKFILL_LOWEST: false,
};

beforeEach(() => {
  vi.clearAllMocks();

  // Default mocks
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(sampleCsvContent);
  mockLoadConfig.mockReturnValue(sampleConfig);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("backfill.js CLI", () => {
  describe("setupBackfillCommander", () => {
    it("creates a commander program with required options", () => {
      const program = setupBackfillCommander();

      expect(program.name()).toBe("backfill");
      expect(program.description()).toContain(
        'Backfill the prices the filler could not find, marked "Error"',
      );
    });

    it("has input option as required", () => {
      const program = setupBackfillCommander();
      const options = program.options;

      const inputOption = options.find((o) => o.long === "--input");
      expect(inputOption).toBeDefined();
      expect(inputOption.required).toBe(true);
    });

    it("has backfill-highest and backfill-lowest options", () => {
      const program = setupBackfillCommander();
      const options = program.options;

      const highestOption = options.find(
        (o) => o.long === "--backfill-highest",
      );
      const lowestOption = options.find((o) => o.long === "--backfill-lowest");

      expect(highestOption).toBeDefined();
      expect(lowestOption).toBeDefined();
    });
  });

  describe("runBackfill", () => {
    it("processes CSV file with backfill-highest", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const stats = await runBackfill({
        input: "test.csv",
        backfillHighest: true,
      });

      expect(stats.totalRows).toBe(3);
      expect(stats.blocksFound).toBe(1);
      expect(stats.emptyRowsFilled).toBe(1);

      consoleSpy.mockRestore();
    });

    it("processes CSV file with backfill-lowest", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const stats = await runBackfill({
        input: "test.csv",
        backfillLowest: true,
      });

      expect(stats.totalRows).toBe(3);
      expect(stats.blocksFound).toBe(1);
      expect(stats.emptyRowsFilled).toBe(1);

      consoleSpy.mockRestore();
    });

    it("throws error when neither backfill option is specified", async () => {
      await expect(
        runBackfill({
          input: "test.csv",
        }),
      ).rejects.toThrow("Must specify --backfill-highest or --backfill-lowest");
    });

    it("throws error when input file does not exist", async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(
        runBackfill({
          input: "nonexistent.csv",
          backfillHighest: true,
        }),
      ).rejects.toThrow("Input file not found");
    });

    it("throws error when CSV is empty", async () => {
      mockReadFileSync.mockReturnValue("");

      await expect(
        runBackfill({
          input: "empty.csv",
          backfillHighest: true,
        }),
      ).rejects.toThrow("Input CSV is empty");
    });

    it("takes its mode from the settings config.js reads when no flag is given", async () => {
      mockLoadConfig.mockReturnValue({ BACKFILL_HIGHEST: true });

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      // Should succeed without explicit backfill flag because config has it set
      const stats = await runBackfill({
        input: "test.csv",
      });

      expect(stats.emptyRowsFilled).toBe(1);
      expect(mockLoadConfig).toHaveBeenCalledTimes(1);

      consoleSpy.mockRestore();
    });

    it("expands ~ in input path", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runBackfill({
        input: "~/test.csv",
        backfillHighest: true,
      });

      // Should not throw - the path expansion happens internally
      consoleSpy.mockRestore();
    });

    it("defaults output to input file", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runBackfill({
        input: "test.csv",
        backfillHighest: true,
      });

      // Check that output message mentions the same file
      const outputLog = consoleSpy.mock.calls.find((c) =>
        c[0].includes("Output written"),
      );
      expect(outputLog[0]).toContain("test.csv");

      consoleSpy.mockRestore();
    });

    it("uses specified output file", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runBackfill({
        input: "test.csv",
        output: "backfilled.csv",
        backfillHighest: true,
      });

      const outputLog = consoleSpy.mock.calls.find((c) =>
        c[0].includes("Output written"),
      );
      expect(outputLog[0]).toContain("backfilled.csv");

      consoleSpy.mockRestore();
    });

    it("handles verbose mode", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runBackfill({
        input: "test.csv",
        backfillHighest: true,
        verbose: true,
      });

      const verboseLogs = consoleSpy.mock.calls.filter(
        (c) => c[0] && c[0].includes && c[0].includes("[VERBOSE"),
      );
      expect(verboseLogs.length).toBeGreaterThan(0);

      consoleSpy.mockRestore();
    });

    it("stops, saying why, when the settings cannot be read, even with a flag given", async () => {
      mockLoadConfig.mockImplementation(() => {
        throw new SyntaxError("Unexpected token } in JSON at position 9");
      });

      await expect(
        runBackfill({
          input: "test.csv",
          backfillHighest: true,
        }),
      ).rejects.toThrow("Unexpected token");
    });

    it("detects column names from CSV headers", async () => {
      const customCsv = `"date","qty","$usd price","$usd amount","grand total ($usd)"
"2024-01-01","10","100","1000","1000"
"2024-01-02","20","Error","","1000"
"2024-01-03","15","200","3000","4000"`;

      mockReadFileSync.mockReturnValue(customCsv);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const stats = await runBackfill({
        input: "test.csv",
        backfillHighest: true,
      });

      expect(stats.emptyRowsFilled).toBe(1);

      consoleSpy.mockRestore();
    });
  });
});
