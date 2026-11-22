/**
 * Refuses two conflicting options of a command line when a settings file
 * sets one of them, as commander refuses two typed ones.
 * @module lib/option-conflicts
 *
 * What: a command line may take its options' defaults from a settings
 * file, such as the `config.json` beside a tool, whose values its JSON
 * Schema checks (`lib/settings-file.js`). Two options can conflict, such
 * as `--source`, which names where a chart's candles come from, and
 * `--useDexToolsOnly`, which asks another service alone. Commander, the
 * package that parses the command lines, refuses two conflicting options
 * only when both are typed. One taken from the settings file would pass,
 * and the run would act on one of the two without a word. No schema of
 * the file can say this, since the other option is typed.
 * `checkConflicts` refuses the pair, once parsing is done and before the
 * run asks anything.
 *
 * How: for each option that conflicts with another (commander's
 * `conflictsWith`), when both are set, that is, neither undefined, null
 * nor false, and at least one came from its default (commander's
 * `getOptionValueSource`), it stops the run through the command's
 * `error`, with exit code 1, naming the two options and the settings file.
 *
 * Fit: the command lines of the projects that install this repo call it
 * as `crypto-price-fetchers/lib/option-conflicts`, from a `preAction`
 * hook or after `parse`.
 */

/** The code commander gives two options that conflict. */
const CONFLICTING_OPTION = "commander.conflictingOption";

/**
 * Says whether an option's value is set: neither undefined, null nor
 * false, the values an option that was not given holds.
 *
 * @param {*} value - The value
 * @returns {boolean} Whether it is set
 */
function isSet(value) {
  return value !== undefined && value !== null && value !== false;
}

/**
 * Says whether an option's value came from its default, that is, from the
 * settings file or the code, rather than from the command line.
 *
 * @param {import('commander').Command} command - The command
 * @param {import('commander').Option} option - The option
 * @returns {boolean} Whether it did
 */
function fromDefault(command, option) {
  return command.getOptionValueSource(option.attributeName()) === "default";
}

/**
 * Names an option in an error, saying when the settings file sets it.
 *
 * @param {import('commander').Command} command - The command
 * @param {import('commander').Option} option - The option
 * @param {string} settingsFile - The settings file's name
 * @returns {string} The option's name in the error
 */
function named(command, option, settingsFile) {
  return fromDefault(command, option)
    ? `option '${option.flags}' (set in ${settingsFile})`
    : `option '${option.flags}'`;
}

/**
 * Refuses two conflicting options when both are set and the settings file
 * sets at least one of them.
 *
 * @param {import('commander').Command} command - The command, parsed
 * @param {string} settingsFile - The settings file's name, for the error, such as 'config.json'
 * @returns {void}
 */
export function checkConflicts(command, settingsFile) {
  const set = command.options.filter((option) =>
    isSet(command.getOptionValue(option.attributeName())),
  );
  for (const option of set) {
    for (const otherName of option.conflictsWith) {
      const other = set.find(
        (candidate) => candidate.attributeName() === otherName,
      );
      if (other === undefined) continue;
      if (!fromDefault(command, option) && !fromDefault(command, other)) {
        continue;
      }
      command.error(
        `error: ${named(command, option, settingsFile)} cannot be used with ${named(command, other, settingsFile)}`,
        { exitCode: 1, code: CONFLICTING_OPTION },
      );
    }
  }
}
