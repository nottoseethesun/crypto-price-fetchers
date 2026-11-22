/**
 * Checks the option values a command line took as its defaults from a
 * settings file, with the checks commander gives the same values typed.
 * @module lib/command-defaults
 *
 * What: a command line may take its options' defaults from a settings
 * file, such as the `config.json` beside a tool. Commander, the package
 * that parses the command lines, checks a value only when it is typed: it
 * runs the option's parser, which holds its choices too, and refuses two
 * options that conflict. A default goes unchecked, so a value the command
 * line refuses typed would pass from the file. `checkDefaults` gives the
 * defaults the same checks, once parsing is done and before the run asks
 * anything.
 *
 * How: for each option whose value came from its default (commander's
 * `getOptionValueSource`) and is set, that is, neither undefined, null nor
 * false, it calls the option's parser on the value written as text. Then,
 * for each option that conflicts with another, when both are set and at
 * least one came from its default, it refuses the pair, as commander does
 * two typed ones. A refusal stops the run through the command's `error`,
 * with exit code 1, naming the settings file and the option. A parser's
 * refusal is known by its code, `commander.invalidArgument`, rather than
 * its class, since a project may load another copy of commander than this
 * repo's.
 *
 * Fit: the command lines of the projects that install this repo call it
 * as `crypto-price-fetchers/lib/command-defaults`, from a `preAction` hook
 * or after `parse`.
 */

/** The code commander gives a value an option's parser refuses. */
const INVALID_ARGUMENT = "commander.invalidArgument";

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
 * Names an option in an error, saying when its value is the settings
 * file's.
 *
 * @param {import('commander').Command} command - The command
 * @param {import('commander').Option} option - The option
 * @param {string} settingsFile - The settings file's name
 * @returns {string} The option's name in the error
 */
function named(command, option, settingsFile) {
  const fromFile =
    command.getOptionValueSource(option.attributeName()) === "default";
  return fromFile
    ? `option '${option.flags}', which ${settingsFile} sets,`
    : `option '${option.flags}'`;
}

/**
 * Checks the defaults a command line took from a settings file: each with
 * its option's parser, and each pair of conflicting options with one
 * taken from the file.
 *
 * @param {import('commander').Command} command - The command, parsed
 * @param {string} settingsFile - The settings file's name, for the error, such as 'config.json'
 * @returns {void}
 * @throws {Error} When an option's parser throws for another reason than a refused value
 */
export function checkDefaults(command, settingsFile) {
  const set = command.options.filter((option) =>
    isSet(command.getOptionValue(option.attributeName())),
  );
  for (const option of set) {
    const name = option.attributeName();
    if (command.getOptionValueSource(name) !== "default") continue;
    if (typeof option.parseArg !== "function") continue;
    const value = String(command.getOptionValue(name));
    try {
      option.parseArg(value, undefined);
    } catch (error) {
      if (error?.code !== INVALID_ARGUMENT) throw error;
      command.error(
        `error: ${settingsFile} gives option '${option.flags}' the value '${value}', which is invalid. ${error.message}`,
        { exitCode: 1, code: INVALID_ARGUMENT },
      );
    }
  }
  for (const option of set) {
    for (const otherName of option.conflictsWith) {
      const other = set.find(
        (candidate) => candidate.attributeName() === otherName,
      );
      if (other === undefined) continue;
      const fromFile = [option, other].some(
        (one) =>
          command.getOptionValueSource(one.attributeName()) === "default",
      );
      if (!fromFile) continue;
      command.error(
        `error: ${named(command, option, settingsFile)} cannot be used with ${named(command, other, settingsFile)}`.replace(
          /,$/,
          "",
        ),
        { exitCode: 1, code: CONFLICTING_OPTION },
      );
    }
  }
}
