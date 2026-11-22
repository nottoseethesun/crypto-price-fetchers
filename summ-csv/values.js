/**
 * How the values of a row are checked and written as the text of a csv
 * cell: amounts, prices, times, hashes and addresses.
 * @module summ-csv/values
 *
 * What: a row holds its values in the forms a program has them in, and a
 * csv file holds text, so each value is turned into text here, at the
 * file's edge, as LP Ranger's rule for numbers asks. An amount is written
 * as plain decimal text, such as `0.000000000000000001`, never in
 * exponent form, since a program keeps a token amount as a whole number
 * of the token's smallest units and its decimals, which a JavaScript
 * number cannot always hold. A time is written as Summ's
 * `YYYY-MM-DD HH:MM:SS`, in UTC. A transaction hash or an address is
 * checked against its chain's form, which the settings describe.
 *
 * How: an amount comes as decimal text, which is trimmed of the zeros
 * that change nothing, or as `{raw, decimals}`, whose digits are cut at
 * `decimals` places by the text alone, never by arithmetic on a
 * JavaScript number. A price may come as a JavaScript number, as a price
 * service gives one; its shortest text, which `String` gives, is spread
 * out of exponent form by moving its decimal point, which changes no
 * digit. A chain's form names a prefix, an alphabet and a length (or a
 * least and a most length), such as `0x`, `hex` and `64` for a
 * PulseChain transaction hash.
 *
 * Fit: `summ-csv/rules.js` checks a row's values with these functions,
 * and `summ-csv/index.js` writes them with them, once every check has
 * passed.
 */

/** Digits, one or more, and nothing else. */
const DIGITS = /^\d+$/;

/** Summ's time: `YYYY-MM-DD HH:MM:SS`. */
const SUMM_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * The last second Summ's `YYYY-MM-DD HH:MM:SS` can write, in seconds since
 * 1970: 9999-12-31 23:59:59 UTC. A later time has a year of five digits,
 * which no such text holds, and a time in milliseconds given for seconds,
 * such as `Date.now()`, is one.
 */
const LAST_SECOND = 253402300799;

/** The characters of each alphabet a chain's form may name. */
const ALPHABETS = Object.freeze({
  hex: { characters: /^[0-9a-fA-F]+$/, name: "hex digits" },
  base58: {
    characters: /^[1-9A-HJ-NP-Za-km-z]+$/,
    name: "base58 characters",
  },
});

/** The names of the alphabets a chain's form may name. */
export const ALPHABET_NAMES = Object.freeze(Object.keys(ALPHABETS));

/**
 * Whether a cell is left empty: a value that is absent, `null` or empty
 * text.
 *
 * @param {*} value - A row's value
 * @returns {boolean} Whether the cell is empty
 */
export function isBlank(value) {
  return value === undefined || value === null || value === "";
}

/**
 * Whether text is a plain decimal above zero: digits, with a fraction or
 * none, no sign and no exponent.
 *
 * The text is split at its points, and each part must be digits alone,
 * with one point at most: a check without the nested repeats of a
 * regular expression such as `^\d+(\.\d+)?$`, which the security lint
 * refuses as open to slow matching.
 *
 * @param {string} text - The text
 * @returns {boolean} Whether it is such a decimal
 */
export function isDecimalAboveZero(text) {
  const parts = text.split(".");
  return (
    parts.length <= 2 &&
    parts.every((part) => DIGITS.test(part)) &&
    trimDecimal(text) !== "0"
  );
}

/**
 * Plain decimal text without the zeros that change nothing: those before
 * the first digit of the whole part, those at the end of the fraction,
 * and a point with no fraction after it.
 *
 * @param {string} text - Plain decimal text
 * @returns {string} The same number, trimmed, such as `12.5` for `012.500`
 */
export function trimDecimal(text) {
  const [whole, fraction = ""] = text.split(".");
  const wholeTrimmed = whole.replace(/^0+(?=\d)/, "");
  const fractionTrimmed = fraction.replace(/0+$/, "");
  return fractionTrimmed === ""
    ? wholeTrimmed
    : `${wholeTrimmed}.${fractionTrimmed}`;
}

/**
 * The decimal text of an amount held as a whole number of a token's
 * smallest units.
 *
 * The digits are cut `decimals` places from their end, after zeros are
 * put before them where they are fewer than that, so no digit passes
 * through a JavaScript number.
 *
 * @param {bigint|string} raw - The amount in the token's smallest units:
 *   a BigInt, or its digits as text
 * @param {number} decimals - The token's decimals
 * @returns {string} The amount, as trimmed decimal text
 */
export function decimalFromRaw(raw, decimals) {
  const digits = String(raw).padStart(decimals + 1, "0");
  const cut = digits.length - decimals;
  return trimDecimal(`${digits.slice(0, cut)}.${digits.slice(cut)}`);
}

/**
 * Whether a value is an amount held as `{raw, decimals}`: a whole number
 * of a token's smallest units above zero, as a BigInt or as digits, and
 * the token's decimals, a whole number from 0 to 255, as an ERC-20
 * token's are.
 *
 * @param {*} value - A row's amount
 * @returns {boolean} Whether it is such an amount
 */
export function isRawAmount(value) {
  if (value === null || typeof value !== "object") return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "decimals" || keys[1] !== "raw")
    return false;
  const { raw, decimals } = value;
  const rawAboveZero =
    typeof raw === "bigint"
      ? raw > 0n
      : typeof raw === "string" && DIGITS.test(raw) && /[1-9]/.test(raw);
  return (
    rawAboveZero &&
    Number.isInteger(decimals) &&
    decimals >= 0 &&
    decimals <= 255
  );
}

