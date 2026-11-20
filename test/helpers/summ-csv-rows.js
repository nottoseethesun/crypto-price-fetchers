/**
 * Rows, a template and settings for the tests of the Summ csv utility.
 * @module test/helpers/summ-csv-rows
 *
 * The rows are made up. Their wallets and transaction hashes are runs of
 * one digit, so no address of the owner's is in this public repo; their
 * tokens are PulseChain's HEX and wrapped PLS, whose contracts are
 * public. `tokenRow` gives a row that passes every rule, which a test
 * changes in the one value it is about. `summTemplate` is a template as
 * the owner keeps his, `test/fixtures/summ-template.csv`, whose header
 * pads two names. `testSettings` is the shipped settings with a made-up
 * chain beside PulseChain, whose hashes and addresses are base58, so the
 * rules for a form of either alphabet are tested.
 */

import { fileURLToPath } from "node:url";
import {
  readSummCsvSettings,
  readTemplateHeader,
} from "../../summ-csv/index.js";

/** The owner's wallet, in a row: made up, and in mixed case. */
export const WALLET = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";

/** A pool the wallet trades with: made up. */
export const POOL = "0x2222222222222222222222222222222222222222";

/** HEX's contract on PulseChain. */
export const HEX = "0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39";

/** Wrapped PLS's contract on PulseChain. */
export const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

/** A transaction's hash: made up. */
export const HASH = `0x${"ab".repeat(32)}`;

/** Another transaction's hash: made up. */
export const OTHER_HASH = `0x${"cd".repeat(32)}`;

/** 2026-03-15 11:38:05 UTC, in seconds since 1970. */
export const MARCH_15 = 1773574685;

/**
 * The template, as a path.
 *
 * @returns {string} `test/fixtures/summ-template.csv`
 */
export function summTemplate() {
  return fileURLToPath(
    new URL("../fixtures/summ-template.csv", import.meta.url),
  );
}

/**
 * The template's header.
 *
 * @returns {string} Its first line
 */
export function summHeader() {
  return readTemplateHeader(summTemplate());
}

/**
 * The shipped settings, with a made-up chain whose hashes and addresses
 * are base58 of 4 to 6 characters, and whose own coin is `TST`.
 *
 * @returns {object} The settings
 */
export function testSettings() {
  const shipped = readSummCsvSettings();
  return {
    ...shipped,
    chains: {
      ...shipped.chains,
      base58chain: {
        ownCoin: "TST",
        transactionHash: {
          prefix: "",
          alphabet: "base58",
          minLength: 4,
          maxLength: 6,
        },
        address: { prefix: "", alphabet: "base58", length: 4 },
      },
    },
  };
}

/**
 * A row that passes every rule: HEX received as income on PulseChain,
 * changed by what the test gives.
 *
 * @param {object} [changes] - The values to set in place of the row's
 * @returns {object} The row
 */
export function tokenRow(changes = {}) {
  return {
    timestamp: MARCH_15,
    type: "income",
    baseCurrency: "HEX",
    baseAmount: { raw: 8355037234293n, decimals: 8 },
    from: POOL,
    to: WALLET,
    blockchain: "pulsechain",
    id: HASH,
    description: "Fees collected from a 9mm V3 position",
    contractAddress: HEX,
    ...changes,
  };
}
