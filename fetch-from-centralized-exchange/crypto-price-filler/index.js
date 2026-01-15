import fs from 'fs';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';
import { parse as csvParse } from 'csv-parse/sync';
import { createObjectCsvWriter } from 'csv-writer';
import { DateTime } from 'luxon';

// Exported configuration (complete)
export const CONFIG = {
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

// Global cache (not exported to avoid getter issues)
let cache = new Map();

// Helpers to access/mock cache in tests
export function getCache() {
  return cache;
}

export function setCache(newCache) {
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
  if (verbose) console.log('[VERBOSE] Verbose mode ENABLED');

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
    console.log('[VERBOSE] First 5 rows:');
    rows.slice(0, 5).forEach((row, i) => console.log(`[VERBOSE] Row ${i + 1}: ${JSON.stringify(row)}`));
  }

  let dateColName = headers.find(h => h.includes('date') && h.includes('UTC')) ||
                    headers.find(h => h.toLowerCase().includes('date'));
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
    if (verbose) console.log(`[VERBOSE] Row ${i + 1} date: "${dateStr}"`);

    if (dateStr && !dateStr.includes(',,,,') && !dateStr.includes('Total')) {
      const parsed = DateTime.fromFormat(dateStr, 'yyyy-MM-dd HH:mm:ss');
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
      if (verbose) console.log(`[VERBOSE] Price fetched: ${price}`);
    } catch (e) {
      console.error(`Error fetching price for "${dateStr}": ${e.message}`);
    }

    row[priceColName] = price ?? 'Error';

    if (price !== null && amountStr) {
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        row[usdAmountColName] = (amount * price).toFixed(8);
      }
    }

    outputRows.push(row);
  }

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
export async function getCryptoPrice(token, dateStr, tz, highOrLow = 'high', verbose = false) {
  verbose = verbose || process.env.VERBOSE === '1';

  if (verbose) console.log(`[VERBOSE] getCryptoPrice called: ${dateStr} (tz: ${tz}, mode: ${highOrLow})`);

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
    if (verbose) console.log(`[VERBOSE] Skipping: invalid or future date "${safeDateStr}"`);
    return null;
  }

  const target = highOrLow.toLowerCase() === 'low' ? 'low' : 'high';
  if (verbose) console.log(`[VERBOSE] Target price type: ${target}`);

  const cacheKey = `price_${token}_${safeDateStr.replace(/[^0-9]/g, '')}_${tz}_${target}`;
  if (verbose) console.log(`[VERBOSE] Cache key: ${cacheKey}`);

  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (verbose) console.log(`[VERBOSE] Cache hit! Returning cached price: ${cached}`);
    return cached;
  } else {
    if (verbose) console.log('[VERBOSE] No cache hit - proceeding to API fetches');
  }

  if (verbose) console.log('[VERBOSE] Trying MEXC first...');
  let price = await getPriceFromMEXC(token, utcMs, target, verbose);
  if (price !== null) {
    if (verbose) console.log(`[VERBOSE] MEXC returned price: ${price}`);
    cache.set(cacheKey, price);
    return price;
  } else {
    if (verbose) console.log('[VERBOSE] MEXC failed - trying CoinGecko');
  }

  const idMap = TOKEN_TO_ID[token] || { gecko: token, paprika: token };
  if (verbose) console.log(`[VERBOSE] Fallback IDs - Gecko: ${idMap.gecko}, Paprika: ${idMap.paprika}`);

  if (verbose) console.log('[VERBOSE] Trying CoinGecko...');
  price = await getPriceFromCoinGecko(idMap.gecko, utcMs, target, verbose);
  if (price !== null) {
    if (verbose) console.log(`[VERBOSE] CoinGecko returned price: ${price}`);
    cache.set(cacheKey, price);
    return price;
  } else {
    if (verbose) console.log('[VERBOSE] CoinGecko failed - trying CoinPaprika');
  }

  if (verbose) console.log('[VERBOSE] Trying CoinPaprika...');
  price = await getPriceFromCoinPaprika(idMap.paprika, utcMs, target, verbose);
  if (price !== null) {
    if (verbose) console.log(`[VERBOSE] CoinPaprika returned price: ${price}`);
    cache.set(cacheKey, price);
    return price;
  } else {
    if (verbose) console.log('[VERBOSE] All sources failed - returning null');
  }

  cache.set(cacheKey, null);
  return null;
}

