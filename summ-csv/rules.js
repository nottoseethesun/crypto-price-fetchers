/**
 * The rules a row must pass before it is written to a csv file for Summ.
 * @module summ-csv/rules
 *
 * What: Summ imports whatever a csv file says, so a wrong row reaches the
 * books unless something refuses it first. These rules refuse a row that
 * Summ would read wrongly, or that breaks one of the owner's rules for
 * his files: one token per row, so a trade is a sell row and a buy row; a
 * contract address on every token row, so Summ knows which token it is;
 * and the gas of a transaction on one of its rows only, so it is not
 * counted twice. `rowProblems` gives every problem of one row, and
 * `gasProblems` every transaction whose gas is on more than one row.
 *
 * How: a row is first checked for its shape: an object, keyed only by the
 * sixteen columns' keys, with text where a column holds text. A row of the
 * wrong shape gets those problems alone, since the other rules read its
 * values. Each other rule then reads the values it concerns and passes an
 * empty cell, which the rule for the columns every row fills reports. A
 * row on a blockchain, which its `blockchain` column names, is held to
 * that chain's facts in the settings: its own coin, which has no contract
 * and pays the gas, and the forms of its transaction hashes and addresses.
 *
 * Fit: `summCsvText` in `summ-csv/index.js` runs `rowProblems` on every row
 * and `gasProblems` on the cells it would write, and writes nothing while
 * any problem stands, naming each one.
 */

import { SUMM_COLUMNS, labelOf } from "./columns.js";
import {
  fitsForm,
  formText,
  isBlank,
  isDecimalAboveZero,
  isRawAmount,
  isSecondsSince1970,
  isSummTimestamp,
} from "./values.js";

/**
 * The types Summ's custom csv import takes, with the other names it
 * takes for some of them (`transfer-in` for `receive`, `gift` for
 * `incoming-gift`), from its help article "Custom CSV import"
 * (help.summ.com, article 5777675), as it read on 2026-11-20.
 */
export const SUMM_TYPES = Object.freeze([
  "buy",
  "sell",
  "fiat-deposit",
  "fiat-withdrawal",
  "fee",
  "approval",
  "receive",
  "transfer-in",
  "send",
  "transfer-out",
  "chain-split",
  "expense",
  "stolen",
  "lost",
  "burn",
  "income",
  "interest",
  "mining",
  "airdrop",
  "staking",
  "staking-deposit",
  "staking-withdrawal",
  "rebate",
  "royalty",
  "royalties",
  "personal-use",
  "incoming-gift",
  "gift",
  "outgoing-gift",
  "borrow",
  "loan",
  "loan-repayment",
  "liquidate",
  "bridge-in",
  "bridge-out",
  "mint",
  "collateral-withdrawal",
  "collateral-deposit",
  "add-liquidity",
  "receive-lp-token",
  "remove-liquidity",
  "return-lp-token",
  "failed-in",
  "failed-out",
  "spam",
  "swap-in",
  "swap-out",
  "bridge-trade-in",
  "bridge-trade-out",
  "realized-profit",
  "realized-loss",
  "margin-fee",
  "open-position",
  "close-position",
  "receive-pq",
  "send-pq",
]);

/** The columns whose value is text. */
const TEXT_KEYS = Object.freeze([
  "type",
  "baseCurrency",
  "quoteCurrency",
  "feeCurrency",
  "from",
  "to",
  "blockchain",
  "id",
  "description",
  "referencePriceCurrency",
  "contractAddress",
]);

/**
 * The columns every row fills: the four Summ's import needs, and From and
 * To, since the owner's files name both sides of every movement.
 */
const REQUIRED_KEYS = Object.freeze([
  "timestamp",
  "type",
  "baseCurrency",
  "baseAmount",
  "from",
  "to",
]);

/** The columns that hold an amount, the quote's aside. */
const AMOUNT_KEYS = Object.freeze(["baseAmount", "feeAmount"]);

/**
 * The columns that name a hash or an address on a row's blockchain, and
 * the form of the chain's each must have.
 */
const CHAIN_FORM_KEYS = Object.freeze([
  { key: "id", form: "transactionHash", what: "transaction hash" },
  { key: "from", form: "address", what: "address" },
  { key: "to", form: "address", what: "address" },
  { key: "contractAddress", form: "address", what: "address" },
]);

/**
 * A row's value as a message shows it: text in quotes, a BigInt with its
 * `n`, an object as JSON.
 *
 * @param {*} value - The value
 * @returns {string} The value in a message
 */
function shown(value) {
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "bigint") return `${value}n`;
  if (value !== null && typeof value === "object")
    return JSON.stringify(value, (_key, inner) =>
      typeof inner === "bigint" ? `${inner}n` : inner,
    );
  return String(value);
}

/**
 * The settings of the chain a row names, or `undefined` for a row that
 * names none or one the settings lack.
 *
 * @param {object} row - The row
 * @param {object} settings - The utility's settings
 * @returns {object|undefined} The chain's settings
 */
