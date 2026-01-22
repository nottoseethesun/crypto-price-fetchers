/**
 * Crypto Price Filler
 * =====================
 *
 * A Node.js CLI tool to fetch historical cryptocurrency prices (high/low) for a given token
 * and date/time, then fill a CSV file with USD prices and calculated USD amounts.
 *
 * Features:
 * - Primary source: MEXC (1m & 60m klines)
 * - Fallbacks: CoinGecko (tickers + history), CoinPaprika (tickers + OHLCV)
 * - Supports timezone offsets, caching, rate-limit retry, BTC-pair adjustment
 * - Verbose logging for debugging
 * - Handles invalid/future dates gracefully
 *
 * @version 1.0.0
 * @author Christopher M. Balz with Grok
 * @license See the file, `../LICENSE`
 *
 * Installation / Usage
 * --------------------
 *
 * 1. Install dependencies:
 *    npm install
 * 
 * 2. Ensure that your coin is entered into the `tokenMap` mapping in this file.
 *
 * 3. Ensure that your CSV input file's format, where you list out the dates that you want 
 *    to fetch the price for, matches the sample CSV file provided in `tests/input.csv` exactly 
 *    in terms of column headers and date format (YYYY-MM-DD HH:mm:SS).
 * 
 * 4. Basic usage:
 *    node index.js --token=xtm --input=input.csv --output=output.csv
 *
 * Command-Line Options
 * --------------------
 * All options are passed as --key=value or --key (flag style)
 *
 * --token       {string}  Required. Token symbol (e.g. xtm, btc, xmr). Case-insensitive.
 * --input       {string}  Required. Path to input CSV. Supports ~ for home directory.
 * --output      {string}  Output CSV path. Default: 'output.csv'
 * --mode        {string}  Price type: 'high' (default) or 'low'
 * --tz          {string}  Timezone abbreviation. Default: 'UTC'
 *                         Supported: UTC, GMT, EST, EDT, CST, CDT, MST, MDT, PST, PDT
 * --verbose     {flag}    Enable detailed [VERBOSE] logging. Default: false
 *                         Also enabled by env var: VERBOSE=1
 *
 * Examples
 * --------
 *
 * # Basic high-price fill (UTC)
 * node index.js --token=xtm --input=tests/input.csv --output=filled_output.csv --mode=high --tz=UTC
 *
 * # Low price in CDT timezone + verbose
 * node index.js --token=xtm --input=input.csv --output=low_prices_output.csv --mode=low --tz=CDT --verbose
 *
 * # Missing args → shows usage
 * node index.js
 *
 * Testing Instructions
 * --------------------
 *
 * 1. Unit/Integration Tests (Vitest)
 *    Run the full suite (15 tests):
 *    npm run test              # clean output
 *    npm run test:verbose      # with full [VERBOSE] logs
 *
 *    All tests use mocks for APIs, cache, fallback, retry, etc.
 *    Coverage: ~44% statements (mostly CLI & rare edges uncovered)
 *
 * 2. Production-Style Test with Real Data
 *    Use the provided sample CSV in tests/input.csv (10 rows with dates & amounts)
 *    Run:
 *    node index.js --token=xtm --input=tests/input.csv --output=filled_output.csv --mode=high --tz=UTC --verbose
 *
 *    Expected output:
 *    - Reads 10 rows
 *    - Fetches real XTM prices from MEXC (or fallbacks)
 *    - Fills $usd price and $usd amount columns
 *    - Writes filled_output.csv
 *    - Verbose logs show every fetch attempt, parse step, price result
 *    - Future/invalid dates left blank
 *    - If no price available → writes 'Error'
 *
 *    Note: Real API calls may hit rate limits → verbose logs will show retries/backoffs.
 *
 * TroubleShooting
 * ----------------
 * 
 * - Ensure Node.js v14+ is installed
 * - Ensure internet connectivity for API access
 * - Check that input CSV matches expected format exactly
 * - Use --verbose flag for detailed logs
 * - Check API status of MEXC, CoinGecko, CoinPaprika if fetches fail
 * - Review rate-limit handling in logs if many requests are made
 * - For unexpected errors, check stack traces in verbose output
 * 
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

import { parse as csvParse } from 'csv-parse/sync';
import { createObjectCsvWriter } from 'csv-writer';

import { getTimezoneOffsetHours, parseInputToUtcMs } from './utils/date.js';
import { getCryptoPrice } from './sources/price.js';
import { getCache, setCache } from './utils/cache.js';

// Verbosity-aware logger
function logv(shouldLog, level, message, ...args) {
  if (!shouldLog || level < 1) return;
  console.log(`[VERBOSE:${level}] ${message}`, ...args);
}

// Only run main CLI logic when file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2).reduce((acc, arg) => {
    const [key, value] = arg.split('=');
    acc[key.replace('--', '')] = value || true;
    return acc;
  }, {});

  const token = args.token;
  let inputFile = args.input;
  const outputFile = args.output || 'output.csv';
  const mode = args.mode || 'high';
  const tz = args.tz || 'UTC';
  const verbose = args.verbose === true || args.verbose === 'true' || process.env.VERBOSE === '1';

  if (inputFile?.startsWith('~')) {
    inputFile = path.join(os.homedir(), inputFile.slice(1));
  }

  if (!token || !inputFile) {
    console.error('Missing required args. Usage:');
    console.error('  node index.js --token=xtm --input=~/path/to/file.csv [--output=output.csv] [--mode=high] [--tz=CDT] [--verbose]');
    process.exit(1);
  }

  console.log(`Starting price filler for token: ${token}, mode: ${mode}, tz: ${tz}`);
  console.log(`Input: ${inputFile}, Output: ${outputFile}`);
  logv(verbose, 1, 'Verbose mode ENABLED. Starting CLI logic');

  const csvContent = fs.readFileSync(inputFile, 'utf8');
  logv(verbose, 1, `Read CSV content from input file, length: ${csvContent.length}`);
  const records = csvParse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter: ',',
    quote: '"',
    relax_column_count: true
  });

  const headers = Object.keys(records[0] || {});
  console.log(`Detected headers (${headers.length}): ${headers.join(', ')}`);

  const rows = records;
  console.log(`Read ${rows.length} rows from input CSV.`);

  logv(verbose, 1, 'First 5 rows:');
  rows.slice(0, 5).forEach((row, i) => logv(verbose, 1, `Row ${i + 1}: ${JSON.stringify(row)}`));

  let dateColName = headers.find(h => h.includes('date') && h.includes('UTC')) ||
                    headers.find(h => h.toLowerCase().includes('date'));
  logv(verbose, 1, `Searching for date column in headers: ${headers.join(', ')}`);
  if (!dateColName) {
    console.error('No date column found in CSV headers');
    process.exit(1);
  }
  console.log(`Using date column: "${dateColName}"`);

  const amountColName = headers.find(h => h.toLowerCase().includes('amount'));
  if (amountColName) console.log(`Using amount column: "${amountColName}"`);

  const priceColName = '$usd price';
  const usdAmountColName = '$usd amount';

  let lastValidDateIndex = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    const dateStr = (rows[i][dateColName] || '').trim();
    logv(verbose, 2, `Checking row ${i + 1} date: "${dateStr}"`);

    if (dateStr && !dateStr.includes(',,,,') && !dateStr.includes('Total')) {
      const parsed = DateTime.fromFormat(dateStr, 'yyyy-MM-dd HH:mm:ss');
      logv(verbose, 2, `Date parse result for "${dateStr}": valid=${parsed.isValid}`);
      if (parsed.isValid) {
        lastValidDateIndex = i;
        console.log(`Last valid date row: index ${i + 1} (${dateStr})`);
        break;
      }
    }
  }

  if (lastValidDateIndex === -1) console.warn('No valid date rows found');

  const outputRows = [];

  for (let i = 0; i < rows.length; i++) {
    const row = { ...rows[i] };
    const dateStr = (row[dateColName] || '').trim();

    if (i > lastValidDateIndex || !dateStr || dateStr.includes(',,,,') || dateStr.includes('Total')) {
      row[priceColName] = '';
      row[usdAmountColName] = '';
      outputRows.push(row);
      continue;
    }

    const amountStr = amountColName ? (row[amountColName] || '').trim() : '';
    let price = null;

    logv(verbose, 1, `Processing row ${i + 1}: "${dateStr}"`);

    try {
      price = await getCryptoPrice(token, dateStr, tz, mode, verbose);
      logv(verbose, 1, `Price fetched for row ${i + 1}: ${price}`);
    } catch (e) {
      logv(verbose, 1, `Error fetching price for row ${i + 1}: ${e.message}`);
      console.error(`Error fetching price for "${dateStr}": ${e.message}`);
    }

    row[priceColName] = price ?? 'Error';

    if (price !== null && amountStr) {
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        row[usdAmountColName] = (amount * price).toFixed(8);
      } else {
        logv(verbose, 1, `Invalid amount in row ${i + 1}: "${amountStr}"`);
      }
    }

    outputRows.push(row);
  }

  logv(verbose, 1, `Preparing to write output CSV with ${outputRows.length} rows`);

  const csvWriter = createObjectCsvWriter({
    path: outputFile,
    header: headers.map(h => ({ id: h, title: h })),
    fieldDelimiter: ',',
    quote: '"',
    escape: '"'
  });

  await csvWriter.writeRecords(outputRows);
  console.log(`Output CSV written to ${outputFile}`);
}

// Export everything needed for tests
export {
  getCryptoPrice,
  getCache,
  setCache,
  getTimezoneOffsetHours,
  parseInputToUtcMs
};
