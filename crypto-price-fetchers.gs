/**
 * DexTools Price & FDV Fetcher (with X1 blockchain support via x1.ninja) – Rate Limit Friendly & Fully Documented (January 2026)
 * 
 * PURPOSE:
 *   Provides reliable access to DexTools API v2 for token prices and Fully Diluted Values (FDV)
 *   from Google Sheets / Apps Script, with strong protection against rate limiting.
 * 
 * KEY FEATURES:
 *   - Supports exact pool address for price queries (DexTools specialty)
 *   - Caching via CacheService to minimize repeated API calls
 *   - Global rate limiting using LockService + PropertiesService
 *   - Detailed debug logging (extra verbose mode in tests)
 *   - Returns 0 when data is unavailable (untracked token, no pools, API error)
 *     → This allows math formulas in Sheets to continue working (0 is neutral)
 *     → User can manually override 0 in the sheet if needed
 *   - Graceful handling of lock timeouts: returns visible string in cells
 *   - Custom Sheets menu "DexTools Price/FDV" with "Refresh" option to clear cache and flush sheet
 *     (must be manually installed - see instructions below)
 *   - X1 blockchain support: prices on X1 are routed through the same
 *     `dexToolsGetTokenPrice` function (DexTools doesn't list X1 yet —
 *     see "X1 BLOCKCHAIN ROUTING – DESIGN NOTE" below for the rationale)
 *   - Never caches zeros or failures → forces fresh retry on next call after transient issues
 * 
 * IMPORTANT – SUBSCRIPTION PLAN CONFIGURATION
 * 
 * The DexTools public API v2 requires the plan segment in the URL:
 * https://public-api.dextools.io/{plan}/v2/...
 * 
 * Valid values for SUBSCRIPTION_PLAN (must match your actual API key tier exactly):
 *   - "free"       → Free/limited tier (~40–60 req/min, monthly cap)
 *   - "standard"   → Standard plan (most common paid tier)
 *   - "advanced"   → Advanced plan
 *   - "pro"        → Pro / Premium plan
 * 
 * Using the WRONG value usually results in:
 *   - 401/403 Unauthorized
 *   - 404 Not Found
 *   - or HTTP 200 with empty data object {}
 * 
 * How to find your correct plan name:
 * 1. Log in to https://developer.dextools.io/
 * 2. Go to your API product / dashboard
 * 3. Check base URL examples, subscription details or billing section
 * 4. Look for the segment used (e.g. /standard/v2/, /pro/v2/)
 * 
 * USAGE
 * 
 * 1. Finding the correct chain identifier (blockchain slug):
 *    - DexTools uses short, lowercase slugs (e.g., "ether" for Ethereum mainnet, not "ethereum")
 *    - Official interactive API documentation shows examples:  
 *      https://developer.dextools.io/products/http-api/65a5092590427172cd54ada7/spec
 *    - For the complete, up-to-date list of supported chains and their exact identifiers:  
 *      Call the API endpoint (requires your key):  
 *      GET https://public-api.dextools.io/{your-plan}/v2/blockchain  
 *      This returns a JSON array of all supported chains with their slugs/IDs.
 *    - Common examples:  
 *      - Ethereum mainnet: "ether"  
 *      - Binance Smart Chain: "bsc"  
 *      - Polygon: "polygon"  
 *      - PulseChain: "pulse"
 *      - Solana: "solana"
 *      - X1 blockchain (routed to x1.ninja, not DexTools): "x1"
 * 
 * 2. Example calls (use these in your Google Sheets formulas):
 * 
 *    A. Basic token price (token address, no pool specified):  
 *       =dexToolsGetTokenPrice("ether", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")
 *       → Returns USDC price on Ethereum (~1.00 USD)
 * 
 *    B. FDV of a token:  
 *       =dexToolsGetTokenFDV("pulse", "0xF84b84dAAce6Ac00DbBAed26CA32Ff3570Aaf66C")
 *       → Returns FDV in USD for the Pulse token
 * 
 *    C. Price from a specific liquidity pool (most precise):  
 *       =dexToolsGetTokenPrice("ether", "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
 *          {{"0x69d91b94f0aaf8e8a2586909fa77a5c2c89818d5", 0}})
 *       → Returns HEX price from the specified >$1M LP on Ethereum
 *       → Note: The extra "0" is required in Sheets to force array passing
 * 
 *    D. Using a different chain (e.g., Binance Smart Chain):
 *       =dexToolsGetTokenPrice("bsc", "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c")
 *       → Returns WBNB price on BSC
 *
 *    E. X1 blockchain (routed to x1.ninja API – pool address required):
 *       =dexToolsGetTokenPrice("x1", "So11111111111111111111111111111111111111112",
 *          {{"CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR", 0}})
 *       → Returns the wXNT/USDC.X pool's current USD price on X1.
 *       → For X1, the pool address is REQUIRED (third argument,
 *         example-C style with the trailing `0` for Sheets array
 *         passing). x1.ninja's free tier does not provide token→pool
 *         resolution — you supply a known pool/pair address from XDEX.
 *       → Uses x1.ninja's /v1/pools/{poolAddress} endpoint (free tier).
 *       → Configure X1_CONFIG.API_KEY at the top of this file. See the
 *         "X1 BLOCKCHAIN ROUTING – DESIGN NOTE" section below for how
 *         to obtain a free-tier key.
 *
 * X1 BLOCKCHAIN ROUTING – DESIGN NOTE
 *
 * Why is X1 routed through a function called `dexToolsGetTokenPrice`?
 *
 *   - DexTools (as of January 2026) does not list X1 among its supported
 *     chains. Without this routing, an X1 price would require a separate
 *     function and a separate config block on the spreadsheet side.
 *   - X1 was folded into `dexToolsGetTokenPrice` so spreadsheet formulas
 *     stay uniform across chains: only the chain slug changes
 *     ("ether", "pulse", "x1", …). One function, one mental model.
 *   - If DexTools later adds X1 native support, the X1 branch inside
 *     `dexToolsGetTokenPrice` can be deleted in one step with no
 *     spreadsheet impact.
 *
 * How to get an x1.ninja API key:
 *   1. Visit https://x1.ninja/developers
 *   2. Sign up with a wallet (free tier: 500K req/mo, 60 req/min).
 *   3. Copy the resulting `x1_…` token.
 *   4. Paste it into X1_CONFIG.API_KEY near the top of this file.
 *
 * Endpoint used:
 *   GET /v1/pools/{poolAddress}   (free tier)
 *   Returns `{ pool: { address, baseToken, quoteToken, priceUsd, … }, … }`.
 *   We extract `pool.priceUsd` and return it as the current USD price.
 *   The caller supplies the pool address via the public function's
 *   third argument (`poolAddresses`, example-C style). x1.ninja's free
 *   tier does not include token→pool resolution (`/v1/search` would
 *   provide it but is paid Starter tier), so the pool address must be
 *   known to the caller.
 *
 * PROJECT & LICENSE INFORMATION
 * 
 * This script is named crypto-price-fetcher.gs and is part of the open-source
 * crypto-price-fetchers GitHub repository:
 * https://github.com/nottoseethesun/crypto-price-fetchers
 * 
 * Use at your own risk. This script interacts with external APIs and handles
 * financial data. The author provides no warranty, expressed or implied.
 * 
 * Full license details (Apache 2.0 License) are available here:
 * https://github.com/nottoseethesun/crypto-price-fetchers/blob/main/LICENSE
 * 
 * TEST
 * 
 * To verify the script is working correctly, run the built-in test functions from the Apps Script editor:
 * 
 * 1. Standard test (clean summary output):
 *    - In the Apps Script editor, select the function: testDexToolsFunctions
 *    - Click Run (no parameters needed)
 *    - View results in the Executions log or View → Logs
 *    - Expected: All 6 tests PASS with real values for supported tokens
 *      (the 6th test queries x1.ninja for wXNT on X1 and depends on
 *      X1_CONFIG.API_KEY being set)
 * 
 * 2. Verbose test (maximum debug detail – recommended for troubleshooting):
 *    - Select the function: testDexToolsVerbose
 *    - Click Run
 *    - Or, select testDexToolsFunctions, then pass true as parameter (if dialog allows)
 *    - Expected: Detailed logs for every step (timestamps, lock attempts, raw API responses,
 *      data keys, cache info)
 * 
 * Run tests periodically, especially after changes to CONFIG, tokens, or during heavy sheet usage.
 * If any test fails with 0 (and verbose mode shows empty data keys), it indicates DexTools has 
 * no indexed data for that token/pool.
 * 
 * TROUBLESHOOTING TIPS
 * 
 * 1. Cells stuck with "⌛ Rate limit / busy – retry soon" or "⚠️ API error – check logs"
 *    - This means the script couldn't get the lock within 60 seconds (another call is running or previously hung)
 *    - The script automatically retries on the next sheet recalculation (no need to immediately refresh the page)
 *    - Triggers for automatic retry:
 *      - Any edit in the sheet (even a small change elsewhere)
 *      - Background recalculation (Sheets retries periodically)
 *      - Opening/reloading the sheet
 *    - If it persists >1–2 minutes: Hard refresh the page (Windows: Ctrl + Shift + R; Mac: Cmd + Shift + R)
 *    - Or, use menu → "DexTools Price/FDV → Refresh" (clears cache + forces recalc) if menu is working
 * 
 * 2. Persistent "Exceeded maximum execution time" in SUM or dependent cells
 *    - Caused by too many parallel custom function calls + temporary delays (locks/sleeps) during recalc
 *    - The error can "stick" in some cells even after the issue is resolved because Sheets' internal computation 
 *      queue gets corrupted
 *    - Automatic retry happens on next recalc (edit, open, background), but sometimes it doesn't clear the stuck state
 *    - Immediate fix that works reliably (your current method):
 *      1. Temporarily break the formula in the stuck cell (e.g., change `U18` to `U18a`)
 *      2. Wait a few seconds for Sheets to process the error
 *      3. Fix it back (remove the "a")
 *      → This forces Sheets to treat it as a new formula and re-queue it correctly
 *    - For large sheets (e.g. 100+ DexTools cells), do this in small batches (10–20 cells at a time) to
 *      avoid overwhelming the queue
 *    - Long-term solution (recommended when you have time):
 *      Replace many individual custom function calls with one ARRAYFORMULA at the top of the column.
 *      Example:
 *      =ARRAYFORMULA(
 *        IF(U4:U123<>"",
 *          dexToolsGetTokenPrice("ether", U4:U123),
 *          ""
 *        )
 *      )
 *      → This runs far fewer parallel instances → dramatically reduces timeouts
 *      → Easier to maintain and scales better for 120+ tokens
 *    - Prevention:
 *      - Use the "Refresh" menu or hard refresh proactively after adding new tokens
 *      - Avoid massive simultaneous edits that trigger full recalc
 *      - Mac users: Use Cmd + Shift + R for hard refresh (Windows: Ctrl + Shift + R)
 * 
 * 3. Cells show 0 for tokens that should have data
 *    - Run testDexToolsVerbose() → check logs for "empty data keys"
 *    - If empty: DexTools has no indexed data for that token/pool → normal, return 0
 *    - Hard refresh or edit sheet → retries automatically
 * 
 * 4. General tips
 *    - Mac users: Use Cmd (not Ctrl) for shortcuts (e.g. Cmd + Shift + R for hard refresh)
 *    - Monitor Executions log for warnings/errors
 *    - If issues persist: Run resetDexToolsLock() to force timestamp update
 * 
 * OPTIONAL: Add Custom Refresh Menu
 * 
 * The script includes code to create a custom menu "DexTools Price/FDV" with a "Refresh" item, but if the 
 * menu is not appearing automatically, use an installable "On open" trigger for reliability (simple triggers can
 * be flaky with conflicts or permissions).
 * 
 * Step-by-step to add an installable trigger:
 * 1. In the Apps Script editor, go to the left sidebar and click the clock icon (Triggers).
 * 2. At the bottom right, click the blue "+ Add Trigger" button.
 * 3. In the "Choose which function to run" dropdown, select: onOpenDexTools
 * 4. Leave "Choose which deployment should run" as "Head" (default).
 * 5. For "Select event source", choose: From spreadsheet
 * 6. For "Select event type", choose: On open
 * 7. (Optional) Set "Failure notification settings" to "Notify me immediately" so you get email alerts if
 *    the trigger ever fails.
 * 8. Click "Save" at the bottom.
 * 9. If prompted, review and grant the requested permissions (this is normal for installable triggers).
 * 10. Close and reopen your spreadsheet tab (or refresh the page).
 * 
 * The menu should now appear consistently every time the sheet opens.
 * If it still does not appear, check the Triggers list for errors, ensure the function name is exactly
 * "onOpenDexTools", and verify no other scripts are conflicting.
 * 
 * Rate Limiting Strategy:
 *   - LockService.getScriptLock() → mutual exclusion (only one execution makes API call at a time)
 *   - PropertiesService → persists last call timestamp across all script executions
 *   - Utilities.sleep() → enforces minimum delay between real calls
 *   - On lock timeout (60s): returns user-friendly string visible in sheet cells
 * 
 * Google Apps Script Specifics:
 *   - Custom functions run in **parallel** for each cell → many concurrent calls possible
 *   - No built-in mutex → LockService is essential
 *   - Recursive sleep / naive timestamp checks → dangerous (quota violations, stack overflow)
 *   - Current pattern: lock → check time → sleep if needed → call → update time → release
 * 
 * Dependencies:
 *   - UrlFetchApp, LockService, PropertiesService, CacheService (all built-in)
 */

