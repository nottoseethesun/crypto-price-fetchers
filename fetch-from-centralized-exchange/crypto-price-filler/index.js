import fs from 'fs';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';
import { parse as csvParse } from 'csv-parse/sync';
import { createObjectCsvWriter } from 'csv-writer';
import { parse as dateParse, isValid } from 'date-fns';

// Config (must be defined before any function that uses it)
const CONFIG = {
  EXCHANGE_BASE_URL: 'https://api.mexc.com/api/v3',
  QUOTE_CURRENCY: 'USDT',
  DEFAULT_INTERVAL: '1m',
  FALLBACK_INTERVAL: '60m',
  TIMEZONE_OFFSETS: {
    'UTC': 0, 'GMT': 0,
    'EST': -5, 'EDT': -4,
    'CST': -6, 'CDT': -5,
    'MST': -7, 'MDT': -6,
    'PST': -8, 'PDT': -7
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
  'btc': { gecko: 'bitcoin', paprika: 'btc-bitcoin' },
  'xmr': { gecko: 'monero', paprika: 'xmr-monero' },
  'grc': { gecko: 'gridcoin-research', paprika: 'grc-gridcoin' },
  'xtm': { gecko: 'tari', paprika: 'xtm-tari' }
};

// Guard: only run CLI logic when this file is executed directly (not imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  // Parse command-line args
  const args = process.argv.slice(2).reduce((acc, arg) => {
    const [key, value] = arg.split('=');
    acc[key.replace('--', '')] = value || true;
    return acc;
  }, {});

  const token = args.token;
  const inputFile = args.input;
  const outputFile = args.output || 'output.csv';
  const mode = args.mode || 'high';
  const tz = args.tz || 'UTC';
  const verbose = args.verbose === true || args.verbose === 'true';

  if (inputFile && inputFile.startsWith('~')) {
    inputFile = path.join(os.homedir(), inputFile.slice(1));
  }

  if (outputFile && outputFile.startsWith('~')) {
    outputFile = path.join(os.homedir(), outputFile.slice(1));
  }

  if (!token || !inputFile) {
    console.error('Missing required args. Usage:');
    console.error('  node index.js --token=xtm --input=~/Downloads/file.csv [--output=output.csv] [--mode=high] [--tz=CDT] [--verbose]');
    process.exit(1);
  }

  console.log(`Starting price filler for token: ${token}, mode: ${mode}, tz: ${tz}`);
  console.log(`Input: ${inputFile}, Output: ${outputFile}`);
  console.log(`Verbose mode: ${verbose ? 'ENABLED' : 'disabled'}`);

  // Main execution
  const csvContent = fs.readFileSync(inputFile, 'utf8');
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
    console.log('First 5 rows raw data (for debug):');
    rows.slice(0, 5).forEach((row, idx) => {
      console.log(`Row ${idx + 1} raw: ${JSON.stringify(row)}`);
    });
  }

  let dateColName = headers.find(h => h.includes('date') && h.includes('UTC'));
  if (!dateColName) dateColName = headers.find(h => h.toLowerCase().includes('date'));
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
    if (verbose) console.log(`Row ${i + 1} raw date: "${dateStr}"`);

    if (dateStr && dateStr.length > 0 && !dateStr.includes(',,,,') && !dateStr.includes('Total')) {
      const parsedDate = dateParse(dateStr, 'yyyy-MM-dd HH:mm:ss', new Date());
      if (isValid(parsedDate)) {
        lastValidDateIndex = i;
        console.log(`Last valid date row found at index ${i + 1} (date: ${dateStr})`);
        break;
      }
    }
  }

  if (lastValidDateIndex === -1) {
    console.warn('No valid date rows found');
  }

  const outputRows = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const dateStr = (row[dateColName] || '').trim();

    if (i > lastValidDateIndex) {
      console.log(`Row ${i + 1}: After last valid date - skipping price fetch`);
      row[priceColName] = '';
      row[usdAmountColName] = '';
      outputRows.push(row);
      continue;
    }

    if (!dateStr || dateStr === '' || dateStr.includes(',,,,') || dateStr.includes('Total')) {
      console.warn(`Row ${i + 1}: Invalid or missing date "${dateStr}" - skipping price fetch`);
      row[priceColName] = '';
      row[usdAmountColName] = '';
      outputRows.push(row);
      continue;
    }

    const amountStr = amountColName ? (row[amountColName] || '').trim() : '';
    let price = null;
    let usdAmount = '';

    if (verbose) console.log(`Row ${i + 1}: Attempting price fetch for date "${dateStr}"`);

    try {
      price = await getCryptoPrice(token, dateStr, tz, mode);
      if (verbose) console.log(`Row ${i + 1}: Fetched price for "${dateStr}": ${price}`);
    } catch (e) {
      console.error(`Row ${i + 1}: Error fetching price for date "${dateStr}": ${e.message}`);
    }

    row[priceColName] = price !== null ? price.toString() : 'Error';

    if (price !== null && amountStr) {
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        usdAmount = (amount * price).toFixed(8);
      }
    }

    row[usdAmountColName] = usdAmount;

    outputRows.push(row);
  }

  const csvWriter = createObjectCsvWriter({
    path: outputFile,
    header: headers.map(h => ({ id: h, title: h })),
    fieldDelimiter: ',',
    quote: '"',
    escape: '"'
  });

  csvWriter.writeRecords(outputRows)
    .then(() => console.log(`Output CSV written to ${outputFile}`))
    .catch(e => console.error(`Error writing output CSV: ${e.message}`));
}

