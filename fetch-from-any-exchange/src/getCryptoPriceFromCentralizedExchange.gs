/**
 * Google Apps Script: Get Crypto Price from Centralized Exchange
 * ==============================================================
 *
 * @fileoverview Fetches historical cryptocurrency prices (USD) from
 *   centralized exchanges, the average of a period's high and low or its
 *   high, low or close, for use directly in Google Sheets, Google's
 *   spreadsheet app.
 * @author Christopher M. Balz, with Grok and Claude
 * @version 2.19.0
 * @lastModified November 25, 2026
 *
 * OVERVIEW
 * --------
 * A custom function for Google Sheets, written in Apps Script, Google's
 * platform for scripts that run inside its apps. It
 * returns a cryptocurrency's historical USD price at a given time, the
 * average of the high and the low of a period around it, or the high, the
 * low or the close, asking one source after another until
 * one has a price: MEXC, a centralized exchange, then CoinGecko and
 * CoinPaprika, two services that gather the exchanges' prices.
 * crypto-price-filler, the repo's tool for whole CSV files, which runs on
 * Node, the program that runs JavaScript outside a browser, asks these
 * same price sources through the repo's runner, so a fix here fixes both.
 *
 * INSTALLATION
 * ------------
 * The script is in three files, to keep each under the 500 lines of code
 * that LP Ranger's rules allow (LP Ranger, the owner's bot that manages his
 * 9mm V3 liquidity positions, sets the coding standards the repo follows): this one, getCryptoPriceFromCentralizedExchange-sources.gs, the
 * price sources, MEXC, CoinGecko and CoinPaprika, and
 * getCryptoPriceFromCentralizedExchange-tests.gs, the tests run from the
 * Apps Script editor. Apps Script runs every script file of a project in
 * one global scope, so the three work as one. The build step of the
 * crypto-price-fetchers repo, `npm run build apps-script` (npm, Node's
 * package manager, runs the repo's commands), joins them with
 * the repo's other Sheets scripts into the one file to paste into a
 * spreadsheet; the repo's README, under Install, says how.
 *
 * API KEYS
 * --------
 * This file, as committed, holds no api key: CONFIG.COINGECKO_API_KEY and
 * CONFIG.COINPAPRIKA_API_KEY are empty, and the script asks each service
 * without a key. The build step sets them at the end of the file it gives,
 * from the keys saved in the repo (`npm run api-keys`). Each key is
 * optional:
 *
 *   COINGECKO_API_KEY   - A CoinGecko demo api key, sent to CoinGecko in
 *                         the x-cg-demo-api-key header. Without it,
 *                         CoinGecko answers at a lower rate.
 *   COINPAPRIKA_API_KEY - A key for one of CoinPaprika's paid plans, sent
 *                         to CoinPaprika's paid server as the whole
 *                         Authorization header. Without it, the script
 *                         asks CoinPaprika's free server, for close alone:
 *                         it keeps no candle of a day already over.
 *
 * A key goes only in a header, never in a url, so no url the log quotes
 * holds it.
 *
 * <!-- HELP START -->
 * ## Past prices: getCryptoPrice
 *
 * `getCryptoPrice(token, dateStr, tz, mode)` gives a coin's price in USD at
 * a past time, from a short period around that time: the average of its
 * highest and lowest price, or the highest, the lowest or the closing
 * price, from centralized exchanges.
 *
 * - `token`: the coin's ticker symbol, in any case, such as `"btc"`,
 *   `"grc"`, `"xmr"` or `"xtm"`.
 * - `dateStr`: the time, written `"YYYY-MM-DD HH:MM:SS"` (24-hour), or a
 *   cell that holds a date and time, read as the time it shows.
 * - `tz`: the time zone of that time, by its abbreviation (see Time
 *   zones); left empty, UTC.
 * - `mode`: `"average"`, `"high"`, `"low"` or `"close"`; any other value,
 *   or none, means `"average"`.
 *
 * ```
 * =getCryptoPrice("btc", "2026-01-15 14:30:00", "CST", "high")
 * =getCryptoPrice("grc", A1, "CST")
 * =getCryptoPrice("xmr", A1, "UTC", "low")
 * =getCryptoPrice("xtm", A1, "UTC", "close")
 * ```
 *
 * As the script is written (the CACHE_EXPIRY_SECONDS setting), a price for
 * a time is kept for up to 6 hours, the longest Apps Script's cache keeps
 * a value, and "no data" for up to 5 minutes, so a cell that runs again
 * within that time gives the answer it gave before; Refresh & freeze,
 * below, says when a cell's price stops changing.
 *
 * ### Average, high, low and close
 *
 * Each source prices a period around the time, once the period is over:
 * a period not over holds only the prices so far, which can still
 * change. `"high"` gives the highest price recorded in that period and
 * `"low"` the lowest, which bound what a trade at that time was worth,
 * and `"average"` the average of the two. For a coin MEXC prices through
 * its pair against BTC, high multiplies the pair's high by BTC's in the
 * same period, and low the two lows, so the two can lie beyond any price
 * the coin traded at in USD. `"close"` gives the price at the end of the
 * period, the close of MEXC's minute or hour or of CoinPaprika's day, but
 * from CoinGecko its hourly price nearest the time. The period depends on
 * the source that answers:
 *
 * - MEXC, an exchange, asked first: the minute that holds the time, when
 *   the time falls in about the last 30 days, for which MEXC keeps minute
 *   candles; for an older time, the hour that holds it. When nothing
 *   traded in that minute or hour, the script goes up one period at a
 *   time, through the hour, 2 hours, 4 hours, day, week (from Monday),
 *   month and year, in UTC, that hold the time, and the first in which
 *   something traded gives the average of its high and low, whatever the
 *   mode. When MEXC gives no candle of that minute or hour, or the request
 *   for it fails, the script asks for the day before, since the larger
 *   periods may hold only trades from after the time when it comes before
 *   the coin's first trade, and a candle of the day before shows the coin
 *   traded before that day: with one, the script goes on, from the minute
 *   to the hour, or from the hour up; with none, as on the day MEXC listed
 *   the coin or before, or when that request fails too, the next source
 *   answers. When nothing traded in the year, the next source answers. A
 *   request MEXC fails for a larger period is never taken for a period
 *   with no candle: the script goes on up. For a time in the minute not
 *   yet over, the cell says when to ask again (below); when the next
 *   period up is not over, the script stops going up, and the next source
 *   answers.
 * - CoinGecko, a service that gathers the exchanges' prices, asked next:
 *   24 hours of hourly prices, from 12 hours before the time to 12 hours
 *   after, whose price the script takes only once those hours are over;
 *   for `"close"` only, when they hold no price, its price at 00:00 UTC
 *   the next day, which ends the time's UTC day, and which CoinGecko
 *   serves from 00:50 UTC that day: asked before then, CoinGecko gives no
 *   price.
 * - CoinPaprika, a service like CoinGecko, asked last: the day, from 00:00
 *   to 23:59:59 UTC, that holds the time, whose price the script takes
 *   only once the day is over; for `"close"` only, when the day is older
 *   than the plan's candles reach, its price at 00:00 UTC the next day,
 *   which ends the day.
 *
 * ### Refresh & freeze
 *
 * A past price does not change, so Refresh & freeze historical prices, in
 * the Crypto Price Fetchers menu, can replace a tab's `getCryptoPrice`
 * formulas with their numbers, with two exceptions. CoinGecko says it may revise a price for
 * up to 2 days after its date, as later data settles, and a price for a
 * time can come from CoinGecko's prices of the next UTC day, which can
 * change until the end of the second day after that one, when the fourth
 * day after the time's UTC day begins. Refresh & freeze keeps the price
 * the cell kept, which may have been asked of CoinGecko up to 12 hours
 * earlier, since the script keeps a cell's price for up to 6 hours and
 * the prices CoinGecko gave it for up to 6 more. So freeze a cell only
 * once its time is 5 days old, when the fourth day after the time's UTC
 * day began at least a day before. And a coin that traded nothing on MEXC
 * in the UTC day that holds the time takes the next source's price until
 * MEXC can give the average of a larger period that holds the time, each
 * in UTC: the week, which MEXC counts from Monday 00:00, once it is over;
 * or, when nothing traded in the week either, the month, once it and the
 * week are over, since a week from Monday can end after its month or its
 * year; or, when nothing traded in the month either, the year, once it
 * and the week are over. A cell keeps the price it gave for up to
 * 6 hours, so freeze such a cell only once that period and the week have
 * been over 6 hours.
 *
 * ### Time zones
 *
 * UTC, GMT, EST, EDT, CST, CDT, MST, MDT, PST and PDT. Use the one in force
 * at that time: CDT in summer and CST in winter for US Central time. Any
 * other value gives a message in the cell instead of a price, so a
 * misspelt zone is never read as UTC.
 *
 * ### Messages in the cell
 *
 * - `No data available from any source`: no source had a price for that
 *   coin at that time; `No data available (cached)` repeats that answer
 *   while the script keeps "no data" (above).
 * - `No data available from any source; CoinPaprika gives average, high
 *   and low only with an api key`: no earlier source had a price for an
 *   average, a high or a low, and CoinPaprika, asked last, gives those
 *   only from a day's candle, which its free server, asked without a key,
 *   keeps only for the 24 hours after the candle begins, and so never once
 *   the day is over. A CoinPaprika key, saved with `npm run api-keys`
 *   before the build, has the script ask its paid server.
 * - `No data available for future dates`: the time is after now.
 * - `Too recent for a final price: ask again after …`: the time is in the
 *   minute not yet over, for a coin MEXC is asked about; or MEXC has no
 *   price for the time, no request of the call was cut short, and a later
 *   source's period that holds the time is not over: CoinGecko's 24 hours
 *   around the time, when CoinGecko has prices of the coin in the part of
 *   them already over, or else CoinPaprika's UTC day of the time, for
 *   which the script asks CoinPaprika nothing until the day is over, for
 *   close or with a CoinPaprika key (without one, an average, a high or a
 *   low gets the message on keys, above), so this message comes whether or
 *   not CoinPaprika has the coin, save for GridCoin, which the script never
 *   asks CoinPaprika about. A
 *   price from part of a period could still change, so the script gives
 *   none, asks no later source, and keeps nothing, until the time named,
 *   the period's end. When CoinGecko has none, as for a ticker no coin
 *   has, the script goes on to CoinPaprika.
 * - `Rate limit busy - retry later`: other cells kept the script busy, or
 *   no source gave a price and a request got no answer: refused as too
 *   many on its last try, or when the call had no more of the 25 seconds
 *   the script allows a cell, within the 30 Google gives one, to wait;
 *   answered with a server error or a request timeout (408); or given no
 *   response, as on a timeout
 *   or when Apps Script's daily quota of requests is spent; choose Clean
 *   up errors in the Crypto Price Fetchers menu, which runs the cell
 *   again.
 * - `Unknown time zone`, or `Invalid` with a part of the date: check
 *   `tz` or `dateStr`.
 * - `#ERROR!`: choose Clean up errors in the Crypto Price Fetchers menu.
 * <!-- HELP END -->
 *
 * HIGH, LOW AND CLOSE, BY SOURCE
 * ------------------------------
 * The help section above says what each mode gives. Each provider works it
 * out from its own data:
 *
 *   MEXC: Asks for the 1-minute candle of the minute containing the
 *     requested timestamp, once the minute is over: before then, the cell
 *     says when to ask again (fetchPriceFromProviders), since a candle of
 *     a period not over holds only the trades made so far, and the script
 *     goes up to no window that is not over (mexcWindowOver): MEXC then
 *     gives no price. MEXC gives a candle for every period it keeps:
 *     one in which nothing traded has volume 0, and open, high, low and
 *     close all at the last trade's price. It keeps 1-minute candles for
 *     about the last 30 days and gives none for an older minute, nor for a
 *     period before the pair's first trade, which comes on the day MEXC
 *     listed the pair; the larger windows that hold such a time may hold
 *     only trades from after it. A candle of the day before shows the pair
 *     traded before that day, so the day before decides. Within those 30
 *     days, when MEXC gives no candle of the minute, or the request for it
 *     fails, the script asks for the candle of the day before: with one,
 *     it asks for the 60-minute candle of the hour containing the
 *     timestamp, as it does for an older time; with none, or when that
 *     request fails too, MEXC gives no price. When MEXC gives no candle of
 *     the hour, or the request for it fails, the day before decides the
 *     same way: with a candle, the script asks for the next window up, as
 *     for an hour of volume 0; with none, or a failed request, MEXC gives
 *     no price. When the candle's volume is above 0, the script gives the
 *     mode's price from it. When it is 0, the script asks for the candles
 *     of the next window up, in MEXC_WINDOWS (-sources.gs): the hour, 2
 *     hours, 4 hours, day, week, month and year containing the timestamp.
 *     MEXC serves no 2-hour or yearly candle, so the 2 hours join their
 *     two hour candles and the year its twelve month candles. The first
 *     window whose volume is above 0 gives the average of its high and
 *     low, whatever the mode. A failed request for a larger window leaves
 *     the script to go on up, since the pair traded before the time. A
 *     coin for which MEXC lists no pair against the quote currency
 *     (QUOTE_CURRENCY, below, USDT as written), but one against BTC, is
 *     priced from its BTC pair, then in USD with the candle of BTC against
 *     the quote currency of the same window, read the same way.
 *
 *   CoinGecko market_chart/range: Fetches hourly data points over a
 *     24-hour window centered on the requested time (12 hours before to
 *     12 hours after), once that window is over, so that no later trade
 *     changes the price it gives, though CoinGecko says it may revise a
 *     price for up to 2 days after its date: the average of the highest
 *     and the lowest for average, the highest for high, the lowest for
 *     low, and the one nearest the time for close.
 *
 *   CoinGecko history: A day's single price, recorded at 00:00 UTC. The
 *     script asks for the day after the time's, whose price at 00:00 UTC
 *     ends the time's day, as CoinPaprika's close does, once CoinGecko
 *     serves it, from 00:50 UTC that day (coinGeckoServesDayEnd). One
 *     price is not a range, so it answers close only; average, high and
 *     low go on to CoinPaprika.
 *
 *   CoinPaprika: The day's OHLCV candle (00:00 to 23:59:59 UTC) holding
 *     the requested time, once the day is over, so the price it gives
 *     never changes: the average of its high and low, or its high, low or
 *     close. A plan reaches only so many days back for candles: the free
 *     plan, the last 24 hours, which hold no day already over, since a
 *     day's candle begins 24 hours before the day ends. For
 *     an older day, close takes instead the price at 00:00 UTC of the next
 *     day, which is the price at the day's end, 24:00 UTC: the free plan
 *     keeps those prices for the last 365 days, though its candles only 24
 *     hours, so the script asks for the date after the time's on purpose;
 *     that one price answers close only.
 *
 * DATA SOURCES (PROVIDER CHAIN)
 * -----------------------------
 * Providers are tried in order; the first successful result is returned.
 * None asks for the current price, which would put today's price on a
 * past date. A request a provider refuses as one too many (status 429) is
 * sent again after each wait in RETRY_DELAYS_MS, while the wait fits in
 * the call's budget, CALL_BUDGET_MS, below; a request that gets no
 * response at all, as on a timeout, a refused connection or Apps Script's
 * own quota of requests, is a failed one, as a refusal is, and the next
 * provider answers. Such a request, an answer with a server error (5xx)
 * or a request timeout (408), a refusal the call cannot wait out and a
 * request it has no time to send are cut short (CALL, below): when no provider then gives a price, the
 * cell shows the busy message, and no provider's silence is kept as no
 * data.
 *
 *   1. MEXC       - Primary. Real OHLCV candles (1-minute for about the
 *                   last 30 days, else 1-hour; up to the year when
 *                   nothing traded), of periods already over. Queries
 *                   exchangeInfo to verify the trading pair exists. Skip
 *                   list: grc (not listed on MEXC).
 *
 *   2. CoinGecko  - Tries two sub-endpoints in order, both dated:
 *                   a) market_chart/range (24h window, hourly data points)
 *                   b) history (the price at 00:00 UTC the day after the
 *                      requested UTC day, which ends it), for close only
 *                   Both send the demo api key when
 *                   CONFIG.COINGECKO_API_KEY holds one (see API KEYS
 *                   above).
 *
 *   3. CoinPaprika - The day's candle, then, for close, the price at 00:00
 *                   UTC of the next day, which ends the day (see above).
 *                   With a key in CONFIG.COINPAPRIKA_API_KEY, both are
 *                   asked of the paid server with the key, and
 *                   reach as far back as the plan does.
 *                   Skip list: grc-gridcoin (is_active is false).
 *
 * TOKEN MAPPINGS (TOKEN_TO_ID):
 *   Tokens not listed in TOKEN_TO_ID use the raw ticker as the CoinGecko /
 *   CoinPaprika ID. To add a new token, add an entry with its gecko and
 *   paprika IDs:
 *     'mytok': { gecko: 'mytoken-id', paprika: 'mytok-mytoken' }
 *   If the token is not on MEXC, add it to the skip set in mexcSkips.
 *   Similarly for CoinPaprika in coinPaprikaSkips.
 *
 * CONFIGURATION
 * -------------
 * All tuning is in the CONFIG object at the top of this file:
 *
 *   EXCHANGE_BASE_URL    - MEXC REST API base ("https://api.mexc.com/api/v3")
 *   QUOTE_CURRENCY       - Quote side of the token's MEXC pair, and of the
 *                          BTC pair a BTC-quoted price goes through:
 *                          "USDT" or "USDC" ("USDT"). It is a USD
 *                          stablecoin, since CoinGecko and CoinPaprika
 *                          answer in USD, and one of the two MEXC quotes
 *                          the most pairs in: on 2026-11-21, 1,366 pairs
 *                          in USDT and 222 in USDC; then 77 in USD1, 20
 *                          in BTC, 16 in EUR, 7 each in ETH and BRL, 6 in
 *                          USDE and 4 in USDF. DAI and USDS, the
 *                          stablecoin Sky (formerly MakerDAO) upgraded DAI
 *                          to, are left out: MEXC quotes no pair in
 *                          either, so with either set MEXC would give no
 *                          price, finding at most a coin's BTC pair and no
 *                          BTC pair in DAI or USDS to convert it through,
 *                          and CoinGecko or CoinPaprika would give every
 *                          price.
 *
 *   TIMEZONE_OFFSETS     - Map of abbreviation to UTC offset in hours
 *                          (see Time zones, in the help section above)
 *
 *   CACHE_EXPIRY_SECONDS
 *     DAILY_PRICE        - TTL for successful price lookups (21600 = 6h,
 *                          the longest Apps Script's cache keeps a value)
 *     NEGATIVE_CACHE     - TTL for "no data" results (300 = 5min)
 *
 *   COINGECKO_BASE       - CoinGecko API v3 base URL
 *   COINGECKO_API_KEY    - The CoinGecko demo api key; empty for none, as
 *                          committed (see API KEYS)
 *   COINGECKO_API_KEY_HEADER
 *                        - The header the key is sent in
 *                          ("x-cg-demo-api-key")
 *   COINPAPRIKA_BASE     - CoinPaprika API v1 base URL, the free server
 *   COINPAPRIKA_PRO_BASE - CoinPaprika's paid server, asked with a key
 *   COINPAPRIKA_API_KEY  - The CoinPaprika api key; empty for none, as
 *                          committed (see API KEYS)
 *   COINPAPRIKA_API_KEY_HEADER
 *                        - The header the key is sent in, as its whole
 *                          value ("Authorization")
 *
 *   Endpoint templates (use {base}, {id}, {date}, {from}, {to}, {start},
 *   {end} placeholders). config.json may change one only so that it still
 *   asks for USD: vs_currency=usd for CoinGecko's range, quote=usd for
 *   CoinPaprika's two; CoinGecko's history gives every currency, and the
 *   script reads its USD price:
 *     COINGECKO_HISTORY_TEMPLATE
 *     COINGECKO_MARKET_CHART_RANGE_TEMPLATE
 *     COINPAPRIKA_OHLCV_TEMPLATE      - the day's candle
 *     COINPAPRIKA_DAY_PRICE_TEMPLATE  - the day's price at 00:00 UTC
 *
 *   RETRY_DELAYS_MS      - The waits, in milliseconds, before each new try
 *                          of a request refused with status 429
 *                          ([5000, 5000]: three tries in all)
 *
 *   Rate-limit tuning:
 *     LOCK_WAIT_MS         - Lock acquisition timeout (2000ms)
 *     GENERAL_DELAY_MS     - The wait once the lock is taken, before a lookup
 *                            (200ms). A call that passes 0 as getCryptoPrice's
 *                            fifth argument, as the in-sheet tests do, takes
 *                            no lock at all, so config.json may set only a
 *                            whole number above 0
 *     MAX_LOCK_RETRIES     - Tries of the lock, the first one included (3)
 *     LOCK_RETRY_BACKOFF   - Exponential backoff array [5000, 10000, 20000]:
 *                            the waits after each failed try but the last
 *
 *   The build step also sets, at the end of the file it gives, the fields
 *   of CONFIG that fetch-from-any-exchange/config.json sets, which
 *   git ignores. The file may set any field above but the two keys, each
 *   with a value of its kind, as the Node version's CONFIG_SCHEMAS says;
 *   the build refuses a file that sets another field or a value of another
 *   kind. A field that holds an object or a list is set whole.
 *
 * TESTING
 * -------
 * The repo's tests run this file unchanged under Node. In the Apps Script
 * editor, select the "test" function from the function dropdown and click
 * Run. Results appear in the execution log.
 *
 * LIMITATIONS
 * -----------
 * Google Apps Script execution limits cap each run at roughly 100 API calls.
 * For larger batch jobs, use the Node.js CLI in crypto-price-filler/.
 */

