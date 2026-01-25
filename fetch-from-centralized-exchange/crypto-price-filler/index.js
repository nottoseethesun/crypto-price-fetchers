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
 * - Backfill options for empty prices (tax estimation)
 *
 * @version 1.0.0
 * @author Christopher M. Balz with Grok and Claude.ai
 * @license See the file, `../LICENSE`
 *
 * Installation
 * ------------
 *
 * 1. Ensure Node.js v21.1.0 or later is installed
 * 2. Install dependencies:
 *    npm install
 *
 * Configuration
 * -------------
 *
 * All configuration is done via two JSON files: `supported-tokens.json` for tokens
 * and `config.json` for API settings. No code changes required.
 *
 * ADDING A NEW COIN (supported-tokens.json):
 *
 *   Open `supported-tokens.json` and add an entry under the "tokens" object:
 *
 *   "symbol": {
 *     "name": "Human-readable name",
 *     "coingecko_id": "coingecko-api-id",      // or null if not on CoinGecko
 *     "coinpaprika_id": "coinpaprika-api-id",  // or null if not on CoinPaprika
 *     "mexc_symbol": "SYMBOL",                 // base symbol (e.g. "XTM"), or null
 *     "note": "Optional notes about this token"
 *   }
 *
 *   To find the correct IDs:
 *   - CoinGecko: Search at https://www.coingecko.com, the ID is in the URL
 *     (e.g., https://www.coingecko.com/en/coins/gridcoin-research → "gridcoin-research")
 *   - CoinPaprika: Search at https://coinpaprika.com, ID format is "symbol-name"
 *     (e.g., "grc-gridcoin")
 *   - MEXC: Use the base symbol only (e.g., "XTM" not "XTMUSDT")
 *
 *   Example - adding Monero:
 *   "xmr": {
 *     "name": "Monero",
 *     "coingecko_id": "monero",
 *     "coinpaprika_id": "xmr-monero",
 *     "mexc_symbol": "XMR",
 *     "note": "Privacy coin"
 *   }
 *
 * ADDING A NEW DATA SOURCE:
 *
 *   To add a new price API source (e.g., CryptoCompare, Binance):
 *
 *   1. Create a new module in `sources/` (e.g., `sources/cryptoCompare.js`)
 *      Export a function like: getPriceFromCryptoCompare(id, utcMs, target, verbose)
 *      - Should return a price (number) or null if unavailable
 *      - Use `fetchWithRetry` from `utils/fetch.js` for rate-limit handling
 *      - Include verbose logging with logv() pattern
 *
 *   2. Add API configuration to `config.json`:
 *      - Base URL (e.g., "CRYPTOOMPARE_BASE": "https://...")
 *      - API key if required (e.g., "CRYPTOOMPARE_API_KEY": "")
 *      - Rate limit delay (e.g., "CRYPTOOMPARE_RATE_LIMIT_MS": 1000)
 *
 *   3. Add the source ID field to `supported-tokens.json` schema:
 *      - Add "cryptoCompare_id" field to relevant tokens
 *
 *   4. Integrate into `sources/price.js`:
 *      - Import your new function
 *      - Add it to the fallback chain (after MEXC, CoinGecko, CoinPaprika)
 *      - Follow the existing pattern for null checks and logging
 *
 *   5. Export from `sources/index.js` (barrel file)
 *
 * API KEYS (config.json):
 *
 *   COINGECKO_API_KEY    Your CoinGecko API key. Obtain from https://www.coingecko.com/en/api
 *                        The free "Demo" tier provides 30 requests/minute and 365 days of
 *                        historical data. Leave empty ("") for unauthenticated access
 *                        (stricter rate limits, no historical data beyond current day).
 *
 * RATE LIMITING (config.json):
 *
 *   REQUEST_DELAY_MS     Default delay (in milliseconds) between successive API requests.
 *                        Used as a baseline for all sources. Default: 1200ms.
 *
 *   COINGECKO_RATE_LIMIT_MS
 *                        CoinGecko-specific delay between requests. Set based on your plan:
 *                        - Demo (free with key): 30 req/min → 2000ms recommended
 *                        - Analyst: 500 req/min → 120ms
 *                        - Pro: higher limits → adjust accordingly
 *                        Default: 2000ms. Skipped in test environments.
 *
 *   To customize for your API plan:
 *   1. Check your provider's documentation for rate limits
 *   2. Calculate delay: (60000 ms / requests_per_minute)
 *   3. Update the relevant *_RATE_LIMIT_MS value in config.json
 *
 * OTHER SETTINGS (config.json):
 *
 *   MAX_RETRIES          Number of retry attempts on rate-limit (429) errors. Default: 3.
 *   RETRY_BACKOFF_MS     Array of backoff delays for successive retries. Default: [5000, 10000, 20000].
 *   TIMEZONE_OFFSETS     Add custom timezone abbreviations and their UTC offsets.
 *
 *   BACKFILL_HIGHEST     Set to true to enable --backfill-highest by default. Default: false.
 *                        Fills empty/error prices with the highest of the two bracketing prices.
 *                        Use for conservative tax estimates (higher taxable income).
 *
 *   BACKFILL_LOWEST      Set to true to enable --backfill-lowest by default. Default: false.
 *                        Fills empty/error prices with the lowest of the two bracketing prices.
 *                        Use for budgeting to avoid over-estimating income.
 *
 *   Note: CLI flags (--backfill-highest, --backfill-lowest) override config.json settings.
 *   If both are enabled, BACKFILL_HIGHEST takes precedence.
 *
 * Usage
 * -----
 *
 * Prepare your input CSV file with the following format (see `tests/mock-input.csv`):
 *   - Required column: "date (UTC)" in format YYYY-MM-DD HH:mm:ss
 *   - Required column: "amount" (quantity of tokens)
 *   - Optional columns are preserved in output
 *
 * Basic command:
 *   node index.js --token=<symbol> --input=<file.csv> --output=<output.csv>
 *
 * Command-Line Options:
 *   --token       {string}  Required. Token symbol (e.g. xtm, grc, btc). Case-insensitive.
 *   --input       {string}  Required. Path to input CSV. Supports ~ for home directory.
 *   --output      {string}  Output CSV path. Default: 'output.csv'
 *   --mode        {string}  Price type: 'high', 'low', or 'close'. Default: 'close'
 *   --tz          {string}  Timezone abbreviation. Default: 'UTC'
 *                           Supported: UTC, GMT, EST, EDT, CST, CDT, MST, MDT, PST, PDT
 *   --verbose     {flag}    Enable detailed [VERBOSE] logging. Also: VERBOSE=1 env var
 *   --backfill-highest {flag}  Fill empty/error prices with highest bracketing price.
 *                           Use for conservative tax estimates (higher taxable income).
 *   --backfill-lowest  {flag}  Fill empty/error prices with lowest bracketing price.
 *                           Use for budgeting to avoid over-estimating income.
 *   --help        {flag}    Show usage information
 *
 * Backfill Options:
 *   When price data is unavailable for certain rows (API errors, unsupported dates),
 *   the output will contain empty or 'Error' values. The backfill options allow you
 *   to fill these gaps using neighboring prices for tax estimation purposes.
 *
 *   How it works:
 *   - Finds contiguous blocks of empty/error prices
 *   - Looks at the valid prices immediately before and after the block
 *   - Fills with the higher (--backfill-highest) or lower (--backfill-lowest) of the two
 *   - If only one bracketing price exists (start/end of file), uses that price
 *   - Recalculates USD amounts and grand totals after backfilling
 *
 *   Use cases:
 *   - --backfill-highest: Conservative tax estimates (assumes higher price at time
 *     of receipt, resulting in higher reported taxable income)
 *   - --backfill-lowest: Budgeting (assumes lower price at time of receipt to avoid
 *     over-estimating income when planning)
 *
 *   Configuration:
 *   These options can also be set in config.json for persistent defaults:
 *     "BACKFILL_HIGHEST": true   // Enable by default (CLI flag overrides)
 *     "BACKFILL_LOWEST": true    // Enable by default (CLI flag overrides)
 *
 *   Note: If both flags are specified, --backfill-highest takes precedence.
 *
 * Progress Bar:
 *   A progress bar is displayed by default during processing, showing:
 *   - Current row / total rows
 *   - Percentage complete
 *   - Estimated time remaining (ETA)
 *
 *   The progress bar is automatically disabled in:
 *   - Verbose mode (--verbose) - detailed logs shown instead
 *   - Test environments (NODE_ENV=test or VITEST)
 *
 * Examples:
 *
 *   # Basic close-price fill (UTC)
 *   node index.js --token=grc --input=mining.csv --output=filled.csv
 *
 *   # High price in CDT timezone with verbose logging
 *   node index.js --token=xtm --input=input.csv --output=prices.csv --mode=high --tz=CDT --verbose
 *
 *   # Backfill empty prices with highest bracketing price (conservative tax estimates)
 *   node index.js --token=grc --input=mining.csv --output=filled.csv --backfill-highest
 *
 *   # Backfill empty prices with lowest bracketing price (budgeting)
 *   node index.js --token=grc --input=mining.csv --output=filled.csv --backfill-lowest
 *
 *   # Show help
 *   node index.js --help
 *
 * Testing
 * -------
 *
 * Unit/Integration Tests (Vitest):
 *   npm run test              # standard test run
 *   npm run test:strict       # includes import verification (recommended)
 *   npm run test:debug        # with full [VERBOSE] logs
 *
 *   All tests use mocks for APIs, cache, fallback, retry, etc.
 *
 *   IMPORTANT: Use `test:strict` to catch import errors that `vitest` alone may miss.
 *   This ensures files will actually load into Node.js, preventing production breakage.
 *
 * Production-Style Test with Real Data:
 *   node index.js --token=grc --input=tests/mock-input.csv --output=tests/mock-filled.csv --verbose
 *
 *   Expected behavior:
 *   - Fetches real prices from configured sources (MEXC → CoinGecko → CoinPaprika)
 *   - Fills $usd price, $usd amount, and grand total columns
 *   - Future/invalid dates left blank
 *   - If no price available → writes 'Error'
 *   - Verbose logs show every fetch attempt, parse step, price result
 *
 * Saving Test Logs:
 *   npm run test:debug > test.log 2>&1
 *
 *   To view logs in HTML (requires `aha`: sudo apt install aha):
 *   aha --black -y 'body { font-size: 14px; }' < test.log > test.html && xdg-open test.html
 *
 *   Optional shell aliases for convenience:
 *     alias svtlog='npm run test:debug > test.log 2>&1'
 *     alias swtlog="aha --black -y 'body { font-size: 14px; }' < test.log > test.html && xdg-open test.html"
 *
 * TroubleShooting
 * ---------------
 *
 * - Ensure Node.js v21.1.0 or later is installed
 * - Ensure internet connectivity for API access
 * - Check that input CSV matches expected format exactly
 * - Use --verbose flag for detailed logs
 * - Check API status of MEXC, CoinGecko, CoinPaprika if fetches fail
 * - Review rate-limit handling in logs if many requests are made
 * - For unexpected errors, check stack traces in verbose output
 * - If historical data returns 401, check API key and plan limits (e.g., 365-day limit)
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
import { getProgressBar } from './utils/progress.js';

// Added missing luxon import (fixes DateTime is not defined)
import { DateTime } from 'luxon';

// Import CLI setup from separate module
import { parseArgs } from './commander.js';

// Load configuration files
const supportedTokens = JSON.parse(fs.readFileSync('./supported-tokens.json', 'utf8'));
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

// Verbosity-aware logger
function logv(shouldLog, level, message, ...args) {
  if (!shouldLog || level < 1) return;
  console.log(`[VERBOSE:${level}] ${message}`, ...args);
}

/**
 * Backfills empty price rows using bracketing prices.
 * Empty prices are filled with either the highest or lowest of the surrounding valid prices.
 * Also recalculates USD amounts and grand totals after backfilling.
 *
 * @param {Array<Object>} rows - Array of row objects to process
 * @param {string} priceColName - Name of the price column
 * @param {string} amountColName - Name of the amount column
 * @param {string} usdAmountColName - Name of the USD amount column
 * @param {string} grandTotalColName - Name of the grand total column
 * @param {boolean} useHighest - If true, use highest bracketing price; if false, use lowest
 * @param {boolean} verbose - Enable verbose logging
 */
function backfillPrices(rows, priceColName, amountColName, usdAmountColName, grandTotalColName, useHighest, verbose) {
    const isEmpty = (price) => price === '' || price === 'Error';

    let i = 0;
    while (i < rows.length) {
        if (isEmpty(rows[i][priceColName])) {
            const blockStart = i;
            while (i < rows.length && isEmpty(rows[i][priceColName])) i++;
            const blockEnd = i;

            // Find bracketing prices
            let leftPrice = blockStart > 0 ? parseFloat(rows[blockStart - 1][priceColName]) : null;
            let rightPrice = blockEnd < rows.length ? parseFloat(rows[blockEnd][priceColName]) : null;
            if (isNaN(leftPrice)) leftPrice = null;
            if (isNaN(rightPrice)) rightPrice = null;

            // Determine fill price
            let fillPrice = null;
            if (leftPrice !== null && rightPrice !== null) {
                fillPrice = useHighest ? Math.max(leftPrice, rightPrice) : Math.min(leftPrice, rightPrice);
            } else {
                fillPrice = leftPrice ?? rightPrice;
            }

            // Fill the block
            if (fillPrice !== null) {
                logv(verbose, 1, `Backfilling rows ${blockStart + 1}-${blockEnd} with price ${fillPrice}`);
                for (let j = blockStart; j < blockEnd; j++) {
                    rows[j][priceColName] = fillPrice;
                }
            }
        } else {
            i++;
        }
    }

    // Recalculate USD amounts and grand totals
    let grandTotalUsd = 0;
    for (const row of rows) {
        const price = parseFloat(row[priceColName]);
        const amount = parseFloat((row[amountColName] || '').trim());
        if (!isNaN(price) && !isNaN(amount)) {
            const usdAmount = amount * price;
            row[usdAmountColName] = usdAmount.toFixed(8);
            grandTotalUsd += usdAmount;
        }
        row[grandTotalColName] = grandTotalUsd.toFixed(6);
    }
}

// Parse CLI args using commander (moved to commander.js)
const args = parseArgs();

const token = args.token;
let inputFile = args.input;
const outputFile = args.output || 'output.csv';
const mode = args.mode || 'high';
const tz = args.tz || 'UTC';
const verbose = args.verbose || process.env.VERBOSE === '1';
const backfillHighest = args.backfillHighest || config.BACKFILL_HIGHEST || false;
const backfillLowest = args.backfillLowest || config.BACKFILL_LOWEST || false;

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

// Initialize progress bar (shows in non-verbose mode, disabled in tests)
const progressBar = getProgressBar(rows.length, verbose);
progressBar.start();

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

  // Update progress bar
  progressBar.increment();
}

// Stop progress bar
progressBar.stop();

// Apply backfill if requested (backfillHighest takes precedence if both are set)
if (backfillHighest || backfillLowest) {
    const useHighest = backfillHighest; // backfillHighest takes precedence
    logv(verbose, 1, `Backfill mode: ${useHighest ? 'highest' : 'lowest'}`);
    backfillPrices(outputRows, priceColName, amountColName, usdAmountColName, grandTotalColName, useHighest, verbose);
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
  parseInputToUtcMs,
  backfillPrices
};
