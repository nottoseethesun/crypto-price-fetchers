#!/usr/bin/env node
/**
 * Backfill Batch Job
 * ==================
 *
 * A standalone CLI tool to backfill empty/error prices in a previously-generated
 * output CSV file. This is useful when you have an existing output.csv from index.js
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
 * @license See the file, `../LICENSE`
 *
 * Quick Start
 * -----------
 *
 * Basic usage (conservative tax estimates - use highest bracketing price):
 *   node backfill.js --input=output.csv --backfill-highest
 *
 * Budgeting (avoid over-estimating - use lowest bracketing price):
 *   node backfill.js --input=output.csv --backfill-lowest
 *
 * Write to a different file:
 *   node backfill.js --input=output.csv --output=backfilled.csv --backfill-highest
 *
 * Command-Line Options
 * --------------------
 *
 *   --input <path>       Required. Path to input CSV file (typically a previous output.csv)
 *   --output <path>      Output CSV path. Default: overwrites input file
 *   --backfill-highest   Fill empty prices with highest bracketing price (tax estimates)
 *   --backfill-lowest    Fill empty prices with lowest bracketing price (budgeting)
 *   --verbose            Enable detailed logging
 *   --help               Show usage information
 *
 * Configuration
 * -------------
 *
 * Default backfill mode can be set in config.json:
 *   "BACKFILL_HIGHEST": true   // Enable --backfill-highest by default
 *   "BACKFILL_LOWEST": true    // Enable --backfill-lowest by default
 *
 * CLI flags override config.json settings.
 *
 * Examples
 * --------
 *
 *   # Backfill in place with highest price (conservative for taxes)
 *   node backfill.js --input=mining-output.csv --backfill-highest
 *
 *   # Backfill to new file with lowest price (for budgeting)
 *   node backfill.js --input=output.csv --output=budget.csv --backfill-lowest
 *
 *   # Verbose mode to see which rows are being filled
 *   node backfill.js --input=output.csv --backfill-highest --verbose
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

import fs from 'fs';
import path from 'path';
import os from 'os';

import { Command } from 'commander';
import { parse as csvParse } from 'csv-parse/sync';
import { createObjectCsvWriter } from 'csv-writer';

import { backfillPrices, logv, DEFAULT_COLUMNS } from './utils/backfill.js';

/**
 * Loads configuration from config.json.
 * @returns {Object} Configuration object
 */
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync('./config.json', 'utf8'));
  } catch (e) {
    // Return empty config if file doesn't exist or is invalid
    return {};
  }
}

/**
 * Sets up and returns the Commander program instance for backfill CLI.
 * @returns {import('commander').Command} Configured Commander program
 */
export function setupBackfillCommander() {
  const program = new Command();
  program
    .name('backfill')
    .description('Backfill empty/error prices in a CSV file using bracketing prices')
    .version('1.0.0', '-v, --version', 'output the version number')

    .requiredOption(
      '--input <path>',
      'Path to input CSV file (typically a previous output.csv)'
    )
    .option(
      '--output <path>',
      'Path to output CSV file (default: overwrites input)'
    )
    .option(
      '--backfill-highest',
      'Fill empty prices with highest bracketing price (conservative tax estimates)',
      false
    )
    .option(
      '--backfill-lowest',
      'Fill empty prices with lowest bracketing price (budgeting: avoid over-estimating)',
      false
    )
    .option(
      '--verbose',
      'Enable detailed logging during processing',
      false
    )

    .addHelpText('after', `
Examples:
  Backfill in place (conservative tax estimates):
    $ node backfill.js --input=output.csv --backfill-highest

  Backfill to new file (budgeting):
    $ node backfill.js --input=output.csv --output=budget.csv --backfill-lowest

  Verbose mode:
    $ node backfill.js --input=output.csv --backfill-highest --verbose
    `)

    .helpOption('-h, --help', 'display help for command');

  return program;
}

/**
 * Parses command-line arguments.
 * @returns {Object} Parsed options
 */