// Declared in getCryptoPriceFromCentralizedExchange-sources.gs, in the same
// project:
/* global getPriceFromMEXC, getPriceFromCoinGecko, getPriceFromCoinPaprika, mexcSkips, coinGeckoHasPricesSoFar, coinPaprikaSkips, configuredKey */

/** ============================================================================
 *                          CONFIGURATION & GLOBALS
 * ========================================================================== */
const CONFIG = {
  EXCHANGE_BASE_URL: "https://api.mexc.com/api/v3",
  QUOTE_CURRENCY: "USDT",
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
    PDT: -7,
  },
  CACHE_EXPIRY_SECONDS: {
    DAILY_PRICE: 21600, // 6 hours, the longest Apps Script's cache keeps a value
    NEGATIVE_CACHE: 300, // 5 min for failures
  },

  // API URL bases
  COINGECKO_BASE: "https://api.coingecko.com/api/v3",
  COINPAPRIKA_BASE: "https://api.coinpaprika.com/v1",
  COINPAPRIKA_PRO_BASE: "https://api-pro.coinpaprika.com/v1",

  /*-
   *  The CoinGecko demo api key, sent in this header; empty for none. The
   *  build step sets it (see API KEYS), as the Node version does.
   */
  COINGECKO_API_KEY: "",
  COINGECKO_API_KEY_HEADER: "x-cg-demo-api-key",

  /*-
   *  The CoinPaprika paid-plan api key, sent as this header's whole
   *  value; empty for none. The build step sets it (see API KEYS).
   */
  COINPAPRIKA_API_KEY: "",
  COINPAPRIKA_API_KEY_HEADER: "Authorization",

  // Endpoint templates
  COINGECKO_HISTORY_TEMPLATE: "{base}/coins/{id}/history?date={date}",
  COINGECKO_MARKET_CHART_RANGE_TEMPLATE:
    "{base}/coins/{id}/market_chart/range?vs_currency=usd&from={from}&to={to}",

  COINPAPRIKA_OHLCV_TEMPLATE:
    "{base}/coins/{id}/ohlcv/historical?start={start}&end={end}&quote=usd",
  COINPAPRIKA_DAY_PRICE_TEMPLATE:
    "{base}/tickers/{id}/historical?start={date}&interval=1d&limit=1&quote=usd",

  // The waits before each new try of a request refused with status 429
  RETRY_DELAYS_MS: [5000, 5000],

  // Rate limit tuning
  LOCK_WAIT_MS: 2000, // Wait time for lock acquisition
  GENERAL_DELAY_MS: 200, // Delay between calls (reduced for speed)
  MAX_LOCK_RETRIES: 3, // Tries of the lock, the first one included
  LOCK_RETRY_BACKOFF: [5000, 10000, 20000], // Exponential backoff (5s → 10s → 20s)
};

