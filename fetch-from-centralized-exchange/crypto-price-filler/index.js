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
 * @author Christopher M. Balz with Grok and Claude.ai
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
 * --help        {flag}    Show usage information
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
 * Configuration (config.json)
 * ---------------------------
 *
 * API Keys:
 *
 *   COINGECKO_API_KEY    Your CoinGecko API key. Obtain one from https://www.coingecko.com/en/api
 *                        The free "Demo" tier provides 30 requests/minute and 365 days of
 *                        historical data. Leave empty ("") to use unauthenticated access
 *                        (stricter rate limits, no historical data beyond current day).
 *
 * Rate Limiting:
 *
 *   REQUEST_DELAY_MS     Default delay (in milliseconds) between successive API requests.
 *                        Used as a baseline for all sources. Default: 1200ms.
 *
 *   COINGECKO_RATE_LIMIT_MS
 *                        CoinGecko-specific delay between requests. Set based on your plan:
 *                        - Demo (free with key): 30 req/min → 2000ms recommended
 *                        - Analyst: 500 req/min → 120ms
 *                        - Pro: higher limits → adjust accordingly
 *                        Default: 2000ms. This delay is skipped in test environments.
 *
 * Customizing for Your API Plan:
 *
 *   1. Check your API provider's documentation for rate limits and features.
 *   2. Open config.json and locate the relevant setting (e.g., COINGECKO_RATE_LIMIT_MS).
 *   3. Calculate the appropriate delay: (60000 ms / requests_per_minute).
 *   4. Update the value and save. No code changes required.
 *
 *   Other configurable values in config.json:
 *   - MAX_RETRIES: Number of retry attempts on rate-limit (429) errors. Default: 3.
 *   - RETRY_BACKOFF_MS: Array of backoff delays [5000, 10000, 20000] for successive retries.
 *   - TIMEZONE_OFFSETS: Add custom timezone abbreviations if needed.
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

// Added missing luxon import (fixes DateTime is not defined)
import { DateTime } from 'luxon';

// Import CLI setup from separate module
import { parseArgs } from './commander.js';

// Load central token configurations from supported-tokens.json
const supportedTokens = JSON.parse(fs.readFileSync('./supported-tokens.json', 'utf8'));

// Verbosity-aware logger
function logv(shouldLog, level, message, ...args) {
  if (!shouldLog || level < 1) return;
  console.log(`[VERBOSE:${level}] ${message}`, ...args);
}

// Parse CLI args using commander (moved to commander.js)
const args = parseArgs();

const token = args.token;
let inputFile = args.input;
const outputFile = args.output || 'output.csv';
const mode = args.mode || 'high';
const tz = args.tz || 'UTC';
const verbose = args.verbose || process.env.VERBOSE === '1';

if (inputFile?.startsWith('~')) {
  inputFile = path.join(os.homedir(), inputFile.slice(1));
}

// Resolve CoinGecko and CoinPaprika IDs from central mapping
const tokenConfig = supportedTokens.tokens?.[token.toLowerCase()] || {};
const coingeckoId = tokenConfig.coingecko_id || token.toLowerCase();
const coinpaprikaId = tokenConfig.coinpaprika_id || null;
logv(verbose, 1, `Resolved CoinGecko ID for ${token}: ${coingeckoId}`);
logv(verbose, 1, `Resolved CoinPaprika ID for ${token}: ${coinpaprikaId || 'none'}`);

// No need for manual missing arg check — commander.requiredOption handles it
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

// Add new columns if not already present
const priceColName = '$usd price';
const usdAmountColName = '$usd amount';
const grandTotalColName = 'grand total ($usd)';

if (!headers.includes(priceColName)) headers.push(priceColName);
if (!headers.includes(usdAmountColName)) headers.push(usdAmountColName);
if (!headers.includes(grandTotalColName)) headers.push(grandTotalColName);

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

let grandTotalUsd = 0;

for (let i = 0; i < rows.length; i++) {
  const row = { ...rows[i] };
  const dateStr = (row[dateColName] || '').trim();

  if (i > lastValidDateIndex || !dateStr || dateStr.includes(',,,,') || dateStr.includes('Total')) {
    row[priceColName] = '';
    row[usdAmountColName] = '';
    row[grandTotalColName] = grandTotalUsd.toFixed(6);
    outputRows.push(row);
    continue;
  }

  const amountStr = amountColName ? (row[amountColName] || '').trim() : '';
  let price = null;

  logv(verbose, 1, `Processing row ${i + 1}: "${dateStr}"`);

  try {
    price = await getCryptoPrice(token, dateStr, tz, mode, verbose, null, coingeckoId, coinpaprikaId);
    logv(verbose, 1, `Price fetched for row ${i + 1}: ${price}`);
  } catch (e) {
    logv(verbose, 1, `Error fetching price for row ${i + 1}: ${e.message}`);
    console.error(`Error fetching price for "${dateStr}": ${e.message}`);
  }

  row[priceColName] = price ?? 'Error';

  if (price !== null && amountStr) {
    const amount = parseFloat(amountStr);
    if (!isNaN(amount)) {
      const usdAmount = amount * price;
      row[usdAmountColName] = usdAmount.toFixed(8);
      grandTotalUsd += usdAmount;
    } else {
      logv(verbose, 1, `Invalid amount in row ${i + 1}: "${amountStr}"`);
    }
  }

  row[grandTotalColName] = grandTotalUsd.toFixed(6);
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

// Export everything needed for tests
export {
  getCryptoPrice,
  getCache,
  setCache,
  getTimezoneOffsetHours,
  parseInputToUtcMs
};