export function parseBackfillArgs() {
  const cmd = setupBackfillCommander();
  cmd.parse(process.argv);
  return cmd.opts();
}

/**
 * Main function to run the backfill process.
 * @param {Object} options - Backfill options
 * @param {string} options.input - Input file path
 * @param {string} [options.output] - Output file path (defaults to input)
 * @param {boolean} [options.backfillHighest] - Use highest bracketing price
 * @param {boolean} [options.backfillLowest] - Use lowest bracketing price
 * @param {boolean} [options.verbose] - Enable verbose logging
 * @returns {Promise<Object>} Result object with statistics
 */
export async function runBackfill(options) {
  const config = loadConfig();

  let inputFile = options.input;
  const outputFile = options.output || inputFile;
  const verbose = options.verbose || process.env.VERBOSE === '1';
  const backfillHighest = options.backfillHighest || config.BACKFILL_HIGHEST || false;
  const backfillLowest = options.backfillLowest || config.BACKFILL_LOWEST || false;

  // Expand ~ to home directory
  if (inputFile?.startsWith('~')) {
    inputFile = path.join(os.homedir(), inputFile.slice(1));
  }

  // Validate backfill mode
  if (!backfillHighest && !backfillLowest) {
    throw new Error('Must specify --backfill-highest or --backfill-lowest (or set in config.json)');
  }

  logv(verbose, 1, `Input file: ${inputFile}`);
  logv(verbose, 1, `Output file: ${outputFile}`);
  logv(verbose, 1, `Backfill mode: ${backfillHighest ? 'highest' : 'lowest'}`);

  // Read input CSV
  if (!fs.existsSync(inputFile)) {
    throw new Error(`Input file not found: ${inputFile}`);
  }

  const csvContent = fs.readFileSync(inputFile, 'utf8');
  logv(verbose, 1, `Read CSV content, length: ${csvContent.length}`);

  const rows = csvParse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter: ',',
    quote: '"',
    relax_column_count: true
  });

  if (rows.length === 0) {
    throw new Error('Input CSV is empty');
  }

  const headers = Object.keys(rows[0]);
  logv(verbose, 1, `Detected headers: ${headers.join(', ')}`);

  // Detect column names (use defaults or find matching columns)
  const priceColName = headers.find(h => h.includes('$usd price')) || DEFAULT_COLUMNS.price;
  const amountColName = headers.find(h => h.toLowerCase().includes('amount')) || DEFAULT_COLUMNS.amount;
  const usdAmountColName = headers.find(h => h.includes('$usd amount')) || DEFAULT_COLUMNS.usdAmount;
  const grandTotalColName = headers.find(h => h.includes('grand total')) || DEFAULT_COLUMNS.grandTotal;

  logv(verbose, 1, `Price column: ${priceColName}`);
  logv(verbose, 1, `Amount column: ${amountColName}`);

  // Verify required columns exist
  if (!headers.includes(priceColName)) {
    throw new Error(`Price column "${priceColName}" not found in CSV`);
  }

  console.log(`Backfilling ${rows.length} rows from ${inputFile}...`);

  // Apply backfill
  const useHighest = backfillHighest; // backfillHighest takes precedence
  const stats = backfillPrices(rows, {
    priceColName,
    amountColName,
    usdAmountColName,
    grandTotalColName,
    useHighest,
    verbose
  });

  logv(verbose, 1, `Backfill stats: ${JSON.stringify(stats)}`);

  // Write output CSV
  const csvWriter = createObjectCsvWriter({
    path: outputFile,
    header: headers.map(h => ({ id: h, title: h })),
    fieldDelimiter: ',',
    quote: '"',
    escape: '"'
  });

  await csvWriter.writeRecords(rows);

  console.log(`Backfill complete: ${stats.emptyRowsFilled} rows filled in ${stats.blocksFound} block(s)`);
  console.log(`Output written to ${outputFile}`);

  return stats;
}

// Main entry point - only run if this is the main module
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  try {
    const args = parseBackfillArgs();
    await runBackfill(args);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
