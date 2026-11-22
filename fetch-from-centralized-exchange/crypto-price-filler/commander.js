/**
 * crypto-price-filler's command line, declared with commander: its
 * options, each checked as it is parsed, and its help.
 * @module commander
 *
 * `setupCommander` builds the command anew for each parse, so a test can
 * parse several argument lists. A mistake in an option names the option,
 * on stderr, and stops the run, with exit code 1, before any price is asked
 * for: a token supported-tokens.json does not list (the message lists the
 * ones it does), a mode other than high, low or close, or a time zone not
 * named in full. `--list-valid-timezones` prints every zone `--tz` takes and
 * exits, as `--help` does. The backfill flags take no default, so a flag
 * not given leaves config.json's setting to decide (`backfillChoice`, in
 * `utils/backfill.js`). `parseArgs` parses the process's arguments.
 */

import { Command, InvalidArgumentError } from "commander";
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

/** The prices a row can take from its candle. */
const PRICE_TARGETS = Object.freeze(["high", "low", "close"]);

/**
 * Loads the supported token symbols from supported-tokens.json.
 * @returns {Object} The tokens object keyed by lowercase symbol
 */
function loadSupportedTokens() {
  return readSupportedTokens().tokens ?? {};
}

/**
 * Checks a token's symbol, as commander parses it.
 *
 * @param {string} value - The symbol typed, in any case
 * @returns {string} The symbol, in lower case
 * @throws {InvalidArgumentError} When supported-tokens.json does not list it, naming the ones it does
 */
export function tokenSymbol(value) {
  const symbol = value.toLowerCase();
  const tokens = loadSupportedTokens();
  if (Object.hasOwn(tokens, symbol)) return symbol;
  const supported = Object.entries(tokens)
    .map(([sym, cfg]) => `  ${sym}\t${cfg.name}`)
    .join("\n");
  throw new InvalidArgumentError(
    `Unknown token symbol "${value}".\n\nSupported tokens:\n${supported}\n\n` +
      "To add a new token, edit supported-tokens.json. See --help for details.",
  );
}

/**
 * Checks the price a row takes from its candle, as commander parses it.
 *
 * @param {string} value - The price typed, in any case
 * @returns {string} high, low or close
 * @throws {InvalidArgumentError} When it is none of them
 */
export function priceTarget(value) {
  const target = value.toLowerCase();
  if (PRICE_TARGETS.includes(target)) return target;
  throw new InvalidArgumentError("Give high, low or close.");
}

/**
 * Builds the command line.
 *
 * @returns {import('commander').Command} The command
 */
export function setupCommander() {
  const command = new Command()
    .name("crypto-price-filler")
    .description(
      "Fetch historical crypto prices from centralized exchanges and fill CSV with USD values",
    )
    .version("1.0.0", "-v, --version", "output the version number")

    // Required options
    .requiredOption(
      "--token <symbol>",
      "Crypto token symbol (e.g. grc, xtm, btc)",
      tokenSymbol,
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
      priceTarget,
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
    .option("--verbose", "Enable detailed logging during processing")
    .option(
      "--backfill-highest",
      "Fill each Error price with the highest bracketing price (conservative tax estimates); config.json's BACKFILL_HIGHEST when not given",
    )
    .option(
      "--backfill-lowest",
      "Fill each Error price with the lowest bracketing price (budgeting: avoid over-estimating income); config.json's BACKFILL_LOWEST when not given",
    )

    // Custom help formatting
    .addHelpText(
      "after",
      `
Examples:
  Basic usage:
    $ node bin/crypto-price-filler.js --token=grc --input=mining.csv

  Full options:
    $ node bin/crypto-price-filler.js --token=xtm --input=input.csv --output=prices.csv --mode=high --tz=America/Chicago --verbose

  Backfill the Error prices (conservative tax estimates - use higher bracketing price):
    $ node bin/crypto-price-filler.js --token=grc --input=mining.csv --backfill-highest

  Backfill the Error prices (budgeting - use lower bracketing price):
    $ node bin/crypto-price-filler.js --token=grc --input=mining.csv --backfill-lowest

  Show help:
    $ node bin/crypto-price-filler.js --help

Exit codes:
  0  the output file was written; a row no service priced gets Error in
     its $usd price, unless a --backfill flag or config.json filled it
  1  it was not: an option was wrong or missing, the input file was not
     found, or has no rows or no date column, the api keys could not be
     opened, or a step failed
`,
    )

    // Make --help more visible
    .helpOption("-h, --help", "display help for command");

  // --list-valid-timezones works on its own, as --help does: it prints the
  // list while the options are parsed, before the required ones are checked.
  command.on("option:list-valid-timezones", () => {
    console.log(validTimeZones().join("\n"));
    process.exit(0);
  });

  return command;
}

/**
 * Parses the process's arguments with the command line. `--help` and
 * `--list-valid-timezones` print and exit with 0; a mistake prints its
 * message and exits with 1.
 *
 * @param {string[]} [argv=process.argv] - The arguments, as process.argv holds them
 * @returns {Object} The options, such as { token: 'grc', input: '...', output: 'output.csv' }
 */
export function parseArgs(argv = process.argv) {
  return setupCommander().parse(argv).opts();
}