const API_LOCK = LockService.getScriptLock();

/**
 * The time a call of getCryptoPrice may use, its waits included: Google
 * stops a custom function after 30 seconds. A call waits for the lock or
 * for a request refused as one too many only while the wait fits in it,
 * and sends no request once it is used; when no source then gave a price,
 * the cell shows the busy message, and nothing is cached (CALL, below).
 * Not a setting: it follows Google's limit.
 */
const CALL_BUDGET_MS = 25000;

/**
 * The time a call of getCryptoPrice has used, for its budget
 * (CALL_BUDGET_MS): when it began, or null outside a call; the waits it
 * asked for; and how many of its requests were cut short: refused as one
 * too many past the last try or the time left to wait, answered with a
 * server error (5xx) or a request timeout (408), given no response, or not
 * sent for want of time. A request cut short says nothing of
 * whether its source has a price, so no source keeps the lack of an answer
 * from one, and a call with one, which no source priced, shows the busy
 * message rather than no data. Outside a call the count only grows.
 */
const CALL = { startMs: null, waitedMs: 0, cutRequests: 0 };

/**
 * The time the call has used: the time since it began, or the waits it
 * asked for, whichever is more, so a wait counts though the clock does not
 * move for it, as under a stand-in.
 *
 * @return {number} The time, in ms; 0 outside a call
 */