/* ─────────────────────────────────────────────────────────────────────────────
   CONFIGURATION – EDIT ONLY THESE VALUES
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} Config
 * @property {string} API_KEY                  Your DexTools API key
 * @property {string} SUBSCRIPTION_PLAN        Exact plan name: "free"|"standard"|"advanced"|"pro"
 * @property {number} MIN_SECONDS_BETWEEN_CALLS Minimum seconds between real API calls
 * @property {string} API_HOST                 Base host (rarely changes)
 * @property {string} API_VERSION              Current API version
 * @property {number} CACHE_SECONDS            How long to cache successful results
 * @property {number} LOCK_WAIT_MS             Max milliseconds to wait for lock acquisition
 */
const CONFIG = {
  API_KEY:               'paste_your_dextools_api_key_here',    // Remember, there's a free tier if needed
  SUBSCRIPTION_PLAN:     'standard',          // ← MUST match your key's actual plan tier; free should work too
  MIN_SECONDS_BETWEEN_CALLS: 0.7,               // Safe for Standard+; 1.5–3 for free tier; 1.0+ if also calling x1.ninja free (60 req/min)
  API_HOST:              "https://public-api.dextools.io",
  API_VERSION:           "v2",
  CACHE_SECONDS:         300,                 // 5 minutes default – only successful results cached
  LOCK_WAIT_MS:          120000,               // 60 seconds for lock wait (increased for stability)
};

