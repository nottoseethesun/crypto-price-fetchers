/**
 * The command line of the Summ csv utility: `npm run summ-csv`.
 * @module summ-csv/command-line
 *
 * What: writes a csv file for Summ's custom import from a JSON file of
 * rows, under the header of the owner's template, as `writeSummCsv` in
 * `summ-csv/index.js` writes one for a program. It prints how many rows
 * it wrote and where, with exit code 0, or every problem it found, with
 * exit code 1, having written nothing.
 *
 * How: Commander reads the options and renders `--help` from the same
 * declaration. The rows file holds a JSON array of rows. JSON has no
 * BigInt, so an amount in it is decimal text or `{raw, decimals}` with
 * `raw` as digits. Output goes to the streams a caller gives, so the tests
 * read what a run prints.
 *
 * Fit: `bin/summ-csv.js` runs `runSummCsv`, as
 * `npm run summ-csv` and as the bin `summ-csv` of a project that installs
 * this repo.
 */

import fs from "node:fs";
import { Command, CommanderError } from "commander";
import { messageOf } from "../lib/message-of.js";
import { writeSummCsv } from "./index.js";

/** The end of the help: the rows file, and what is refused. */
const HELP_AFTER = `
The rows file holds a JSON array, one object per row, keyed by column:
  timestamp                 whole seconds since 1970, or "YYYY-MM-DD HH:MM:SS",
                            in UTC
  type                      one of the types Summ's csv import takes
  baseCurrency, baseAmount  the row's one token, and how much of it
  feeCurrency, feeAmount    the gas, on one row of a transaction only
  from, to                  both sides of the movement
  blockchain, id            the chain, by Summ's name for it, and the
                            transaction's hash
  description
  referencePrice, referencePriceCurrency
  contractAddress           the token's contract; none for a chain's own coin

An amount is decimal text, such as "12.5", or {"raw": "12500000",
"decimals": 6}. Every problem in the rows is listed, and nothing is written
while any stands. A file already at --out is written over only with
--replace. summ-csv/README.md gives every rule.

Examples:
  Write a wallet's rows as a csv file for Summ's custom import:
    $ npm run summ-csv -- --rows rows.json --template ~/summ-template.csv --out summ.csv
  Write it again over the file the last run wrote, after fixing a row:
    $ npm run summ-csv -- --rows rows.json --template ~/summ-template.csv --out summ.csv --replace

Exit codes: 0 when the file was written; 1 when it was not.
`;

/**
 * Runs the command line.
 *
 * @param {string[]} argv - The arguments, as `process.argv` holds them
 * @param {object} [deps] - Stand-ins for the tests
 * @param {{write: function(string): *}} [deps.stdout] - Where the report
 *   and the help go
 * @param {{write: function(string): *}} [deps.stderr] - Where problems go
 * @returns {number} The exit code: 0 when the file was written, 1 when
 *   it was not
 */
export function runSummCsv(argv, deps = {}) {
  const io = {
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
  };
  const program = new Command()
    .name("summ-csv")
    .description(
      "Writes a csv file for Summ's custom import from a JSON file of rows, under the header of the owner's template, once every row has passed the rules.",
    )
    .requiredOption("--rows <file>", "the JSON file of rows")
    .requiredOption(
      "--template <file>",
      "the template, whose first line is Summ's header",
    )
    .requiredOption("--out <file>", "the csv file to write")
    .option("--replace", "write over a file already at --out")
    .addHelpText("after", HELP_AFTER)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.stdout.write(text),
      writeErr: (text) => io.stderr.write(text),
    })
    .action((options) => {
      const written = writeSummCsv({
        rows: JSON.parse(fs.readFileSync(options.rows, "utf8")),
        templatePath: options.template,
        outPath: options.out,
        replace: options.replace === true,
      });
      const rows =
        written.rowCount === 1 ? "1 row" : `${written.rowCount} rows`;
      io.stdout.write(`Wrote ${rows} to ${written.outPath}.\n`);
    });
  try {
    program.parse(argv);
  } catch (thrown) {
    if (thrown instanceof CommanderError) return thrown.exitCode;
    io.stderr.write(`${messageOf(thrown)}\n`);
    return 1;
  }
  return 0;
}
