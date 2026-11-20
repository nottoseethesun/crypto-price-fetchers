/**
 * Tests for the Summ csv utility's text and rules: the columns of a
 * header (`summ-csv/columns.js`), how values become cells
 * (`summ-csv/values.js`), the rules a row must pass (`summ-csv/rules.js`)
 * and the text `summCsvText` gives. Part two, `summ-csv-files.test.js`,
 * covers the files: the template, the settings, writing a file, the
 * command line and what the package ships.
 * @module test/summ-csv.test
 *
 * Each test of a rule changes one value of a row that passes every rule
 * (`helpers/summ-csv-rows.js`), so the problem the test reads is that
 * value's alone.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SUMM_COLUMNS, columnKeysOf } from "../summ-csv/columns.js";
import { SUMM_TYPES, gasProblems, rowProblems } from "../summ-csv/rules.js";
import { summCsvText } from "../summ-csv/index.js";
import {
  HASH,
  HEX,
  MARCH_15,
  OTHER_HASH,
  POOL,
  WALLET,
  WPLS,
  summHeader,
  testSettings,
  tokenRow,
} from "./helpers/summ-csv-rows.js";

/**
 * The problems of one row under the test settings.
 *
 * @param {object} changes - The values to set in a row that passes
 * @returns {string[]} The row's problems
 */
function problemsOf(changes) {
  return rowProblems(tokenRow(changes), testSettings());
}

/**
 * The problems `summCsvText` names for some rows.
 *
 * @param {*} rows - The rows
 * @returns {string[]} The problems the thrown error holds
 */
function textProblems(rows) {
  try {
    summCsvText(rows, summHeader(), testSettings());
  } catch (thrown) {
    return thrown.problems;
  }
  throw new Error("summCsvText wrote rows it should have refused");
}

describe("columnKeysOf", () => {
  it("gives the key of each column of the owner's template, in its order", () => {
    assert.deepEqual(
      columnKeysOf(summHeader()),
      SUMM_COLUMNS.map((column) => column.key),
    );
  });

  it("follows the header's order, whatever it is", () => {
    const names = SUMM_COLUMNS.map((column) => column.name).reverse();

    assert.deepEqual(
      columnKeysOf(names.join(",")),
      SUMM_COLUMNS.map((column) => column.key).reverse(),
    );
  });

  it("refuses a column Summ's import does not have", () => {
    assert.throws(
      () => columnKeysOf(`${summHeader()},Notes`),
      /names a column Summ's import does not have: "Notes"/,
    );
  });

  it("refuses a header that lacks one of the sixteen columns", () => {
    const fifteen = SUMM_COLUMNS.slice(0, 15).map((column) => column.name);

    assert.throws(
      () => columnKeysOf(fifteen.join(",")),
      /lacks Contract Address: it needs Summ's sixteen columns/,
    );
  });

  it("refuses a column named twice", () => {
    assert.throws(
      () => columnKeysOf(`${summHeader()},Type`),
      /names a column twice: Type/,
    );
  });

  it("refuses a quoted name, which Summ's header never has", () => {
    assert.throws(
      () => columnKeysOf(summHeader().replace("Type", '"Type"')),
      /quotes a column name/,
    );
  });
});

describe("SUMM_TYPES", () => {
  it("holds the types the owner's files use", () => {
    for (const type of [
      "approval",
      "fee",
      "buy",
      "sell",
      "income",
      "spam",
      "send",
      "receive",
      "add-liquidity",
      "receive-lp-token",
      "remove-liquidity",
      "return-lp-token",
      "swap-in",
      "swap-out",
      "bridge-in",
      "bridge-out",
      "failed-out",
    ])
      assert.ok(SUMM_TYPES.includes(type), type);
  });
});