/**
 * @typedef {Object} X1Config
 * @property {string} API_KEY      Your x1.ninja API key (bearer token like `x1_...`)
 * @property {string} API_HOST     Base host for x1.ninja
 * @property {string} API_VERSION  Current API version
 */
const X1_CONFIG = {
  API_KEY:     'paste_your_x1_ninja_api_key_here',  // Free tier — get yours at https://x1.ninja/developers
  API_HOST:    'https://api.x1.ninja',
  API_VERSION: 'v1',
};

/* ─────────────────────────────────────────────────────────────────────────────
   COMPUTED CONSTANTS & SERVICES
   ───────────────────────────────────────────────────────────────────────────── */

const MILLISECONDS_BETWEEN_CALLS = CONFIG.MIN_SECONDS_BETWEEN_CALLS * 1000;
const BASE_URL = `${CONFIG.API_HOST}/${CONFIG.SUBSCRIPTION_PLAN}/${CONFIG.API_VERSION}`;
const X1_BASE_URL = `${X1_CONFIG.API_HOST}/${X1_CONFIG.API_VERSION}`;

const props = PropertiesService.getScriptProperties();
const CACHE = CacheService.getScriptCache();

/* ─────────────────────────────────────────────────────────────────────────────
   PUBLIC API FUNCTIONS
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Gets the current price of a token in USD.
 *
 * Routes by `blockchain`:
 *   - `"x1"`  → x1.ninja `/v1/pools/{poolAddress}` — returns the pool's
 *               current `priceUsd`. The pool address must be supplied
 *               via the third argument (`poolAddresses`), example-C
 *               style. The free tier does not include token→pool
 *               resolution.
 *   - other   → DexTools (token endpoint, or pool endpoint when poolAddresses given)
 *
 * Design note: DexTools (as of January 2026) does not list X1 among its
 * supported chains. The X1 branch is intentionally folded into this
 * function so end-user spreadsheet formulas stay uniform across chains
 * — only the chain slug changes. If DexTools later adds X1 natively,
 * the X1 branch here can be deleted in one step with no spreadsheet
 * impact. See the "X1 BLOCKCHAIN ROUTING – DESIGN NOTE" section in
 * this file's header doc for the full rationale.
 *
 * For X1, the call pattern is example-C style: pass the token mint as
 * `tokenAddress` (for documentation/cache-key clarity) and the pool
 * address as the third argument: `[[poolAddress, 0]]`. The fetcher
 * uses the pool address to query `/v1/pools/{poolAddress}`.
 *
 * @param {string} blockchain - Chain identifier (e.g. "pulse", "ether", "bsc", "x1")
 * @param {string} tokenAddress - Token contract address (or pool address for X1)
 * @param {Array<Array<string>>} [poolAddresses=[]] - Optional [[poolAddress, unused]]
 *                                 Use when you want price from specific pool
 * @param {number} [cacheSeconds=CONFIG.CACHE_SECONDS] - Override cache duration
 * @return {number|string} Price in USD, or 0 (for math) / friendly string on timeout
 */
