/**
 * crypto-price-fetchers.gs – a token's current price and fully diluted value
 * (FDV) in USD, from DexTools, or from x1.ninja for X1
 *
 * PURPOSE
 *   Two custom functions for Google Sheets, Google's spreadsheet app,
 *   `dexToolsGetTokenPrice` and `dexToolsGetTokenFDV`. They ask DexTools, a service that prices tokens
 *   from the pools of decentralized exchanges, through its public api v2.
 *   For X1, a chain DexTools does not list, they ask x1.ninja, a service
 *   that does the same for X1 (see X1 ROUTING below). The build step of the
 *   crypto-price-fetchers repo, `npm run build apps-script` (npm is the
 *   package manager of Node, the program that runs JavaScript outside a
 *   browser), puts this file in the one file to paste into a spreadsheet's
 *   project in Apps Script, Google's platform for scripts that run inside
 *   its apps, with the api keys set at that file's end; the repo's README says how to
 *   install it.
 *
 * <!-- HELP START -->
 * ## Current prices: dexToolsGetTokenPrice and dexToolsGetTokenFDV
 *
 * `dexToolsGetTokenPrice(chain, tokenAddress, [pool], [seconds])` gives a
 * token's current price in USD.
 * `dexToolsGetTokenFDV(chain, tokenAddress, [pool], [seconds])` gives its
 * fully diluted value (FDV): its price times its total supply. Both ask
 * DexTools, or x1.ninja for X1. The script keeps each number above 0, a
 * price or an FDV, for up to 5 minutes, as the script is written (the
 * CACHE_SECONDS setting), or up to the seconds the fourth argument gives,
 * a whole number from 1 to 21600, the longest Apps Script's cache keeps a
 * value, so a cell that runs again within that time gives the number it
 * gave before.
 *
 * Each function gives one of these:
 *
 * - a number, in USD;
 * - 0, when the service has no data for the token or pool, or answered
 *   with an error; a 0 keeps the sums of the sheet working, and you can
 *   type a number over it;
 * - `⌛ Rate limit / busy – retry soon`, when other cells kept the script
 *   busy for longer than it waits for them;
 * - `⚠️ API error – check logs`, when the request failed in a way the
 *   script does not handle;
 * - `Cache seconds must be a whole number from 1 to 21600, not …`, when
 *   the fourth argument is another value; the script then asks nothing.
 *
 * ### Chains
 *
 * The first argument names the chain as DexTools names it, in lowercase:
 *
 * - Ethereum: `ether`, not `ethereum`
 * - BNB Smart Chain: `bsc`
 * - Polygon: `polygon`
 * - PulseChain: `pulse`
 * - Solana: `solana`
 * - X1: `x1`, which goes to x1.ninja and needs a pool (example E)
 *
 * DexTools' documentation lists the rest:
 * [developer.dextools.io](https://developer.dextools.io/products/http-api/65a5092590427172cd54ada7/spec).
 *
 * ### The pool argument
 *
 * The third argument names one pool, written as the pool's address and a
 * 0 in double braces: `{{"<pool-address>", 0}}`. Sheets hands a function
 * one value as that value and two or more values as an array, and the script
 * reads the pool from an array, so the 0 is needed. With a pool, the price
 * is that pool's; without one, it is from the pools DexTools picks.
 * DexTools' FDV belongs to the token, so `dexToolsGetTokenFDV` sends
 * DexTools no pool. x1.ninja answers only for a pool, so on X1 both
 * functions need one.
 *
 * ### Examples
 *
 * A. A token's price: USDC on Ethereum, about 1.00.
 *
 * ```
 * =dexToolsGetTokenPrice("ether", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
 * ```
 *
 * B. A token's FDV, on PulseChain.
 *
 * ```
 * =dexToolsGetTokenFDV("pulse", "0xF84b84dAAce6Ac00DbBAed26CA32Ff3570Aaf66C")
 * ```
 *
 * C. HEX's price on Ethereum, in one of its pools.
 *
 * ```
 * =dexToolsGetTokenPrice("ether", "0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39", {{"0x69D91B94f0AaF8e8A2586909fA77A5c2c89818d5", 0}})
 * ```
 *
 * D. WBNB's price on BNB Smart Chain.
 *
 * ```
 * =dexToolsGetTokenPrice("bsc", "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c")
 * ```
 *
 * E. Wrapped XNT's price on X1, in its pool with USDC.X. The pool is
 * needed: x1.ninja's free tier finds no pool from a token, so the pool
 * comes from XDEX, X1's exchange.
 *
 * ```
 * =dexToolsGetTokenPrice("x1", "So11111111111111111111111111111111111111112", {{"CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR", 0}})
 * ```
 *
 * F. A token's FDV on X1, in the same form as E. x1.ninja gives 0 as the
 * FDV of a pool whose base token is Wrapped XNT, X1's own coin.
 *
 * ```
 * =dexToolsGetTokenFDV("x1", "<x1-token-mint>", {{"<x1-pool-address>", 0}})
 * ```
 *
 * ### When a cell shows 0 or a message
 *
 * - 0: check that the chain is named as DexTools names it, and that the
 *   address is the token's, not a wallet's. DexTools has no data for a token
 *   it has not indexed, such as one with little trading, and 0 is then its
 *   answer.
 * - `⌛ Rate limit / busy – retry soon`: choose Clean up errors, or Refresh,
 *   in the Crypto Price Fetchers menu; each runs the cell again.
 * - `#ERROR!`: choose Clean up errors in the Crypto Price Fetchers menu.
 * - To see what the services answered, open Extensions > Apps Script,
 *   choose `testDexToolsVerbose` in the list of functions at the top, and
 *   click Run: the log shows each request and its answer.
 * <!-- HELP END -->
 *
 * API KEYS AND SETTINGS
 *   DEXTOOLS_CONFIG.API_KEY, DexTools' key, and X1_CONFIG.API_KEY,
 *   x1.ninja's, hold placeholders as committed, which the services refuse.
 *   The build step sets both at the end of the file it gives, from the keys
 *   saved in the repo (`npm run api-keys`), with the fields of
 *   DEXTOOLS_CONFIG that the repo's top config.json sets. The build sets
 *   its values after this file's top-level code has run, so a field that
 *   code reads keeps the value written here: SUBSCRIPTION_PLAN, API_HOST
 *   and API_VERSION, which make the urls, MIN_SECONDS_BETWEEN_CALLS, and
 *   X1_CONFIG's API_HOST and API_VERSION. config.json may set only the
 *   other two, CACHE_SECONDS and LOCK_WAIT_MS, as the Node version's
 *   CONFIG_SCHEMAS says, and the build refuses a file that sets more. To
 *   change a field the top-level code reads, change it here and build
 *   again.
 *
 * SUBSCRIPTION PLAN
 *   DexTools' url names the plan of the key:
 *   https://public-api.dextools.io/{plan}/v2/... SUBSCRIPTION_PLAN must
 *   be the key's plan: "free", "trial", "standard", "advanced" or "pro". With
 *   another plan, DexTools answers 401 or 403, 404, or 200 with an empty
 *   data object. The plan shows in DexTools' developer portal,
 *   https://developer.dextools.io/, in the key's product and billing pages
 *   and in the base url of its examples, such as /standard/v2/.
 *
 * X1 ROUTING
 *   DexTools does not list X1 (January 2026), so the two functions send an
 *   X1 request to x1.ninja instead, and a formula on X1 differs from one on
 *   another chain only in the chain's name and the pool. Should DexTools
 *   list X1, the X1 branches of the two functions can go, and no formula
 *   changes.
 *
 *   Both functions ask x1.ninja's free tier for GET /v1/pools/{poolAddress},
 *   whose answer is `{ pool: { address, baseToken, quoteToken, priceUsd,
 *   fdv, marketCap, liquidity, … }, … }`: the price is `pool.priceUsd` and
 *   the FDV `pool.fdv`. The free tier has no way to find a pool from a
 *   token (/v1/search, which has, is on the paid Starter tier), so the
 *   formula names the pool. An x1.ninja key comes from
 *   https://x1.ninja/developers, by signing up with a wallet; the free tier
 *   allows 500,000 requests a month and 60 a minute.
 *
 * RATE LIMITING
 *   Sheets runs the custom function of each cell as a separate call, up to
 *   30 of one person's at the same time. Each call that asks a service takes the script lock
 *   (LockService), waits until MIN_SECONDS_BETWEEN_CALLS have passed since
 *   the last request, whose time the script properties keep, sends its
 *   request, records the time, and gives the lock back. A call that gets
 *   no lock within LOCK_WAIT_MS gives the busy message,
 *   DEXTOOLS_BUSY_MESSAGE, which the menu's Clean up errors looks for in the
 *   cells it runs again. LOCK_WAIT_MS, 120
 *   seconds, is longer than the 30 seconds Google gives a custom function,
 *   so a cell that waits that long shows #ERROR! instead: a known bug, in
 *   the repo's CLAUDE.md. Only a number above 0 is cached, so a failed
 *   request is sent again the next time its cell runs.
 *
 * TESTING
 *   The repo's tests run this file unchanged under Node. In the Apps Script
 *   editor, choose testDexToolsFunctions in the list of functions and click
 *   Run: it asks for 7 prices and FDVs, the last two on X1 through
 *   x1.ninja, and logs PASS for each that gives a number above 0, and a
 *   summary. testDexToolsVerbose runs the same tests and logs each step.
 *   A test that gives 0, with "empty data keys" in the verbose log, asked
 *   for a token or pool DexTools has no data for.
 *
 * NODE
 *   crypto-price-fetchers.js, beside this file in the repo, runs it
 *   unchanged under Node, for Node programs and the command line.
 *
 * PROJECT & LICENSE INFORMATION
 *   Part of https://github.com/nottoseethesun/crypto-price-fetchers, under
 *   the Apache 2.0 License:
 *   https://github.com/nottoseethesun/crypto-price-fetchers/blob/main/LICENSE
 *   Use at your own risk. This script asks outside services for financial
 *   data, and the author gives no warranty, expressed or implied.
 */