describe("summCsvText", () => {
  it("writes the header, then a line per row, each ended by a line feed", () => {
    const rows = [
      tokenRow({
        type: "sell",
        baseCurrency: "WPLS",
        baseAmount: "250000.5000",
        feeCurrency: "PLS",
        feeAmount: { raw: 951080289000000000000n, decimals: 18 },
        from: WALLET,
        to: POOL,
        description: "One side of a swap: 250,000.5 WPLS for HEX",
        contractAddress: WPLS,
      }),
      tokenRow({
        type: "buy",
        baseAmount: { raw: "75397114339500", decimals: 8 },
        description: 'The other side, "buy"',
      }),
      tokenRow({
        timestamp: "2026-03-24 19:15:35",
        type: "approval",
        baseCurrency: "PLS",
        baseAmount: "34.468551",
        from: WALLET,
        to: WPLS,
        id: OTHER_HASH,
        description: "",
        referencePrice: 2.15e-7,
        referencePriceCurrency: "USD",
        contractAddress: "",
      }),
    ];
    const wallet = WALLET.toLowerCase();
    const hex = HEX.toLowerCase();
    const wpls = WPLS.toLowerCase();

    assert.equal(
      summCsvText(rows, summHeader(), testSettings()),
      [
        summHeader(),
        `2026-03-15 11:38:05,sell,WPLS,250000.5,,,PLS,951.080289,${wallet},${POOL},pulsechain,${HASH},"One side of a swap: 250,000.5 WPLS for HEX",,,${wpls}`,
        `2026-03-15 11:38:05,buy,HEX,753971.143395,,,,,${POOL},${wallet},pulsechain,${HASH},"The other side, ""buy""",,,${hex}`,
        `2026-03-24 19:15:35,approval,PLS,34.468551,,,,,${wallet},${wpls},pulsechain,${OTHER_HASH},,0.000000215,USD,`,
        "",
      ].join("\n"),
    );
  });

  it("names every problem of every row, each with its row, and writes nothing", () => {
    const problems = textProblems([
      tokenRow(),
      tokenRow({ type: "recieve", from: "" }),
      null,
    ]);

    assert.deepEqual(problems, [
      "row 2: From is empty, and every row fills it",
      `row 2: type "recieve" is not one Summ's csv import takes`,
      "row 3: null is not an object of columns",
    ]);
  });

  it("lists the problems in the error's message", () => {
    assert.throws(
      () =>
        summCsvText([tokenRow({ type: "x" })], summHeader(), testSettings()),
      /^Error: Nothing was written: 1 problem\.\nrow 1: type "x"/,
    );
  });

  it("refuses to write a file without rows", () => {
    assert.deepEqual(textProblems([]), ["there are no rows to write"]);
    assert.deepEqual(textProblems("rows"), ["there are no rows to write"]);
  });

  it("refuses the gas of one transaction on a second row", () => {
    const gas = { feeCurrency: "PLS", feeAmount: "1.5" };

    assert.deepEqual(
      textProblems([
        tokenRow(gas),
        tokenRow({ ...gas, id: OTHER_HASH }),
        tokenRow({ ...gas, id: HASH.toUpperCase().replace("0X", "0x") }),
      ]),
      [
        `row 3: transaction ${HASH} already carries its gas on row 1, and gas goes on one row of a transaction`,
      ],
    );
  });

  it("writes a base58 chain's hashes and addresses in the case they come in", () => {
    const text = summCsvText(
      [
        tokenRow({
          blockchain: "base58chain",
          baseCurrency: "TST",
          contractAddress: "",
          from: "AbCd",
          to: "EfGh",
          id: "XyZ12",
        }),
      ],
      summHeader(),
      testSettings(),
    );

    assert.match(text, /,AbCd,EfGh,base58chain,XyZ12,/);
  });
});

