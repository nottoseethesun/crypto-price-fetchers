/**
 * Writes the csv files the owner imports into Summ, the crypto tax
 * service: the one way such a file is made.
 * @module summ-csv/index
 *
 * What: a program, or the command line through `summ-csv.js`, gives the
 * rows of a file as objects, one token per row, and the path of the
 * owner's template, a file whose one line is the header of Summ's custom
 * csv import. `writeSummCsv` checks every row against the rules of
 * `summ-csv/rules.js` and, when all pass, writes the file: the template's
 * header, exactly as the template has it, then a line per row. When any
 * row fails, it writes nothing and throws an error that names every
 * problem, each with its row, counted from 1. `summCsvText` gives the
 * file's text without writing it.
 *
 * How: the template's header gives the order of the cells, through
 * `columnKeysOf`. Each value is written as text at this edge
 * (`summ-csv/values.js`): an amount as plain decimal text, a time in
 * seconds as Summ's `YYYY-MM-DD HH:MM:SS`, and, on a chain whose hashes
 * and addresses are hex, each hash and address in lower case, as the
 * files Summ has taken from the owner are written. The rule that a
 * transaction's gas sits on one row reads those cells, in which a hash's
 * case has been settled. The settings, `summ-csv/settings.json`, hold each
 * chain's facts, by the name Summ gives the chain, and the fiat
 * currencies a reference price may be in; a call may pass its own. An
 * existing file is written over only when the call says so, through a
 * file beside it that is then renamed, so the file is never left half
 * written.
 *
 * Fit: other repos install this one from GitHub and import
 * `crypto-price-fetchers/summ-csv` to write such a file from their own
 * code. `summ-csv/command-line.js` runs it for
 * `npm run summ-csv`, and for the bin `summ-csv` of a project that
 * installs this repo.
 */

import fs from "node:fs";
import { SUMM_COLUMNS, columnKeysOf } from "./columns.js";
import { chainOf, gasProblems, rowProblems } from "./rules.js";
import {
  amountText,
  caseFree,
  csvField,
  isBlank,
  plainNumberText,
  timestampText,
  trimDecimal,
} from "./values.js";

/**
 * The byte-order mark an editor may put before a file's first line, which
 * is no part of the header.
 */
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);

/** The chain form that each column naming a hash or an address has. */
const FORM_OF_KEY = Object.freeze({
  id: "transactionHash",
  from: "address",
  to: "address",
  contractAddress: "address",
});

/**
 * The utility's settings, as `summ-csv/settings.json` holds them: under
 * `chains`, each chain by the name Summ gives it, with its own coin and
 * the forms of its transaction hashes and addresses; and under
 * `referencePriceCurrencies`, the fiat currencies a reference price may
 * be in.
 *
 * @returns {{chains: Object<string, object>,
 *   referencePriceCurrencies: string[]}} The settings
 */
export function readSummCsvSettings() {
  return JSON.parse(
    fs.readFileSync(new URL("./settings.json", import.meta.url), "utf8"),
  );
}

/**
 * The header of a template: its first line, without a byte-order mark
 * before it or a line ending after it.
 *
 * @param {string} templatePath - The template file
 * @returns {string} The header, as the template writes it
 */
export function readTemplateHeader(templatePath) {
  const text = fs.readFileSync(templatePath, "utf8");
  const unmarked = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
  return unmarked.split(/\r?\n/, 1)[0];
}

/**
 * The error that a file's problems throw.
 *
 * @param {string[]} problems - Every problem, each naming its row
 * @returns {Error} An error whose message lists them, and whose
 *   `problems` holds them
 */
function problemsError(problems) {
  const count =
    problems.length === 1 ? "1 problem" : `${problems.length} problems`;
  return Object.assign(
    new Error(`Nothing was written: ${count}.\n${problems.join("\n")}`),
    { problems },
  );
}

/**
 * The text of one cell, once the row has passed every rule.
 *
 * @param {string} key - The column's key
 * @param {*} value - The row's value
 * @param {object|undefined} chain - The settings of the row's chain
 * @returns {string} The cell's text
 */