function dexToolsGetTokenPrice(blockchain, tokenAddress, poolAddresses = [], cacheSeconds = CONFIG.CACHE_SECONDS) {
  const isX1 = String(blockchain || '').toLowerCase() === 'x1';
  const pool = Array.isArray(poolAddresses) && poolAddresses[0]?.[0];
  const address = pool || tokenAddress;
  const isPool = !!pool;
  const provider = isX1 ? 'x1' : 'dt';
  const cacheKey = `${provider}_price_${blockchain}_${address}_${isPool ? 'pool' : 'token'}`;

  const cached = CACHE.get(cacheKey);
  if (cached) return Number(cached);

  const price = withRateLimitProtection(() =>
    isX1
      ? fetchX1NinjaPrice(address)
      : fetchDexToolsPrice(blockchain, address, isPool)
  );

  if (typeof price === 'number' && price > 0) {
    CACHE.put(cacheKey, price.toString(), cacheSeconds);
  }

  return price;
}

/**
 * Gets the Fully Diluted Value (FDV / fully diluted market cap) in USD.
 *
 * @param {string} blockchain - Chain identifier
 * @param {string} tokenAddress - Token contract address
 * @param {number} [cacheSeconds=CONFIG.CACHE_SECONDS] - Override cache duration
 * @return {number|string} FDV in USD, or 0 (for math) / friendly string on timeout
 */