/**
 * The text of an amount, once checked: decimal text, trimmed, or the
 * decimal text of `{raw, decimals}`.
 *
 * @param {string|{raw: (bigint|string), decimals: number}} amount - The
 *   amount
 * @returns {string} Its plain decimal text
 */
export function amountText(amount) {
  return typeof amount === "string"
    ? trimDecimal(amount)
    : decimalFromRaw(amount.raw, amount.decimals);
}

/**
 * The plain decimal text of a number above zero, as `String` gives its
 * shortest form, spread out of exponent form.
 *
 * `String` writes a number in exponent form only when it is below a
 * millionth or has 21 whole digits or more, such as `1.5e-7` and `1e+21`.
 * Moving the point by the exponent gives the same digits in plain form.
 * For a number below a millionth the point moves left past every digit
 * of the mantissa, which zeros then follow the point to fill:
 * `0.00000015`. For one of 21 whole digits or more it moves right past
 * every digit, since a number has at most 17 significant digits, and
 * zeros fill the places up to the point.
 *
 * @param {number} number - A finite number above zero
 * @returns {string} Its plain decimal text
 */
export function plainNumberText(number) {
  const text = String(number);
  const at = text.indexOf("e");
  if (at === -1) return text;
  const mantissa = text.slice(0, at);
  const point = mantissa.indexOf(".");
  const digits = mantissa.replace(".", "");
  const whole =
    (point === -1 ? mantissa.length : point) + Number(text.slice(at + 1));
  if (whole <= 0) return trimDecimal(`0.${"0".repeat(-whole)}${digits}`);
  return digits + "0".repeat(whole - digits.length);
}

/**
 * Whether a number is a whole count of seconds since 1970 that Summ's
 * text can write: up to the last second of the year 9999.
 *
 * @param {number} seconds - The number
 * @returns {boolean} Whether it is such a count
 */
export function isSecondsSince1970(seconds) {
  return (
    Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= LAST_SECOND
  );
}

/**
 * Summ's text of a time given in seconds since 1970: `YYYY-MM-DD HH:MM:SS`,
 * in UTC.
 *
 * @param {number} seconds - Whole seconds since 1970
 * @returns {string} The time, as Summ's text
 */
export function timestampText(seconds) {
  const iso = new Date(seconds * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

/**
 * Whether text is a time in Summ's form that names a real moment, so that
 * `2026-02-30 10:00:00`, which a `Date` would move into March, is refused.
 *
 * @param {string} text - The text
 * @returns {boolean} Whether it is such a time
 */
export function isSummTimestamp(text) {
  if (!SUMM_TIME.test(text)) return false;
  const milliseconds = Date.parse(`${text.replace(" ", "T")}Z`);
  return (
    Number.isFinite(milliseconds) && timestampText(milliseconds / 1000) === text
  );
}

/**
 * The alphabet a form names.
 *
 * @param {{alphabet: string}} form - A chain's form, from the settings
 * @returns {{characters: RegExp, name: string}} The alphabet
 * @throws {Error} When the settings name an alphabet this module does not
 *   know, since no text could then be checked against the form
 */
function alphabetOf(form) {
  if (!Object.hasOwn(ALPHABETS, form.alphabet))
    throw new Error(
      `The settings name an alphabet the utility does not know: "${form.alphabet}" (it knows ${Object.keys(ALPHABETS).join(", ")})`,
    );
  return ALPHABETS[form.alphabet];
}

/**
 * Whether text has a chain's form: its prefix, then characters of its
 * alphabet only, as many as its length, or from its least to its most
 * length.
 *
 * @param {string} text - A hash or an address
 * @param {{prefix: string, alphabet: string, length?: number,
 *   minLength?: number, maxLength?: number}} form - The form, from the
 *   settings
 * @returns {boolean} Whether the text has the form
 */
export function fitsForm(text, form) {
  const alphabet = alphabetOf(form);
  if (!text.startsWith(form.prefix)) return false;
  const body = text.slice(form.prefix.length);
  const least = form.length ?? form.minLength;
  const most = form.length ?? form.maxLength;
  return (
    body.length >= least &&
    body.length <= most &&
    alphabet.characters.test(body)
  );
}

/**
 * A form in words, for a message: `0x and 64 hex digits`.
 *
 * @param {{prefix: string, alphabet: string, length?: number,
 *   minLength?: number, maxLength?: number}} form - The form
 * @returns {string} The form in words
 */
export function formText(form) {
  const count =
    form.length === undefined
      ? `${form.minLength} to ${form.maxLength}`
      : `${form.length}`;
  const characters = `${count} ${alphabetOf(form).name}`;
  return form.prefix === "" ? characters : `${form.prefix} and ${characters}`;
}

/**
 * Whether a form's alphabet is one whose letters mean the same in either
 * case, as hex digits do, so that its text is written in lower case.
 * base58 is not: its `a` and `A` are different characters.
 *
 * @param {{alphabet: string}} form - The form
 * @returns {boolean} Whether case changes nothing in it
 */
export function caseFree(form) {
  return form.alphabet === "hex";
}

/**
 * A cell's text as a csv file holds it: quoted, with each quote doubled,
 * when it holds a comma, a quote or a line break, which would otherwise
 * end the cell.
 *
 * @param {string} text - The cell's text
 * @returns {string} The text the file holds
 */
export function csvField(text) {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