describe("the rules of a row", () => {
  it("pass a row that keeps them", () => {
    assert.deepEqual(problemsOf({}), []);
  });

  it("refuse a key that is no column's, and text columns holding other things", () => {
    assert.deepEqual(problemsOf({ contractAdress: HEX, type: 5 }), [
      `"contractAdress" is not a column the utility writes`,
      "Type 5 is not text",
    ]);
  });

  it("refuse a row that is not an object of columns", () => {
    assert.deepEqual(rowProblems("a row", testSettings()), [
      `"a row" is not an object of columns`,
    ]);
    assert.deepEqual(rowProblems([], testSettings()), [
      "[] is not an object of columns",
    ]);
  });

  it("refuse an empty column every row fills", () => {
    assert.deepEqual(problemsOf({ timestamp: null, to: "" }), [
      "Timestamp is empty, and every row fills it",
      "To is empty, and every row fills it",
    ]);
  });

  it("refuse a quote, which would put a second token on the row", () => {
    assert.deepEqual(problemsOf({ quoteCurrency: "PLS" }), [
      "Quote Currency or Quote Amount is filled, but a row carries one token: a trade is a sell row and a buy row",
    ]);
  });

  it("refuse a time that is neither whole seconds nor a real time in Summ's form", () => {
    for (const timestamp of [
      1.5,
      -1,
      "2026-02-30 10:00:00",
      "2026-03-15T11:38:05Z",
      true,
    ])
      assert.equal(problemsOf({ timestamp }).length, 1, String(timestamp));
    assert.deepEqual(problemsOf({ timestamp: "2026-03-15 11:38:05" }), []);
    assert.deepEqual(problemsOf({ timestamp: MARCH_15 }), []);
  });

  it("refuse an amount a JavaScript number holds, since it may not hold it exactly", () => {
    assert.deepEqual(problemsOf({ baseAmount: 0.1 }), [
      "Base Amount 0.1 is a JavaScript number, which cannot hold every amount exactly: give it as decimal text or as {raw, decimals}",
    ]);
  });

  it("refuse an amount that is no plain decimal above zero", () => {
    for (const baseAmount of ["0", "0.000", "-1", "1e-7", "1,000", " 1"])
      assert.deepEqual(
        problemsOf({ baseAmount }),
        [`Base Amount "${baseAmount}" is not a plain decimal above zero`],
        baseAmount,
      );
  });

  it("refuse a raw amount of zero, of decimals out of range, or of other keys", () => {
    for (const baseAmount of [
      { raw: "0", decimals: 8 },
      { raw: 0n, decimals: 8 },
      { raw: "12", decimals: 256 },
      { raw: "12", decimals: 1.5 },
      { raw: "1.2", decimals: 8 },
      { raw: 12, decimals: 8 },
      { raw: "12", decimals: 8, symbol: "HEX" },
      { raw: "12" },
    ])
      assert.match(
        problemsOf({ baseAmount })[0],
        /^Base Amount .* is neither decimal text nor \{raw, decimals\}/,
      );
    assert.deepEqual(problemsOf({ baseAmount: { raw: 12n, decimals: 0 } }), []);
  });

  it("refuse a fee currency without an amount, or the reverse", () => {
    const message = [
      "Fee Currency and Fee Amount are filled together or not at all",
    ];

    assert.deepEqual(problemsOf({ feeCurrency: "PLS" }), message);
    assert.deepEqual(problemsOf({ feeAmount: "1" }), message);
  });

  it("refuse gas in anything but the chain's own coin", () => {
    assert.deepEqual(problemsOf({ feeCurrency: "HEX", feeAmount: "1" }), [
      `gas on pulsechain is paid in PLS, not "HEX"`,
    ]);
    assert.deepEqual(
      problemsOf({
        blockchain: "",
        id: "",
        feeCurrency: "BTC",
        feeAmount: "1",
      }),
      [],
    );
  });

  it("refuse a blockchain the settings lack", () => {
    assert.deepEqual(problemsOf({ blockchain: "ethereum" }), [
      `blockchain "ethereum" is not in the utility's settings (pulsechain, base58chain)`,
    ]);
  });

  it("refuse a row on a blockchain that names no transaction hash", () => {
    assert.deepEqual(problemsOf({ id: "" }), [
      "ID is empty, and a row on pulsechain names its transaction hash",
    ]);
  });

  it("refuse a hash or an address that lacks its chain's form", () => {
    assert.deepEqual(
      problemsOf({
        id: HASH.slice(0, 65),
        from: "0xZZ22222222222222222222222222222222222222",
        to: WALLET.slice(2),
        contractAddress: `${HEX}00`,
      }),
      [
        `ID "${HASH.slice(0, 65)}" is not a pulsechain transaction hash (0x and 64 hex digits)`,
        `From "0xZZ22222222222222222222222222222222222222" is not a pulsechain address (0x and 40 hex digits)`,
        `To "${WALLET.slice(2)}" is not a pulsechain address (0x and 40 hex digits)`,
        `Contract Address "${HEX}00" is not a pulsechain address (0x and 40 hex digits)`,
      ],
    );
  });

  it("hold a base58 chain to its least and most lengths, and its alphabet", () => {
    const row = {
      blockchain: "base58chain",
      baseCurrency: "TST",
      contractAddress: "",
      from: "AbCd",
      to: "EfGh",
    };

    assert.deepEqual(problemsOf({ ...row, id: "XyZ1" }), []);
    assert.deepEqual(problemsOf({ ...row, id: "XyZ1234" }), [
      `ID "XyZ1234" is not a base58chain transaction hash (4 to 6 base58 characters)`,
    ]);
    assert.deepEqual(problemsOf({ ...row, id: "XyZ0" }), [
      `ID "XyZ0" is not a base58chain transaction hash (4 to 6 base58 characters)`,
    ]);
  });

  it("refuse a contract address on the chain's own coin, which has none", () => {
    assert.deepEqual(problemsOf({ baseCurrency: "PLS" }), [
      "PLS is pulsechain's own coin and has no contract, but Contract Address is filled",
    ]);
  });

  it("refuse a token row without its contract", () => {
    assert.deepEqual(problemsOf({ contractAddress: "" }), [
      "HEX on pulsechain has no Contract Address, and every token row names its contract",
    ]);
  });

  it("refuse a reference price that is no price above zero", () => {
    for (const referencePrice of [0, -2, Number.NaN, Infinity, "1e-3", "abc"])
      assert.match(
        problemsOf({ referencePrice })[0],
        /^Reference Price Per Unit .* is not a number or plain decimal above zero$/,
      );
    assert.deepEqual(problemsOf({ referencePrice: "0.25" }), []);
  });

  it("refuse a reference currency without a price, or one not in the settings", () => {
    assert.deepEqual(problemsOf({ referencePriceCurrency: "USDT" }), [
      "Reference Price Currency is filled without a Reference Price Per Unit",
      `Reference Price Currency "USDT" is not one of the fiat currencies in the utility's settings (USD)`,
    ]);
  });
});

describe("gasProblems", () => {
  it("counts a transaction by its blockchain and its hash, and skips rows without gas", () => {
    const cells = [
      { blockchain: "pulsechain", id: HASH, feeAmount: "1" },
      { blockchain: "base58chain", id: HASH, feeAmount: "1" },
      { blockchain: "pulsechain", id: HASH, feeAmount: "" },
      { blockchain: "", id: "", feeAmount: "1" },
      { blockchain: "", id: "", feeAmount: "1" },
    ];

    assert.deepEqual(gasProblems(cells), []);
  });
});