/* ─────────────────────────────────────────────────────────────────────────────
   CONFIGURATION – the build step sets the keys (see API KEYS AND SETTINGS)
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} DexToolsConfig
 * @property {string} API_KEY                   DexTools' key; the build step sets it
 * @property {string} SUBSCRIPTION_PLAN         The key's plan: "free"|"trial"|"standard"|"advanced"|"pro"
 * @property {number} MIN_SECONDS_BETWEEN_CALLS Least seconds between two requests to a service
 * @property {string} API_HOST                  DexTools' api host
 * @property {string} API_VERSION               DexTools' api version
 * @property {number} CACHE_SECONDS             How long a number above 0 is kept
 * @property {number} LOCK_WAIT_MS              Longest wait for the script lock, in milliseconds
 */
const DEXTOOLS_CONFIG = {
  API_KEY: "set_by_the_build_step", // DexTools has a free tier
  SUBSCRIPTION_PLAN: "standard", // Must be the key's plan
  MIN_SECONDS_BETWEEN_CALLS: 0.7, // 0.7 for standard and above; 1.5–3 for free; 1.0 or more when x1.ninja's free tier (60 requests a minute) is asked too
  API_HOST: "https://public-api.dextools.io",
  API_VERSION: "v2",
  CACHE_SECONDS: 300, // 5 minutes
  LOCK_WAIT_MS: 120000, // 120 seconds: longer than Google's 30 seconds for a custom function (a known bug)
};

