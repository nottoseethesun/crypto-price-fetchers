/**
 * Preload that lets a test run the Node tool's real command line, `index.js`,
 * in a child process without asking any price service.
 * @module tests/helpers/stand-in-fetch-preload
 *
 * A test starts `node --import <this file> index.js ...`. This file replaces
 * the global fetch with a stand-in MEXC that lists the XTMUSDT pair and
 * answers every candle request with one candle at the requested end time:
 * open 1.00, high 1.50, low 0.80, close 1.10. CoinGecko's ping, which checks
 * a saved api key, takes the key of `stand-in-coingecko-key.js` alone, sent
 * in its header, and refuses any other. Each url the tool asks for is recorded,
 * and written as json, when the process exits, to the file named by the
 * environment variable `STAND_IN_ASKED`, so the test can read what the tool
 * asked for.
 */

import fs from 'fs';
import { STAND_IN_GECKO_KEY } from './stand-in-coingecko-key.js';

const asked = [];

/**
 * A response as Node's fetch gives it.
 *
 * @param {number} status - The status
 * @param {*} body - The json body
 * @returns {{ok: boolean, status: number, json: function(): Promise<*>}} The response
 */
function respond(status, body) {
  return { ok: status === 200, status, json: async () => body };
}

/*-
 *  TEST-ONLY global swap: index.js and the sources it loads reach the
 *  network only through the global fetch, and offer no seam for it. This
 *  file runs only in a child process a test starts for one run of the
 *  command line, so the swap is never seen outside that process, and it
 *  ends with the process.
 */
globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  asked.push(href);
  if (href.endsWith('/ping')) {
    const key = init.headers?.['x-cg-demo-api-key'];
    return key === STAND_IN_GECKO_KEY ? respond(200, { gecko_says: '(V3) To the Moon!' }) : respond(401, {});
  }
  if (href.includes('/exchangeInfo')) {
    return respond(200, { symbols: [{ symbol: 'XTMUSDT', baseAsset: 'XTM', quoteAsset: 'USDT' }] });
  }
  const end = Number(new URL(href).searchParams.get('endTime'));
  return respond(200, [[end - 30000, '1.00', '1.50', '0.80', '1.10', '10']]);
};

process.on('exit', () => {
  const askedPath = process.env.STAND_IN_ASKED;
  if (askedPath !== undefined && askedPath !== '') {
    fs.writeFileSync(askedPath, JSON.stringify(asked));
  }
});
