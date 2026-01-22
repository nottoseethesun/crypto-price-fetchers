/**
 * @file commander.js
 * @module commander
 * @description
 * Centralized Commander.js CLI configuration for crypto-price-filler.
 *
 * This module defines the CLI interface using the commander library.
 * It handles argument parsing, validation, help text, and version display.
 *
 * Main exports:
 * - {@link setupCommander} → returns configured program instance
 * - {@link parseArgs}      → parses process.argv and returns options object
 *
 * Usage in index.js (recommended):
 * ```js
 * import { parseArgs } from './commander.js';
 *
 * const options = parseArgs();
 * // then use options.token, options.input, etc.
 * ```
 *
 * @example
 * node index.js --help
 * node index.js --token=grc --input=mining.csv --output=prices.csv --verbose
 *
 * @requires commander
 * @version 1.0.0
 * @author Your Name / Project Maintainer
 * @license MIT (or your project's license)
 */

import { program } from 'commander';

/**
 * Configures and returns the Commander program instance.
 *
 * This function defines:
 * - program name, description, version
 * - all required & optional options
 * - custom help text & examples
 *
 * @returns {import('commander').Command} Configured Commander program
 */
export function setupCommander() {
    program
        .name('crypto-price-filler')
        .description('Fetch historical crypto prices from centralized exchanges and fill CSV with USD values')
        .version('1.0.0', '-v, --version', 'output the version number')

        // Required options
        .requiredOption(
            '--token <symbol>',
            'Crypto token symbol (e.g. grc, xtm, btc)',
            (value) => value.toLowerCase()
        )
        .requiredOption(
            '--input <path>',
            'Path to input CSV file (must contain "date (UTC)" column in format yyyy-MM-dd HH:mm:ss)'
        )

        // Optional options with defaults
        .option(
            '--output <path>',
            'Path to output CSV file',
            'output.csv'
        )
        .option(
            '--mode <mode>',
            'Price target to fetch: high, low, or close',
            (value) => {
                const valid = ['high', 'low', 'close'];
                if (!valid.includes(value.toLowerCase())) {
                    throw new Error(`--mode must be one of: high, low, close`);
                }
                return value.toLowerCase();
            },
            'close'
        )
        .option(
            '--tz <timezone>',
            'Timezone abbreviation for date parsing (e.g. UTC, CDT, PST)',
            'UTC'
        )
        .option(
            '--verbose',
            'Enable detailed logging during processing',
            false
        )

        // Custom help formatting
        .addHelpText('after', `
Examples:
  Basic usage:
    $ node index.js --token=grc --input=mining.csv

  Full options:
    $ node index.js --token=xtm --input=input.csv --output=prices.csv --mode=high --tz=CDT --verbose

  Show help:
    $ node index.js --help
    `)

        // Make --help more visible
        .helpOption('-h, --help', 'display help for command');

    return program;
}

/**
 * Parses process.argv using the configured Commander program and returns the options object.
 *
 * Automatically handles:
 * - --help / -h → prints help and exits 0
 * - missing required options → prints error + help and exits 1
 * - invalid values → throws error (Commander validation)
 *
 * @returns {Object} Parsed options (e.g. { token: 'grc', input: '...', output: 'output.csv', ... })
 * @throws {Error} If parsing fails (Commander already prints error + exits in most cases)
 */
export function parseArgs() {
    const cmd = setupCommander();
    cmd.parse(process.argv);
    return cmd.opts();
}

// Optional: export the program itself for advanced testing / extension
export { program };