export function chainOf(row, settings) {
  if (
    isBlank(row.blockchain) ||
    !Object.hasOwn(settings.chains, row.blockchain)
  )
    return undefined;
  return settings.chains[row.blockchain];
}

/**
 * The problems of a row's shape: a key that is no column's, and a column
 * that holds text holding something else.
 *
 * @param {object} row - The row
 * @returns {string[]} The problems
 */
function shapeProblems(row) {
  const keys = SUMM_COLUMNS.map((column) => column.key);
  const unknown = Object.keys(row)
    .filter((key) => !keys.includes(key))
    .map((key) => `"${key}" is not a column the utility writes`);
  const notText = TEXT_KEYS.filter(
    (key) => !isBlank(row[key]) && typeof row[key] !== "string",
  ).map((key) => `${labelOf(key)} ${shown(row[key])} is not text`);
  return [...unknown, ...notText];
}

/**
 * The columns every row fills that this row leaves empty.
 *
 * @param {object} row - The row
 * @returns {string[]} The problems
 */
function requiredProblems(row) {
  return REQUIRED_KEYS.filter((key) => isBlank(row[key])).map(
    (key) => `${labelOf(key)} is empty, and every row fills it`,
  );
}

/**
 * A type Summ's import does not take.
 *
 * @param {object} row - The row
 * @returns {string[]} The problem, or none
 */
function typeProblems(row) {
  if (isBlank(row.type) || SUMM_TYPES.includes(row.type)) return [];
  return [`type ${shown(row.type)} is not one Summ's csv import takes`];
}

/**
 * A quote, which would put a second token on the row.
 *
 * @param {object} row - The row
 * @returns {string[]} The problem, or none
 */
function quoteProblems(row) {
  if (isBlank(row.quoteCurrency) && isBlank(row.quoteAmount)) return [];
  return [
    "Quote Currency or Quote Amount is filled, but a row carries one token: a trade is a sell row and a buy row",
  ];
}

/**
 * A time that is neither whole seconds since 1970 nor Summ's text.
 *
 * @param {object} row - The row
 * @returns {string[]} The problem, or none
 */
function timestampProblems(row) {
  const time = row.timestamp;
  if (isBlank(time)) return [];
  const valid =
    typeof time === "number"
      ? isSecondsSince1970(time)
      : typeof time === "string" && isSummTimestamp(time);
  if (valid) return [];
  return [
    `Timestamp ${shown(time)} is neither whole seconds since 1970, up to the year 9999, nor a real time as "YYYY-MM-DD HH:MM:SS"`,
  ];
}

/**
 * The problem of one amount, or none.
 *
 * @param {*} value - The amount
 * @param {string} label - Its column's label
 * @returns {string[]} The problem, or none
 */
function amountProblem(value, label) {
  if (typeof value === "number")
    return [
      `${label} ${shown(value)} is a JavaScript number, which cannot hold every amount exactly: give it as decimal text or as {raw, decimals}`,
    ];
  if (typeof value === "string")
    return isDecimalAboveZero(value)
      ? []
      : [`${label} ${shown(value)} is not a plain decimal above zero`];
  if (isRawAmount(value)) return [];
  return [
    `${label} ${shown(value)} is neither decimal text nor {raw, decimals} with raw above zero and decimals from 0 to 255`,
  ];
}

/**
 * The problems of a row's amounts.
 *
 * @param {object} row - The row
 * @returns {string[]} The problems
 */
function amountProblems(row) {
  return AMOUNT_KEYS.filter((key) => !isBlank(row[key])).flatMap((key) =>
    amountProblem(row[key], labelOf(key)),
  );
}

/**
 * The problems of a row's gas: a fee currency without an amount or an
 * amount without a currency, and, on a blockchain, gas in anything but
 * the chain's own coin, which is what a chain's gas is paid in.
 *
 * @param {object} row - The row
 * @param {object} settings - The utility's settings
 * @returns {string[]} The problems
 */
function feeProblems(row, settings) {
  const hasCurrency = !isBlank(row.feeCurrency);
  if (hasCurrency !== !isBlank(row.feeAmount))
    return ["Fee Currency and Fee Amount are filled together or not at all"];
  const chain = chainOf(row, settings);
  if (!hasCurrency || chain === undefined || row.feeCurrency === chain.ownCoin)
    return [];
  return [
    `gas on ${row.blockchain} is paid in ${chain.ownCoin}, not ${shown(row.feeCurrency)}`,
  ];
}

/**
 * The problems of a contract address: one on the chain's own coin, which
 * has no contract, and none on a token, which Summ then cannot tell from
 * another of the same name.
 *
 * @param {object} row - A row on a blockchain the settings hold
 * @param {object} chain - The chain's settings
 * @returns {string[]} The problem, or none
 */
