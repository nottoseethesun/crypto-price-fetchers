# How the Scripts Decide Which Price to Give

crypto-price-fetchers gives the USD price of crypto tokens in three ways,
and each decides its price by rules of its own:

- `dexToolsGetTokenPrice` and `dexToolsGetTokenFDV`, which a cell of a
  spreadsheet calls, give a token's price now, and its fully diluted
  value.
- `getCryptoPrice`, which a cell calls too, gives a coin's price at a past
  time.
- crypto-price-filler, a program run from a terminal, prices every row of
  a CSV file at the row's own time, such as each payout in a year of a
  miner's payouts. Its backfill fills the rows no service priced.

The cells are those of Google Sheets, Google's spreadsheet app, whose
functions here are scripts in Apps Script, Google's platform for scripts
that run inside its apps. The build step, `npm run build apps-script`,
joins the repo's Sheets scripts into the one file pasted into a
spreadsheet; npm is the package manager of Node, the program that runs
JavaScript outside a browser, and runs the commands the repo's
`package.json` names. The Node version of each Sheets script, in
`bin/end-user/`, runs the same script on Node, and so follows the same
rules, save that what it keeps lasts
only for its run, and Google's own limits, such as its daily quota of
requests, do not apply. The build step can also add the functions of DEX
Screener, a service that lists the pairs of decentralized exchanges with
their prices, such as `DEX_SCREENER_PAIR_PROP`; their code is DEX
Screener's own, which decides their prices, and this page does not cover
them.

An api key, which some services take, is saved with the key manager,
`npm run api-keys`, which keeps it encrypted with a password you choose.
The build step writes the saved keys into the file pasted into a
spreadsheet. A Node program opens the saved keys of the services it may
ask before it asks anything, and has each service check its key; when
the password does not open the keys, or a service refuses its key, the
program stops with exit code 1, and prices nothing.

This page follows each of the three from the question it is asked to the
number it gives, and names each case in which it gives a message
instead.

## Contents