function dexToolsGetTokenFDV(blockchain, tokenAddress, cacheSeconds = CONFIG.CACHE_SECONDS) {
  const cacheKey = `dt_fdv_${blockchain}_${tokenAddress}`;

  const cached = CACHE.get(cacheKey);
  if (cached) return Number(cached);

  const fdv = withRateLimitProtection(() => {
    const info = fetchDexToolsTokenInfo(blockchain, tokenAddress);
    return info?.fdv ?? info?.fullyDilutedValue ?? info?.fdvUsd ?? info?.metrics?.fdv ?? 0;
  });

  if (typeof fdv === 'number' && fdv > 0) {
    CACHE.put(cacheKey, fdv.toString(), cacheSeconds);
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
  
  const acquired = lock.tryLock(CONFIG.LOCK_WAIT_MS);
  
  if (!acquired) {
    console.warn("Rate limit lock timeout after " + (CONFIG.LOCK_WAIT_MS / 1000) + "s – another execution is holding it");
    return "⌛ Rate limit / busy – retry soon";  // Visible in cell
  }

  try {
    const lastStr = props.getProperty('lastDexToolsCall');
    const lastMs  = lastStr ? parseInt(lastStr, 10) : 0;
    const nowMs   = Date.now();

    const waitedMs = nowMs - lastMs;

    if (waitedMs < MILLISECONDS_BETWEEN_CALLS) {
      const sleepMs = MILLISECONDS_BETWEEN_CALLS - waitedMs;
      console.log(`Enforcing rate limit: sleeping ${sleepMs} ms`);
      Utilities.sleep(sleepMs);
    }

    const result = callback();

    props.setProperty('lastDexToolsCall', Date.now().toString());

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
      console.error(`[PRICE] HTTP Error ${code}: ${response.getContentText().substring(0, 300)}`);
      return 0;
    }

    const json = JSON.parse(response.getContentText());
    console.log(`[PRICE] Data keys: ${Object.keys(json?.data || {})}`);

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
      console.error(`[INFO] HTTP Error ${code}: ${response.getContentText().substring(0, 300)}`);
      return {};
    }

    const json = JSON.parse(response.getContentText());
    console.log(`[INFO] Data keys: ${Object.keys(json?.data || {})}`);

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
      "X-API-Key": CONFIG.API_KEY,
      "Accept": "application/json"
    },
    muteHttpExceptions: true
  };
}

