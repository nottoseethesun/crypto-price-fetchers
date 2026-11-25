/**
 * Backfill Batch Job
 * ==================
 *
 * A standalone CLI tool to backfill the prices index.js could not find, marked
 * "Error", in a previously-generated output CSV file. A blank price marks a
 * row that holds no data, such as a "Total" row, which it leaves as it is.
 * This is useful when you have an existing output.csv from index.js
 * that was created without backfill options, and you want to apply backfill without
 * re-fetching prices.
 *
 * For detailed documentation on:
 * - Configuration options (config.json)
 * - Backfill algorithm and behavior
 * - Tax estimation vs budgeting use cases
 * - CSV format requirements
 *
 * Please refer to the file-header documentation in ./index.js.
 *
 * @version 1.0.0
 * @author Christopher M. Balz with Claude.ai
 * @license See the file, `../../LICENSE`
 *
 * Quick Start
 * -----------
 *
 * From the repo's top folder, on a file the filler wrote in its folder's
 * `output/csv/`, where git keeps nothing but the folder.
 *
 * Basic usage (conservative tax estimates - use highest bracketing price):
 *   node bin/end-user/backfill.js --input=fetch-from-any-exchange/crypto-price-filler/output/csv/output.csv --backfill-highest
 *
 * Budgeting (avoid over-estimating - use lowest bracketing price):
 *   node bin/end-user/backfill.js --input=fetch-from-any-exchange/crypto-price-filler/output/csv/output.csv --backfill-lowest
 *
 * Write to a different file:
 *   node bin/end-user/backfill.js --input=fetch-from-any-exchange/crypto-price-filler/output/csv/output.csv --output=fetch-from-any-exchange/crypto-price-filler/output/csv/backfilled.csv --backfill-highest
 *
 * Command-Line Options
 * --------------------
 *
 *   --input <path>       Required. Path to input CSV file (typically a previous output.csv)
 *   --output <path>      Output CSV path. Default: overwrites input file
 *   --backfill-highest   Fill each "Error" price with the highest bracketing price (tax estimates)
 *   --backfill-lowest    Fill each "Error" price with the lowest bracketing price (budgeting)
 *   --verbose            Enable detailed logging
 *   --help               Show usage information
 *
 * Configuration
 * -------------
 *
 * Default backfill mode can be set in config.json, which config.js lays
 * over the committed config-example.json:
 *   "BACKFILL_HIGHEST": true   // Enable --backfill-highest by default
 *   "BACKFILL_LOWEST": true    // Enable --backfill-lowest by default
 *
 * With neither flag typed, the settings decide. A flag typed against the
 * other's setting, the two flags typed together, or the two settings both
 * true stop the run with exit code 1, naming the two
 * (`takeBackfillSettings`, in utils/backfill.js). A config.json that
 * cannot be read stops the run.
 *
 * Examples
 * --------
 *
 *   # Backfill in place with highest price (conservative for taxes)
 *   node bin/end-user/backfill.js --input=fetch-from-any-exchange/crypto-price-filler/output/csv/mining-output.csv --backfill-highest
 *
 *   # Backfill to new file with lowest price (for budgeting)
 *   node bin/end-user/backfill.js --input=fetch-from-any-exchange/crypto-price-filler/output/csv/output.csv --output=fetch-from-any-exchange/crypto-price-filler/output/csv/budget.csv --backfill-lowest
 *
 *   # Verbose mode to see which rows are being filled
 *   node bin/end-user/backfill.js --input=fetch-from-any-exchange/crypto-price-filler/output/csv/output.csv --backfill-highest --verbose
 *
 * Exit Codes
 * ----------
 *
 *   0  Success
 *   1  Error (missing required options, file not found, etc.)
 *
 * @module backfill
 * @requires fs
 * @requires path
 * @requires os
 * @requires csv-parse/sync
 * @requires csv-writer
 * @requires commander
 */

import fs from "fs";
import path from "path";
import os from "os";

import { Command, Option } from "commander";
import { parse as csvParse } from "csv-parse/sync";
import { createObjectCsvWriter } from "csv-writer";

import { loadConfig } from "./config.js";
import { fileToWriteArgument } from "../../lib/file-to-write.js";
import {
  backfillChoice,
  backfillPrices,
  DEFAULT_COLUMNS,
  takeBackfillSettings,
} from "./utils/backfill.js";
import { logv, say } from "./utils/log.js";

