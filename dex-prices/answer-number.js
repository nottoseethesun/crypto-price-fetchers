/**
 * Reads a number in a service's answer.
 * @module dex-prices/answer-number
 *
 * What: the services write each number of an answer as a JSON number, or
 * as text, which keeps every digit of a price. `answerNumber` reads
 * either, and gives NaN for anything else, so a field that is missing,
 * null, empty or of another kind fails the check after it, where
 * `Number` reads null, "" and false as 0, and true as 1, which pass it.
 *
 * Fit: the clients of Moralis and DexTools read their answers' numbers
 * through it.
 */

/**
 * Reads a number written in an answer as a number or as text.
 *
 * @param {*} value - The answer's field
 * @returns {number} The number, or NaN when the field writes none
 */
export function answerNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}
