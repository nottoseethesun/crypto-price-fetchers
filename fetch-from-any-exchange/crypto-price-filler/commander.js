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
 * named in full. `--list-valid-timezones` prints every zone `--tz` takes,
 * each by the name Node's list of time zones spells, and exits, as
 * `--help` does. The two backfill flags conflict, so commander refuses
 * them typed together; they take no default here, since config.json is
 * read after the parse, so that `--help` answers whatever it holds, and
 * `takeBackfillSettings`, in `utils/backfill.js`, then lays its two
 * settings under them and refuses a flag typed against the other's
 * setting. With no `--output`, the tool writes `output.csv` in its own
 * folder's `output/csv/` (`DEFAULT_OUTPUT`), wherever it runs, where git
 * keeps nothing but the folder. `parseCommandLine` parses the process's
 * arguments.
 */

import { fileURLToPath } from "url";
import { Command, InvalidArgumentError, Option } from "commander";
import { canonicalTimeZone, validTimeZones } from "./utils/date.js";
import { readSupportedTokens } from "./supported-tokens.js";
import { fileToWriteArgument } from "../../lib/file-to-write.js";

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
      "Run with --list-valid-timezones to see every zone it takes.",
  );
}

/**
 * The file the tool writes when no `--output` is given: `output.csv` in
 * the `output/csv/` folder beside this file, which git ignores but for its
 * `.gitkeep`, the empty file that keeps the folder in the repo.
 */
export const DEFAULT_OUTPUT = fileURLToPath(
  new URL("./output/csv/output.csv", import.meta.url),
);

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
      "Fill a CSV file's USD price columns with a token's price at each row's time: " +
        "from the pools a pool token trades in (Moralis, then GeckoTerminal), " +
        "and from MEXC, CoinGecko and CoinPaprika",
    )
    .version("1.0.0", "-v, --version", "output the version number")
    .allowExcessArguments(false)

    // Required options
    .requiredOption(
      "--token <symbol>",
      "Crypto token symbol (required), e.g. grc, xtm or btc",
      tokenSymbol,
    )
    .requiredOption(
      "--input <path>",
      "Path to input CSV file, with a column of dates written yyyy-MM-dd HH:mm:ss and read in --tz: " +
        'the first whose name holds "date" and "UTC", or else the first whose name holds "date" (required)',
    )

    // Optional options with defaults
    .addOption(
      new Option(
        "--output <path>",
        "Path to output CSV file, in a folder that exists",
      )
        .default(
          DEFAULT_OUTPUT,
          "output/csv/output.csv, in crypto-price-filler's folder",
        )
        .argParser(fileToWriteArgument),
    )
    .option(
      "--mode <mode>",
      "Price target to fetch: high, low, or close",
      priceTarget,
      "close",
    )
    .option(
      "--tz <zone>",
      "Time zone the input dates are in, named in full (e.g. America/Chicago, " +
        "or a current name such as Asia/Kolkata for a zone Node's list of time zones spells Asia/Calcutta) or UTC; " +
        "each row gets the offset the zone had then, daylight saving included. " +
        "Abbreviations such as CDT are refused.",
      parseTimeZone,
      "UTC",
    )
    .option(
      "--list-valid-timezones",
      "Print every zone --tz takes, by the name the list spells, one per line, and exit",
    )
    .option(
      "--verbose",
      "Enable detailed logging during processing; VERBOSE=1 in the environment does the same",
    )
    .addOption(
      new Option(
        "--backfill-highest",
        "Fill each Error price with the highest bracketing price (conservative tax estimates); config.json's BACKFILL_HIGHEST when not given",
      ).conflicts("backfillLowest"),
    )
    .addOption(
      new Option(
        "--backfill-lowest",
        "Fill each Error price with the lowest bracketing price (budgeting: avoid over-estimating income); config.json's BACKFILL_LOWEST when not given",
      ).conflicts("backfillHighest"),
    )

    // Custom help formatting
    .addHelpText(
      "after",
      `
The examples run from the repo's top folder, with the files you give the
tool in its input/ folder, fetch-from-any-exchange/crypto-price-filler/input/,
where git keeps nothing but the folder.

Settings and tokens:
  config.json, in crypto-price-filler's folder,
  fetch-from-any-exchange/crypto-price-filler/, laid over the
  committed config-example.json beside it, holds BACKFILL_HIGHEST and
  BACKFILL_LOWEST, the backfill a run makes when no --backfill flag is
  typed, and GECKOTERMINAL_TOP_POOLS_CONSIDERED, how many of the pools
  GeckoTerminal lists for a pool token are weighed when the tool picks the
  one it reads. A --backfill flag typed against the other's setting, the
  two flags typed together, or the two settings both true stop the run.
  supported-tokens.json, in the same folder, lists each symbol --token
  takes; a token is added there.

Api keys:
  The tool sends a Moralis api key, a CoinGecko demo api key and a
  CoinPaprika api key when each is saved (npm run api-keys, in the repo's
  top folder). It opens them with the password in API_KEYS_PASSWORD, which
  source ./bin/unlock-api-keys.sh keeps for a terminal, or else asks for
  the password on stderr. Without a Moralis key it prices pool tokens
  from GeckoTerminal alone; without the others it asks CoinGecko and
  CoinPaprika without one. Without a CoinPaprika key, CoinPaprika gives no
  high or low, so a run with --mode high or --mode low, for a token
  CoinPaprika lists, says so and asks whether to go on without its
  prices: y goes on; Enter, n or an input that ends stops the run, with
  exit code 1, before any price is asked for.

Examples:
  Basic usage, writing output/csv/output.csv in crypto-price-filler's folder:
    $ node bin/end-user/crypto-price-filler.js --token=grc --input=fetch-from-any-exchange/crypto-price-filler/input/mining.csv

  Full options:
    $ node bin/end-user/crypto-price-filler.js --token=xtm --input=fetch-from-any-exchange/crypto-price-filler/input/input.csv --output=fetch-from-any-exchange/crypto-price-filler/output/csv/prices.csv --mode=high --tz=America/Chicago --verbose

  Backfill the Error prices (conservative tax estimates - use higher bracketing price):
    $ node bin/end-user/crypto-price-filler.js --token=grc --input=fetch-from-any-exchange/crypto-price-filler/input/mining.csv --backfill-highest

  Backfill the Error prices (budgeting - use lower bracketing price):
    $ node bin/end-user/crypto-price-filler.js --token=grc --input=fetch-from-any-exchange/crypto-price-filler/input/mining.csv --backfill-lowest

  Show help:
    $ node bin/end-user/crypto-price-filler.js --help

Exit codes:
  0  the output file was written; a row no service priced gets Error in
     its $usd price, unless a --backfill flag or config.json filled it
  1  it was not: an option was wrong or missing, a word it does not take
     was given, the input file was not found, or has no rows or no date
     column, the api keys could not be opened, the run was not to go on
     without CoinPaprika's prices, a step failed, or the program reading
     the log stopped reading before the file was written
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
 * @returns {import('commander').Command} The command, parsed, whose `opts()` gives the options, such as { token: 'grc', input: '...', output: DEFAULT_OUTPUT }
 */
export function parseCommandLine(argv = process.argv) {
  return setupCommander().parse(argv);
}
