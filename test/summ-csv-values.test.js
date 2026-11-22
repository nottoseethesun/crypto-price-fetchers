/**
 * Tests for how the Summ csv utility turns a row's values into the text of
 * csv cells: `summ-csv/values.js`. `summ-csv.test.js` tests the rules and
 * the text of a whole file, and `summ-csv-files.test.js` the files.
 * @module test/summ-csv-values.test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  amountText,
  csvField,
  decimalFromRaw,
  fitsForm,
  formText,
  isSummTimestamp,
  plainNumberText,
  timestampText,
  trimDecimal,
} from "../summ-csv/values.js";

/** PulseChain's form of an address. */
const ADDRESS = { prefix: "0x", alphabet: "hex", length: 40 };

describe("trimDecimal", () => {
  it("drops the zeros that change nothing, and a point with nothing after it", () => {
    assert.equal(trimDecimal("012.500"), "12.5");
    assert.equal(trimDecimal("0.000001"), "0.000001");
    assert.equal(trimDecimal("100"), "100");
    assert.equal(trimDecimal("100.0"), "100");
    assert.equal(trimDecimal("000"), "0");
  });
});

describe("decimalFromRaw", () => {
  it("cuts the digits of a token's smallest units at its decimals", () => {
    assert.equal(decimalFromRaw(8355037234293n, 8), "83550.37234293");
    assert.equal(decimalFromRaw("1", 18), "0.000000000000000001");
    assert.equal(decimalFromRaw(1000000000000000000n, 18), "1");
    assert.equal(decimalFromRaw("42", 0), "42");
  });

  it("writes nothing but 0 for an amount of 0, and takes decimals up to 255", () => {
    assert.equal(decimalFromRaw(0n, 8), "0");
    assert.equal(decimalFromRaw(5n, 255), `0.${"0".repeat(254)}5`);
  });

  it("keeps every digit of an amount no JavaScript number holds", () => {
    assert.equal(
      decimalFromRaw(123456789012345678901234567890n, 18),
      "123456789012.34567890123456789",
    );
  });
});

describe("amountText", () => {
  it("trims decimal text, and spells out {raw, decimals}", () => {
    assert.equal(amountText("5.10"), "5.1");
    assert.equal(amountText({ raw: "510", decimals: 2 }), "5.1");
  });
});

describe("plainNumberText", () => {
  it("leaves a number String writes without an exponent as String writes it", () => {
    assert.equal(plainNumberText(123.456), "123.456");
    assert.equal(plainNumberText(0.0010421), "0.0010421");
  });

  it("spreads out a small number's exponent form", () => {
    assert.equal(plainNumberText(1.5e-7), "0.00000015");
    assert.equal(plainNumberText(1e-7), "0.0000001");
  });

  it("spreads out a large number's exponent form", () => {
    assert.equal(plainNumberText(1e21), "1000000000000000000000");
    assert.equal(plainNumberText(1.25e21), "1250000000000000000000");
  });
});

describe("timestampText and isSummTimestamp", () => {
  it("write seconds since 1970 as Summ's time, in UTC", () => {
    assert.equal(timestampText(1773574685), "2026-03-15 11:38:05");
    assert.equal(timestampText(0), "1970-01-01 00:00:00");
  });

  it("take a real time in Summ's form, and nothing else", () => {
    assert.equal(isSummTimestamp("2026-03-15 11:38:05"), true);
    assert.equal(isSummTimestamp("2024-02-29 23:59:59"), true);
    assert.equal(isSummTimestamp("2026-02-29 00:00:00"), false);
    assert.equal(isSummTimestamp("2026-03-15 24:00:00"), false);
    assert.equal(isSummTimestamp("2026-3-15 11:38:05"), false);
    assert.equal(isSummTimestamp("2026-03-15 11:38:05 "), false);
  });
});

describe("fitsForm and formText", () => {
  it("take text of the form's prefix, alphabet and length", () => {
    assert.equal(fitsForm(`0x${"aB".repeat(20)}`, ADDRESS), true);
    assert.equal(fitsForm(`0x${"aB".repeat(19)}`, ADDRESS), false);
    assert.equal(fitsForm(`0X${"ab".repeat(20)}`, ADDRESS), false);
    assert.equal(fitsForm(`0x${"ag".repeat(20)}`, ADDRESS), false);
  });

  it("put a form in words", () => {
    assert.equal(formText(ADDRESS), "0x and 40 hex digits");
    assert.equal(
      formText({
        prefix: "",
        alphabet: "base58",
        minLength: 32,
        maxLength: 44,
      }),
      "32 to 44 base58 characters",
    );
  });

  it("refuse an alphabet the utility does not know, since nothing could be checked", () => {
    const form = { prefix: "", alphabet: "bech32", length: 4 };

    assert.throws(
      () => fitsForm("abcd", form),
      /settings name an alphabet the utility does not know: "bech32" \(it knows hex, base58\)/,
    );
    assert.throws(() => formText(form), /"bech32"/);
  });
});

describe("csvField", () => {
  it("quotes a cell holding a comma, a quote or a line break, doubling each quote", () => {
    assert.equal(csvField("plain text"), "plain text");
    assert.equal(csvField("a,b"), '"a,b"');
    assert.equal(csvField('say "hi"'), '"say ""hi"""');
    assert.equal(csvField("two\nlines"), '"two\nlines"');
    assert.equal(csvField(""), "");
  });
});