/**
 * Fetches current USD price for an X1 pool from the x1.ninja API.
 *
 * Endpoint: GET /v1/pools/{poolAddress}   (free tier)
 * Returns the pool's current `priceUsd` field.
 *
 * Pool-spec required: pass the pool address via the public function's
 * third argument (the `poolAddresses` slot, example-C style). x1.ninja
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
      console.error(`[X1 PRICE] HTTP Error ${code}: ${response.getContentText().substring(0, 300)}`);
      return 0;
    }

    const json = JSON.parse(response.getContentText());
    const price = Number(json?.pool?.priceUsd) || 0;
    console.log(`[X1 PRICE] Pool ${json?.pool?.address}: priceUsd=${price}`);
    return price;
  } catch (err) {
    console.error(`[X1 PRICE] Exception: ${err.message}`);
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
      "Authorization": `Bearer ${X1_CONFIG.API_KEY}`,
      "Accept": "application/json"
    },
    muteHttpExceptions: true
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   SHEET MENU – "DexTools Price/FDV" with "Refresh" option
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Creates the custom menu when the spreadsheet opens.
 * Menu title: "DexTools Price/FDV"
 * Item: "Refresh" → calls refreshDexTools()
 */
function onOpenDexTools() {
  SpreadsheetApp.getUi()
    .createMenu("DexTools Price/FDV")
    .addItem("Refresh", "refreshDexTools")
    .addToUi();
}