function contractProblems(row, chain) {
  const ownCoin = row.baseCurrency === chain.ownCoin;
  const hasContract = !isBlank(row.contractAddress);
  if (ownCoin && hasContract)
    return [
      `${chain.ownCoin} is ${row.blockchain}'s own coin and has no contract, but Contract Address is filled`,
    ];
  if (!ownCoin && !hasContract && !isBlank(row.baseCurrency))
    return [
      `${row.baseCurrency} on ${row.blockchain} has no Contract Address, and every token row names its contract`,
    ];
  return [];
}

/**
 * The problems of a row's hashes and addresses: a row on a blockchain
 * names its transaction's hash, and each hash and address has the chain's
 * form.
 *
 * @param {object} row - A row on a blockchain the settings hold
 * @param {object} chain - The chain's settings
 * @returns {string[]} The problems
 */
function formProblems(row, chain) {
  return CHAIN_FORM_KEYS.flatMap(({ key, form, what }) => {
    if (isBlank(row[key]))
      return key === "id"
        ? [
            `ID is empty, and a row on ${row.blockchain} names its transaction hash`,
          ]
        : [];
    if (fitsForm(row[key], chain[form])) return [];
    return [
      `${labelOf(key)} ${shown(row[key])} is not a ${row.blockchain} ${what} (${formText(chain[form])})`,
    ];
  });
}

/**
 * The problems of a row on a blockchain: a chain the settings lack, and
 * the chain's rules for hashes, addresses and contracts.
 *
 * @param {object} row - The row
 * @param {object} settings - The utility's settings
 * @returns {string[]} The problems
 */
function chainProblems(row, settings) {
  if (isBlank(row.blockchain)) return [];
  const chain = chainOf(row, settings);
  if (chain === undefined)
    return [
      `blockchain ${shown(row.blockchain)} is not in the utility's settings (${Object.keys(settings.chains).join(", ")})`,
    ];
  return [...formProblems(row, chain), ...contractProblems(row, chain)];
}

/**
 * Whether a price is above zero: a finite JavaScript number, as a price
 * service gives one, or plain decimal text.
 *
 * @param {*} value - The price
 * @returns {boolean} Whether it is such a price
 */
function isPrice(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return typeof value === "string" && isDecimalAboveZero(value);
}

/**
 * The problems of a reference price: a price that is no price, a currency
 * without a price, and a currency other than the fiat ones the settings
 * list, since Summ ignores a reference price in anything but fiat.
 *
 * @param {object} row - The row
 * @param {object} settings - The utility's settings
 * @returns {string[]} The problems
 */
function referenceProblems(row, settings) {
  const price = row.referencePrice;
  const currency = row.referencePriceCurrency;
  const problems = [];
  if (!isBlank(price) && !isPrice(price))
    problems.push(
      `Reference Price Per Unit ${shown(price)} is not a number or plain decimal above zero`,
    );
  if (isBlank(currency)) return problems;
  if (isBlank(price))
    problems.push(
      "Reference Price Currency is filled without a Reference Price Per Unit",
    );
  if (!settings.referencePriceCurrencies.includes(currency))
    problems.push(
      `Reference Price Currency ${shown(currency)} is not one of the fiat currencies in the utility's settings (${settings.referencePriceCurrencies.join(", ")})`,
    );
  return problems;
}

/**
 * Every problem of one row.
 *
 * A row whose shape is wrong gets the problems of its shape alone, since
 * the other rules read its values as text, amounts and times.
 *
 * @param {*} row - The row
 * @param {object} settings - The utility's settings: its chains and the
 *   fiat currencies a reference price may be in
 * @returns {string[]} The problems, none for a row that may be written
 */
export function rowProblems(row, settings) {
  if (row === null || typeof row !== "object" || Array.isArray(row))
    return [`${shown(row)} is not an object of columns`];
  const shape = shapeProblems(row);
  if (shape.length > 0) return shape;
  return [
    ...requiredProblems(row),
    ...typeProblems(row),
    ...quoteProblems(row),
    ...timestampProblems(row),
    ...amountProblems(row),
    ...feeProblems(row, settings),
    ...chainProblems(row, settings),
    ...referenceProblems(row, settings),
  ];
}

/**
 * Every row that carries a transaction's gas after another row of the
 * same transaction already has: the gas would be counted twice.
 *
 * A transaction is a blockchain and an ID, as the file would hold them,
 * so the cells are those the file would be written with, in which a
 * hash's case has been settled.
 *
 * @param {Array<Object<string, string>>} cells - Each row's cells, by key
 * @returns {string[]} The problems, each naming its row
 */
export function gasProblems(cells) {
  const gasRowOf = new Map();
  const problems = [];
  cells.forEach((cell, at) => {
    if (cell.feeAmount === "" || cell.blockchain === "" || cell.id === "")
      return;
    const transaction = `${cell.blockchain} ${cell.id}`;
    if (gasRowOf.has(transaction))
      problems.push(
        `row ${at + 1}: transaction ${cell.id} already carries its gas on row ${gasRowOf.get(transaction)}, and gas goes on one row of a transaction`,
      );
    else gasRowOf.set(transaction, at + 1);
  });
  return problems;
}