function callTimeUsedMs() {
  if (CALL.startMs === null) return 0;
  return Math.max(Date.now() - CALL.startMs, CALL.waitedMs);
}

/**
 * Whether the call has time for a wait of this long, within its budget;
 * always, outside a call, as when a test function runs from the editor.
 *
 * @param {number} milliseconds - The wait
 * @return {boolean} Whether it fits
 */
function callHasTimeFor(milliseconds) {
  return (
    CALL.startMs === null || callTimeUsedMs() + milliseconds <= CALL_BUDGET_MS
  );
}

/**
 * Waits, and counts the wait against the call's budget.
 *
 * @param {number} milliseconds - The wait
 */
function waitInCall(milliseconds) {
  CALL.waitedMs += milliseconds;
  Utilities.sleep(milliseconds);
}

/**
 * What a cell shows when the call got no script lock in its tries, or no
 * source gave a price and a request was cut short: refused as one too many
 * past what the call could wait out, answered with a server error or a
 * request timeout, given no response, or not sent for want of time. The menu's Clean up errors runs again each cell that shows
 * it.
 *
 * @type {string}
 */
const EXCHANGE_BUSY_MESSAGE = "Rate limit busy - retry later";

/**
 * What a cell shows when no earlier source has a price and CoinPaprika,
 * without a key, can give no average, high or low (`coinPaprikaCanGive`).
 *
 * @type {string}
 */
