/**
 * Backfill utility functions for Crypto Price Filler
 * @module utils/backfill
 * @description Shared backfill logic used by both index.js and backfill.js.
 * Provides functions to fill empty/error price values using bracketing prices.
 * @version 1.0.0
 * @author Christopher M. Balz with Claude.ai
 */

/**
 * Verbosity-aware logger function.
 * @param {boolean} shouldLog - Whether logging is enabled
 * @param {number} level - Log level (1 = basic, 2+ = more detail)
 * @param {string} message - Message to log
 * @param {...*} args - Additional arguments to log
 */
export function logv(shouldLog, level, message, ...args) {
  if (!shouldLog || level < 1) return;
  console.log(`[VERBOSE:${level}] ${message}`, ...args);
}

/**
 * Checks if a price value should be considered empty/missing.
 * @param {*} price - The price value to check
 * @returns {boolean} True if the price is empty, 'Error', or missing
 */
export function isPriceEmpty(price) {
  return price === '' || price === 'Error' || price === null || price === undefined;
}

/**
 * Finds the bracketing prices around an empty block.
 * @param {Array<Object>} rows - Array of row objects
 * @param {number} blockStart - Start index of empty block
 * @param {number} blockEnd - End index of empty block (exclusive)
 * @param {string} priceColName - Name of the price column
 * @returns {Object} Object with leftPrice and rightPrice (or null if not found)
 */
export function findBracketingPrices(rows, blockStart, blockEnd, priceColName) {
  let leftPrice = blockStart > 0 ? parseFloat(rows[blockStart - 1][priceColName]) : null;
  let rightPrice = blockEnd < rows.length ? parseFloat(rows[blockEnd][priceColName]) : null;

  if (isNaN(leftPrice)) leftPrice = null;
  if (isNaN(rightPrice)) rightPrice = null;

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
    return useHighest ? Math.max(leftPrice, rightPrice) : Math.min(leftPrice, rightPrice);
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
export function recalculateTotals(rows, priceColName, amountColName, usdAmountColName, grandTotalColName) {
  let grandTotalUsd = 0;
  for (const row of rows) {
    const price = parseFloat(row[priceColName]);
    const amount = parseFloat((row[amountColName] || '').trim());
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
    verbose = false
  } = options;

  const stats = {
    totalRows: rows.length,
    emptyRowsFilled: 0,
    blocksFound: 0
  };

  let i = 0;
  while (i < rows.length) {
    if (isPriceEmpty(rows[i][priceColName])) {
      const blockStart = i;
      while (i < rows.length && isPriceEmpty(rows[i][priceColName])) i++;
      const blockEnd = i;

      stats.blocksFound++;

      const { leftPrice, rightPrice } = findBracketingPrices(rows, blockStart, blockEnd, priceColName);
      const fillPrice = determineFillPrice(leftPrice, rightPrice, useHighest);

      if (fillPrice !== null) {
        logv(verbose, 1, `Backfilling rows ${blockStart + 1}-${blockEnd} with price ${fillPrice}`);
        stats.emptyRowsFilled += fillBlock(rows, blockStart, blockEnd, priceColName, fillPrice);
      }
    } else {
      i++;
    }
  }

  recalculateTotals(rows, priceColName, amountColName, usdAmountColName, grandTotalColName);

  return stats;
}

/**
 * Default column names used in the CSV files.
 * @type {Object}
 */
export const DEFAULT_COLUMNS = {
  price: '$usd price',
  amount: 'amount',
  usdAmount: '$usd amount',
  grandTotal: 'grand total ($usd)'
};