/**
 * @typedef {Object} X1Config
 * @property {string} API_KEY      x1.ninja's key, a bearer token starting with `x1_`; the build step sets it
 * @property {string} API_HOST     x1.ninja's api host
 * @property {string} API_VERSION  x1.ninja's api version
 */
const X1_CONFIG = {
  API_KEY: "set_by_the_build_step", // x1.ninja's free tier: https://x1.ninja/developers
  API_HOST: "https://api.x1.ninja",
  API_VERSION: "v1",
};

/**
 * What a cell shows when the call got no script lock within LOCK_WAIT_MS.
 * The menu's Clean up errors runs again each cell that shows it.
 *
 * @type {string}
 */
const DEXTOOLS_BUSY_MESSAGE = "⌛ Rate limit / busy – retry soon";

/**
 * The longest Apps Script's cache keeps a value, in seconds.
 *
 * @type {number}
 */
const DEXTOOLS_MAX_CACHE_SECONDS = 21600;

/**
 * The seconds a cell keeps its answer: its own fourth argument, a whole
 * number from 1 to DEXTOOLS_MAX_CACHE_SECONDS, or DEXTOOLS_CONFIG's when it
 * gives none, as an empty cell gives "". Any other value gets the message
 * the cell shows instead, before any request is sent.
 *
 * @param {*} cacheSeconds - The cell's fourth argument
 * @return {number|string} The seconds, or the message
 */
