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
 *    in terms of column headers and date format (YYYY-MM-DD HH:MM:SS).
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

import tokenMap from './supported-tokens.json' assert { type: 'json' };
import config from './config.json' assert { type: 'json' };

// Alias for compatibility with existing tests/exports
const CONFIG = config;

// Import utilities
import { getTimezoneOffsetHours, parseInputToUtcMs } from './utils/date.js';
import { fetchWithRetry } from './utils/fetch.js';

// Verbosity-aware logger – takes shouldLog explicitly to avoid global scope issues in tests
function logv(shouldLog, level, message, ...args) {
  if (!shouldLog || level < 1) return;
  console.log(`[VERBOSE:${level}] ${message}`, ...args);
}

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

// Exported API functions
async function getCryptoPrice(token, dateStr, tz, highOrLow = 'high', verbose = false) {
  verbose = verbose || process.env.VERBOSE === '1';

  logv(verbose, 1, `getCryptoPrice START: token=${token}, date="${dateStr}", tz=${tz}, mode=${highOrLow}`);

  const offsetHours = getTimezoneOffsetHours(tz);
  logv(verbose, 1, `Offset hours for ${tz}: ${offsetHours}`);

  let safeDateStr = (dateStr ?? '').trim();
  logv(verbose, 2, `Safe date string: "${safeDateStr}"`);

  if (!safeDateStr) {
    logv(verbose, 1, 'Skipping: empty safeDateStr');
    return null;
  }

  const utcMs = parseInputToUtcMs(safeDateStr, offsetHours, verbose);
  logv(verbose, 1, `Parsed UTC ms: ${utcMs} (${new Date(utcMs).toISOString()})`);

  if (utcMs === null || utcMs > Date.now()) {
    logv(verbose, 1, `Skipping: invalid or future date "${safeDateStr}" (utcMs=${utcMs}, now=${Date.now()})`);
    return null;
  }

  const target = highOrLow.toLowerCase() === 'low' ? 'low' : 'high';
  logv(verbose, 1, `Target price type: ${target}`);

  const cacheKey = `price_${token}_${safeDateStr.replace(/[^0-9]/g, '')}_${tz}_${target}`;
  logv(verbose, 2, `Cache key: ${cacheKey}`);

  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    logv(verbose, 1, `Cache HIT! Returning cached price: ${cached}`);
    return cached;
  } else {
    logv(verbose, 1, 'Cache MISS - proceeding to API fetches');
  }

  logv(verbose, 1, 'Trying MEXC first...');
  let price = await getPriceFromMEXC(token, utcMs, target, verbose);
  if (price !== null) {
    logv(verbose, 1, `MEXC SUCCESS - price: ${price}`);
    cache.set(cacheKey, price);
    return price; // EARLY RETURN ON SUCCESS
  } else {
    logv(verbose, 1, 'MEXC FAILED or returned null - trying CoinGecko');
  }

  const idMap = tokenMap[token] || { gecko: token, paprika: token };
  logv(verbose, 1, `Fallback IDs - Gecko: ${idMap.gecko}, Paprika: ${idMap.paprika}`);

  logv(verbose, 1, 'Trying CoinGecko...');
  price = await getPriceFromCoinGecko(idMap.gecko, utcMs, target, verbose);
  if (price !== null) {
    logv(verbose, 1, `CoinGecko SUCCESS - price: ${price}`);
    cache.set(cacheKey, price);
    return price; // EARLY RETURN ON SUCCESS
  } else {
    logv(verbose, 1, 'CoinGecko FAILED or returned null - trying CoinPaprika');
  }

  logv(verbose, 1, 'Trying CoinPaprika...');
  price = await getPriceFromCoinPaprika(idMap.paprika, utcMs, target, verbose);
  if (price !== null) {
    logv(verbose, 1, `CoinPaprika SUCCESS - price: ${price}`);
    cache.set(cacheKey, price);
    return price; // EARLY RETURN ON SUCCESS
  } else {
    logv(verbose, 1, 'CoinPaprika FAILED or returned null - all sources exhausted');
  }

  logv(verbose, 1, 'All sources failed - returning null and caching null');
  cache.set(cacheKey, null);
  return null;
}