const COINPAPRIKA_KEY_MESSAGE =
  "No data available from any source; CoinPaprika gives average, high and low only with an api key";

/** ============================================================================
 *                       TOKEN MAPPINGS FOR FALLBACKS
 * ========================================================================== */
const TOKEN_TO_ID = {
  btc: { gecko: "bitcoin", paprika: "btc-bitcoin" },
  xmr: { gecko: "monero", paprika: "xmr-monero" },
  grc: { gecko: "gridcoin-research", paprika: "grc-gridcoin" },
  xtm: { gecko: "minotari", paprika: "xtm-tari" },
};

/** ============================================================================
 *                          CACHE HELPERS
 * ========================================================================== */

/**
 * A price kept in the script's cache.
 *
 * @param {string} key - The cache key
 * @returns {number|string|null} The price; "No data available (cached)" when a lookup that found nothing was cached; the message that CoinPaprika needs a key, when that was kept; or null when nothing usable is cached
 */
function getCachedResult(key) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) {
    Logger.log(`Cache hit: ${key} = ${cached}`);
    if (cached === "NO_DATA") {
      Logger.log(`Negative cache hit for ${key}`);
      return "No data available (cached)";
    }
    if (cached === "NEEDS_KEY") return COINPAPRIKA_KEY_MESSAGE;
    const num = parseFloat(cached);
    if (isNaN(num)) {
      Logger.log(`Invalid cached value (NaN) for ${key} - treating as miss`);
      cache.remove(key);
      return null;
    }
    return num;
  }
  Logger.log(`Cache miss: ${key}`);
  return null;
}

/**
 * Keeps a price in the script's cache, or NO_DATA when the value is not a
 * number, so a lookup that found nothing is not asked again until it
 * expires.
 *
 * @param {string} key - The cache key
 * @param {*} value - The price found, or anything else for none
 * @param {number} [ttl=CONFIG.CACHE_EXPIRY_SECONDS.DAILY_PRICE] - The seconds to keep it
 */
function setCachedResult(
  key,
  value,
  ttl = CONFIG.CACHE_EXPIRY_SECONDS.DAILY_PRICE,
) {
  const cache = CacheService.getScriptCache();
  const valueToCache =
    typeof value === "number" && !isNaN(value) ? value : "NO_DATA";
  cache.put(key, valueToCache.toString(), ttl);
  Logger.log(`Cached: ${key} = ${valueToCache} (TTL ${ttl}s)`);
}

/** ============================================================================
 * Main entry point custom function for Google Sheets
 * ========================================================================== */
function getCryptoPrice(
  token,
  dateStr,
  tz,
  mode = "average",
  apiDelayMs = CONFIG.GENERAL_DELAY_MS,
) {
  CALL.startMs = Date.now();
  CALL.waitedMs = 0;
  CALL.cutRequests = 0;
  try {
    return cryptoPriceInCall(token, dateStr, tz, mode, apiDelayMs);
  } finally {
    CALL.startMs = null;
  }
}

/**
 * getCryptoPrice's work, within the call's budget, which getCryptoPrice
 * starts and ends.
 *
 * @param {string} token - The token, as the cell names it
 * @param {string|Date} dateStr - The time
 * @param {string} tz - The time zone
 * @param {string} mode - The price to give
 * @param {number} apiDelayMs - The wait after the lock is taken
 * @return {number|string} The price, or what the cell shows
 */