function cacheSecondsOf(cacheSeconds) {
  if (
    cacheSeconds === undefined ||
    cacheSeconds === null ||
    cacheSeconds === ""
  )
    return DEXTOOLS_CONFIG.CACHE_SECONDS;
  if (
    Number.isInteger(cacheSeconds) &&
    cacheSeconds >= 1 &&
    cacheSeconds <= DEXTOOLS_MAX_CACHE_SECONDS
  )
    return cacheSeconds;
  const given =
    typeof cacheSeconds === "string"
      ? JSON.stringify(cacheSeconds)
      : cacheSeconds;
  return `Cache seconds must be a whole number from 1 to ${DEXTOOLS_MAX_CACHE_SECONDS}, not ${given}`;
}

/* ─────────────────────────────────────────────────────────────────────────────
   COMPUTED CONSTANTS & SERVICES
   ───────────────────────────────────────────────────────────────────────────── */

const MILLISECONDS_BETWEEN_CALLS =
  DEXTOOLS_CONFIG.MIN_SECONDS_BETWEEN_CALLS * 1000;
const BASE_URL = `${DEXTOOLS_CONFIG.API_HOST}/${DEXTOOLS_CONFIG.SUBSCRIPTION_PLAN}/${DEXTOOLS_CONFIG.API_VERSION}`;
const X1_BASE_URL = `${X1_CONFIG.API_HOST}/${X1_CONFIG.API_VERSION}`;

const props = PropertiesService.getScriptProperties();
const CACHE = CacheService.getScriptCache();

/* ─────────────────────────────────────────────────────────────────────────────
   PUBLIC API FUNCTIONS
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * The pool a cell names in the third argument of a DexTools function,
 * `[[poolAddress, unused]]`: a range of one row, whose first cell holds the
 * pool's address.
 *
 * @param {*} poolAddresses - The argument, or anything else when the cell names no pool
 * @returns {?string} The pool's address, or null when the cell names none
 */
function poolNamed(poolAddresses) {
  const firstRow = Array.isArray(poolAddresses) ? poolAddresses[0] : undefined;
  const pool = Array.isArray(firstRow) ? firstRow[0] : undefined;
  return typeof pool === "string" && pool !== "" ? pool : null;
}

/**
 * An address as DexTools is asked for it: an EVM address, 0x and 40 hex
 * digits, in lower case, since its letters' case only checksums it; any
 * other, such as an X1 address in base58, whose case matters, as given.
 *
 * @param {string} address - The address, as a cell gives it
 * @returns {string} The address to ask for
 */
function dexToolsAddress(address) {
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : address;
}

/**
 * Gets the current price of a token in USD.
 *
 * Routes by `blockchain`:
 *   - `"x1"`  → x1.ninja `/v1/pools/{poolAddress}` — returns the pool's
 *               current `priceUsd`. The pool address must be supplied
 *               via the third argument (`poolAddresses`), as in
 *               example C. The free tier does not include token→pool
 *               resolution.
 *   - other   → DexTools (token endpoint, or pool endpoint when poolAddresses given)
 *
 * Design note: DexTools (as of January 2026) does not list X1 among its
 * supported chains. The X1 branch is intentionally folded into this
 * function so end-user spreadsheet formulas stay uniform across chains
 * — only the chain slug changes. If DexTools later adds X1 natively,
 * the X1 branch here can be deleted in one step with no spreadsheet
 * impact. X1 ROUTING, in this file's header, says why.
 *
 * For X1, the call pattern is as in example C: pass the token mint as
 * `tokenAddress` (for documentation/cache-key clarity) and the pool
 * address as the third argument: `[[poolAddress, 0]]`. The fetcher
 * uses the pool address to query `/v1/pools/{poolAddress}`.
 *
 * @param {string} blockchain - Chain identifier (e.g. "pulse", "ether", "bsc", "x1")
 * @param {string} tokenAddress - Token contract address (or pool address for X1)
 * @param {Array<Array<string>>} [poolAddresses=[]] - Optional [[poolAddress, unused]]
 *                                 Use when you want price from specific pool
 * @param {number} [cacheSeconds=DEXTOOLS_CONFIG.CACHE_SECONDS] - The seconds to keep the answer, a whole number from 1 to 21600; the config's when absent or empty
 * @return {number|string} Price in USD, or 0 (for math) / friendly string on timeout
 */