// MEXC fetch (accepts verbose) - FIXED VERSION WITH RETRY ON EXCHANGEINFO
async function getPriceFromMEXC(token, utcMs, target, verbose = false) {
  const skipTokens = new Set(['grc']);
  if (skipTokens.has(token)) {
    logv(verbose, 1, `Token ${token} skipped for MEXC`);
    return null;
  }

  const exchangeInfoUrl = config.EXCHANGE_BASE_URL + '/exchangeInfo';
  logv(verbose, 2, `MEXC exchangeInfo URL: ${exchangeInfoUrl}`);

  // Retry exchangeInfo on 429
  let exchangeRes = null;
  let attempts = 0;
  while (attempts < config.MAX_RETRIES) {
    attempts++;
    exchangeRes = await fetchWithRetry(exchangeInfoUrl, verbose);
    if (exchangeRes && exchangeRes.ok) break;
    if (exchangeRes && exchangeRes.status === 429) {
      const backoff = config.RETRY_BACKOFF_MS[attempts - 1] || 5000;
      logv(verbose, 1, `429 on exchangeInfo - backoff ${backoff}ms (attempt ${attempts}/${config.MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, backoff));
    } else {
      logv(verbose, 1, 'exchangeInfo fetch failed non-429 - giving up on MEXC');
      return null;
    }
  }

  if (!exchangeRes || !exchangeRes.ok) {
    logv(verbose, 1, 'All exchangeInfo retries failed');
    return null;
  }

  let exchangeData;
  try {
    exchangeData = await exchangeRes.json();
    logv(verbose, 3, `MEXC exchangeInfo raw data: ${JSON.stringify(exchangeData, null, 2)}`);
  } catch (e) {
    logv(verbose, 1, `MEXC exchangeInfo JSON parse FAILED: ${e.message}`);
    return null;
  }

  const symbols = exchangeData.symbols || [];
  logv(verbose, 2, `MEXC symbols loaded: ${symbols.length} symbols`);

  const upperToken = token.toUpperCase();
  let symbol = null;
  let useBTC = false;

  for (const sym of symbols) {
    const symStr = sym.symbol || 'missing';
    const base = sym.baseAsset || 'missing';
    const quote = sym.quoteAsset || 'missing';
    logv(verbose, 3, `Checking symbol: symbol=${symStr}, base=${base}, quote=${quote}`);
    if (base === upperToken) {
      if (quote === 'USDT') {
        symbol = upperToken + 'USDT';
        logv(verbose, 2, `Found USDT pair: ${symbol}`);
        break;
      } else if (quote === 'BTC') {
        symbol = upperToken + 'BTC';
        useBTC = true;
        logv(verbose, 2, `Found BTC pair: ${symbol}`);
      }
    }
  }

  if (!symbol) {
    logv(verbose, 1, `No matching symbol found for ${token} in MEXC`);
    return null;
  }

  logv(verbose, 1, `Using symbol: ${symbol} (BTC pair: ${useBTC})`);

  let interval = config.DEFAULT_INTERVAL;
  let klineUrl = config.EXCHANGE_BASE_URL + `/klines?symbol=${symbol}&interval=${interval}&startTime=${utcMs - 60000}&endTime=${utcMs}&limit=1`;
  logv(verbose, 2, `MEXC klines URL (${interval}): ${klineUrl}`);
  let klineRes = await fetchWithRetry(klineUrl, verbose);
  logv(verbose, 2, `MEXC klines response (1m): ${klineRes ? 'received' : 'null'}`);

  let data = null;

  if (klineRes) {
    logv(verbose, 2, `MEXC klines (1m) response ok: ${klineRes.ok}`);
    try {
      data = await klineRes.json();
      logv(verbose, 2, `MEXC ${interval} klines data: ${JSON.stringify(data)}`);
    } catch (e) {
      logv(verbose, 1, `MEXC ${interval} klines JSON parse FAILED: ${e.message}`);
      data = null;
    }
  }

  if (data && data.length > 0) {
    const candleTime = data[0][0];
    logv(verbose, 2, `MEXC candle time: ${candleTime} (diff from target: ${Math.abs(candleTime - utcMs)}ms)`);
    if (Math.abs(candleTime - utcMs) > 120000) {
      logv(verbose, 1, '1m candle time too far from target - discarding and trying fallback');
      data = null;
    } else {
      logv(verbose, 2, '1m candle time acceptable');
    }
  } else {
    logv(verbose, 1, 'No data or empty data from 1m klines - trying fallback');
  }

  if (!data || data.length === 0) {
    interval = config.FALLBACK_INTERVAL;
    klineUrl = config.EXCHANGE_BASE_URL + `/klines?symbol=${symbol}&interval=${interval}&startTime=${utcMs - 3600000}&endTime=${utcMs}&limit=1`;
    logv(verbose, 2, `MEXC klines fallback URL (${interval}): ${klineUrl}`);
    klineRes = await fetchWithRetry(klineUrl, verbose);
    logv(verbose, 2, `MEXC klines response (fallback): ${klineRes ? 'received' : 'null'}`);

    if (klineRes) {
      logv(verbose, 2, `MEXC klines (fallback) response ok: ${klineRes.ok}`);
      try {
        data = await klineRes.json();
        logv(verbose, 2, `MEXC fallback ${interval} klines data: ${JSON.stringify(data)}`);
      } catch (e) {
        logv(verbose, 1, `MEXC fallback ${interval} klines JSON parse FAILED: ${e.message}`);
        data = null;
      }
    }
  }

  if (!data || data.length === 0) {
    logv(verbose, 1, 'No klines data from MEXC after fallback attempt');
    return null;
  }

  const candle = data[0];
  logv(verbose, 2, `MEXC final candle data: ${JSON.stringify(candle)}`);

  let price = target === 'low' ? parseFloat(candle[3]) : parseFloat(candle[2]);
  if (isNaN(price)) {
    logv(verbose, 1, 'MEXC price parse FAILED - NaN from candle');
    return null;
  }

  logv(verbose, 2, `MEXC raw price: ${price} (from ${target})`);

  if (useBTC) {
    logv(verbose, 1, 'Using BTC pair - fetching BTC/USDT price');
    const btcPrice = await getBTCUSDTPrice(verbose);
    if (btcPrice === null) {
      logv(verbose, 1, 'BTC price fetch FAILED');
      return null;
    }
    price *= btcPrice;
    logv(verbose, 1, `BTC adjusted price: ${price} (BTC price was ${btcPrice})`);
  }

  logv(verbose, 1, `MEXC final price returning: ${price}`);
  return price;
}

// CoinGecko fetch (accepts verbose)
async function getPriceFromCoinGecko(id, utcMs, target, verbose = false) {
  const dateStr = new Date(utcMs).toISOString().slice(0, 10);
  logv(verbose, 2, `CoinGecko calculated date: ${dateStr}`);

  let price = await tryCoinGeckoTickers(id, verbose);
  if (price !== null) {
    logv(verbose, 1, `CoinGecko tickers returned price: ${price}`);
    return price;
  }

  price = await tryCoinGeckoHistory(id, dateStr, verbose);
  if (price !== null) {
    logv(verbose, 1, `CoinGecko history returned price: ${price}`);
    return price;
  }

  logv(verbose, 1, 'CoinGecko both paths failed');
  return null;
}

async function tryCoinGeckoTickers(id, verbose = false) {
  const tickersUrl = config.COINGECKO_TICKERS_TEMPLATE
    .replace('{base}', config.COINGECKO_BASE)
    .replace('{id}', id);
  logv(verbose, 2, `CoinGecko tickers URL: ${tickersUrl}`);
  const res = await fetchWithRetry(tickersUrl, verbose);
  if (!res) {
    logv(verbose, 1, 'CoinGecko tickers fetch FAILED');
    return null;
  }

  let data;
  try {
    data = await res.json();
    logv(verbose, 2, `CoinGecko tickers data received (keys: ${Object.keys(data).join(', ')})`);
  } catch (e) {
    logv(verbose, 1, `CoinGecko tickers JSON parse FAILED: ${e.message}`);
    return null;
  }

  const tickers = data.tickers || [];
  logv(verbose, 2, `CoinGecko tickers count: ${tickers.length}`);

  let maxVol = 0;
  let selPrice = null;
  for (const t of tickers) {
    const vol = t.volume || 0;
    const usd = t.converted_last?.usd || null;
    logv(verbose, 3, `Ticker: ${t.base}/${t.target || 'unknown'}, vol=${vol}, usd=${usd || 'none'}, stale=${t.is_stale}`);
    if (!t.is_stale && vol > maxVol && usd) {
      maxVol = vol;
      selPrice = usd;
    }
  }
  logv(verbose, 2, `CoinGecko tickers selected price: ${selPrice || 'null'} (max vol: ${maxVol})`);
  return selPrice;
}

async function tryCoinGeckoHistory(id, dateStr, verbose = false) {
  const histUrl = config.COINGECKO_HISTORY_TEMPLATE
    .replace('{base}', config.COINGECKO_BASE)
    .replace('{id}', id)
    .replace('{date}', dateStr);
  logv(verbose, 2, `CoinGecko history URL: ${histUrl}`);
  const res = await fetchWithRetry(histUrl, verbose);
  if (!res) {
    logv(verbose, 1, 'CoinGecko history fetch FAILED');
    return null;
  }

  let data;
  try {
    data = await res.json();
    logv(verbose, 2, `CoinGecko history data received (keys: ${Object.keys(data).join(', ')})`);
  } catch (e) {
    logv(verbose, 1, `CoinGecko history JSON parse FAILED: ${e.message}`);
    return null;
  }

  const marketData = data.market_data;
  if (!marketData) {
    logv(verbose, 1, 'CoinGecko history missing market_data key');
    return null;
  }

  const currentPrice = marketData.current_price;
  if (!currentPrice) {
    logv(verbose, 1, 'CoinGecko history missing current_price object');
    return null;
  }

  const price = currentPrice.usd;
  logv(verbose, 2, `CoinGecko history price: ${price || 'null'} (usd key present: ${currentPrice.hasOwnProperty('usd')})`);
  return price;
}

// CoinPaprika fetch (accepts verbose)
async function getPriceFromCoinPaprika(id, utcMs, highOrLow, verbose = false) {
  const tickersUrl = config.COINPAPRIKA_TICKERS_TEMPLATE
    .replace('{base}', config.COINPAPRIKA_BASE)
    .replace('{id}', id);
  logv(verbose, 2, `CoinPaprika tickers URL: ${tickersUrl}`);
  const res = await fetchWithRetry(tickersUrl, verbose);
  if (!res) return null;

  let data;
  try {
    data = await res.json();
    logv(verbose, 2, `CoinPaprika tickers data received (keys: ${Object.keys(data).join(', ')})`);
  } catch (e) {
    logv(verbose, 1, `CoinPaprika tickers JSON parse FAILED: ${e.message}`);
    return null;
  }

  if (!data.quotes || !data.quotes.USD) {
    logv(verbose, 1, 'CoinPaprika quotes missing or no USD');
    return null;
  }

  const start = Math.floor(utcMs / 1000 - 60);
  const end = Math.floor(utcMs / 1000);
  const ohlcvUrl = config.COINPAPRIKA_OHLCV_TEMPLATE
    .replace('{base}', config.COINPAPRIKA_BASE)
    .replace('{id}', id)
    .replace('{start}', start)
    .replace('{end}', end);
  logv(verbose, 2, `CoinPaprika OHLCV URL: ${ohlcvUrl}`);
  const ohlcvRes = await fetchWithRetry(ohlcvUrl, verbose);
  if (!ohlcvRes) return null;

  let ohlcv;
  try {
    ohlcv = await ohlcvRes.json();
    logv(verbose, 2, `CoinPaprika OHLCV data received (length: ${ohlcv.length})`);
  } catch (e) {
    logv(verbose, 1, `CoinPaprika OHLCV JSON parse FAILED: ${e.message}`);
    return null;
  }

  if (!ohlcv || ohlcv.length === 0) {
    logv(verbose, 1, 'CoinPaprika OHLCV empty');
    return null;
  }

  const price = highOrLow === 'low' ? parseFloat(ohlcv[0].low) : parseFloat(ohlcv[0].high);
  logv(verbose, 1, `CoinPaprika price: ${price}`);
  return price;
}

// BTC price fetch (accepts verbose)
async function getBTCUSDTPrice(verbose = false) {
  const url = config.COINGECKO_SIMPLE_PRICE_TEMPLATE.replace('{base}', config.COINGECKO_BASE);
  logv(verbose, 2, `BTC price URL: ${url}`);
  const res = await fetchWithRetry(url, verbose);
  if (!res) return null;

  let data;
  try {
    data = await res.json();
    logv(verbose, 2, `BTC price data: ${JSON.stringify(data)}`);
  } catch (e) {
    logv(verbose, 1, `BTC price JSON parse FAILED: ${e.message}`);
    return null;
  }

  const price = data.bitcoin?.usd;
  logv(verbose, 1, `BTC price: ${price || 'null'}`);
  return price;
}

// Single export block - no duplicates
export {
  CONFIG,
  getCryptoPrice,
  getPriceFromMEXC,
  getPriceFromCoinGecko,
  getPriceFromCoinPaprika,
  getBTCUSDTPrice,
  fetchWithRetry,
  getCache,
  setCache,
  // Re-export date helpers so existing tests continue to work
  getTimezoneOffsetHours,
  parseInputToUtcMs
};