function cryptoPriceInCall(token, dateStr, tz, mode, apiDelayMs) {
  Logger.log(
    `getCryptoPrice called: token=${token}, date=${dateStr}, tz=${tz}, mode=${mode}, delay=${apiDelayMs}ms`,
  );

  token = token.toLowerCase();
  const target = priceTarget(mode);

  // Parse and validate date
  const safeDateStr = normalizeDateStr(dateStr);
  if (typeof safeDateStr !== "string") return safeDateStr.error;

  const offsetHours = getTimezoneOffsetHours(tz);
  if (offsetHours === null) return unknownTimeZoneMessage(tz);

  const utcMs = parseInputToUtcMs(safeDateStr, offsetHours);
  if (typeof utcMs === "string") return utcMs;
  if (utcMs > Date.now()) return "No data available for future dates";

  // Check cache
  const cacheKey = `price_${token}_${safeDateStr.replace(/[^0-9-]/g, "")}_${tz}_${target}`;
  const cached = getCachedResult(cacheKey);
  if (cached !== null) return cached;

  // Acquire lock with retry
  const lockAcquired = acquireLockWithRetry(apiDelayMs);
  if (!lockAcquired) return EXCHANGE_BUSY_MESSAGE;

  try {
    const price = fetchPriceFromProviders(token, utcMs, target);
    if (price === COINPAPRIKA_KEY_MESSAGE) {
      CacheService.getScriptCache().put(
        cacheKey,
        "NEEDS_KEY",
        CONFIG.CACHE_EXPIRY_SECONDS.NEGATIVE_CACHE,
      );
    }
    if (typeof price === "string") return price;
    if (price === null && CALL.cutRequests > 0) {
      Logger.log(
        "No source gave a price, and the call was cut short, so nothing is cached",
      );
      return EXCHANGE_BUSY_MESSAGE;
    }
    cacheAndReturn(cacheKey, price);
    return price !== null ? price : "No data available from any source";
  } catch (e) {
    Logger.log(`Critical error: ${e.message}`);
    return `Error: ${e.message}`;
  } finally {
    releaseLockIfHeld(lockAcquired);
  }
}

/**
 * The time zone a date cell's time is shown in: the spreadsheet's. With no
 * spreadsheet, as when the script runs from the editor or under Node, the
 * script's, or UTC when that is not known either.
 *
 * @return {string} The time zone, as `Utilities.formatDate` takes it
 */
function cellTimeZone() {
  const spreadsheet =
    typeof SpreadsheetApp === "undefined"
      ? null
      : SpreadsheetApp.getActiveSpreadsheet();
  if (spreadsheet) return spreadsheet.getSpreadsheetTimeZone();
  return typeof Session === "undefined" ? "UTC" : Session.getScriptTimeZone();
}

/**
 * The time a cell gives, as "YYYY-MM-DD HH:MM:SS" text. Sheets hands a date
 * cell as the moment the cell shows in the spreadsheet's time zone, so the
 * time the cell shows is that moment written in that zone.
 *
 * @param {string|Date} dateStr - The time, as text or a date cell's Date
 * @return {string|{error: string}} The text, or an error when it is neither
 */
function normalizeDateStr(dateStr) {
  if (typeof dateStr === "string") return dateStr;
  if (dateStr instanceof Date && !isNaN(dateStr.getTime())) {
    return Utilities.formatDate(dateStr, cellTimeZone(), "yyyy-MM-dd HH:mm:ss");
  }
  Logger.log(`Invalid dateStr type: ${typeof dateStr}`);
  return { error: "Invalid date format" };
}

/** The price a mode asks for: "high", "low" or "close" as named, in any letter case, and "average" for any other value */
function priceTarget(mode) {
  const named = String(mode).toLowerCase();
  return ["high", "low", "close"].includes(named) ? named : "average";
}

/**
 * Attempts to acquire the lock, waiting LOCK_RETRY_BACKOFF after each
 * failed try but the last, within the call's budget: a try or a wait that
 * does not fit in it is not made.
 *
 * @param {number} apiDelayMs - The wait once the lock is taken; 0 takes none
 * @return {boolean} Whether the lock was taken
 */
function acquireLockWithRetry(apiDelayMs) {
  if (apiDelayMs <= 0) return true;

  for (let attempt = 0; attempt < CONFIG.MAX_LOCK_RETRIES; attempt++) {
    if (!callHasTimeFor(CONFIG.LOCK_WAIT_MS)) break;
    Logger.log(`Lock attempt ${attempt + 1}/${CONFIG.MAX_LOCK_RETRIES}`);
    if (API_LOCK.tryLock(CONFIG.LOCK_WAIT_MS)) {
      Logger.log(`Lock acquired, sleeping ${apiDelayMs}ms`);
      waitInCall(apiDelayMs);
      return true;
    }
    // tryLock waited all its time for the lock
    CALL.waitedMs += CONFIG.LOCK_WAIT_MS;
    const backoff = CONFIG.LOCK_RETRY_BACKOFF[attempt] ?? 5000;
    if (attempt === CONFIG.MAX_LOCK_RETRIES - 1 || !callHasTimeFor(backoff))
      break;
    Logger.log(`Lock timeout - backoff ${backoff}ms`);
    waitInCall(backoff);
  }
  Logger.log("All lock attempts failed");
  return false;
}

/** Releases lock if it was acquired */
function releaseLockIfHeld(lockAcquired) {
  if (lockAcquired) {
    API_LOCK.releaseLock();
    Logger.log("Lock released");
  }
}

/**
 * Tries each provider in order, and gives the first valid price; or the
 * message that says when to ask again, for a time in MEXC's minute not
 * yet over, or, when MEXC has no price and no request of the call was cut
 * short, while a later source's period for
 * the time is not over: CoinGecko's window, when CoinGecko has prices of
 * the coin in the part of it already over, without asking CoinPaprika, or
 * else CoinPaprika's UTC day, which the script asks nothing of until the
 * day is over; or else null, which the caller shows as busy when a
 * request of the call was cut short, and as no data otherwise. A source
 * gives no price from a period not over; when CoinGecko has none of the
 * coin, as for a ticker no coin has, the script goes on to CoinPaprika.
 * Without a CoinPaprika key, CoinPaprika can give no average, high or low
 * (`coinPaprikaCanGive`), so for those it is not asked, and the message
 * says it needs a key, save for a token CoinPaprika lists as inactive
 * (`coinPaprikaSkips`), or the caller shows busy when a request of the
 * call was cut short.
 * For a token CoinPaprika lists as inactive (`coinPaprikaSkips`), the
 * script asks CoinPaprika nothing, and the cell says no source has a
 * price.
 *
 * @param {string} token - The ticker
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @param {string} target - The price to give
 * @return {number|string|null} The price, the message, or null
 */
