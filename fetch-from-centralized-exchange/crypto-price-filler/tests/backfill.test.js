/**
 * Unit tests for backfill price functionality
 * @module tests/backfill.test
 */

import { describe, it, expect } from "vitest";
import {
  backfillChoice,
  backfillPrices,
  isPriceEmpty,
  DEFAULT_COLUMNS,
} from "../utils/backfill.js";
import { logv } from "../utils/log.js";
import { logLines } from "./helpers/log-lines.js";

// Helper to create test rows
function createRow(price, amount = "10") {
  return {
    "$usd price": price,
    amount: amount,
    "$usd amount": "",
    "grand total ($usd)": "",
  };
}

// Default options for backfillPrices
const defaultOptions = {
  priceColName: "$usd price",
  amountColName: "amount",
  usdAmountColName: "$usd amount",
  grandTotalColName: "grand total ($usd)",
  useHighest: true,
  verbose: false,
};

describe("utils/backfill", () => {
  describe("logv", () => {
    it("logs when shouldLog is true and level >= 1", () => {
      const printed = logLines();

      logv(true, 1, "Test message", "arg1", "arg2");

      expect(printed).toHaveBeenCalledWith(
        "[VERBOSE:1] Test message",
        "arg1",
        "arg2",
      );
    });

    it("does not log when shouldLog is false", () => {
      const printed = logLines();

      logv(false, 1, "Test message");

      expect(printed).not.toHaveBeenCalled();
    });

    it("does not log when level is 0", () => {
      const printed = logLines();

      logv(true, 0, "Test message");

      expect(printed).not.toHaveBeenCalled();
    });

    it("logs with correct level prefix", () => {
      const printed = logLines();

      logv(true, 3, "Level 3 message");

      expect(printed).toHaveBeenCalledWith("[VERBOSE:3] Level 3 message");
    });
  });

  describe("isPriceEmpty", () => {
    it('returns true for "Error", the price the filler could not find', () => {
      expect(isPriceEmpty("Error")).toBe(true);
    });

    it("returns false for a blank price, which marks a row that holds no data", () => {
      expect(isPriceEmpty("")).toBe(false);
    });

    it("returns false for null and undefined", () => {
      expect(isPriceEmpty(null)).toBe(false);
      expect(isPriceEmpty(undefined)).toBe(false);
    });

    it("returns false for valid price number", () => {
      expect(isPriceEmpty(10.5)).toBe(false);
    });

    it("returns false for price string", () => {
      expect(isPriceEmpty("10.5")).toBe(false);
    });

    it("returns false for zero", () => {
      expect(isPriceEmpty(0)).toBe(false);
    });
  });

  describe("DEFAULT_COLUMNS", () => {
    it("has expected column names", () => {
      expect(DEFAULT_COLUMNS.price).toBe("$usd price");
      expect(DEFAULT_COLUMNS.amount).toBe("amount");
      expect(DEFAULT_COLUMNS.usdAmount).toBe("$usd amount");
      expect(DEFAULT_COLUMNS.grandTotal).toBe("grand total ($usd)");
    });
  });

  describe("backfillPrices", () => {
    describe("middle block - highest", () => {
      it("fills empty prices with highest bracketing price", () => {
        const rows = [createRow(10), createRow("Error"), createRow(20)];

        const stats = backfillPrices(rows, {
          ...defaultOptions,
          useHighest: true,
        });

        expect(rows[0]["$usd price"]).toBe(10);
        expect(rows[1]["$usd price"]).toBe(20);
        expect(rows[2]["$usd price"]).toBe(20);
        expect(stats.emptyRowsFilled).toBe(1);
        expect(stats.blocksFound).toBe(1);
      });

      it("fills multiple empty rows with highest bracketing price", () => {
        const rows = [
          createRow(10),
          createRow("Error"),
          createRow("Error"),
          createRow("Error"),
          createRow(30),
        ];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[1]["$usd price"]).toBe(30);
        expect(rows[2]["$usd price"]).toBe(30);
        expect(rows[3]["$usd price"]).toBe(30);
      });
    });

    describe("middle block - lowest", () => {
      it("fills empty prices with lowest bracketing price", () => {
        const rows = [createRow(10), createRow("Error"), createRow(20)];

        backfillPrices(rows, { ...defaultOptions, useHighest: false });

        expect(rows[0]["$usd price"]).toBe(10);
        expect(rows[1]["$usd price"]).toBe(10);
        expect(rows[2]["$usd price"]).toBe(20);
      });

      it("fills multiple empty rows with lowest bracketing price", () => {
        const rows = [
          createRow(25),
          createRow("Error"),
          createRow("Error"),
          createRow(15),
        ];

        backfillPrices(rows, { ...defaultOptions, useHighest: false });

        expect(rows[1]["$usd price"]).toBe(15);
        expect(rows[2]["$usd price"]).toBe(15);
      });
    });

    describe("empty at beginning", () => {
      it("uses first available price after empty block", () => {
        const rows = [createRow("Error"), createRow("Error"), createRow(15)];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[0]["$usd price"]).toBe(15);
        expect(rows[1]["$usd price"]).toBe(15);
        expect(rows[2]["$usd price"]).toBe(15);
      });

      it("works with lowest mode too", () => {
        const rows = [createRow("Error"), createRow(25)];

        backfillPrices(rows, { ...defaultOptions, useHighest: false });

        expect(rows[0]["$usd price"]).toBe(25);
      });
    });

    describe("empty at end", () => {
      it("uses last available price before empty block", () => {
        const rows = [createRow(10), createRow("Error"), createRow("Error")];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[0]["$usd price"]).toBe(10);
        expect(rows[1]["$usd price"]).toBe(10);
        expect(rows[2]["$usd price"]).toBe(10);
      });
    });

    describe("Error values", () => {
      it("treats Error values as empty", () => {
        const rows = [createRow(10), createRow("Error"), createRow(20)];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[1]["$usd price"]).toBe(20);
      });

      it("treats Error at beginning as empty", () => {
        const rows = [createRow("Error"), createRow(15)];

        backfillPrices(rows, { ...defaultOptions, useHighest: false });

        expect(rows[0]["$usd price"]).toBe(15);
      });
    });

    describe("all rows empty", () => {
      it("makes no changes when all rows are empty", () => {
        const rows = [
          createRow("Error"),
          createRow("Error"),
          createRow("Error"),
        ];

        const stats = backfillPrices(rows, {
          ...defaultOptions,
          useHighest: true,
        });

        expect(rows[0]["$usd price"]).toBe("Error");
        expect(rows[1]["$usd price"]).toBe("Error");
        expect(rows[2]["$usd price"]).toBe("Error");
        expect(stats.emptyRowsFilled).toBe(0);
      });
    });

    describe("USD amounts and grand totals recalculation", () => {
      it("recalculates USD amounts after backfill", () => {
        const rows = [
          createRow(10, "5"),
          createRow("Error", "10"),
          createRow(20, "2"),
        ];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(parseFloat(rows[0]["$usd amount"])).toBe(50);
        expect(parseFloat(rows[1]["$usd amount"])).toBe(200);
        expect(parseFloat(rows[2]["$usd amount"])).toBe(40);
      });

      it("recalculates grand totals correctly", () => {
        const rows = [
          createRow(10, "5"),
          createRow("Error", "10"),
          createRow(20, "2"),
        ];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(parseFloat(rows[0]["grand total ($usd)"])).toBe(50);
        expect(parseFloat(rows[1]["grand total ($usd)"])).toBe(250);
        expect(parseFloat(rows[2]["grand total ($usd)"])).toBe(290);
      });
    });

    describe("multiple empty blocks", () => {
      it("handles multiple separate empty blocks", () => {
        const rows = [
          createRow(10),
          createRow("Error"),
          createRow(20),
          createRow("Error"),
          createRow(30),
        ];

        const stats = backfillPrices(rows, {
          ...defaultOptions,
          useHighest: true,
        });

        expect(rows[1]["$usd price"]).toBe(20);
        expect(rows[3]["$usd price"]).toBe(30);
        expect(stats.blocksFound).toBe(2);
        expect(stats.emptyRowsFilled).toBe(2);
      });

      it("handles multiple separate empty blocks with lowest", () => {
        const rows = [
          createRow(10),
          createRow("Error"),
          createRow(20),
          createRow("Error"),
          createRow(5),
        ];

        backfillPrices(rows, { ...defaultOptions, useHighest: false });

        expect(rows[1]["$usd price"]).toBe(10);
        expect(rows[3]["$usd price"]).toBe(5);
      });
    });

    describe("edge cases", () => {
      it("handles single row with price", () => {
        const rows = [createRow(10)];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[0]["$usd price"]).toBe(10);
      });

      it("handles single empty row", () => {
        const rows = [createRow("Error")];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[0]["$usd price"]).toBe("Error");
      });

      it("handles empty array", () => {
        const rows = [];

        expect(() => {
          backfillPrices(rows, { ...defaultOptions, useHighest: true });
        }).not.toThrow();
      });

      it("leaves a blank, null or undefined price as it is, as a row that holds no data", () => {
        const rows = [
          createRow(10),
          createRow(""),
          createRow(null),
          createRow(undefined),
          createRow(20),
        ];

        backfillPrices(rows, { ...defaultOptions, useHighest: true });

        expect(rows[1]["$usd price"]).toBe("");
        expect(rows[2]["$usd price"]).toBe(null);
        expect(rows[3]["$usd price"]).toBe(undefined);
        expect(rows[4]["grand total ($usd)"]).toBe((300).toFixed(6));
      });
    });

    describe("statistics", () => {
      it("returns correct statistics", () => {
        const rows = [
          createRow(10),
          createRow("Error"),
          createRow("Error"),
          createRow(20),
          createRow("Error"),
          createRow(30),
        ];

        const stats = backfillPrices(rows, {
          ...defaultOptions,
          useHighest: true,
        });

        expect(stats.totalRows).toBe(6);
        expect(stats.blocksFound).toBe(2);
        expect(stats.emptyRowsFilled).toBe(3);
      });
    });

    describe("verbose logging", () => {
      it("logs when verbose is enabled", () => {
        const printed = logLines();
        const rows = [createRow(10), createRow("Error"), createRow(20)];

        backfillPrices(rows, {
          ...defaultOptions,
          useHighest: true,
          verbose: true,
        });

        expect(printed).toHaveBeenCalled();
        const logCalls = printed.mock.calls.map((c) => c[0]);
        expect(logCalls.some((msg) => msg.includes("Backfilling rows"))).toBe(
          true,
        );
      });
    });
  });
});

describe("backfillChoice", () => {
  it("turns a mode on when its flag is given or config.json's setting is true", () => {
    const none = { BACKFILL_HIGHEST: false, BACKFILL_LOWEST: false };
    expect(backfillChoice({}, none)).toEqual({ highest: false, lowest: false });
    expect(backfillChoice({ backfillHighest: true }, none)).toEqual({
      highest: true,
      lowest: false,
    });
    expect(backfillChoice({}, { BACKFILL_LOWEST: true })).toEqual({
      highest: false,
      lowest: true,
    });
    expect(
      backfillChoice({ backfillLowest: true }, { BACKFILL_HIGHEST: true }),
    ).toEqual({ highest: true, lowest: true });
  });

  it("takes only true as on, from a flag or a setting", () => {
    expect(
      backfillChoice(
        { backfillHighest: "yes" },
        { BACKFILL_HIGHEST: 1, BACKFILL_LOWEST: "true" },
      ),
    ).toEqual({ highest: false, lowest: false });
  });
});