// Crypto price fetching logic
export async function getCryptoPrice(token, dateStr, tz, highOrLow = 'high') {
  const offsetHours = getTimezoneOffsetHours(tz);

  let safeDateStr = '';
  if (dateStr != null) {
    safeDateStr = String(dateStr).trim();
  }

  if (!safeDateStr) {
    return null;
  }

  const utcMs = parseInputToUtcMs(safeDateStr, offsetHours);

  if (utcMs === null || utcMs > Date.now()) {
    return null;
  }

  const target = highOrLow.toLowerCase() === 'low' ? 'low' : 'high';

  const cleanedDate = safeDateStr.replace(/[^0-9-]/g, '');
  const cacheKey = `price_${token}_${cleanedDate}_${tz}_${target}`;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  let price = await getPriceFromMEXC(token, utcMs, target);
  if (price !== null) {
    cache.set(cacheKey, price);
    return price;
  }

  const idMap = TOKEN_TO_ID[token] || { gecko: token, paprika: token };

  price = await getPriceFromCoinGecko(idMap.gecko, utcMs, target);
  if (price !== null) {
    cache.set(cacheKey, price);
    return price;
  }

  price = await getPriceFromCoinPaprika(idMap.paprika, utcMs, target);
  if (price !== null) {
    cache.set(cacheKey, price);
    return price;
  }

  cache.set(cacheKey, null);
  return null;
}

// Helper functions
export function getTimezoneOffsetHours(tz) {
  return CONFIG.TIMEZONE_OFFSETS[tz.toUpperCase()] || 0;
}

export function parseInputToUtcMs(dateStr, offsetHours) {
  // Parse the local date/time string (as if it is in the given timezone)
  const parsed = dateParse(dateStr, 'yyyy-MM-dd HH:mm:ss', new Date());
  if (isValid(parsed)) {
    // Convert local time to UTC: localMs - (offset * ms_per_hour)
    // Negative offset (west of UTC) means local is behind → subtract negative = add hours
    const utcMs = parsed.getTime() - (offsetHours * 3600000);
    return utcMs;
  }

  // Fallback for other formats
  const fallback = new Date(dateStr);
  if (isNaN(fallback.getTime())) return null;

  const utcMs = fallback.getTime() - (offsetHours * 3600000);
  return utcMs;
}

// MEXC fetch
async function getPriceFromMEXC(token, utcMs, target) {
  const skipTokens = new Set(['grc']);
  if (skipTokens.has(token)) return null;

  const exchangeInfoUrl = CONFIG.EXCHANGE_BASE_URL + '/exchangeInfo';
  const exchangeRes = await fetchWithRetry(exchangeInfoUrl);
  if (!exchangeRes) return null;

  const symbols = (await exchangeRes.json()).symbols || [];
  const upperToken = token.toUpperCase();
  let symbol = null;
  let useBTC = false;

  for (const sym of symbols) {
    if (sym.baseAsset === upperToken) {
      if (sym.quoteAsset === 'USDT') {
        symbol = upperToken + 'USDT';
        break;
      } else if (sym.quoteAsset === 'BTC') {
        symbol = upperToken + 'BTC';
        useBTC = true;
      }
    }
  }

  if (!symbol) return null;

  let interval = CONFIG.DEFAULT_INTERVAL;
  let klineUrl = CONFIG.EXCHANGE_BASE_URL + `/klines?symbol=${symbol}&interval=${interval}&startTime=${utcMs - 60000}&endTime=${utcMs}&limit=1`;
  let klineRes = await fetchWithRetry(klineUrl);
  let data = klineRes ? await klineRes.json() : null;

  if (data && data.length > 0) {
    const candleTime = data[0][0];
    if (Math.abs(candleTime - utcMs) > 120000) data = null;
  }

  if (!data || data.length === 0) {
    interval = CONFIG.FALLBACK_INTERVAL;
    klineUrl = CONFIG.EXCHANGE_BASE_URL + `/klines?symbol=${symbol}&interval=${interval}&startTime=${utcMs - 3600000}&endTime=${utcMs}&limit=1`;
    klineRes = await fetchWithRetry(klineUrl);
    data = klineRes ? await klineRes.json() : null;
  }

  if (!data || data.length === 0) return null;

  let price = target === 'low' ? parseFloat(data[0][3]) : parseFloat(data[0][2]);
  if (useBTC) {
    const btcPrice = await getBTCUSDTPrice();
    if (btcPrice === null) return null;
    price *= btcPrice;
  }

  return price;
}

