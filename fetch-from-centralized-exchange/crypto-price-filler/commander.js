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

import { InvalidArgumentError, program } from "commander";
import { canonicalTimeZone, validTimeZones } from "./utils/date.js";
import { readSupportedTokens } from "./supported-tokens.js";

/**
 * Accepts a time zone named in full, such as America/Chicago, or UTC, in
 * any letter case, and refuses anything else, an abbreviation such as CDT
 * included, pointing to --list-valid-timezones.
 *
 * @param {string} value - The option's value
 * @returns {string} The zone, as the list of valid zones spells it
 * @throws {InvalidArgumentError} When it is not a valid zone
 */
export function parseTimeZone(value) {
  const zone = canonicalTimeZone(value);
  if (zone !== null) return zone;
  throw new InvalidArgumentError(
    `not a valid time zone: ${value}. Name it in full, such as America/Chicago, or UTC. ` +
      "Run with --list-valid-timezones to see every valid one.",
  );
}

/**
 * Loads the supported token symbols from supported-tokens.json.
 * @returns {Object} The tokens object keyed by lowercase symbol
 */
function loadSupportedTokens() {
  return readSupportedTokens().tokens ?? {};
}

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
    .name("crypto-price-filler")
    .description(
      "Fetch historical crypto prices from centralized exchanges and fill CSV with USD values",
    )
    .version("1.0.0", "-v, --version", "output the version number")

    // Required options
    .requiredOption(
      "--token <symbol>",
      "Crypto token symbol (e.g. grc, xtm, btc)",
      (value) => {
        const symbol = value.toLowerCase();
        const tokens = loadSupportedTokens();
        if (!tokens[symbol]) {
          const supported = Object.entries(tokens)
            .map(([sym, cfg]) => `  ${sym}\t${cfg.name}`)
            .join("\n");
          console.error(`\nError: Unknown token symbol "${value}".`);
          console.error(`\nSupported tokens:\n${supported}`);
          console.error(
            `\nTo add a new token, edit supported-tokens.json. See --help for details.`,
          );
          process.exit(1);
        }
        return symbol;
      },
    )
    .requiredOption(
      "--input <path>",
      'Path to input CSV file (must contain "date (UTC)" column in format yyyy-MM-dd HH:mm:ss)',
    )

    // Optional options with defaults
    .option("--output <path>", "Path to output CSV file", "output.csv")
    .option(
      "--mode <mode>",
      "Price target to fetch: high, low, or close",
      (value) => {
        const valid = ["high", "low", "close"];
        if (!valid.includes(value.toLowerCase())) {
          throw new Error(`--mode must be one of: high, low, close`);
        }
        return value.toLowerCase();
      },
      "close",
    )
    .option(
      "--tz <zone>",
      "Time zone the input dates are in, named in full (e.g. America/Chicago) or UTC; " +
        "each row gets the offset the zone had then, daylight saving included. " +
        "Abbreviations such as CDT are refused.",
      parseTimeZone,
      "UTC",
    )
    .option(
      "--list-valid-timezones",
      "Print every name --tz takes, one per line, and exit",
    )
    .option("--verbose", "Enable detailed logging during processing", false)
    .option(
      "--backfill-highest",
      "Fill empty prices with highest bracketing price (conservative tax estimates)",
      false,
    )
    .option(
      "--backfill-lowest",
      "Fill empty prices with lowest bracketing price (budgeting: avoid over-estimating income)",
      false,
    )

    // Custom help formatting
    .addHelpText(
      "after",
      `
Examples:
  Basic usage:
    $ node index.js --token=grc --input=mining.csv

  Full options:
    $ node index.js --token=xtm --input=input.csv --output=prices.csv --mode=high --tz=America/Chicago --verbose

  Backfill empty prices (conservative tax estimates - use higher bracketing price):
    $ node index.js --token=grc --input=mining.csv --backfill-highest

  Backfill empty prices (budgeting - use lower bracketing price):
    $ node index.js --token=grc --input=mining.csv --backfill-lowest

  Show help:
    $ node index.js --help

Exit codes:
  0  the output file was written; a row no service priced is left empty
  1  it was not: an option was wrong or missing, the input has no date
     column, the api keys could not be opened, or a step failed
`,
    )

    // Make --help more visible
    .helpOption("-h, --help", "display help for command");

  // --list-valid-timezones works on its own, as --help does: it prints the
  // list while the options are parsed, before the required ones are checked.
  program.on("option:list-valid-timezones", () => {
    console.log(validTimeZones().join("\n"));
    process.exit(0);
  });

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
