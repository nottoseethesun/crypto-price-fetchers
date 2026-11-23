/**
 * Backfill utility functions for Crypto Price Filler
 * @module utils/backfill
 * @description Shared backfill logic used by both index.js and backfill.js.
 * Provides functions to fill the prices index.js could not find, marked
 * "Error", using bracketing prices. index.js leaves the price blank on
 * purpose for the rows that hold no data (a "Total" row, a row with no
 * date, the rows after the last date), so a blank price is never filled,
 * and those rows stay out of the grand total.
 * @version 1.0.0
 * @author Christopher M. Balz with Claude.ai
 */

import { logv } from "./log.js";

/**
 * Whether to backfill with the higher or the lower bracketing price: a
 * flag given on the command line, else config.json's setting. The flags
 * only turn backfill on, so each is true when its flag is given or its
 * setting is true; when both are, the higher price is used.
 *
 * @param {{backfillHighest?: boolean, backfillLowest?: boolean}} options - The options, as commander parsed them
 * @param {{BACKFILL_HIGHEST?: boolean, BACKFILL_LOWEST?: boolean}} config - The settings, as `loadConfig` read them
 * @returns {{highest: boolean, lowest: boolean}} Whether each is on
 */
export function backfillChoice(options, config) {
  return {
    highest:
      options.backfillHighest === true || config.BACKFILL_HIGHEST === true,
    lowest: options.backfillLowest === true || config.BACKFILL_LOWEST === true,
  };
}

/**
 * Checks whether a price is one index.js could not find: "Error". A blank
 * price marks a row that holds no data, which backfill leaves as it is.
 * @param {*} price - The price value to check
 * @returns {boolean} True if the price is "Error"
 */
export function isPriceEmpty(price) {
  return price === "Error";
}

/**
 * Finds the bracketing prices around a block of Error prices: the price of
 * the nearest priced row before the block and after it, stepping past any
 * row with no price, such as a blank row that holds no data or another
 * Error.
 * @param {Array<Object>} rows - Array of row objects
 * @param {number} blockStart - Start index of the block
 * @param {number} blockEnd - End index of the block (exclusive)
 * @param {string} priceColName - Name of the price column
 * @returns {Object} Object with leftPrice and rightPrice (or null if not found)
 */
export function findBracketingPrices(rows, blockStart, blockEnd, priceColName) {
  const priceAt = (index) => {
    const price = parseFloat(rows[index][priceColName]);
    return Number.isFinite(price) ? price : null;
  };
  let leftPrice = null;
  for (let i = blockStart - 1; i >= 0 && leftPrice === null; i--)
    leftPrice = priceAt(i);
  let rightPrice = null;
  for (let i = blockEnd; i < rows.length && rightPrice === null; i++)
    rightPrice = priceAt(i);
  return { leftPrice, rightPrice };
}

/**
 * Determines the fill price based on bracketing prices and mode.
 * @param {number|null} leftPrice - Price before the empty block
 * @param {number|null} rightPrice - Price after the empty block
 * @param {boolean} useHighest - If true, use max; if false, use min
 * @returns {number|null} The price to use for filling, or null if no valid price
 */
export function determineFillPrice(leftPrice, rightPrice, useHighest) {
  if (leftPrice !== null && rightPrice !== null) {
    return useHighest
      ? Math.max(leftPrice, rightPrice)
      : Math.min(leftPrice, rightPrice);
  }
  return leftPrice ?? rightPrice;
}

/**
 * Fills a block of empty rows with the specified price.
 * @param {Array<Object>} rows - Array of row objects
 * @param {number} blockStart - Start index of block to fill
 * @param {number} blockEnd - End index of block (exclusive)
 * @param {string} priceColName - Name of the price column
 * @param {number} fillPrice - Price to fill with
 * @returns {number} Number of rows filled
 */
export function fillBlock(rows, blockStart, blockEnd, priceColName, fillPrice) {
  let filled = 0;
  for (let j = blockStart; j < blockEnd; j++) {
    rows[j][priceColName] = fillPrice;
    filled++;
  }
  return filled;
}

/**
 * Recalculates USD amounts and grand totals for all rows.
 * @param {Array<Object>} rows - Array of row objects to process (mutated in place)
 * @param {string} priceColName - Name of the price column
 * @param {string} amountColName - Name of the amount column
 * @param {string} usdAmountColName - Name of the USD amount column
 * @param {string} grandTotalColName - Name of the grand total column
 */
export function recalculateTotals(
  rows,
  priceColName,
  amountColName,
  usdAmountColName,
  grandTotalColName,
) {
  let grandTotalUsd = 0;
  for (const row of rows) {
    const price = parseFloat(row[priceColName]);
    const amount = parseFloat((row[amountColName] ?? "").trim());
    if (!isNaN(price) && !isNaN(amount)) {
      const usdAmount = amount * price;
      row[usdAmountColName] = usdAmount.toFixed(8);
      grandTotalUsd += usdAmount;
    }
    row[grandTotalColName] = grandTotalUsd.toFixed(6);
  }
}

/**
 * Backfills empty price rows using bracketing prices.
 * Empty prices are filled with either the highest or lowest of the surrounding valid prices.
 * Also recalculates USD amounts and grand totals after backfilling.
 *
 * @param {Array<Object>} rows - Array of row objects to process (mutated in place)
 * @param {Object} options - Configuration options
 * @param {string} options.priceColName - Name of the price column
 * @param {string} options.amountColName - Name of the amount column
 * @param {string} options.usdAmountColName - Name of the USD amount column
 * @param {string} options.grandTotalColName - Name of the grand total column
 * @param {boolean} options.useHighest - If true, use highest bracketing price; if false, use lowest
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @returns {Object} Statistics about the backfill operation
 */
export function backfillPrices(rows, options) {
  const {
    priceColName,
    amountColName,
    usdAmountColName,
    grandTotalColName,
    useHighest,
    verbose = false,
  } = options;

  const stats = {
    totalRows: rows.length,
    emptyRowsFilled: 0,
    blocksFound: 0,
  };

  let i = 0;
  while (i < rows.length) {
    if (isPriceEmpty(rows[i][priceColName])) {
      const blockStart = i;
      while (i < rows.length && isPriceEmpty(rows[i][priceColName])) i++;
      const blockEnd = i;

      stats.blocksFound++;

      const { leftPrice, rightPrice } = findBracketingPrices(
        rows,
        blockStart,
        blockEnd,
        priceColName,
      );
      const fillPrice = determineFillPrice(leftPrice, rightPrice, useHighest);

      if (fillPrice !== null) {
        logv(
          verbose,
          1,
          `Backfilling rows ${blockStart + 1}-${blockEnd} with price ${fillPrice}`,
        );
        stats.emptyRowsFilled += fillBlock(
          rows,
          blockStart,
          blockEnd,
          priceColName,
          fillPrice,
        );
      }
    } else {
      i++;
    }
  }

  recalculateTotals(
    rows,
    priceColName,
    amountColName,
    usdAmountColName,
    grandTotalColName,
  );

  return stats;
}

/**
 * Default column names used in the CSV files.
 * @type {Object}
 */
export const DEFAULT_COLUMNS = {
  price: "$usd price",
  amount: "amount",
  usdAmount: "$usd amount",
  grandTotal: "grand total ($usd)",
};