function dexToolsGetTokenPrice(
  blockchain,
  tokenAddress,
  poolAddresses = [],
  cacheSeconds,
) {
  const seconds = cacheSecondsOf(cacheSeconds);
  if (typeof seconds === "string") return seconds;
  const isX1 = String(blockchain ?? "").toLowerCase() === "x1";
  const pool = poolNamed(poolAddresses);
  const address = dexToolsAddress(pool ?? tokenAddress);
  const isPool = pool !== null;
  const provider = isX1 ? "x1" : "dt";
  const cacheKey = `${provider}_price_${blockchain}_${address}_${isPool ? "pool" : "token"}`;

  const cached = CACHE.get(cacheKey);
  if (cached) return Number(cached);

  const price = withRateLimitProtection(() =>
    isX1
      ? fetchX1NinjaPrice(address)
      : fetchDexToolsPrice(blockchain, address, isPool),
  );

  if (typeof price === "number" && price > 0) {
    CACHE.put(cacheKey, price.toString(), seconds);
  }

  return price;
}

/**
 * Gets the Fully Diluted Value (FDV / fully diluted market cap) in USD.
 *
 * Routes by `blockchain`:
 *   - `"x1"`  → x1.ninja `/v1/pools/{poolAddress}` — returns the
 *               pool's `fdv`. The pool address must be supplied via
 *               the third argument (`poolAddresses`), as in example C.
 *               x1.ninja reports `fdv: 0` for pools whose base token
 *               is the chain-native (Wrapped XNT).
 *   - other   → DexTools `/token/.../info` (FDV is per-token, not per-pool)
 *
 * Design note: DexTools (as of January 2026) does not list X1 among its
 * supported chains. The X1 branch is folded into this function so
 * spreadsheet formulas stay uniform across chains — only the chain
 * slug changes. X1 ROUTING, in this file's header, says why.
 *
 * @param {string} blockchain - Chain identifier (e.g. "pulse", "ether", "x1")
 * @param {string} tokenAddress - Token contract address (or pool address for X1)
 * @param {Array<Array<string>>} [poolAddresses=[]] - Optional [[poolAddress, unused]].
 *                                 Required for X1 (x1.ninja keys on
 *                                 pool address). Ignored by the
 *                                 DexTools path (FDV is per-token).
 * @param {number} [cacheSeconds=DEXTOOLS_CONFIG.CACHE_SECONDS] - The seconds to keep the answer, a whole number from 1 to 21600; the config's when absent or empty
 * @return {number|string} FDV in USD, or 0 (for math) / friendly string on timeout
 */
function dexToolsGetTokenFDV(
  blockchain,
  tokenAddress,
  poolAddresses = [],
  cacheSeconds,
) {
  const seconds = cacheSecondsOf(cacheSeconds);
  if (typeof seconds === "string") return seconds;
  const isX1 = String(blockchain ?? "").toLowerCase() === "x1";
  const pool = poolNamed(poolAddresses);
  const address = dexToolsAddress(pool ?? tokenAddress);
  const isPool = pool !== null;
  const provider = isX1 ? "x1" : "dt";
  const cacheKey = `${provider}_fdv_${blockchain}_${address}_${isPool ? "pool" : "token"}`;

  const cached = CACHE.get(cacheKey);
  if (cached) return Number(cached);

  const fdv = withRateLimitProtection(() => {
    if (isX1) {
      return fetchX1NinjaFDV(address);
    }
    const info = fetchDexToolsTokenInfo(
      blockchain,
      dexToolsAddress(tokenAddress),
    );
    return (
      info?.fdv ??
      info?.fullyDilutedValue ??
      info?.fdvUsd ??
      info?.metrics?.fdv ??
      0
    );
  });

  if (typeof fdv === "number" && fdv > 0) {
    CACHE.put(cacheKey, fdv.toString(), seconds);
  }

  return fdv;
}

