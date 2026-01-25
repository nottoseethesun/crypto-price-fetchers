/**
 * Progress bar utility for Crypto Price Filler
 * @module utils/progress
 * @description Provides progress bar functionality for long-running price fetch jobs.
 * Shows progress by default in non-verbose mode; disabled in test environments.
 * @version 1.0.0
 * @author Christopher M. Balz with Grok and Claude.ai
 */

import cliProgress from 'cli-progress';

/**
 * Determines if progress bar should be shown based on environment
 * @param {boolean} verbose - Whether verbose mode is enabled
 * @returns {boolean} True if progress bar should be displayed
 */
export function shouldShowProgressBar(verbose) {
  const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.VITEST;
  return !verbose && !isTestEnv;
}

/**
 * Creates a real CLI progress bar instance
 * @param {number} total - Total number of items to process
 * @param {Object} [options={}] - Optional configuration overrides
 * @returns {Object} Progress bar with start, increment, update, stop, getProgress methods
 */
export function createProgressBar(total, options = {}) {
  const bar = new cliProgress.SingleBar({
    format: options.format || 'Fetching prices |{bar}| {percentage}% | {value}/{total} rows | ETA: {eta_formatted}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    ...options
  });

  let current = 0;

  return {
    start: () => {
      current = 0;
      bar.start(total, 0);
    },
    increment: () => {
      current++;
      bar.increment();
    },
    update: (value) => {
      current = value;
      bar.update(value);
    },
    stop: () => {
      bar.stop();
    },
    getProgress: () => ({ current, total }),
    getPercentage: () => total > 0 ? Math.round((current / total) * 100) : 0
  };
}

/**
 * Creates a no-op progress bar for testing or verbose mode.
 * Has the same interface as createProgressBar but produces no terminal output.
 * Tracks progress internally for testing verification.
 * @param {number} total - Total number of items to process
 * @returns {Object} No-op progress bar with same interface as real progress bar
 */
export function createNoOpProgressBar(total) {
  let current = 0;
  let started = false;
  let stopped = false;

  return {
    start: () => {
      current = 0;
      started = true;
      stopped = false;
    },
    increment: () => {
      if (started && !stopped) {
        current++;
      }
    },
    update: (value) => {
      if (started && !stopped) {
        current = value;
      }
    },
    stop: () => {
      stopped = true;
    },
    getProgress: () => ({ current, total }),
    getPercentage: () => total > 0 ? Math.round((current / total) * 100) : 0,
    // Additional methods for testing
    isStarted: () => started,
    isStopped: () => stopped
  };
}

/**
 * Factory function that returns the appropriate progress bar based on environment
 * @param {number} total - Total number of items to process
 * @param {boolean} verbose - Whether verbose mode is enabled
 * @param {Object} [options={}] - Optional configuration overrides
 * @returns {Object} Progress bar instance (real or no-op)
 */
export function getProgressBar(total, verbose, options = {}) {
  if (shouldShowProgressBar(verbose)) {
    return createProgressBar(total, options);
  }
  return createNoOpProgressBar(total);
}