export function getTimezoneOffsetHours(tz) {
  return CONFIG.TIMEZONE_OFFSETS[tz?.toUpperCase()] || 0;
}

export function parseInputToUtcMs(dateStr, offsetHours, verbose = false) {
  verbose = verbose || process.env.VERBOSE === '1';

  if (verbose) console.log(`[VERBOSE] parseInputToUtcMs called with "${dateStr}", offset: ${offsetHours}`);

  const zone = `UTC${offsetHours >= 0 ? '+' : ''}${offsetHours}`;
  const dt = DateTime.fromFormat(dateStr, 'yyyy-MM-dd HH:mm:ss', { zone });

  if (!dt.isValid) {
    if (verbose) console.log('[VERBOSE] Luxon parsing failed, falling back to new Date()');
    const fallback = new Date(dateStr);
    if (isNaN(fallback.getTime())) {
      if (verbose) console.log('[VERBOSE] Fallback also failed - returning null');
      return null;
    }
    const utcMs = fallback.getTime() + (offsetHours * 3600000);
    if (verbose) console.log(`[VERBOSE] Fallback succeeded, UTC ms: ${utcMs} (${new Date(utcMs).toISOString()})`);
    return utcMs;
  }

  const utcMs = dt.toUTC().toMillis();
  if (verbose) console.log(`[VERBOSE] Luxon parsed successfully, UTC ms: ${utcMs} (${dt.toUTC().toISO()})`);
  return utcMs;
}

// MEXC fetch (accepts verbose)
async function getPriceFromMEXC(token, utcMs, target, verbose = false) {
  const skipTokens = new Set(['grc']);
  if (skipTokens.has(token)) {
    if (verbose) console.log('[VERBOSE] Token skipped for MEXC: ' + token);
    return null;
  }

  const exchangeInfoUrl = CONFIG.EXCHANGE_BASE_URL + '/exchangeInfo';
  if (verbose) console.log(`[VERBOSE] MEXC exchangeInfo URL: ${exchangeInfoUrl}`);
  const exchangeRes = await fetchWithRetry(exchangeInfoUrl, verbose);
  if (!exchangeRes) {
    if (verbose) console.log('[VERBOSE] MEXC exchangeInfo fetch failed');
    return null;
  }

  const exchangeData = await exchangeRes.json();
  if (verbose) console.log(`[VERBOSE] MEXC exchangeInfo raw data: ${JSON.stringify(exchangeData, null, 2)}`);

  const symbols = exchangeData.symbols || [];
  if (verbose) console.log(`[VERBOSE] MEXC symbols loaded: ${symbols.length} symbols`);

  const upperToken = token.toUpperCase();
  let symbol = null;
  let useBTC = false;

  for (const sym of symbols) {
    if (verbose) console.log(`[VERBOSE] Checking symbol: ${sym.symbol || 'no symbol'} (base: ${sym.baseAsset}, quote: ${sym.quoteAsset})`);
    if (sym.baseAsset === upperToken) {
      if (sym.quoteAsset === 'USDT') {
        symbol = upperToken + 'USDT';
        if (verbose) console.log(`[VERBOSE] Found USDT pair: ${symbol}`);
        break;
      } else if (sym.quoteAsset === 'BTC') {
        symbol = upperToken + 'BTC';
        useBTC = true;
        if (verbose) console.log(`[VERBOSE] Found BTC pair: ${symbol}`);
      }
    }
  }

  if (!symbol) {
    if (verbose) console.log(`[VERBOSE] No symbol found for ${token} in MEXC`);
    return null;
  }

  if (verbose) console.log(`[VERBOSE] Using symbol: ${symbol} (BTC: ${useBTC})`);

  let interval = CONFIG.DEFAULT_INTERVAL;
  let klineUrl = CONFIG.EXCHANGE_BASE_URL + `/klines?symbol=${symbol}&interval=${interval}&startTime=${utcMs - 60000}&endTime=${utcMs}&limit=1`;
  if (verbose) console.log(`[VERBOSE] MEXC klines URL (1m): ${klineUrl}`);
  let klineRes = await fetchWithRetry(klineUrl, verbose);
  let data = klineRes ? await klineRes.json() : null;

  if (data && data.length > 0) {
    const candleTime = data[0][0];
    if (verbose) console.log(`[VERBOSE] MEXC candle time: ${candleTime} (diff from target: ${Math.abs(candleTime - utcMs)}ms)`);
    if (Math.abs(candleTime - utcMs) > 120000) {
      if (verbose) console.log('[VERBOSE] 1m candle time too far - discarding');
      data = null;
    }
  }

  if (!data || data.length === 0) {
    interval = CONFIG.FALLBACK_INTERVAL;
    klineUrl = CONFIG.EXCHANGE_BASE_URL + `/klines?symbol=${symbol}&interval=${interval}&startTime=${utcMs - 3600000}&endTime=${utcMs}&limit=1`;
    if (verbose) console.log(`[VERBOSE] MEXC klines URL (fallback 60m): ${klineUrl}`);
    klineRes = await fetchWithRetry(klineUrl, verbose);
    data = klineRes ? await klineRes.json() : null;
  }

  if (!data || data.length === 0) {
    if (verbose) console.log('[VERBOSE] No klines data from MEXC after fallback');
    return null;
  }

  let price = target === 'low' ? parseFloat(data[0][3]) : parseFloat(data[0][2]);
  if (verbose) console.log(`[VERBOSE] MEXC raw price: ${price} (from ${target})`);

  if (useBTC) {
    const btcPrice = await getBTCUSDTPrice(verbose);
    if (btcPrice === null) return null;
    price *= btcPrice;
    if (verbose) console.log(`[VERBOSE] BTC adjusted price: ${price}`);
  }

  return price;
}

