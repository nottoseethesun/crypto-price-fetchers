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
 * 2. Ensure that your CSV input file's format, where you list out the dates that you want 
 *    to fetch the price for, matches the sample CSV file provided in `tests/input.csv` exactly 
 *    in terms of column headers and date format (YYYY-MM-DD HH:MM:SS).
 * 
 * 2. Basic usage:
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
 * node index.js --token=xtm --input=tests/input.csv --output=filled.csv --mode=high --tz=UTC
 *
 * # Low price in CDT timezone + verbose
 * node index.js --token=xtm --input=input.csv --output=low_prices.csv --mode=low --tz=CDT --verbose
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
 *    After running:
 *    - Open filled_output.csv in LibreOffice Calc, Excel, etc.
 *    - Verify prices are filled for valid past dates
 *    - Check log.txt for full trace (if redirected)
 *
 *    Note: Real API calls may hit rate limits → verbose logs will show retries/backoffs.
 *
 * 
 */

/**
 * Configuration object with API endpoints, intervals, timezones, etc.
 * @constant {Object}
 * @property {string} EXCHANGE_BASE_URL - MEXC API base
 * @property {string} QUOTE_CURRENCY - Default quote asset
 * @property {string} DEFAULT_INTERVAL - Primary kline interval
 * @property {string} FALLBACK_INTERVAL - Secondary kline interval
 * @property {Object} TIMEZONE_OFFSETS - Supported timezone abbreviations → hours offset
 * @property {string} COINGECKO_BASE - CoinGecko API base
 * @property {string} COINPAPRIKA_BASE - CoinPaprika API base
 * @property {string} COINGECKO_TICKERS_TEMPLATE - Ticker endpoint template
 * @property {string} COINGECKO_HISTORY_TEMPLATE - Historical data endpoint template
 * @property {string} COINGECKO_SIMPLE_PRICE_TEMPLATE - Simple price endpoint for BTC
 * @property {string} COINPAPRIKA_TICKERS_TEMPLATE - Paprika ticker endpoint
 * @property {string} COINPAPRIKA_OHLCV_TEMPLATE - Paprika OHLCV historical
 * @property {number[]} RETRY_BACKOFF_MS - Exponential backoff delays for 429
 * @property {number} MAX_RETRIES - Maximum retry attempts
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';
import { parse as csvParse } from 'csv-parse/sync';
import { createObjectCsvWriter } from 'csv-writer';
import { DateTime } from 'luxon';

// Exported configuration (complete)
const CONFIG = {
  EXCHANGE_BASE_URL: 'https://api.mexc.com/api/v3',
  QUOTE_CURRENCY: 'USDT',
  DEFAULT_INTERVAL: '1m',
  FALLBACK_INTERVAL: '60m',
  TIMEZONE_OFFSETS: {
    UTC: 0,
    GMT: 0,
    EST: -5,
    EDT: -4,
    CST: -6,
    CDT: -5,
    MST: -7,
    MDT: -6,
    PST: -8,
    PDT: -7
  },
  COINGECKO_BASE: 'https://api.coingecko.com/api/v3',
  COINPAPRIKA_BASE: 'https://api.coinpaprika.com/v1',
  COINGECKO_TICKERS_TEMPLATE: '{base}/coins/{id}/tickers',
  COINGECKO_HISTORY_TEMPLATE: '{base}/coins/{id}/history?date={date}',
  COINGECKO_SIMPLE_PRICE_TEMPLATE: '{base}/simple/price?ids=bitcoin&vs_currencies=usd',
  COINPAPRIKA_TICKERS_TEMPLATE: '{base}/tickers/{id}',
  COINPAPRIKA_OHLCV_TEMPLATE: '{base}/ohlcv/{id}/historical?start={start}&end={end}',
  RETRY_BACKOFF_MS: [5000, 10000, 20000],
  MAX_RETRIES: 3
};

const TOKEN_TO_ID = {
  btc: { gecko: 'bitcoin', paprika: 'btc-bitcoin' },
  xmr: { gecko: 'monero', paprika: 'xmr-monero' },
  grc: { gecko: 'gridcoin-research', paprika: 'grc-gridcoin' },
  xtm: { gecko: 'tari', paprika: 'xtm-tari' }
};

// Global cache (not exported directly)
let cache = new Map();

// Helpers to access/mock cache in tests (defined here, exported at the end)
function getCache() {
  return cache;
}

function setCache(newCache) {
  cache = newCache;
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
  if (verbose) console.log('[VERBOSE] Verbose mode ENABLED. Starting CLI logic');

  const csvContent = fs.readFileSync(inputFile, 'utf8');
  if (verbose) console.log('[VERBOSE] Read CSV content from input file, length: ' + csvContent.length);
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

  if (verbose) {
    console.log('[VERBOSE] First 5 rows:');
    rows.slice(0, 5).forEach((row, i) => console.log(`[VERBOSE] Row ${i + 1}: ${JSON.stringify(row)}`));
  }

  let dateColName = headers.find(h => h.includes('date') && h.includes('UTC')) ||
                    headers.find(h => h.toLowerCase().includes('date'));
  if (verbose) console.log('[VERBOSE] Searching for date column in headers: ' + headers.join(', '));
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
    if (verbose) console.log(`[VERBOSE] Checking row ${i + 1} date: "${dateStr}"`);

    if (dateStr && !dateStr.includes(',,,,') && !dateStr.includes('Total')) {
      const parsed = DateTime.fromFormat(dateStr, 'yyyy-MM-dd HH:mm:ss');
      if (verbose) console.log(`[VERBOSE] Date parse result for "${dateStr}": valid=${parsed.isValid}`);
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

    if (verbose) console.log(`[VERBOSE] Processing row ${i + 1}: "${dateStr}"`);

    try {
      price = await getCryptoPrice(token, dateStr, tz, mode, verbose);
      if (verbose) console.log(`[VERBOSE] Price fetched for row ${i + 1}: ${price}`);
    } catch (e) {
      if (verbose) console.log(`[VERBOSE] Error fetching price for row ${i + 1}: ${e.message}`);
      console.error(`Error fetching price for "${dateStr}": ${e.message}`);
    }

    row[priceColName] = price ?? 'Error';

    if (price !== null && amountStr) {
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        row[usdAmountColName] = (amount * price).toFixed(8);
      } else {
        if (verbose) console.log(`[VERBOSE] Invalid amount in row ${i + 1}: "${amountStr}"`);
      }
    }

    outputRows.push(row);
  }

  if (verbose) console.log('[VERBOSE] Preparing to write output CSV with ' + outputRows.length + ' rows');

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

// Exported API functions
async function getCryptoPrice(token, dateStr, tz, highOrLow = 'high', verbose = false) {
  verbose = verbose || process.env.VERBOSE === '1';

  if (verbose) console.log(`[VERBOSE] getCryptoPrice START: token=${token}, date="${dateStr}", tz=${tz}, mode=${highOrLow}`);

  const offsetHours = getTimezoneOffsetHours(tz);
  if (verbose) console.log(`[VERBOSE] Offset hours for ${tz}: ${offsetHours}`);

  let safeDateStr = (dateStr ?? '').trim();
  if (verbose) console.log(`[VERBOSE] Safe date string: "${safeDateStr}"`);

  if (!safeDateStr) {
    if (verbose) console.log('[VERBOSE] Skipping: empty safeDateStr');
    return null;
  }

  const utcMs = parseInputToUtcMs(safeDateStr, offsetHours, verbose);
  if (verbose) console.log(`[VERBOSE] Parsed UTC ms: ${utcMs} (${new Date(utcMs).toISOString()})`);

  if (utcMs === null || utcMs > Date.now()) {
    if (verbose) console.log(`[VERBOSE] Skipping: invalid or future date "${safeDateStr}" (utcMs=${utcMs}, now=${Date.now()})`);
    return null;
  }

  const target = highOrLow.toLowerCase() === 'low' ? 'low' : 'high';
  if (verbose) console.log(`[VERBOSE] Target price type: ${target}`);

  const cacheKey = `price_${token}_${safeDateStr.replace(/[^0-9]/g, '')}_${tz}_${target}`;
  if (verbose) console.log(`[VERBOSE] Cache key: ${cacheKey}`);

  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (verbose) console.log(`[VERBOSE] Cache HIT! Returning cached price: ${cached}`);
    return cached;
  } else {
    if (verbose) console.log('[VERBOSE] Cache MISS - proceeding to API fetches');
  }

  if (verbose) console.log('[VERBOSE] Trying MEXC first...');
  let price = await getPriceFromMEXC(token, utcMs, target, verbose);
  if (price !== null) {
    if (verbose) console.log(`[VERBOSE] MEXC SUCCESS - price: ${price}`);
    cache.set(cacheKey, price);
    return price;
  } else {
    if (verbose) console.log('[VERBOSE] MEXC FAILED or returned null - trying CoinGecko');
  }

  const idMap = TOKEN_TO_ID[token] || { gecko: token, paprika: token };
  if (verbose) console.log(`[VERBOSE] Fallback IDs - Gecko: ${idMap.gecko}, Paprika: ${idMap.paprika}`);

  if (verbose) console.log('[VERBOSE] Trying CoinGecko...');
  price = await getPriceFromCoinGecko(idMap.gecko, utcMs, target, verbose);
  if (price !== null) {
    if (verbose) console.log(`[VERBOSE] CoinGecko SUCCESS - price: ${price}`);
    cache.set(cacheKey, price);
    return price;
  } else {
    if (verbose) console.log('[VERBOSE] CoinGecko FAILED or returned null - trying CoinPaprika');
  }

  if (verbose) console.log('[VERBOSE] Trying CoinPaprika...');
  price = await getPriceFromCoinPaprika(idMap.paprika, utcMs, target, verbose);
  if (price !== null) {
    if (verbose) console.log(`[VERBOSE] CoinPaprika SUCCESS - price: ${price}`);
    cache.set(cacheKey, price);
    return price;
  } else {
    if (verbose) console.log('[VERBOSE] CoinPaprika FAILED or returned null - all sources exhausted');
  }

  if (verbose) console.log('[VERBOSE] All sources failed - returning null and caching null');
  cache.set(cacheKey, null);
  return null;
}

function getTimezoneOffsetHours(tz) {
  return CONFIG.TIMEZONE_OFFSETS[tz?.toUpperCase()] || 0;
}

function parseInputToUtcMs(dateStr, offsetHours, verbose = false) {
  verbose = verbose || process.env.VERBOSE === '1';

  if (verbose) console.log(`[VERBOSE] parseInputToUtcMs called with "${dateStr}", offset: ${offsetHours}`);

  const zone = `UTC${offsetHours >= 0 ? '+' : ''}${offsetHours}`;
  const dt = DateTime.fromFormat(dateStr, 'yyyy-MM-dd HH:mm:ss', { zone });

  if (!dt.isValid) {
    if (verbose) console.log('[VERBOSE] Luxon parsing FAILED, falling back to new Date()');
    const fallback = new Date(dateStr);
    if (isNaN(fallback.getTime())) {
      if (verbose) console.log('[VERBOSE] Fallback new Date() also FAILED - returning null');
      return null;
    }
    const utcMs = fallback.getTime() + (offsetHours * 3600000);
    if (verbose) console.log(`[VERBOSE] Fallback new Date() SUCCEEDED, UTC ms: ${utcMs} (${new Date(utcMs).toISOString()})`);
    return utcMs;
  }

  const utcMs = dt.toUTC().toMillis();
  if (verbose) console.log(`[VERBOSE] Luxon parsing SUCCEEDED, UTC ms: ${utcMs} (${dt.toUTC().toISO()})`);
  return utcMs;
}

// MEXC fetch (accepts verbose)
async function getPriceFromMEXC(token, utcMs, target, verbose = false) {
  const skipTokens = new Set(['grc']);
  if (skipTokens.has(token)) {
    if (verbose) console.log(`[VERBOSE] Token ${token} skipped for MEXC`);
    return null;
  }

  const exchangeInfoUrl = CONFIG.EXCHANGE_BASE_URL + '/exchangeInfo';
  if (verbose) console.log(`[VERBOSE] MEXC exchangeInfo URL: ${exchangeInfoUrl}`);
  const exchangeRes = await fetchWithRetry(exchangeInfoUrl, verbose);
  if (!exchangeRes) {
    if (verbose) console.log('[VERBOSE] MEXC exchangeInfo fetch FAILED (no response)'); 
    return null;
  }

  if (verbose) console.log('[VERBOSE] MEXC exchangeInfo response ok: ' + exchangeRes.ok);

  let exchangeData;
  try {
    exchangeData = await exchangeRes.json();
    if (verbose) console.log(`[VERBOSE] MEXC exchangeInfo raw data: ${JSON.stringify(exchangeData, null, 2)}`);
  } catch (e) {
    if (verbose) console.log(`[VERBOSE] MEXC exchangeInfo JSON parse FAILED: ${e.message}`);
    return null;
  }

  const symbols = exchangeData.symbols || [];
  if (verbose) console.log(`[VERBOSE] MEXC symbols loaded: ${symbols.length} symbols`);

  const upperToken = token.toUpperCase();
  let symbol = null;
  let useBTC = false;

  for (const sym of symbols) {
    const symStr = sym.symbol || 'missing';
    const base = sym.baseAsset || 'missing';
    const quote = sym.quoteAsset || 'missing';
    if (verbose) console.log(`[VERBOSE] Checking symbol: symbol=${symStr}, base=${base}, quote=${quote}`);
    if (base === upperToken) {
      if (quote === 'USDT') {
        symbol = upperToken + 'USDT';
        if (verbose) console.log(`[VERBOSE] Found USDT pair: ${symbol}`);
        break;
      } else if (quote === 'BTC') {
        symbol = upperToken + 'BTC';
        useBTC = true;
        if (verbose) console.log(`[VERBOSE] Found BTC pair: ${symbol}`);
      }
    }
  }

  if (!symbol) {
    if (verbose) console.log(`[VERBOSE] No matching symbol found for ${token} in MEXC`);
    return null;
  }

  if (verbose) console.log(`[VERBOSE] Using symbol: ${symbol} (BTC pair: ${useBTC})`);

  let interval = CONFIG.DEFAULT_INTERVAL;
  let klineUrl = CONFIG.EXCHANGE_BASE_URL + `/klines?symbol=${symbol}&interval=${interval}&startTime=${utcMs - 60000}&endTime=${utcMs}&limit=1`;
  if (verbose) console.log(`[VERBOSE] MEXC klines URL (${interval}): ${klineUrl}`);
  let klineRes = await fetchWithRetry(klineUrl, verbose);
  if (verbose) console.log('[VERBOSE] MEXC klines response (1m): ' + (klineRes ? 'received' : 'null'));

  let data = null;

  if (klineRes) {
    if (verbose) console.log('[VERBOSE] MEXC klines (1m) response ok: ' + klineRes.ok);
    try {
      data = await klineRes.json();
      if (verbose) console.log(`[VERBOSE] MEXC ${interval} klines data: ${JSON.stringify(data)}`);
    } catch (e) {
      if (verbose) console.log(`[VERBOSE] MEXC ${interval} klines JSON parse FAILED: ${e.message}`);
      data = null;
    }
  }

  if (data && data.length > 0) {
    const candleTime = data[0][0];
    if (verbose) console.log(`[VERBOSE] MEXC candle time: ${candleTime} (diff from target: ${Math.abs(candleTime - utcMs)}ms)`);
    if (Math.abs(candleTime - utcMs) > 120000) {
      if (verbose) console.log('[VERBOSE] 1m candle time too far from target - discarding and trying fallback');
      data = null;
    } else {
      if (verbose) console.log('[VERBOSE] 1m candle time acceptable');
    }
  } else {
    if (verbose) console.log('[VERBOSE] No data or empty data from 1m klines - trying fallback');
  }

  if (!data || data.length === 0) {
    interval = CONFIG.FALLBACK_INTERVAL;
    klineUrl = CONFIG.EXCHANGE_BASE_URL + `/klines?symbol=${symbol}&interval=${interval}&startTime=${utcMs - 3600000}&endTime=${utcMs}&limit=1`;
    if (verbose) console.log(`[VERBOSE] MEXC klines fallback URL (${interval}): ${klineUrl}`);
    klineRes = await fetchWithRetry(klineUrl, verbose);
    if (verbose) console.log('[VERBOSE] MEXC klines response (fallback): ' + (klineRes ? 'received' : 'null'));

    if (klineRes) {
      if (verbose) console.log('[VERBOSE] MEXC klines (fallback) response ok: ' + klineRes.ok);
      try {
        data = await klineRes.json();
        if (verbose) console.log(`[VERBOSE] MEXC fallback ${interval} klines data: ${JSON.stringify(data)}`);
      } catch (e) {
        if (verbose) console.log(`[VERBOSE] MEXC fallback ${interval} klines JSON parse FAILED: ${e.message}`);
        data = null;
      }
    }
  }

  if (!data || data.length === 0) {
    if (verbose) console.log('[VERBOSE] No klines data from MEXC after fallback attempt');
    return null;
  }

  const candle = data[0];
  if (verbose) console.log(`[VERBOSE] MEXC final candle data: ${JSON.stringify(candle)}`);

  let price = target === 'low' ? parseFloat(candle[3]) : parseFloat(candle[2]);
  if (isNaN(price)) {
    if (verbose) console.log('[VERBOSE] MEXC price parse FAILED - NaN from candle');
    return null;
  }

  if (verbose) console.log(`[VERBOSE] MEXC raw price: ${price} (from ${target})`);

  if (useBTC) {
    if (verbose) console.log('[VERBOSE] Using BTC pair - fetching BTC/USDT price');
    const btcPrice = await getBTCUSDTPrice(verbose);
    if (btcPrice === null) {
      if (verbose) console.log('[VERBOSE] BTC price fetch FAILED');
      return null;
    }
    price *= btcPrice;
    if (verbose) console.log(`[VERBOSE] BTC adjusted price: ${price} (BTC price was ${btcPrice})`);
  }

  if (verbose) console.log(`[VERBOSE] MEXC final price returning: ${price}`);
  return price;
}

// CoinGecko fetch (accepts verbose)
async function getPriceFromCoinGecko(id, utcMs, target, verbose = false) {
  const dateStr = new Date(utcMs).toISOString().slice(0, 10);
  if (verbose) console.log(`[VERBOSE] CoinGecko calculated date: ${dateStr}`);

  let price = await tryCoinGeckoTickers(id, verbose);
  if (price !== null) {
    if (verbose) console.log(`[VERBOSE] CoinGecko tickers returned price: ${price}`);
    return price;
  }

  price = await tryCoinGeckoHistory(id, dateStr, verbose);
  if (price !== null) {
    if (verbose) console.log(`[VERBOSE] CoinGecko history returned price: ${price}`);
    return price;
  }

  if (verbose) console.log('[VERBOSE] CoinGecko both paths failed');
  return null;
}

async function tryCoinGeckoTickers(id, verbose = false) {
  const tickersUrl = CONFIG.COINGECKO_TICKERS_TEMPLATE
    .replace('{base}', CONFIG.COINGECKO_BASE)
    .replace('{id}', id);
  if (verbose) console.log(`[VERBOSE] CoinGecko tickers URL: ${tickersUrl}`);
  const res = await fetchWithRetry(tickersUrl, verbose);
  if (!res) {
    if (verbose) console.log('[VERBOSE] CoinGecko tickers fetch FAILED');
    return null;
  }

  let data;
  try {
    data = await res.json();
    if (verbose) console.log(`[VERBOSE] CoinGecko tickers data received (keys: ${Object.keys(data).join(', ')})`);
  } catch (e) {
    if (verbose) console.log(`[VERBOSE] CoinGecko tickers JSON parse FAILED: ${e.message}`);
    return null;
  }

  const tickers = data.tickers || [];
  if (verbose) console.log(`[VERBOSE] CoinGecko tickers count: ${tickers.length}`);

  let maxVol = 0;
  let selPrice = null;
  for (const t of tickers) {
    const vol = t.volume || 0;
    const usd = t.converted_last?.usd || null;
    if (verbose) console.log(`[VERBOSE] Ticker: ${t.base}/${t.target || 'unknown'}, vol=${vol}, usd=${usd || 'none'}, stale=${t.is_stale}`);
    if (!t.is_stale && vol > maxVol && usd) {
      maxVol = vol;
      selPrice = usd;
    }
  }
  if (verbose) console.log(`[VERBOSE] CoinGecko tickers selected price: ${selPrice || 'null'} (max vol: ${maxVol})`);
  return selPrice;
}

async function tryCoinGeckoHistory(id, dateStr, verbose = false) {
  const histUrl = CONFIG.COINGECKO_HISTORY_TEMPLATE
    .replace('{base}', CONFIG.COINGECKO_BASE)
    .replace('{id}', id)
    .replace('{date}', dateStr);
  if (verbose) console.log(`[VERBOSE] CoinGecko history URL: ${histUrl}`);
  const res = await fetchWithRetry(histUrl, verbose);
  if (!res) {
    if (verbose) console.log('[VERBOSE] CoinGecko history fetch FAILED');
    return null;
  }

  let data;
  try {
    data = await res.json();
    if (verbose) console.log(`[VERBOSE] CoinGecko history data received (keys: ${Object.keys(data).join(', ')})`);
  } catch (e) {
    if (verbose) console.log(`[VERBOSE] CoinGecko history JSON parse FAILED: ${e.message}`);
    return null;
  }

  const marketData = data.market_data;
  if (!marketData) {
    if (verbose) console.log('[VERBOSE] CoinGecko history missing market_data key');
    return null;
  }

  const currentPrice = marketData.current_price;
  if (!currentPrice) {
    if (verbose) console.log('[VERBOSE] CoinGecko history missing current_price object');
    return null;
  }

  const price = currentPrice.usd;
  if (verbose) console.log(`[VERBOSE] CoinGecko history price: ${price || 'null'} (usd key present: ${currentPrice.hasOwnProperty('usd')})`);
  return price;
}

// CoinPaprika fetch (accepts verbose)
async function getPriceFromCoinPaprika(id, utcMs, highOrLow, verbose = false) {
  const tickersUrl = CONFIG.COINPAPRIKA_TICKERS_TEMPLATE
    .replace('{base}', CONFIG.COINPAPRIKA_BASE)
    .replace('{id}', id);
  if (verbose) console.log(`[VERBOSE] CoinPaprika tickers URL: ${tickersUrl}`);
  const res = await fetchWithRetry(tickersUrl, verbose);
  if (!res) return null;

  let data;
  try {
    data = await res.json();
    if (verbose) console.log(`[VERBOSE] CoinPaprika tickers data received (keys: ${Object.keys(data).join(', ')})`);
  } catch (e) {
    if (verbose) console.log(`[VERBOSE] CoinPaprika tickers JSON parse FAILED: ${e.message}`);
    return null;
  }

  if (!data.quotes || !data.quotes.USD) {
    if (verbose) console.log('[VERBOSE] CoinPaprika quotes missing or no USD');
    return null;
  }

  const start = Math.floor(utcMs / 1000 - 60);
  const end = Math.floor(utcMs / 1000);
  const ohlcvUrl = CONFIG.COINPAPRIKA_OHLCV_TEMPLATE
    .replace('{base}', CONFIG.COINPAPRIKA_BASE)
    .replace('{id}', id)
    .replace('{start}', start)
    .replace('{end}', end);
  if (verbose) console.log(`[VERBOSE] CoinPaprika OHLCV URL: ${ohlcvUrl}`);
  const ohlcvRes = await fetchWithRetry(ohlcvUrl, verbose);
  if (!ohlcvRes) return null;

  let ohlcv;
  try {
    ohlcv = await ohlcvRes.json();
    if (verbose) console.log(`[VERBOSE] CoinPaprika OHLCV data received (length: ${ohlcv.length})`);
  } catch (e) {
    if (verbose) console.log(`[VERBOSE] CoinPaprika OHLCV JSON parse FAILED: ${e.message}`);
    return null;
  }

  if (!ohlcv || ohlcv.length === 0) {
    if (verbose) console.log('[VERBOSE] CoinPaprika OHLCV empty');
    return null;
  }

  const price = highOrLow === 'low' ? parseFloat(ohlcv[0].low) : parseFloat(ohlcv[0].high);
  if (verbose) console.log(`[VERBOSE] CoinPaprika price: ${price}`);
  return price;
}

// BTC price fetch (accepts verbose)
async function getBTCUSDTPrice(verbose = false) {
  const url = CONFIG.COINGECKO_SIMPLE_PRICE_TEMPLATE.replace('{base}', CONFIG.COINGECKO_BASE);
  if (verbose) console.log(`[VERBOSE] BTC price URL: ${url}`);
  const res = await fetchWithRetry(url, verbose);
  if (!res) return null;

  let data;
  try {
    data = await res.json();
    if (verbose) console.log(`[VERBOSE] BTC price data: ${JSON.stringify(data)}`);
  } catch (e) {
    if (verbose) console.log(`[VERBOSE] BTC price JSON parse FAILED: ${e.message}`);
    return null;
  }

  const price = data.bitcoin?.usd;
  if (verbose) console.log(`[VERBOSE] BTC price: ${price || 'null'}`);
  return price;
}

// Fetch with retry (accepts verbose)
async function fetchWithRetry(url, verbose = false) {
  let attempts = 0;
  while (attempts < CONFIG.MAX_RETRIES) {
    attempts++;
    if (verbose) console.log(`[VERBOSE] Fetch attempt ${attempts}/${CONFIG.MAX_RETRIES} for ${url}`);
    try {
      const res = await fetch(url);
      if (verbose) console.log(`[VERBOSE] Fetch response status: ${res.status} for ${url}`);
      if (res.ok) {
        if (verbose) console.log(`[VERBOSE] Fetch succeeded for ${url} (HTTP ${res.status})`);
        return res;
      }
      if (res.status === 429) {
        const backoff = CONFIG.RETRY_BACKOFF_MS[attempts - 1] || 5000;
        if (verbose) console.log(`[VERBOSE] 429 rate limit - backoff ${backoff}ms (attempt ${attempts}/${CONFIG.MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, backoff));
      } else {
        if (verbose) console.log(`[VERBOSE] Fetch failed: HTTP ${res.status} for ${url}`);
        break;
      }
    } catch (e) {
      if (verbose) console.log(`[VERBOSE] Fetch error: ${e.message} for ${url}`);
      break;
    }
  }
  if (verbose) console.log(`[VERBOSE] All retries failed for ${url}`);
  return null;
}

// Single export block - no duplicates
export {
  CONFIG,
  getCryptoPrice,
  getTimezoneOffsetHours,
  parseInputToUtcMs,
  getPriceFromMEXC,
  getPriceFromCoinGecko,
  getPriceFromCoinPaprika,
  getBTCUSDTPrice,
  fetchWithRetry,
  getCache,
  setCache
};