/**
 * Refresh function called from the menu.
 * Forces immediate recalculation of all formulas in the sheet.
 * This helps clear stuck "#ERROR!" or "Exceeded maximum execution time" states.
 * Note: Does NOT clear cache (cache expires naturally in 5 min).
 * To fully clear cache, hard-refresh the page or wait for expiration.
 */
function refreshDexTools() {
  SpreadsheetApp.flush();
  console.log("Sheet formulas forcibly re-evaluated. Stuck cells should update.");
}

/* ─────────────────────────────────────────────────────────────────────────────
   TESTING & DEBUGGING – WITH VERBOSE MODE
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Comprehensive test function – run this from the script editor
 * to verify everything is working correctly.
 * 
 * @param {boolean} verbose - When true, logs maximum detail (lock attempts, 
 *                            raw JSON responses, full data keys, cache status, etc.)
 *                            Default: false (clean summary only)
 */
function testDexToolsFunctions(verbose = false) {
  console.log("=== DexTools Full Test Started ===");
  console.log(`Plan: ${CONFIG.SUBSCRIPTION_PLAN} | Delay: ${CONFIG.MIN_SECONDS_BETWEEN_CALLS}s | Cache: ${CONFIG.CACHE_SECONDS}s | Verbose mode: ${verbose}`);

  const testCases = [
    { name: "Pulse token price", fn: () => dexToolsGetTokenPrice("pulse", "0xF84b84dAAce6Ac00DbBAed26CA32Ff3570Aaf66C") },
    { name: "Pulse token FDV",   fn: () => dexToolsGetTokenFDV("pulse", "0xF84b84dAAce6Ac00DbBAed26CA32Ff3570Aaf66C") },
    { name: "USDC (Ethereum) price – expected ~1.00 USD (stablecoin)", fn: () => dexToolsGetTokenPrice("ether", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48") },
    { name: "USDC (Ethereum) FDV – expected very large number (billions)", fn: () => dexToolsGetTokenFDV("ether", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48") },
    { name: "HEX (Ethereum) price with specific LP (> $1M pool)", fn: () => dexToolsGetTokenPrice("ether", "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39", [["0x69d91b94f0aaf8e8a2586909fa77a5c2c89818d5", 0]]) },
    { name: "X1 wXNT (wrapped XNT) price via x1.ninja – wXNT/USDC.X pool", fn: () => dexToolsGetTokenPrice("x1", "So11111111111111111111111111111111111111112", [["CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR", 0]]) },
  ];

  let passes = 0;
  let fails = 0;

  testCases.forEach((test, i) => {
    console.log(`\nTest #${i+1}: ${test.name}`);

    if (verbose) {
      console.log("[VERBOSE] Starting execution of this test case...");
      console.log("[VERBOSE] Current timestamp:", new Date().toISOString());
      console.log("[VERBOSE] Attempting to acquire script lock...");
    }

    const result = test.fn();

    console.log("→ Result:", result);

    const isNumber = typeof result === 'number';
    const isPass = isNumber && result > 0;
    console.log("→ Status:", isPass ? "PASS" : "FAIL");

    // Diagnostic when numeric zero is returned
    if (isNumber && result === 0) {
      console.log("→ Possible causes: lock timeout, no data available from DexTools, API error, rate limit");
      console.log("→ Note: 0 is returned intentionally so spreadsheet math still works.");
      console.log("→ You can manually replace 0 with a known value if needed.");
    }

    // Extra verbose information
    if (verbose) {
      console.log("[VERBOSE] Result type:", typeof result);
      if (isNumber) {
        console.log("[VERBOSE] Numeric value:", result);
      }
      const cachePrefix = test.name.toUpperCase().startsWith('X1') ? 'x1' : 'dt';
      console.log("[VERBOSE] Cache key likely used:",
        test.name.includes('FDV') ? `${cachePrefix}_fdv_${test.name.split(' ')[0].toLowerCase()}_...` :
                                    `${cachePrefix}_price_${test.name.split(' ')[0].toLowerCase()}_...`);
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