/* ─────────────────────────────────────────────────────────────────────────────
   INTERNAL – RATE LIMITING CORE (WITH GRACEFUL TIMEOUT HANDLING)
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Wraps any API-calling function with global rate limit protection.
 * Uses script-wide lock + persistent last-call timestamp.
 * Returns a clear string message on lock timeout so Sheets shows it directly
 * (no need for IFERROR in every cell).
 *
 * @param {Function} callback - The function that makes the actual API request
 * @return {*} Result of callback, or descriptive string on timeout/failure
 */
function withRateLimitProtection(callback) {
  const lock = LockService.getScriptLock();

  const acquired = lock.tryLock(DEXTOOLS_CONFIG.LOCK_WAIT_MS);

  if (!acquired) {
    console.warn(
      "Rate limit lock timeout after " +
        DEXTOOLS_CONFIG.LOCK_WAIT_MS / 1000 +
        "s – another execution is holding it",
    );
    return DEXTOOLS_BUSY_MESSAGE; // Visible in cell
  }

  try {
    const lastStr = props.getProperty("lastDexToolsCall");
    const lastMs = lastStr ? parseInt(lastStr, 10) : 0;
    const nowMs = Date.now();

    const waitedMs = nowMs - lastMs;

    if (waitedMs < MILLISECONDS_BETWEEN_CALLS) {
      const sleepMs = MILLISECONDS_BETWEEN_CALLS - waitedMs;
      console.log(`Enforcing rate limit: sleeping ${sleepMs} ms`);
      Utilities.sleep(sleepMs);
    }

    const result = callback();

    props.setProperty("lastDexToolsCall", Date.now().toString());

    return result;
  } catch (err) {
    console.error("Rate limit protection error:", err);
    return "⚠️ API error – check logs";
  } finally {
    lock.releaseLock();
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   INTERNAL – LOW-LEVEL API CALLS
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Fetches price from DexTools (token or pool endpoint).
 *
 * @param {string} blockchain
 * @param {string} address - token or pool address
 * @param {boolean} isPool
 * @return {number} Price or 0
 */
function fetchDexToolsPrice(blockchain, address, isPool) {
  const segment = isPool ? "pool" : "token";
  const url = `${BASE_URL}/${segment}/${blockchain}/${address}/price`;

  console.log(`[PRICE] Fetching: ${url}`);

  try {
    const response = UrlFetchApp.fetch(url, getOptions());
    const code = response.getResponseCode();
    console.log(`[PRICE] HTTP: ${code}`);

    if (code !== 200) {
      console.error(
        `[PRICE] HTTP Error ${code}: ${response.getContentText().substring(0, 300)}`,
      );
      return 0;
    }

    const json = JSON.parse(response.getContentText());
    console.log(`[PRICE] Data keys: ${Object.keys(json?.data ?? {})}`);

    const price = json?.data?.price ?? json?.data?.priceUsd ?? json?.price ?? 0;
    console.log(`[PRICE] Parsed value: ${price}`);
    return Number(price);
  } catch (err) {
    console.error(`[PRICE] Exception: ${err.message}`);
    return 0;
  }
}

/**
 * Fetches token info object (contains FDV and more).
 *
 * @param {string} blockchain
 * @param {string} tokenAddress
 * @return {Object} Data object or empty {}
 */
function fetchDexToolsTokenInfo(blockchain, tokenAddress) {
  const url = `${BASE_URL}/token/${blockchain}/${tokenAddress}/info`;

  console.log(`[INFO] Fetching: ${url}`);

  try {
    const response = UrlFetchApp.fetch(url, getOptions());
    const code = response.getResponseCode();
    console.log(`[INFO] HTTP: ${code}`);

    if (code !== 200) {
      console.error(
        `[INFO] HTTP Error ${code}: ${response.getContentText().substring(0, 300)}`,
      );
      return {};
    }

    const json = JSON.parse(response.getContentText());
    console.log(`[INFO] Data keys: ${Object.keys(json?.data ?? {})}`);

    return json?.data ?? {};
  } catch (err) {
    console.error(`[INFO] Exception: ${err.message}`);
    return {};
  }
}

/**
 * Returns standardized fetch options for DexTools API.
 *
 * @return {Object} UrlFetchApp options
 */
function getOptions() {
  return {
    method: "GET",
    headers: {
      "X-API-Key": DEXTOOLS_CONFIG.API_KEY,
      Accept: "application/json",
    },
    muteHttpExceptions: true,
  };
}

/**
 * Fetches current USD price for an X1 pool from the x1.ninja API.
 *
 * Endpoint: GET /v1/pools/{poolAddress}   (free tier)
 * Returns the pool's current `priceUsd` field.
 *
 * Pool-spec required: pass the pool address via the public function's
 * third argument (the `poolAddresses` slot, as in example C). x1.ninja
 * does not let free-tier callers resolve token-mint → pool, so the
 * caller must know which pool to query.
 *
 * @param {string} poolAddress - Pool/pair address on X1 (e.g. an XDEX LP)
 * @return {number} Price in USD or 0
 */
function fetchX1NinjaPrice(poolAddress) {
  const url = `${X1_BASE_URL}/pools/${poolAddress}`;
  console.log(`[X1 PRICE] Fetching: ${url}`);

  try {
    const response = UrlFetchApp.fetch(url, getX1Options());
    const code = response.getResponseCode();
    console.log(`[X1 PRICE] HTTP: ${code}`);

    if (code !== 200) {
      console.error(
        `[X1 PRICE] HTTP Error ${code}: ${response.getContentText().substring(0, 300)}`,
      );
      return 0;
    }

    const json = JSON.parse(response.getContentText());
    const priceUsd = Number(json?.pool?.priceUsd);
    const price = Number.isFinite(priceUsd) ? priceUsd : 0;
    console.log(`[X1 PRICE] Pool ${json?.pool?.address}: priceUsd=${price}`);
    return price;
  } catch (err) {
    console.error(`[X1 PRICE] Exception: ${err.message}`);
    return 0;
  }
}

/**
 * Fetches Fully Diluted Value (FDV) in USD for an X1 pool from the
 * x1.ninja API. Same endpoint and auth as fetchX1NinjaPrice — these
 * functions differ only in which field is parsed out (`pool.fdv` vs
 * `pool.priceUsd`).
 *
 * Endpoint: GET /v1/pools/{poolAddress}   (free tier)
 *
 * Caveat: x1.ninja reports `fdv: 0` for pools whose base token is the
 * native/wrapped XNT mint (the concept doesn't map cleanly to a
 * chain-native token). The function returns 0 in that case,
 * consistent with the 0-on-no-data convention used throughout this
 * file.
 *
 * @param {string} poolAddress - Pool/pair address on X1
 * @return {number} FDV in USD or 0
 */
function fetchX1NinjaFDV(poolAddress) {
  const url = `${X1_BASE_URL}/pools/${poolAddress}`;
  console.log(`[X1 FDV] Fetching: ${url}`);

  try {
    const response = UrlFetchApp.fetch(url, getX1Options());
    const code = response.getResponseCode();
    console.log(`[X1 FDV] HTTP: ${code}`);

    if (code !== 200) {
      console.error(
        `[X1 FDV] HTTP Error ${code}: ${response.getContentText().substring(0, 300)}`,
      );
      return 0;
    }

    const json = JSON.parse(response.getContentText());
    const fdvUsd = Number(json?.pool?.fdv);
    const fdv = Number.isFinite(fdvUsd) ? fdvUsd : 0;
    console.log(`[X1 FDV] Pool ${json?.pool?.address}: fdv=${fdv}`);
    return fdv;
  } catch (err) {
    console.error(`[X1 FDV] Exception: ${err.message}`);
    return 0;
  }
}

/**
 * Returns standardized fetch options for the x1.ninja API (Bearer token auth).
 *
 * @return {Object} UrlFetchApp options
 */
function getX1Options() {
  return {
    method: "GET",
    headers: {
      Authorization: `Bearer ${X1_CONFIG.API_KEY}`,
      Accept: "application/json",
    },
    muteHttpExceptions: true,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   TESTING & DEBUGGING – WITH VERBOSE MODE
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Runs each DexTools function on a set of known tokens and pools, and
 * logs what each gives: run it from the script editor to check the
 * script's api key, its calls and its cache.
 *
 * @param {boolean} verbose - When true, logs maximum detail (lock attempts,
 *                            raw JSON responses, full data keys, cache status, etc.)
 *                            Default: false (clean summary only)
 */
function testDexToolsFunctions(verbose = false) {
  console.log("=== DexTools Full Test Started ===");
  console.log(
    `Plan: ${DEXTOOLS_CONFIG.SUBSCRIPTION_PLAN} | Delay: ${DEXTOOLS_CONFIG.MIN_SECONDS_BETWEEN_CALLS}s | Cache: ${DEXTOOLS_CONFIG.CACHE_SECONDS}s | Verbose mode: ${verbose}`,
  );

  const testCases = [
    {
      name: "Pulse token price",
      fn: () =>
        dexToolsGetTokenPrice(
          "pulse",
          "0xF84b84dAAce6Ac00DbBAed26CA32Ff3570Aaf66C",
        ),
    },
    {
      name: "Pulse token FDV",
      fn: () =>
        dexToolsGetTokenFDV(
          "pulse",
          "0xF84b84dAAce6Ac00DbBAed26CA32Ff3570Aaf66C",
        ),
    },
    {
      name: "USDC (Ethereum) price – expected ~1.00 USD (stablecoin)",
      fn: () =>
        dexToolsGetTokenPrice(
          "ether",
          "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        ),
    },
    {
      name: "USDC (Ethereum) FDV – expected very large number (billions)",
      fn: () =>
        dexToolsGetTokenFDV(
          "ether",
          "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        ),
    },
    {
      name: "HEX (Ethereum) price with specific LP (> $1M pool)",
      fn: () =>
        dexToolsGetTokenPrice(
          "ether",
          "0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39",
          [["0x69D91B94f0AaF8e8A2586909fA77A5c2c89818d5", 0]],
        ),
    },
    {
      name: "X1 wXNT (wrapped XNT) price via x1.ninja – wXNT/USDC.X pool",
      fn: () =>
        dexToolsGetTokenPrice(
          "x1",
          "So11111111111111111111111111111111111111112",
          [["CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR", 0]],
        ),
    },
    {
      name: "X1 XENCAT (burn) FDV via x1.ninja – XENCAT/wXNT pool",
      fn: () =>
        dexToolsGetTokenFDV(
          "x1",
          "DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb",
          [["6oTV8xMRP6w592xK79Untuq8vqCttFDHZnw3bN5Suxry", 0]],
        ),
    },
  ];

  let passes = 0;
  let fails = 0;

  testCases.forEach((test, i) => {
    console.log(`\nTest #${i + 1}: ${test.name}`);

    if (verbose) {
      console.log("[VERBOSE] Starting execution of this test case...");
      console.log("[VERBOSE] Current timestamp:", new Date().toISOString());
      console.log("[VERBOSE] Attempting to acquire script lock...");
    }

    const result = test.fn();

    console.log("→ Result:", result);

    const isNumber = typeof result === "number";
    const isPass = isNumber && result > 0;
    console.log("→ Status:", isPass ? "PASS" : "FAIL");

    // Diagnostic when numeric zero is returned
    if (isNumber && result === 0) {
      console.log(
        "→ Possible causes: lock timeout, no data available from DexTools, API error, rate limit",
      );
      console.log(
        "→ Note: 0 is returned intentionally so spreadsheet math still works.",
      );
      console.log("→ You can manually replace 0 with a known value if needed.");
    }

    // Extra verbose information
    if (verbose) {
      console.log("[VERBOSE] Result type:", typeof result);
      if (isNumber) {
        console.log("[VERBOSE] Numeric value:", result);
      }
      const cachePrefix = test.name.toUpperCase().startsWith("X1")
        ? "x1"
        : "dt";
      console.log(
        "[VERBOSE] Cache key likely used:",
        test.name.includes("FDV")
          ? `${cachePrefix}_fdv_${test.name.split(" ")[0].toLowerCase()}_...`
          : `${cachePrefix}_price_${test.name.split(" ")[0].toLowerCase()}_...`,
      );
      console.log("[VERBOSE] Finished this test case");
    }

    if (isPass) passes++;
    else fails++;
  });

  const total = passes + fails;
  const rate = total > 0 ? ((passes / total) * 100).toFixed(2) : "0.00";

  console.log("\n=== TEST SUMMARY ===");
  console.log(`Total tests: ${total}`);
  console.log(`Passed: ${passes} | Failed: ${fails}`);
  console.log(`Pass rate: ${rate}%`);
  console.log("=== Test Finished ===\n");
}

/**
 * Quick convenience function to run the full test in verbose mode
 * (shows maximum logging detail for debugging)
 */
function testDexToolsVerbose() {
  testDexToolsFunctions(true);
}