/**
 * Expands ~ to home directory in file path.
 * @param {string|undefined} filePath - File path that may contain ~, or undefined when none was given
 * @returns {string|undefined} Expanded file path, or undefined
 */
function expandPath(filePath) {
  if (filePath?.startsWith("~")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/**
 * Validates backfill options and returns resolved values.
 * @param {Object} options - CLI options
 * @param {Object} config - The settings, as config.js's `loadConfig` reads them
 * @returns {Object} Resolved options with inputFile, outputFile, verbose, useHighest
 * @throws {Error} If validation fails
 */
function validateAndResolveOptions(options, config) {
  const inputFile = expandPath(options.input);
  const outputFile = expandPath(options.output) ?? inputFile;
  const verbose = options.verbose === true || process.env.VERBOSE === "1";
  const { highest: backfillHighest, lowest: backfillLowest } = backfillChoice(
    options,
    config,
  );

  if (!backfillHighest && !backfillLowest) {
    throw new Error(
      "Must specify --backfill-highest or --backfill-lowest (or set in config.json)",
    );
  }

  if (!fs.existsSync(inputFile)) {
    throw new Error(`Input file not found: ${inputFile}`);
  }

  return {
    inputFile,
    outputFile,
    verbose,
    useHighest: backfillHighest, // backfillHighest takes precedence
  };
}

/**
 * Reads and parses CSV file.
 * @param {string} filePath - Path to CSV file
 * @returns {Object} Object with rows array and headers array
 * @throws {Error} If CSV is empty
 */
function readCsvFile(filePath) {
  const csvContent = fs.readFileSync(filePath, "utf8");
  const rows = csvParse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter: ",",
    quote: '"',
    relax_column_count: true,
  });

  if (rows.length === 0) {
    throw new Error("Input CSV is empty");
  }

  const headers = Object.keys(rows[0]);
  return { rows, headers };
}

/**
 * Detects column names from CSV headers.
 * @param {Array<string>} headers - CSV headers
 * @returns {Object} Object with detected column names
 * @throws {Error} If required price column is not found
 */
function detectColumns(headers) {
  const priceColName =
    headers.find((h) => h.includes("$usd price")) ?? DEFAULT_COLUMNS.price;
  const amountColName =
    headers.find((h) => h.toLowerCase().includes("amount")) ??
    DEFAULT_COLUMNS.amount;
  const usdAmountColName =
    headers.find((h) => h.includes("$usd amount")) ?? DEFAULT_COLUMNS.usdAmount;
  const grandTotalColName =
    headers.find((h) => h.includes("grand total")) ??
    DEFAULT_COLUMNS.grandTotal;

  if (!headers.includes(priceColName)) {
    throw new Error(`Price column "${priceColName}" not found in CSV`);
  }

  return { priceColName, amountColName, usdAmountColName, grandTotalColName };
}

/**
 * Writes rows to CSV file.
 * @param {string} filePath - Output file path
 * @param {Array<string>} headers - CSV headers
 * @param {Array<Object>} rows - Rows to write
 * @returns {Promise<void>}
 */
async function writeCsvFile(filePath, headers, rows) {
  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: headers.map((h) => ({ id: h, title: h })),
    fieldDelimiter: ",",
    quote: '"',
    escape: '"',
  });
  await csvWriter.writeRecords(rows);
}

/**
 * Sets up and returns the Commander program instance for backfill CLI.
 * @returns {import('commander').Command} Configured Commander program
 */
