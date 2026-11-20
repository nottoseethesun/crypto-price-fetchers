/**
 * The columns of Summ's custom csv import, and the key under which a row
 * of this utility holds each one's value.
 * @module summ-csv/columns
 *
 * What: Summ imports a csv file whose header names its columns, such as
 * `Base Amount` and `Contract Address (Optional)`. The owner keeps that
 * header in a template file of one line, which Summ's sixteen columns
 * make: its fifteen standard ones and the contract address of the row's
 * token. A row given to this utility is an object instead, keyed by a
 * name of the code's own (`baseAmount`, `contractAddress`), so that a row
 * reads the same whatever padding the template puts around a column's
 * name. `columnKeysOf` reads a header and gives the key of each of its
 * columns, in the header's order, which is the order the file's cells are
 * written in.
 *
 * How: a header is split at its commas, and each name, with the spaces
 * around it trimmed, is looked up among the sixteen. The owner's template
 * pads two names, ` ID (Optional)` and ` Contract Address (Optional)`,
 * which the trim matches; the file keeps the header exactly as the
 * template writes it. A header that names a column Summ's import does not
 * have, lacks one of the sixteen, or names one twice is refused, since a
 * file written under it would put a value under the wrong name or drop
 * it.
 *
 * Fit: `summ-csv/index.js` reads the template's header and writes each
 * row's cells in the order `columnKeysOf` gives; `summ-csv/rules.js`
 * names a column in its messages by its `label`.
 */

/**
 * Summ's sixteen columns, in the order of its template: each column's name
 * as the header writes it once trimmed, the key a row holds its value
 * under, and the shorter name the messages give it.
 */
export const SUMM_COLUMNS = Object.freeze([
  { name: "Timestamp (UTC)", key: "timestamp", label: "Timestamp" },
  { name: "Type", key: "type", label: "Type" },
  { name: "Base Currency", key: "baseCurrency", label: "Base Currency" },
  { name: "Base Amount", key: "baseAmount", label: "Base Amount" },
  {
    name: "Quote Currency (Optional)",
    key: "quoteCurrency",
    label: "Quote Currency",
  },
  {
    name: "Quote Amount (Optional)",
    key: "quoteAmount",
    label: "Quote Amount",
  },
  {
    name: "Fee Currency (Optional)",
    key: "feeCurrency",
    label: "Fee Currency",
  },
  { name: "Fee Amount (Optional)", key: "feeAmount", label: "Fee Amount" },
  { name: "From (Optional)", key: "from", label: "From" },
  { name: "To (Optional)", key: "to", label: "To" },
  { name: "Blockchain (Optional)", key: "blockchain", label: "Blockchain" },
  { name: "ID (Optional)", key: "id", label: "ID" },
  {
    name: "Description (Optional)",
    key: "description",
    label: "Description",
  },
  {
    name: "Reference Price Per Unit (Optional)",
    key: "referencePrice",
    label: "Reference Price Per Unit",
  },
  {
    name: "Reference Price Currency (Optional)",
    key: "referencePriceCurrency",
    label: "Reference Price Currency",
  },
  {
    name: "Contract Address (Optional)",
    key: "contractAddress",
    label: "Contract Address",
  },
]);

/**
 * The shorter name of a column, for a message.
 *
 * @param {string} key - The key a row holds the column's value under
 * @returns {string} The column's label, such as `Contract Address`
 */
export function labelOf(key) {
  return SUMM_COLUMNS.find((column) => column.key === key).label;
}

/**
 * The key of each column a header names, in the header's order.
 *
 * Each name is trimmed of the spaces around it before it is looked up, so
 * the padded names of the owner's template are matched.
 *
 * @param {string} header - The template's first line
 * @returns {string[]} The key of each column, in the header's order
 * @throws {Error} When the header quotes a name, names a column Summ's
 *   import does not have, names one twice, or lacks one: a file written
 *   under it would carry a value under the wrong name, or none
 */
export function columnKeysOf(header) {
  if (header.includes('"'))
    throw new Error(
      "The template's header quotes a column name, which Summ's never does: check that its first line is Summ's header",
    );
  const keys = header.split(",").map((name) => keyOfName(name.trim()));
  const doubled = keys.filter((key, at) => keys.indexOf(key) !== at);
  if (doubled.length > 0)
    throw new Error(
      `The template's header names a column twice: ${doubled.map(labelOf).join(", ")}`,
    );
  const missing = SUMM_COLUMNS.filter((column) => !keys.includes(column.key));
  if (missing.length > 0)
    throw new Error(
      `The template's header lacks ${missing.map((column) => column.label).join(", ")}: it needs Summ's sixteen columns`,
    );
  return keys;
}

/**
 * The key of a column, from its name in a header.
 *
 * @param {string} name - The column's name, trimmed
 * @returns {string} Its key
 * @throws {Error} When Summ's import has no column of that name
 */
function keyOfName(name) {
  const column = SUMM_COLUMNS.find((known) => known.name === name);
  if (column === undefined)
    throw new Error(
      `The template's header names a column Summ's import does not have: "${name}"`,
    );
  return column.key;
}