function fetchPriceFromProviders(token, utcMs, target) {
  const idMap = TOKEN_TO_ID[token] ?? { gecko: token, paprika: token };
  const providers = [
    { name: "MEXC", fn: () => getPriceFromMEXC(token, utcMs, target) },
    {
      name: "CoinGecko",
      fn: () => getPriceFromCoinGecko(idMap.gecko, utcMs, target),
    },
    {
      name: "CoinPaprika",
      fn: () => getPriceFromCoinPaprika(idMap.paprika, utcMs, target),
    },
  ];

  for (const provider of providers) {
    const early = beforeAsking(provider.name, token, idMap, utcMs, target);
    if (early === SKIP_SOURCE) continue;
    if (early !== ASK_SOURCE) return early;
    const price = provider.fn();
    if (isValidPrice(price)) {
      Logger.log(`Final price from ${provider.name}: ${price}`);
      return price;
    }
  }
  Logger.log("All providers failed");
  return null;
}

/** What `beforeAsking` gives for a source to ask, and for one to pass over. */
const ASK_SOURCE = "ask";
const SKIP_SOURCE = "skip";

/**
 * What the provider loop does with a source before it asks it, as
 * `fetchPriceFromProviders` describes: ask it (ASK_SOURCE), pass over it
 * (SKIP_SOURCE), or end the loop with a result: the message that says
 * when to ask again, or that CoinPaprika needs a key, or null, which the
 * caller shows as busy, when a request of the call was cut short. MEXC,
 * asked first, comes before any request of the call. The count of
 * requests cut short is read at each check, since the request for
 * CoinGecko's prices so far, asked here, may itself be cut short.
 *
 * @param {string} name - The source: "MEXC", "CoinGecko" or "CoinPaprika"
 * @param {string} token - The ticker
 * @param {{gecko: string, paprika: string}} idMap - The token's ids at CoinGecko and CoinPaprika
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @param {string} target - The price to give
 * @return {string|null} ASK_SOURCE, SKIP_SOURCE, the message, or null
 */
function beforeAsking(name, token, idMap, utcMs, target) {
  if (name === "MEXC") {
    if (mexcSkips(token) || Date.now() >= mexcMinuteEndMs(utcMs))
      return ASK_SOURCE;
    return tooRecentMessage(mexcMinuteEndMs(utcMs));
  }
  if (name === "CoinGecko") {
    if (Date.now() >= coinGeckoWindowEndMs(utcMs)) return ASK_SOURCE;
    if (CALL.cutRequests === 0 && coinGeckoHasPricesSoFar(idMap.gecko, utcMs))
      return tooRecentMessage(coinGeckoWindowEndMs(utcMs));
    return CALL.cutRequests > 0 ? null : SKIP_SOURCE;
  }
  if (coinPaprikaSkips(idMap.paprika)) {
    Logger.log(`Skipping CoinPaprika for inactive token: ${idMap.paprika}`);
    return SKIP_SOURCE;
  }
  if (!coinPaprikaCanGive(target))
    return CALL.cutRequests > 0 ? null : COINPAPRIKA_KEY_MESSAGE;
  if (Date.now() < coinPaprikaDayEndMs(utcMs))
    return CALL.cutRequests > 0
      ? null
      : tooRecentMessage(coinPaprikaDayEndMs(utcMs));
  return ASK_SOURCE;
}

/** Checks if price is a valid number */
function isValidPrice(price) {
  return typeof price === "number" && !isNaN(price);
}

/** Caches price result (positive or negative) */
function cacheAndReturn(cacheKey, price) {
  if (price !== null) {
    setCachedResult(cacheKey, price);
  } else {
    setCachedResult(
      cacheKey,
      "NO_DATA",
      CONFIG.CACHE_EXPIRY_SECONDS.NEGATIVE_CACHE,
    );
  }
}

/** ============================================================================
 *                 WHEN A SOURCE CAN GIVE A PRICE FOR A TIME
 * ========================================================================== */

/**
 * Whether a window that holds a time is over. MEXC's candle of a window
 * not over holds only the trades made so far, so its prices can still
 * change, and MEXC gives no price from it.
 *
 * @param {Object} window - One of MEXC_WINDOWS
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @returns {boolean} Whether the window is over
 */
function mexcWindowOver(window, utcMs) {
  if (Date.now() > window.bounds(utcMs).end) return true;
  Logger.log(`MEXC: the ${window.name} that holds the time is not over`);
  return false;
}

/**
 * When the minute that holds a time ends, the period of MEXC's smallest
 * candle. Before then, the candle holds only the trades made so far, so
 * its prices can still change.
 *
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @returns {number} The minute's end, in ms since 1970 UTC
 */
function mexcMinuteEndMs(utcMs) {
  return (Math.floor(utcMs / 60000) + 1) * 60000;
}

/**
 * When CoinGecko's window for a time ends: 12 hours after the time, the
 * end of the 24 hours of hourly prices `tryCoinGeckoMarketChartRange`
 * asks for. Before then, a price from those hours could still change.
 *
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @returns {number} The window's end, in ms since 1970 UTC
 */
function coinGeckoWindowEndMs(utcMs) {
  return utcMs + 43200000;
}

/**
 * Whether CoinGecko serves the price that ends a time's UTC day, its daily
 * price for the next day, recorded at 00:00 UTC: it does from 00:50 UTC
 * that day, as CoinGecko's documentation of its history says.
 *
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @returns {boolean} Whether it serves it yet
 */
function coinGeckoServesDayEnd(utcMs) {
  if (Date.now() >= coinPaprikaDayEndMs(utcMs) + 3000000) return true;
  Logger.log("CoinGecko serves the price that ends the day from 00:50 UTC");
  return false;
}

/**
 * When CoinPaprika's day for a time ends: the midnight, UTC, after the
 * time, the end of the day whose candle `getPriceFromCoinPaprika` reads.
 * Before then, the day's candle can still change.
 *
 * @param {number} utcMs - The time, in ms since 1970 UTC
 * @returns {number} The day's end, in ms since 1970 UTC
 */
function coinPaprikaDayEndMs(utcMs) {
  return (Math.floor(utcMs / 86400000) + 1) * 86400000;
}

/**
 * Whether CoinPaprika can give a target: any with a key, which asks a paid
 * server, whose plans reach past days' candles; close alone without one,
 * from a day's price at 00:00 UTC, since the free server keeps a candle
 * only for the 24 hours after it begins, and so none of a day already
 * over.
 *
 * @param {string} target - The price to give: "average", "high", "low" or "close"
 * @returns {boolean} Whether it can
 */
