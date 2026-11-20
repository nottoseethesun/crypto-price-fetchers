/**
 * What the command lines of the Node versions of the Sheets scripts share.
 * @module apps-script-runner/command-line
 *
 * What: each Node version of a Sheets script is also a command line that
 * calls one of the script's functions and prints what it returned. This
 * module holds the part they share, so it is written once:
 *
 * - `runScriptCommandLine` builds the program with commander, with the
 *   options every Node version has, `--config` and `--verbose`; lets the
 *   Node version add its own arguments or commands; parses the arguments;
 *   has the Node version open the api keys the call sends, handed to the
 *   script as config values or Script Properties, only once the arguments
 *   are parsed, so that `--help` never asks for a password; runs the call;
 *   and returns the exit code. A number the script returns
 *   is printed on stdout, with exit code 0. Anything else it returns, such
 *   as the message a cell would show, goes to stderr with exit code 1, and
 *   so does a call that fails. Help goes to stdout with exit code 0, and a
 *   mistake in the arguments to stderr with exit code 1.
 * - `isEntryPoint` tells whether a module is the file node was started
 *   with, so a Node version runs its command line then, and only declares
 *   its functions when another program imports it.
 *
 * How: commander's `exitOverride` and `configureOutput` keep the parse in
 * the process and its output on the streams given, so a test runs a
 * command line as a function call. The program is built afresh for each
 * run. The config file is the default one unless `--config` names
 * another; the default may be missing, and then the script runs on its own
 * values, but a file named on purpose must exist (`readConfigFile`).
 *
 * Fit: the Node versions beside the Sheets scripts call these from their
 * own `runCommandLine`.
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";
import { messageOf } from "../lib/message-of.js";
import { layConfig, readConfigFile } from "./config-file.js";
import { openAppsScript } from "./run-apps-script.js";

/** What the help says about exit codes. */
const EXIT_CODES_HELP = `
Exit codes:
  0  the script returned a number, printed on stdout
  1  the script returned something else, such as a message, printed on
     stderr; or the call failed; or the arguments were wrong`;

/**
 * Opens the script, calls one of its functions, prints what it returned,
 * and closes the script.
 *
 * @param {Object} call - The call
 * @param {string|URL|Array<string|URL>} call.scriptPath - The `.gs` file, or a script's files in the order Apps Script loads them
 * @param {string} call.name - The script function's name
 * @param {Array} call.args - Its arguments
 * @param {Command} call.command - The parsed command, for `--config` and `--verbose`
 * @param {function|undefined} call.fetch - The fetch to do the script's requests, or undefined for Node's own
 * @param {function(Object): Promise<{config: (Object|undefined), scriptProperties: (Object|undefined)}>} call.apiKeys - Opens the api keys the call sends (`runScriptCommandLine`)
 * @param {{stdout: {write: function}, stderr: {write: function}}} call.io - Where output goes
 * @returns {Promise<number>} The exit code
 */
async function printCall({
  scriptPath,
  name,
  args,
  command,
  fetch,
  apiKeys,
  io,
}) {
  const options = command.optsWithGlobals();
  const required =
    command.getOptionValueSourceWithGlobals("config") !== "default";
  const config = readConfigFile(options.config, { required });
  const keys = await apiKeys({ name, args, io });
  const script = await openAppsScript(scriptPath, {
    config: layConfig(config, keys.config ?? {}),
    fetch,
    onLog:
      options.verbose === true
        ? (line) => io.stderr.write(`${line.level}: ${line.text}\n`)
        : null,
    scriptProperties: keys.scriptProperties ?? {},
  });
  try {
    const value = await script.call(name, ...args);
    if (typeof value === "number") {
      io.stdout.write(`${value}\n`);
      return 0;
    }
    io.stderr.write(`${String(value)}\n`);
    return 1;
  } finally {
    await script.close();
  }
}

/**
 * Runs the command line of a Node version of a Sheets script, in process.
 *
 * @param {Object} spec - The command line
 * @param {string[]} spec.argv - The arguments, shaped as `process.argv`: node, the file, then the arguments
 * @param {string|URL|Array<string|URL>} spec.scriptPath - The `.gs` file, or a script's files in the order Apps Script loads them
 * @param {string} spec.defaultConfigFile - The config file used when `--config` names none
 * @param {function(Command, function(string, Array, Command): Promise<void>): void} spec.describe - Gives the program its name, description, arguments or commands; each action calls the function it is handed with the script function's name, its arguments, and the action's command
 * @param {function({name: string, args: Array, io: Object}): Promise<{config: (Object|undefined), scriptProperties: (Object|undefined)}>} [spec.apiKeys] - Opens the api keys the call sends, once the arguments are parsed and before the script opens, handed the call and where output goes; gives config values laid over the config file's, Script Properties, or both. None when absent
 * @param {Object} [deps] - What a test replaces
 * @param {function} [deps.fetch] - Does the script's web requests, in place of Node's fetch
 * @param {{write: function(string): void}} [deps.stdout=process.stdout] - Where output goes
 * @param {{write: function(string): void}} [deps.stderr=process.stderr] - Where messages go
 * @returns {Promise<number>} The exit code
 */
export async function runScriptCommandLine(
  { argv, scriptPath, defaultConfigFile, describe, apiKeys },
  deps = {},
) {
  const io = {
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
  };
  let exitCode = 0;
  const program = new Command()
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.stdout.write(text),
      writeErr: (text) => io.stderr.write(text),
    })
    .option(
      "-c, --config <file>",
      "JSON file of values for the script's config objects",
      defaultConfigFile,
    )
    .option("-v, --verbose", "show the script's log on stderr");
  const runCall = async (name, args, command) => {
    exitCode = await printCall({
      scriptPath,
      name,
      args,
      command,
      fetch: deps.fetch,
      apiKeys: apiKeys ?? (async () => ({})),
      io,
    });
  };
  describe(program, runCall);
  program.addHelpText("after", EXIT_CODES_HELP);
  try {
    await program.parseAsync(argv);
  } catch (thrown) {
    if (thrown instanceof CommanderError) return thrown.exitCode;
    io.stderr.write(`${messageOf(thrown)}\n`);
    return 1;
  }
  return exitCode;
}

/**
 * Tells whether a module is the file node was started with.
 *
 * @param {string} moduleUrl - The module's `import.meta.url`
 * @returns {boolean} True when node was started with that file
 */
export function isEntryPoint(moduleUrl) {
  const started = process.argv[1];
  if (typeof started !== "string") return false;
  try {
    return pathToFileURL(fs.realpathSync(started)).href === moduleUrl;
  } catch {
    return false;
  }
}