export function setupBackfillCommander() {
  const program = new Command();
  program
    .name("backfill")
    .description(
      'Backfill the prices the filler could not find, marked "Error", in a CSV file it wrote, using bracketing prices',
    )
    .version("1.0.0", "-v, --version", "output the version number")
    .allowExcessArguments(false)

    .requiredOption(
      "--input <path>",
      "Path to input CSV file, typically a previous output.csv (required)",
    )
    .option(
      "--output <path>",
      "Path to output CSV file, in a folder that exists (default: overwrites input)",
      (value) => fileToWriteArgument(expandPath(value)),
    )
    .addOption(
      new Option(
        "--backfill-highest",
        "Fill each Error price with the highest bracketing price (conservative tax estimates); config.json's BACKFILL_HIGHEST when not given",
      ).conflicts("backfillLowest"),
    )
    .addOption(
      new Option(
        "--backfill-lowest",
        "Fill each Error price with the lowest bracketing price (budgeting: avoid over-estimating); config.json's BACKFILL_LOWEST when not given",
      ).conflicts("backfillHighest"),
    )
    .option("--verbose", "Enable detailed logging during processing")

    .addHelpText(
      "after",
      `
Settings:
  config.json, in crypto-price-filler's folder,
  fetch-from-any-exchange/crypto-price-filler/, laid over the committed
  config-example.json beside it, holds BACKFILL_HIGHEST and
  BACKFILL_LOWEST, the backfill a run makes when no --backfill flag is
  typed. A --backfill flag typed against the other's setting, the two
  flags typed together, or the two settings both true stop the run, which
  leaves the file as it was.

The examples run from the repo's top folder, on a file the filler wrote in
its folder's output/csv/, fetch-from-any-exchange/crypto-price-filler/output/csv/.

Examples:
  Backfill in place (conservative tax estimates):
    $ node bin/end-user/backfill.js --input=fetch-from-any-exchange/crypto-price-filler/output/csv/output.csv --backfill-highest

  Backfill to new file (budgeting):
    $ node bin/end-user/backfill.js --input=fetch-from-any-exchange/crypto-price-filler/output/csv/output.csv --output=fetch-from-any-exchange/crypto-price-filler/output/csv/budget.csv --backfill-lowest

  Verbose mode:
    $ node bin/end-user/backfill.js --input=fetch-from-any-exchange/crypto-price-filler/output/csv/output.csv --backfill-highest --verbose

Exit codes:
  0  the output file was written
  1  it was not: an option was wrong or missing, a word it does not take
     was given, or the input could not be read or filled
`,
    )

    .helpOption("-h, --help", "display help for command");

  return program;
}

/**
 * Parses the process's arguments with the command line.
 * @returns {import('commander').Command} The command, parsed, whose `opts()` gives the options
 */
export function parseBackfillCommandLine() {
  return setupBackfillCommander().parse(process.argv);
}

/**
 * Main function to run the backfill process.
 * @param {Object} options - Backfill options
 * @param {string} options.input - Input file path
 * @param {string} [options.output] - Output file path (defaults to input)
 * @param {boolean} [options.backfillHighest] - Use highest bracketing price
 * @param {boolean} [options.backfillLowest] - Use lowest bracketing price
 * @param {boolean} [options.verbose] - Enable verbose logging
 * @param {Object} [config] - The settings; those config.js's `loadConfig` reads when not given
 * @returns {Promise<Object>} Result object with statistics
 */
export async function runBackfill(options, config = loadConfig()) {
  const { inputFile, outputFile, verbose, useHighest } =
    validateAndResolveOptions(options, config);

  logv(verbose, 1, `Input file: ${inputFile}`);
  logv(verbose, 1, `Output file: ${outputFile}`);
  logv(verbose, 1, `Backfill mode: ${useHighest ? "highest" : "lowest"}`);

  const { rows, headers } = readCsvFile(inputFile);
  logv(verbose, 1, `Read CSV content, ${rows.length} rows`);
  logv(verbose, 1, `Detected headers: ${headers.join(", ")}`);

  const { priceColName, amountColName, usdAmountColName, grandTotalColName } =
    detectColumns(headers);
  logv(verbose, 1, `Price column: ${priceColName}`);
  logv(verbose, 1, `Amount column: ${amountColName}`);

  say(`Backfilling ${rows.length} rows from ${inputFile}...`);

  const stats = backfillPrices(rows, {
    priceColName,
    amountColName,
    usdAmountColName,
    grandTotalColName,
    useHighest,
    verbose,
  });

  logv(verbose, 1, `Backfill stats: ${JSON.stringify(stats)}`);

  await writeCsvFile(outputFile, headers, rows);

  say(
    `Backfill complete: ${stats.emptyRowsFilled} rows filled in ${stats.blocksFound} block(s)`,
  );
  say(`Output written to ${outputFile}`);

  return stats;
}

/**
 * Runs the command line: reads the options, backfills the file, and ends
 * with exit code 1, the error printed, when it cannot. `bin/end-user/backfill.js`,
 * at the repo's top, runs it.
 *
 * @returns {Promise<void>} Settles once the run has ended
 */
export async function backfillCommandLine() {
  try {
    const command = parseBackfillCommandLine();
    const config = loadConfig();
    takeBackfillSettings(command, config);
    await runBackfill(command.opts(), config);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