function cellText(key, value, chain) {
  if (isBlank(value)) return "";
  if (key === "timestamp")
    return typeof value === "number" ? timestampText(value) : value;
  if (key === "baseAmount" || key === "feeAmount") return amountText(value);
  if (key === "referencePrice")
    return typeof value === "number"
      ? plainNumberText(value)
      : trimDecimal(value);
  if (
    chain !== undefined &&
    Object.hasOwn(FORM_OF_KEY, key) &&
    caseFree(chain[FORM_OF_KEY[key]])
  )
    return value.toLowerCase();
  return value;
}

/**
 * Each cell of a row, by key, once the row has passed every rule.
 *
 * @param {object} row - The row
 * @param {object} settings - The utility's settings
 * @returns {Object<string, string>} The cells
 */
function rowCells(row, settings) {
  const chain = chainOf(row, settings);
  return Object.fromEntries(
    SUMM_COLUMNS.map(({ key }) => [key, cellText(key, row[key], chain)]),
  );
}

/**
 * A csv line of cells, in the header's order.
 *
 * @param {Object<string, string>} cells - The row's cells, by key
 * @param {string[]} keys - The header's keys, in order
 * @returns {string} The line, without its line ending
 */
function csvLine(cells, keys) {
  return keys.map((key) => csvField(cells[key])).join(",");
}

/**
 * The text of a csv file for Summ's import: the header, then a line per
 * row, each line ended by a line feed, as the owner's template ends its
 * line.
 *
 * @param {object[]} rows - The rows, one token each; `summ-csv/README.md`
 *   gives their keys and forms
 * @param {string} header - The template's header, its first line
 * @param {object} [settings] - The utility's settings; by default
 *   `summ-csv/settings.json`'s
 * @returns {string} The file's text
 * @throws {Error} When there are no rows, when the header is not Summ's,
 *   or when any row breaks a rule: the error's `problems` names each
 *   problem with its row, and its message lists them
 */
export function summCsvText(rows, header, settings = readSummCsvSettings()) {
  if (!Array.isArray(rows) || rows.length === 0)
    throw problemsError(["there are no rows to write"]);
  const keys = columnKeysOf(header);
  const problems = rows.flatMap((row, at) =>
    rowProblems(row, settings).map((problem) => `row ${at + 1}: ${problem}`),
  );
  if (problems.length > 0) throw problemsError(problems);
  const cells = rows.map((row) => rowCells(row, settings));
  const gas = gasProblems(cells);
  if (gas.length > 0) throw problemsError(gas);
  return `${[header, ...cells.map((cell) => csvLine(cell, keys))].join("\n")}\n`;
}

/**
 * Writes a csv file for Summ's import, once every row has passed the
 * rules.
 *
 * @param {object} file - What to write
 * @param {object[]} file.rows - The rows, one token each
 * @param {string} file.templatePath - The template, whose first line is
 *   the header
 * @param {string} file.outPath - The file to write
 * @param {boolean} [file.replace] - `true` to write over a file already
 *   at `outPath`; otherwise such a file is left as it is and an error
 *   thrown
 * @param {object} [file.settings] - The utility's settings; by default
 *   `summ-csv/settings.json`'s
 * @returns {{rowCount: number, outPath: string}} The rows written, and
 *   where
 * @throws {Error} As `summCsvText` throws, or when a file is at `outPath`
 *   and `replace` is not `true`
 */
export function writeSummCsv({
  rows,
  templatePath,
  outPath,
  replace,
  settings = readSummCsvSettings(),
}) {
  const text = summCsvText(rows, readTemplateHeader(templatePath), settings);
  if (replace === true) {
    fs.writeFileSync(`${outPath}.tmp`, text);
    fs.renameSync(`${outPath}.tmp`, outPath);
  } else {
    try {
      fs.writeFileSync(outPath, text, { flag: "wx" });
    } catch (thrown) {
      if (thrown.code !== "EEXIST") throw thrown;
      throw new Error(
        `${outPath} exists already, and is written over only when the call says to replace it`,
        { cause: thrown },
      );
    }
  }
  return { rowCount: rows.length, outPath };
}