// CoinGecko fetch
async function getPriceFromCoinGecko(id, utcMs, target) {
  const dateStr = new Date(utcMs).toISOString().slice(0, 10);

  let price = await tryCoinGeckoTickers(id);
  if (price !== null) return price;

  price = await tryCoinGeckoHistory(id, dateStr);
  if (price !== null) return price;

  return null;
}

async function tryCoinGeckoTickers(id) {
  const tickersUrl = CONFIG.COINGECKO_TICKERS_TEMPLATE
    .replace('{base}', CONFIG.COINGECKO_BASE)
    .replace('{id}', id);
  const res = await fetchWithRetry(tickersUrl);
  if (!res) return null;

  const data = await res.json();
  const tickers = data.tickers || [];
  let maxVol = 0;
  let selPrice = null;
  for (const t of tickers) {
    if (!t.is_stale && t.volume > maxVol && t.converted_last?.usd) {
      maxVol = t.volume;
      selPrice = t.converted_last.usd;
    }
  }
  return selPrice;
}

async function tryCoinGeckoHistory(id, dateStr) {
  const histUrl = CONFIG.COINGECKO_HISTORY_TEMPLATE
    .replace('{base}', CONFIG.COINGECKO_BASE)
    .replace('{id}', id)
    .replace('{date}', dateStr);
  const res = await fetchWithRetry(histUrl);
  if (!res) return null;

  const data = await res.json();
  return data.market_data?.current_price?.usd;
}

// CoinPaprika fetch
async function getPriceFromCoinPaprika(id, utcMs, highOrLow) {
  const tickersUrl = CONFIG.COINPAPRIKA_TICKERS_TEMPLATE
    .replace('{base}', CONFIG.COINPAPRIKA_BASE)
    .replace('{id}', id);
  const res = await fetchWithRetry(tickersUrl);
  if (!res) return null;
  const data = await res.json();

  if (!data.quotes || !data.quotes.USD) return null;

  const start = Math.floor(utcMs / 1000 - 60);
  const end = Math.floor(utcMs / 1000);
  const ohlcvUrl = CONFIG.COINPAPRIKA_OHLCV_TEMPLATE
    .replace('{base}', CONFIG.COINPAPRIKA_BASE)
    .replace('{id}', id)
    .replace('{start}', start)
    .replace('{end}', end);
  const ohlcvRes = await fetchWithRetry(ohlcvUrl);
  if (!ohlcvRes) return null;
  const ohlcv = await ohlcvRes.json();

  if (!ohlcv || ohlcv.length === 0) return null;

  return highOrLow === 'low' ? parseFloat(ohlcv[0].low) : parseFloat(ohlcv[0].high);
}

// BTC price fetch
async function getBTCUSDTPrice() {
  const url = CONFIG.COINGECKO_SIMPLE_PRICE_TEMPLATE.replace('{base}', CONFIG.COINGECKO_BASE);
  const res = await fetchWithRetry(url);
  if (!res) return null;
  const data = await res.json();
  return data.bitcoin?.usd;
}

// Fetch with retry
async function fetchWithRetry(url) {
  let attempts = 0;
  while (attempts < CONFIG.MAX_RETRIES) {
    attempts++;
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (res.status === 429) {
        const backoff = CONFIG.RETRY_BACKOFF_MS[attempts - 1] || 5000;
        console.log(`429 rate limit - backoff ${backoff}ms (attempt ${attempts}/${CONFIG.MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, backoff));
      } else {
        console.log(`Fetch failed: HTTP ${res.status} for ${url}`);
        break;
      }
    } catch (e) {
      console.log(`Fetch error: ${e.message} for ${url}`);
      break;
    }
  }
  return null;
}

// Exports for testing (single block - no duplicates)
export {
  getCryptoPrice,
  getTimezoneOffsetHours,
  getPriceFromMEXC,
  getPriceFromCoinGecko,
  getPriceFromCoinPaprika,
  getBTCUSDTPrice,
  fetchWithRetry
};