// CoinGecko fetch (accepts verbose)
async function getPriceFromCoinGecko(id, utcMs, target, verbose = false) {
  const dateStr = new Date(utcMs).toISOString().slice(0, 10);

  if (verbose) console.log(`[VERBOSE] CoinGecko date string: ${dateStr}`);

  let price = await tryCoinGeckoTickers(id, verbose);
  if (price !== null) return price;

  price = await tryCoinGeckoHistory(id, dateStr, verbose);
  if (price !== null) return price;

  return null;
}

async function tryCoinGeckoTickers(id, verbose = false) {
  const tickersUrl = CONFIG.COINGECKO_TICKERS_TEMPLATE
    .replace('{base}', CONFIG.COINGECKO_BASE)
    .replace('{id}', id);
  if (verbose) console.log(`[VERBOSE] CoinGecko tickers URL: ${tickersUrl}`);
  const res = await fetchWithRetry(tickersUrl, verbose);
  if (!res) {
    if (verbose) console.log('[VERBOSE] CoinGecko tickers fetch failed');
    return null;
  }

  const data = await res.json();
  if (verbose) console.log(`[VERBOSE] CoinGecko tickers data: ${JSON.stringify(data, null, 2)}`);

  const tickers = data.tickers || [];
  let maxVol = 0;
  let selPrice = null;
  for (const t of tickers) {
    if (verbose) console.log(`[VERBOSE] Checking ticker: ${t.base}/${t.target} vol=${t.volume} usd=${t.converted_last?.usd || 'no usd'}`);
    if (!t.is_stale && t.volume > maxVol && t.converted_last?.usd) {
      maxVol = t.volume;
      selPrice = t.converted_last.usd;
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
    if (verbose) console.log('[VERBOSE] CoinGecko history fetch failed');
    return null;
  }

  const data = await res.json();
  if (verbose) console.log(`[VERBOSE] CoinGecko history raw data: ${JSON.stringify(data, null, 2)}`);

  const price = data.market_data?.current_price?.usd;
  if (verbose) console.log(`[VERBOSE] CoinGecko history price: ${price || 'null'} (market_data present: ${!!data.market_data})`);
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
  const data = await res.json();

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
  const ohlcv = await ohlcvRes.json();

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
  const data = await res.json();
  const price = data.bitcoin?.usd;
  if (verbose) console.log(`[VERBOSE] BTC price: ${price || 'null'}`);
  return price;
}

// Fetch with retry (accepts verbose)
async function fetchWithRetry(url, verbose = false) {
  let attempts = 0;
  while (attempts < CONFIG.MAX_RETRIES) {
    attempts++;
    if (verbose) console.log(`[VERBOSE] Fetch attempt ${attempts} for ${url}`);
    try {
      const res = await fetch(url);
      if (verbose) console.log(`[VERBOSE] Fetch response status: ${res.status} for ${url}`);
      if (res.ok) {
        if (verbose) console.log(`[VERBOSE] Fetch succeeded for ${url} (HTTP ${res.status})`);
        return res;
      }
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