- [1. Candles, Statuses and Cells](#1-candles-statuses-and-cells)
  - [Candles and Periods](#candles-and-periods)
  - [Http Statuses](#http-statuses)
  - [When a Cell Runs](#when-a-cell-runs)
- [2. A Price Now: dexToolsGetTokenPrice and dexToolsGetTokenFDV](#2-a-price-now-dextoolsgettokenprice-and-dextoolsgettokenfdv)
  - [The Service Asked](#the-service-asked)
  - [The Pool Priced](#the-pool-priced)
  - [What a Price-Now Cell Shows](#what-a-price-now-cell-shows)
  - [How Long a Price Now Is Kept](#how-long-a-price-now-is-kept)
  - [Taking Turns for a Price Now](#taking-turns-for-a-price-now)
- [3. A Past Price: getCryptoPrice](#3-a-past-price-getcryptoprice)
  - [What a Cell Asks For](#what-a-cell-asks-for)
  - [Before Any Source Is Asked](#before-any-source-is-asked)
    - [Answers the Script Keeps](#answers-the-script-keeps)
    - [Waiting for Other Cells](#waiting-for-other-cells)
    - [The Time a Cell Has](#the-time-a-cell-has)
  - [The Order of the Sheet's Sources](#the-order-of-the-sheets-sources)
  - [MEXC](#mexc)
    - [The Market](#the-market)
    - [The First Period: the Minute, or the Hour](#the-first-period-the-minute-or-the-hour)
    - [When Nothing Traded: Larger Periods](#when-nothing-traded-larger-periods)
    - [When MEXC Has No Candle](#when-mexc-has-no-candle)
    - [When MEXC's Period Is Not Over](#when-mexcs-period-is-not-over)
  - [CoinGecko](#coingecko)
    - [The 24 Hours Around the Time](#the-24-hours-around-the-time)
    - [CoinGecko's Close From the Next Day](#coingeckos-close-from-the-next-day)
    - [When CoinGecko's 24 Hours Are Not Over](#when-coingeckos-24-hours-are-not-over)
  - [CoinPaprika](#coinpaprika)
    - [With a Key and Without One](#with-a-key-and-without-one)
    - [The Day That Holds the Time](#the-day-that-holds-the-time)
    - [CoinPaprika's Close From the Next Day](#coinpaprikas-close-from-the-next-day)
  - [When a Cell Gets No Price](#when-a-cell-gets-no-price)
  - [When a Past Price Stops Changing](#when-a-past-price-stops-changing)
  - [The Exchange Script's Settings](#the-exchange-scripts-settings)
- [4. Prices for a CSV File: crypto-price-filler](#4-prices-for-a-csv-file-crypto-price-filler)
  - [The Token and the Rows](#the-token-and-the-rows)
  - [The Order of the Filler's Sources](#the-order-of-the-fillers-sources)
    - [Moralis](#moralis)
    - [GeckoTerminal](#geckoterminal)
    - [MEXC, CoinGecko and CoinPaprika in the Filler](#mexc-coingecko-and-coinpaprika-in-the-filler)
  - [What a Row Gets](#what-a-row-gets)
  - [Backfill: Prices for the Rows No Service Priced](#backfill-prices-for-the-rows-no-service-priced)

## 1. Candles, Statuses and Cells

### Candles and Periods

Most of the services the scripts ask give a token's past prices as
candles. A candle sums up the trades of one market over one period, such
as a minute, an hour or a day, from its open time: the first price
(open), the highest (high), the lowest (low), the last (close), and how
much traded (volume). A period's candle is final once the period is
over. Until then it holds only the trades made so far, and a later trade
can change its high, its low and its close; so the past-price tools take
a price only from a period already over. Every period on this page is
one of UTC, Coordinated Universal Time.

### Http Statuses

A service answers each request with an http status: a number that says
how the request went, such as 200 when it went well, 429 when the
service refuses it as one too many, and 500 or above when the service
failed.

### When a Cell Runs

Sheets runs a cell's function when the cell's formula is entered or
edited, or when a cell the formula names changes, and at no other time.
A cell keeps showing the answer of its last run until then. The script
adds a menu to the spreadsheet, Crypto Price Fetchers, whose items run
cells again:

- Clean up errors runs again every cell, in every tab, that calls one of
  the scripts' functions and shows `#ERROR!` or a busy message.
- Refresh runs again every cell, in every tab, that asks for a price now
  (section 2), or calls a DEX Screener function.
- Refresh & freeze historical prices runs again every cell of the open
  tab that asks for a past price (section 3), then puts each number it
  gave in place of its formula
  ([When a Past Price Stops Changing](#when-a-past-price-stops-changing)).

So a price now is as old as its cell's last run, which can be far longer
ago than the times this page gives for keeping an answer; and a cell
that shows a message keeps it until its formula changes or a menu item
runs it again.

## 2. A Price Now: dexToolsGetTokenPrice and dexToolsGetTokenFDV

`dexToolsGetTokenPrice(chain, tokenAddress, [pool], [seconds])` gives a
token's price now in USD, and
`dexToolsGetTokenFDV(chain, tokenAddress, [pool], [seconds])` its fully
diluted value (FDV): its price times its total supply. Their script is
`crypto-price-fetchers/src/crypto-price-fetchers.gs`.

### The Service Asked

A decentralized exchange is a set of contracts on a blockchain in which
people swap one token for another. It has pools, each holding two tokens
that people swap for each other, and each pool has its own price. The
script asks one of two services that price tokens from such pools,
chosen by the chain the first argument names:

- DexTools, a service that prices tokens from the pools of decentralized
  exchanges on many chains, for each chain it lists, named as DexTools
  names it, such as `ether` for Ethereum or `pulse` for PulseChain.
- x1.ninja, a service that gives the prices of the pools of X1's
  decentralized exchanges, for X1, named `x1`, which DexTools does not
  list.

### The Pool Priced

The third argument can name one pool:

- With a pool, the script asks the service for that pool's price, and
  sends it the pool's address alone, never the token's. The cell gets
  the price the service gives for the pool, which is the price of one of
  the pool's two tokens, as the service picks it, whatever token the
  cell names: the token's address only shows a reader of the sheet what
  the cell is meant to price.
- Without a pool, DexTools gives the token's price from the pools it
  picks. x1.ninja answers only for a pool, so on X1 both functions need
  one.
- An FDV belongs to the token, so `dexToolsGetTokenFDV` sends DexTools no
  pool, whatever pool the cell names. On X1, it gives x1.ninja's FDV for
  the pool named, which x1.ninja gives as 0 for a pool whose base token is
  Wrapped XNT, the token form of XNT, X1's own coin.

### What a Price-Now Cell Shows

| The cell shows | When |
| --- | --- |
| A number, in USD | The service gave a price or FDV. |
| 0 | The service has no data for the token or pool, or refused the request with a status below 500. |
| `⌛ Rate limit / busy – retry soon` | Other cells kept the script busy for more than 20 seconds ([Taking Turns for a Price Now](#taking-turns-for-a-price-now)). |
| `⚠️ API error – check logs` | The request got no answer, the service failed with a status of 500 or above, or its answer could not be read. |
| `Cache seconds must be a whole number from 1 to 21600, not …` | The fourth argument is another value; the script asks nothing. |
| `#ERROR!` | Google stopped the call after 30 seconds. The request has no time limit of its own, so a slow answer after a long wait for the lock can take the call past 30 seconds. |

### How Long a Price Now Is Kept

The script keeps a number above 0 for 5 minutes, as the script is
written, or for the seconds the fourth argument gives, from 1 to 21600
(6 hours, the longest Apps Script's cache keeps a value). A cell that
asks the same within that time, of the same service, chain, pool (or
token, when it names no pool) and seconds, gets the kept number, and no
request is sent. The script keeps no 0 and no message, so a cell that
gave one asks again the next time it runs
([When a Cell Runs](#when-a-cell-runs)).

### Taking Turns for a Price Now

Sheets runs each cell's function as a call of its own, up to 30 at once.
Each call that asks a service takes the script's lock, which one call
holds at a time; waits until 0.7 seconds have passed since the script's
last request; sends its request; and gives the lock back. A call that
gets no lock within 20 seconds shows the busy message, so that it ends
within the 30 seconds Google gives a call. After the build step, this
script and the exchange script of section 3 are one Apps Script
project, and so share one lock: a price-now call waits behind a
`getCryptoPrice` call, which holds the lock for as long as it asks its
sources, up to most of the 25 seconds it allows itself
([The Time a Cell Has](#the-time-a-cell-has)), and the reverse.
`crypto-price-fetchers/config.json`, which the build step reads, may set
a shorter wait for the lock, and another number of seconds to keep a
number, in place of the 5 minutes above.

## 3. A Past Price: getCryptoPrice

`getCryptoPrice(token, dateStr, tz, mode)` gives a coin's price in USD at
a past time: a price of a short period around that time, from one of
three sources, which
[The Order of the Sheet's Sources](#the-order-of-the-sheets-sources)
describes: MEXC, a centralized exchange, and CoinGecko and CoinPaprika,
two services that gather the prices of many exchanges. Its script is in
`fetch-from-any-exchange/src/`:
`getCryptoPriceFromCentralizedExchange.gs`, with its price sources in
`getCryptoPriceFromCentralizedExchange-sources.gs`. The figures in this
section are those of the script as written; its settings file can change
some of them ([The Exchange Script's Settings](#the-exchange-scripts-settings)).

### What a Cell Asks For

- `token`: the coin's ticker symbol, such as `btc`, in any letter case.
- `dateStr`: the time, written `YYYY-MM-DD HH:MM:SS` on a 24-hour clock,
  or a cell that holds a date and time, read as the time the cell shows
  in the spreadsheet's time zone.
- `tz`: the time zone of that time, one of UTC, GMT, EST, EDT, CST, CDT,
  MST, MDT, PST and PDT; left empty, UTC. Each is one fixed offset from
  UTC, so the cell names the one in force at that time, such as CDT in
  summer and CST in winter for US Central time.
- `mode`: which price of the period to give: `average`, the average of
  its highest and lowest price, which is also what any other value, or
  none, means; `high`; `low`; or `close`, its last price.

### Before Any Source Is Asked

The script takes these steps, in order, before it asks any source:

1. A time zone it does not know, or a time not written as above or that
   the calendar does not have, gets a message that names the problem.
2. A time after now gets `No data available for future dates`.
3. An answer the script keeps for the same token, time, time zone and
   mode, kept by a build with the same order of priority and the same
   keys saved, is given again ([Answers the Script Keeps](#answers-the-script-keeps)).
4. The call waits its turn among the cells
   ([Waiting for Other Cells](#waiting-for-other-cells)).

#### Answers the Script Keeps

- A price, for 6 hours, the longest Apps Script's cache keeps a value.
- "No data", for 5 minutes, shown as `No data available (cached)`.
- The message that CoinPaprika needs a key, for 5 minutes
  ([With a Key and Without One](#with-a-key-and-without-one)).
- CoinGecko's answers, apart from the cell's: its price from the 24 hours
  around a time, by coin, time and mode, and its price of a day, by coin
  and date, each for 6 hours; and the lack of either, for 5 minutes,
  unless the request for it was cut short
  ([When a Cell Gets No Price](#when-a-cell-gets-no-price)). Another call
  that asks CoinGecko the same within that time takes the kept answer,
  and CoinGecko is not asked.

The script keeps no busy message and no "too recent" message: a cell
that showed one asks again the next time it runs
([When a Cell Runs](#when-a-cell-runs)).

#### Waiting for Other Cells

The script lets one call at a time ask the sources, with the script's
lock, which the price-now functions of section 2 take too, so the cells
a call waits for include theirs. A call tries for the lock up to three
times, for 2 seconds each,
and waits 5 seconds after the first failed try and 10 seconds after the
second. With the lock, it waits 0.2 seconds, then asks. A call that gets
no lock shows `Rate limit busy - retry later`.

#### The Time a Cell Has

Google stops a cell's call after 30 seconds, and the cell then shows
`#ERROR!`. So the script allows each call 25 seconds, its waits included:
a call does not start a wait, for the lock or for a source that refused
a request as one too many, that would take it past 25 seconds, and sends
no request once they are used.

### The Order of the Sheet's Sources

The script asks three sources, one after another, and gives the first
price one of them gives:

1. MEXC, a centralized exchange: a company that runs markets in which
   people trade coins, and publishes each market's candles. It takes no
   api key.
2. CoinGecko, a service that gathers the prices of many exchanges, and
   CoinPaprika, a service like CoinGecko, which each take an api key, one
   after the other in the order of priority the owner ranked their keys
   in (`npm run api-keys -- rank`), which the build step writes into the
   script as `CONFIG.API_KEY_PRIORITY`. Until the owner ranks them, and in
   the script as committed, CoinGecko comes first.

So a time's price comes from the highest-ranked source that has one: a
source ranked higher whose period for the time is not over makes the
cell say when to ask again rather than let a source ranked lower answer
([When CoinGecko's 24 Hours Are Not Over](#when-coingeckos-24-hours-are-not-over),
[The Day That Holds the Time](#the-day-that-holds-the-time)). A source
that needs a key no one saved for the price asked is passed over
([With a Key and Without One](#with-a-key-and-without-one)).

None of them is asked for the current price, which would put today's
price on a past date. Each prices a period around the time, a different
period for each source (below), and gives a price only once that period
is over.

Each source knows a coin by an id of its own. The script asks MEXC by the
ticker. It asks CoinGecko and CoinPaprika by the ids its list,
`TOKEN_TO_ID`, gives Bitcoin (btc), Monero (xmr), GridCoin (grc) and Tari
(xtm), such as `bitcoin` at CoinGecko and `btc-bitcoin` at CoinPaprika,
and by the ticker itself for any other coin. CoinGecko and CoinPaprika
name most coins by ids other than their tickers, so a coin missing from
that list gets a price from them only where its ticker is an id they
use.

The script passes over GridCoin at two sources by name: MEXC, which does
not list it, and CoinPaprika, which lists it as inactive, with no price.
So no message about MEXC's or CoinPaprika's periods, or about
CoinPaprika's key, ever comes for GridCoin.

### MEXC

#### The Market

MEXC prices a coin in its markets, called pairs, each of which trades
the coin for another. The script asks MEXC for its list of pairs, and
takes the coin's pair against USDT, a stablecoin: a token kept at one US
dollar, which the script takes at exactly $1. When MEXC lists no such
pair but one against Bitcoin, the script takes that one, and turns each
of its prices into USD with the candle of Bitcoin against USDT of the
same period: the pair's high times Bitcoin's high, its low times
Bitcoin's low, its close times Bitcoin's close, and its average times
Bitcoin's average; without that candle of Bitcoin, MEXC gives no price.
So a high or a low priced through Bitcoin can lie beyond any price the
coin traded at in USD. A coin with neither pair gets no price from MEXC.

#### The First Period: the Minute, or the Hour

The script asks first for the candle of the minute that holds the time.
MEXC keeps minute candles for about the last 30 days, so for an older
time it gives none, and the script asks for the hour that holds the time
instead ([When MEXC Has No Candle](#when-mexc-has-no-candle) gives the
step between the two for a recent time). When something traded in that
minute or hour, its candle gives the mode's price: the average of its
high and low, its high, its low or its close.

#### When Nothing Traded: Larger Periods

MEXC gives a candle for every period it keeps, and the candle of a
period in which nothing traded has a volume of 0. Then the script goes
up one period at a time, through the hour, 2 hours, 4 hours, day, week
(from Monday 00:00), month and year that hold the time. MEXC serves no
2-hour or yearly candle, so the script makes the 2 hours from their two
hour candles, and the year from its twelve month candles. The first of
these periods in which something traded gives the average of its high
and low, whatever the mode. When nothing traded in the year either, MEXC gives no
price.

#### When MEXC Has No Candle

MEXC gives no candle at all of a period before the pair's first trade,
which comes on the day MEXC listed the pair, nor of a period older than
the candles of its length that MEXC keeps. A larger period that holds a
time before the pair's first trade can hold only trades made after the
time, whose prices are not the coin's price at the time. So:

- When MEXC gives no candle of the minute of a time in the last 31 days,
  or of the hour, or when the request for either fails, the script asks
  for the candle of the day before the time's day. A candle of the day
  before shows the pair traded before that day: the script goes on, from
  the minute to the hour, or from the hour up to the 2 hours. With none,
  as on the day MEXC listed the pair or before it, or when that request
  fails too, MEXC gives no price.
- Higher up, the script passes over a period MEXC gives no candle of, or
  whose request fails, and goes on up, since the pair traded before the
  time. So a time older than the hour candles MEXC keeps gets the average
  of the first larger period MEXC keeps a candle of, with a trade in it,
  such as the 4 hours or the day, whatever the mode.
- But when MEXC answers that it keeps no candle at all of the day that
  holds the time, MEXC gives no price.

#### When MEXC's Period Is Not Over

- For a time in the minute not yet over, the cell says when to ask again:
  `Too recent for a final price: ask again after …`, naming the minute's
  end in UTC. The script checks this before it asks MEXC anything, for
  any coin but GridCoin, and then asks no later source.
- When the period the script would ask for next, the hour or a larger
  one, is not over, MEXC gives no price, and the next source answers.

### CoinGecko

#### The 24 Hours Around the Time

The script asks CoinGecko for its hourly prices from 12 hours before the
time to 12 hours after it, once those 24 hours are over, and gives the
average of the highest and the lowest of them, the highest, the lowest,
or, for close, the one nearest the time. CoinGecko says it may revise a
price for up to two days after its date, as later data settles.

#### CoinGecko's Close From the Next Day

When CoinGecko gives no price from those 24 hours, the script asks it,
for close only, for its price of the next day. CoinGecko records one
price a day, at 00:00 UTC, so the next day's is the price at the end of
the time's UTC day. CoinGecko serves it from 00:50 UTC that day, and the
script does not ask before then. One price is not a range, so for an
average, a high or a low the script goes on to CoinPaprika.

#### When CoinGecko's 24 Hours Are Not Over

The script then asks CoinGecko whether it has prices of the coin from 12
hours before the time to now:

- With some, the cell says `Too recent for a final price: ask again
  after …`, naming the end of the 24 hours, and the script asks no
  source ranked after CoinGecko.
- With none, as for a ticker that is no coin's id at CoinGecko, the
  script goes on to the next source.

When a request of the call was cut short before or during that check
([When a Cell Gets No Price](#when-a-cell-gets-no-price)), the cell shows
the busy message instead, and the script asks nothing more.

### CoinPaprika

#### With a Key and Without One

CoinPaprika keeps a candle of each day. Its free server, which the script
asks when no CoinPaprika key is saved, keeps a day's candle only for the
24 hours after the candle begins, and so none of a day already over. Its
paid server, which the script asks with the key of one of CoinPaprika's
paid plans, keeps them as far back as the plan reaches. So without a
key, the script asks CoinPaprika for close only, which it gets another
way ([CoinPaprika's Close From the Next Day](#coinpaprikas-close-from-the-next-day));
for an average, a high or a low, it passes CoinPaprika over and asks
the next source, and when no source gives a price, the cell says
`No data available from any source; CoinPaprika gives average, high and low only with an api key`.

#### The Day That Holds the Time

For close, or with a key, the script asks for the candle of the UTC day,
from 00:00 to 23:59:59, that holds the time, once that day is over, and
gives the average of its high and low, its high, its low or its close.
Before the day is over, the cell says
`Too recent for a final price: ask again after …`, naming the day's end,
midnight UTC, and the script asks CoinPaprika nothing, nor any source
ranked after it, so this message comes whether or not CoinPaprika has
the coin.

#### CoinPaprika's Close From the Next Day

When the plan does not reach the day's candle, as the free server's
never does for a day already over, or CoinPaprika gives no candle of the
day with that price, the script asks, for close only, for CoinPaprika's
price at 00:00 UTC of the next day, which is the price at the end of the
time's day. The free server keeps those prices for the last 365 days.
Any other answer, such as one for an id CoinPaprika does not know, gives
no price.

### When a Cell Gets No Price

| The cell shows | When |
| --- | --- |
| `No data available from any source` | No source had a price for the coin at that time. `No data available (cached)` repeats it for 5 minutes. |
| `No data available from any source; CoinPaprika gives average, high and low only with an api key` | No source had an average, a high or a low, and no CoinPaprika key is saved. |
| `Too recent for a final price: ask again after …` | A period that holds the time is not over: MEXC's minute, CoinGecko's 24 hours or CoinPaprika's day (above). |
| `Rate limit busy - retry later` | Other cells kept the call from its turn, or no source gave a price and a request of the call was cut short (below). |
| `No data available for future dates` | The time is after now. |
| `Unknown time zone …`, or a message that starts `Invalid` | The token, the time zone or the time cannot be read: a token that is not text gets `Invalid token: …`. |
| `Error: …` | The script itself failed; the message says why. |
| `#ERROR!` | Google stopped the call after 30 seconds. |

A request a source refuses as one too many (status 429) is sent again
after 5 seconds, and again after 5 more, three tries in all, while the
call has time for the wait. A request is cut short when it is refused as
one too many on its last try, or when the call has no time left to wait;
when it is answered with a server error (a status of 500 or above) or a
request timeout (408); when it gets no answer, as on a timeout or once
Apps Script's daily quota of requests is used up; or when the call has
no time left to send it. Such a request says nothing of whether the
source has a price. So when no source gives one, the cell shows the busy
message in place of `No data available from any source`, the "too
recent" messages of CoinGecko and CoinPaprika, and the message that
CoinPaprika needs a key; and the script keeps nothing, so the next run
asks again. Clean up errors, in the Crypto Price Fetchers menu, runs
again every cell that shows a busy message or `#ERROR!`
([When a Cell Runs](#when-a-cell-runs)).

### When a Past Price Stops Changing

Refresh & freeze historical prices, in the Crypto Price Fetchers menu,
runs again every cell of the open tab that calls `getCryptoPrice`, then
replaces each formula that gave a number with that number, so the
number no longer changes. A cell that gave a message keeps its formula.
A price comes from a period already over, but a later run can still
give another in these cases, which set when to freeze:

- CoinGecko may revise a price for up to two days after its date, and a
  close can come from CoinGecko's price of the next UTC day, which can
  then change until the fourth day after the time's UTC day begins. A
  cell may hold a price the script asked of CoinGecko up to 12 hours
  earlier, since the script keeps a cell's price for up to 6 hours and
  the prices CoinGecko gave it for up to 6 more. So freeze a cell only
  once its time is five days old, when the fourth day after the time's UTC
  day began at least a day before.
- A coin that traded nothing on MEXC in the 4 hours that hold a time in
  the first 12 hours of its UTC day, but traded at another time that day,
  takes CoinGecko's price once CoinGecko's 24 hours are over, until the
  UTC day is over and MEXC can give the day's average. The five days above
  cover this case too.
- A coin that traded nothing on MEXC in the UTC day that holds the time
  takes the next source's price until MEXC can give the average of a
  larger period that holds the time, each in UTC: the week, which MEXC
  counts from Monday 00:00, once it is over; or, when nothing traded in
  the week either, the month, once it and the week are over, since a week
  from Monday can end after its month or its year; or, when nothing
  traded in the month either, the year, once it and the week are over. A
  cell keeps the price it gave for up to 6 hours, so freeze such a cell
  only once that period and the week have been over 6 hours.
- Each source keeps the data a price comes from for a limited time: MEXC
  its minute candles for about 30 days, and its hour candles for longer;
  CoinPaprika's free server its daily prices for 365 days; and
  CoinGecko's and CoinPaprika's plans each reach back only so far.
  Refresh & freeze runs each cell again before it freezes it, so once a
  source no longer keeps a cell's data, the freeze keeps whatever that
  run gives:
  - for a price from MEXC's minute, the hour's
    ([The First Period: the Minute, or the Hour](#the-first-period-the-minute-or-the-hour));
  - for a high, low or close that MEXC gave as the hour's average because
    nothing traded in the minute
    ([When Nothing Traded: Larger Periods](#when-nothing-traded-larger-periods)),
    the hour's own high, low or close: without the minute's candle, the
    hour is the first period, which gives the mode's price
    ([The First Period: the Minute, or the Hour](#the-first-period-the-minute-or-the-hour));
  - for a price from MEXC's hour, or from its 2 hours, which the script
    makes from two hour candles, the average of the first larger period
    MEXC keeps a candle of, with a trade in it
    ([When MEXC Has No Candle](#when-mexc-has-no-candle));
  - for a close from a CoinPaprika candle its plan no longer reaches,
    CoinPaprika's price at 00:00 UTC of the next day
    ([CoinPaprika's Close From the Next Day](#coinpaprikas-close-from-the-next-day));
  - for a price from CoinGecko, CoinPaprika's, when it has one;
  - and, when no source has a price, no number, so the formula stays.

  So, to keep a price MEXC gave while it kept the candle of the time's
  minute, freeze the cell within about 30 days of its time. Refresh &
  freeze historical prices takes every `getCryptoPrice` cell of the open
  tab, with no choice among them, so keep a cell that waits for its week,
  month or year to be over in a tab apart from the cells to freeze within
  about 30 days of their times.

A request cut short during a run
([When a Cell Gets No Price](#when-a-cell-gets-no-price)) can leave a
cell with a later period's or a later source's price, such as the
hour's in place of the minute's. The script keeps that price for 6
hours, as it keeps any, so a freeze in that run, or in the 6 hours after
it, puts it in place of the formula.

### The Exchange Script's Settings

`fetch-from-any-exchange/config.json`, a settings file that git, the
version-control program that keeps the repo's history, leaves out of
that history, may change the figures this section gives. The build step writes its
values into the file pasted into a spreadsheet, and the Node version and
crypto-price-filler read it. It may set the quote currency of MEXC's
pairs, `QUOTE_CURRENCY`, to USDC in place of USDT, the stablecoin both
the coin's pair and the Bitcoin pair are then quoted in; the time zones
a cell may name; how long a price and "no data" are kept, on which the
freeze advice's 12 hours and five days rest; the waits; and the addresses
of the services. It may set no api key.

## 4. Prices for a CSV File: crypto-price-filler

crypto-price-filler, `bin/end-user/crypto-price-filler.js`, prices every
row of a CSV file for one token, each at the row's own time, and writes
the rows again with each one's price and its amount at that price. Its
code is in `fetch-from-any-exchange/crypto-price-filler/`, and its own
settings in that folder's `config.json`, laid over the
`config-example.json` beside it.

### The Token and the Rows

- The token must be one that the filler's list,
  `fetch-from-any-exchange/crypto-price-filler/supported-tokens.json`,
  names; the run refuses any other before it asks anything. The list
  gives each token's id at each source, and, for a token that trades in a
  blockchain's pools, its contract and its chain's ids at GeckoTerminal
  and Moralis, two services that price a token from its chain's pools
  ([The Order of the Filler's Sources](#the-order-of-the-fillers-sources)
  says more of each).
- Each row's time is in the date column: the first column whose name
  holds "date", in any letter case, and `UTC`, in capitals; or, when no
  name holds both, the first whose name holds "date". So of the columns
  `Date (local)` and `Date (UTC)`, the filler reads `Date (UTC)`. The
  time is written
  `YYYY-MM-DD HH:mm:ss`, and read in the time zone `--tz` names in full,
  such as `America/Chicago`, or in UTC, the default, with the offset the
  zone had at that time, daylight saving included.
- `--mode` names the price: `close`, the default, `high` or `low`.

### The Order of the Filler's Sources

For each row, the filler asks these sources in turn, and takes the first
price one gives:

- Moralis, for `--mode close`, for a token whose entry names its
  contract and Moralis's id for its chain, when a Moralis key is saved.
- GeckoTerminal, for a token whose entry names its contract and
  GeckoTerminal's id for its chain.
- MEXC, CoinGecko and CoinPaprika, the sources of `getCryptoPrice`,
  each under the id the token's entry names, and passed over when the
  entry names none, as HEX on PulseChain names none at MEXC.

Moralis, CoinGecko and CoinPaprika, which each take an api key, are asked
in the order of priority the owner ranked their keys in
(`npm run api-keys -- rank`). The two that take none go with their
family: GeckoTerminal right after Moralis, both of which read pools, and
MEXC right before the first of CoinGecko and CoinPaprika, as in
`getCryptoPrice`. The rule is the Sheets script's own
(`sourcesInPriority`), which the filler runs through the script's Node
version, so a coin a sheet and the filler both price is asked of the same
sources in the same order. Until the owner ranks the keys, Moralis comes
first, so the order is the one in the list above.

A saved key is checked before any row is priced: a key its service
refuses, or a password that does not open the keys, stops the run, and
does not pass that service over.

A run keeps each price it finds for the rest of the run, and gives it
again to a row of the same token, time and mode without asking.

#### Moralis

Moralis, a service that prices tokens from the pools of decentralized
exchanges and takes an api key, gives a token's price at a block of its
chain. The filler asks Moralis for the block the chain had at the row's
time, then for the token's price in USD at that block. One price is not
a range, so Moralis answers close only; for a high or a low, the filler
asks GeckoTerminal and the sources after it.

#### GeckoTerminal

GeckoTerminal, a service that lists the pools of decentralized exchanges
with their prices and candles, gives a pool's candles of each minute and
hour:

- The pool: of the first pools GeckoTerminal lists for the token, 10 by
  default (`GECKOTERMINAL_TOP_POOLS_CONSIDERED`), the filler takes the
  one that holds the most value in USD among those that traded in the
  last 24 hours and hold the token, as LP Ranger, the owner's bot that
  manages his liquidity positions, picks a pool. It picks the pool once a
  run, from the pools as they stand when it runs, and prices every row
  from that pool.
- The candle: that of the minute that holds the row's time, or, when
  nothing traded in that minute, so that GeckoTerminal made no candle of
  it, that of the hour that holds it. The candle gives its high, low or
  close, in USD. When nothing traded in that hour either, GeckoTerminal
  gives no price.
- While the minute, or the hour the filler would ask for, is not over,
  GeckoTerminal gives no price.
- GeckoTerminal's public api answers a request only when the time it
  asks back from is within about the last 180 days, and the filler asks
  back from the end of the row's minute or hour, so a row older than
  that gets no price from it.

#### MEXC, CoinGecko and CoinPaprika in the Filler

The filler runs the Sheets script's three sources, unchanged, so each
prices the same period by the same rules as in `getCryptoPrice`
([MEXC](#mexc), [CoinGecko](#coingecko), [CoinPaprika](#coinpaprika)),
with these differences:

- No source gives a message. A source whose period is not over gives no
  price, as does one whose request failed, and the filler asks the next.
  So when MEXC has no price for a time less than 12 hours ago in a UTC
  day already over, a row takes CoinPaprika's price of that day, for
  close or with a CoinPaprika key, where a cell says to ask again once
  CoinGecko's 24 hours are over.
- Without a CoinPaprika key, a run with `--mode high` or `--mode low`,
  for a token with a CoinPaprika id, says that CoinPaprika can give
  neither, and asks, before it prices anything, whether to go on without
  CoinPaprika's prices. y or yes goes on, and a row no other source
  prices gets `Error`; Enter, n or no, or an input that ends with no
  answer, stops the run with exit code 1, before any price is asked for;
  any other answer asks again.
- No lock and no 25-second limit apply: those are for cells.

### What a Row Gets

- A row with a price gets it in `$usd price`. When the row has an amount,
  in the first column whose name holds "amount", it gets that amount
  times the price in `$usd amount`, to eight decimal places, and the running
  total of those in `grand total ($usd)`, to six.
- A row that no source priced, or whose time is after now or cannot be
  read, gets `Error` as its price.
- A row that holds no data, such as a "Total" row, a row with no date or
  a row after the last date the filler can read, gets a blank price, and
  stays out of the total.

### Backfill: Prices for the Rows No Service Priced

Backfill gives each row marked `Error` a price from the rows around it,
asking no service. A run of the filler backfills at its end with
`--backfill-highest` or `--backfill-lowest`, or with `BACKFILL_HIGHEST`
or `BACKFILL_LOWEST` in the filler's `config.json` when neither flag is
typed. The backfill program, `bin/end-user/backfill.js`, does the same to
a file a run wrote. The two can never be on together.

1. Backfill finds each run of consecutive rows marked `Error`.
2. It takes the price of the nearest priced row before them and of the
   nearest after them, stepping past rows with a blank price.
3. It gives each of those rows the higher of the two prices
   (`--backfill-highest`) or the lower (`--backfill-lowest`), or, with a
   priced row on one side only, as at the start or the end of the file,
   that row's price. With a priced row on neither side, the rows keep
   `Error`.
4. It works out each row's `$usd amount` and the running total again.

A backfilled price is a neighbouring row's price, not a price at the
row's own time. The filler's help suggests the higher for tax estimates,
since it gives the higher income, and the lower for budgeting.