function coinPaprikaCanGive(target) {
  return (
    configuredKey(CONFIG.COINPAPRIKA_API_KEY) !== null || target === "close"
  );
}

/**
 * What a cell shows when a source's period for a time is not over, and no
 * request of the call was cut short: MEXC's minute, or, when MEXC has no
 * price for the time, CoinGecko's window or CoinPaprika's UTC day. A price
 * from part of the period could still change, so the script gives none
 * until the period ends, the minute it names, rounded up, in UTC.
 *
 * @param {number} endMs - When the period ends, in ms since 1970 UTC
 * @return {string} The message
 */
function tooRecentMessage(endMs) {
  const end = new Date(Math.ceil(endMs / 60000) * 60000);
  return `Too recent for a final price: ask again after ${Utilities.formatDate(end, "UTC", "yyyy-MM-dd HH:mm")} UTC`;
}

/** ============================================================================
 *                            HELPER FUNCTIONS
 * ========================================================================== */

/**
 * What a cell shows for a time zone the script does not know: the zones
 * it knows. The Node version's command line names a mistyped `--tz` with
 * it before it asks anything.
 *
 * @param {string} tz - The zone given
 * @return {string} The message
 */
function unknownTimeZoneMessage(tz) {
  return `Unknown time zone "${tz}": use one of ${Object.keys(CONFIG.TIMEZONE_OFFSETS).join(", ")}`;
}

/** The UTC offset in hours of a time zone abbreviation; UTC when none is given; null when the abbreviation is unknown */
function getTimezoneOffsetHours(tz) {
  // An empty cell arrives as "", and counts as no zone given, as a missing one does
  const given = tz === undefined || tz === null ? "" : String(tz).trim();
  const key = (given === "" ? "UTC" : given).toUpperCase();
  const offset = CONFIG.TIMEZONE_OFFSETS[key];
  if (offset === undefined) {
    Logger.log(`Unknown time zone: ${tz}`);
    return null;
  }
  Logger.log(`Timezone ${tz} → offset: ${offset} hours`);
  return offset;
}

/**
 * The time a "YYYY-MM-DD HH:MM:SS" text gives, as ms since 1970 UTC: its
 * fields read as the time in a zone the given hours ahead of UTC.
 *
 * @param {string} dateText - The time, as `normalizeDateStr` writes it
 * @param {number} offsetHours - The zone's offset from UTC, in hours
 * @returns {number|string} The time in ms, or the error message the cell shows
 */
function parseInputToUtcMs(dateText, offsetHours) {
  Logger.log(`Parsing date text: ${dateText}, offsetHours: ${offsetHours}`);

  const components = parseDateStringToComponents(dateText);
  if (typeof components === "string") {
    Logger.log(`Date string parse failed: ${components}`);
    return components;
  }

  const utcMs = createUtcTimestampFromComponents(components);
  if (typeof utcMs === "string") {
    Logger.log(`UTC timestamp creation failed: ${utcMs}`);
    return utcMs;
  }

  Logger.log(`UTC ms before offset: ${utcMs}`);
  const finalMs = utcMs - offsetHours * 3600000;
  Logger.log(`Final UTC ms after offset: ${finalMs}`);
  return finalMs;
}

/**
 * The fields of a "YYYY-MM-DD HH:MM:SS" string, on a 24-hour clock, each
 * checked to be in range and the date to exist.
 *
 * @param {string} dateStr - The text
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, second: number}|string} The fields, or an error message
 */
function parseDateStringToComponents(dateStr) {
  Logger.log(`Parsing date string: ${dateStr}`);
  const regex = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
  const match = dateStr.match(regex);

  if (!match) {
    return logAndReturn(
      "Invalid format. Use exactly YYYY-MM-DD HH:MM:SS (24-hour)",
    );
  }

  const [, yStr, mStr, dStr, hStr, minStr, sStr] = match;
  const components = {
    year: parseInt(yStr, 10),
    month: parseInt(mStr, 10),
    day: parseInt(dStr, 10),
    hour: parseInt(hStr, 10),
    minute: parseInt(minStr, 10),
    second: parseInt(sStr, 10),
  };

  const validationError = validateDateComponents(components);
  if (validationError) return validationError;

  Logger.log(`Parsed components: ${JSON.stringify(components)}`);
  return components;
}

/** Validates date component ranges, returns error string or null */
function validateDateComponents(c) {
  if (!inRange(c.year, 1970, 2100)) return "Invalid year (1970–2100)";
  if (!inRange(c.month, 1, 12)) return "Invalid month (01–12)";
  if (!inRange(c.day, 1, 31)) return "Invalid day (01–31)";
  if (!inRange(c.hour, 0, 23)) return "Invalid hour (00–23)";
  if (!inRange(c.minute, 0, 59)) return "Invalid minute (00–59)";
  if (!inRange(c.second, 0, 59)) return "Invalid second (00–59)";

  // Check for impossible dates like Feb 30
  const tempDate = new Date(c.year, c.month - 1, c.day);
  const dateMatches =
    tempDate.getFullYear() === c.year &&
    tempDate.getMonth() + 1 === c.month &&
    tempDate.getDate() === c.day;
  if (!dateMatches) return "Invalid date (e.g., Feb 30 does not exist)";

  return null;
}

/** Checks if value is within range (inclusive) */
function inRange(value, min, max) {
  return value >= min && value <= max;
}

/** Logs message and returns it */
function logAndReturn(msg) {
  Logger.log(msg);
  return msg;
}

/**
 * The ms since 1970 UTC of date and time fields read as UTC.
 *
 * @param {{year: number, month: number, day: number, hour: number, minute: number, second: number}} components - The fields
 * @returns {number|string} The time in ms, or an error message
 */
function createUtcTimestampFromComponents(components) {
  Logger.log(`Creating UTC timestamp from: ${JSON.stringify(components)}`);
  const date = new Date(
    Date.UTC(
      components.year,
      components.month - 1,
      components.day,
      components.hour,
      components.minute,
      components.second,
    ),
  );

  if (isNaN(date.getTime())) {
    const err = "Error creating UTC timestamp";
    Logger.log(err);
    return err;
  }

  Logger.log(`UTC timestamp created: ${date.getTime()}`);
  return date.getTime();
}
