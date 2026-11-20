/**
 * The build step for the Sheets scripts: `npm run build apps-script`.
 * @module apps-script-build
 *
 * What: gives each Sheets script that sends api keys as the sheet should
 * run it, with the keys saved in the repo (`npm run api-keys`) and the
 * values of the config.json its Node version reads set in it, so no key is
 * typed into a script by hand. Each file goes to the clipboard in turn,
 * with where to paste it in the spreadsheet; the run waits for Enter
 * between files, and clears the clipboard after the last.
 *
 * How:
 *
 * - The scripts are those whose Node versions export a build spec,
 *   `APPS_SCRIPT_BUILD` (`APPS_SCRIPTS` below): crypto-price-fetchers.gs,
 *   with the DexTools and x1.ninja keys, and
 *   getCryptoPriceFromCentralizedExchange.gs with its sources and its
 *   tests, with the CoinGecko and CoinPaprika keys.
 *   `npm run build apps-script <script>` builds one of them.
 * - The keys are opened as the programs open them (`unlockProjectKeys`):
 *   with the password in `API_KEYS_PASSWORD`, or else one asked for, and
 *   each service is asked once whether it takes its key. Each script's
 *   values are its config.json's, with the keys laid over them by the
 *   spec's `keyConfig`, as its Node version lays them (`built-script.js`).
 * - With no clipboard tool installed (`clipboard.js`), the run offers to
 *   install one with apt, where it can, and runs the install on a yes,
 *   sudo asking for the computer's password at its own prompt. Declined,
 *   or where no install can be offered, the run says first that the api
 *   keys will be written to disk in the clear, then writes each file to
 *   `build/apps-script/` at the repo's top, which git ignores, readable
 *   by its owner alone, and prints each file's path.
 * - No line printed holds any character of a key: the files' text goes
 *   only to the clipboard or to those files.
 *
 * Fit: `build.js` at the repo's top runs `runBuild`.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn as nodeSpawn } from "node:child_process";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { unlockProjectKeys } from "../api-key-store/index.js";
import {
  layConfig,
  readConfigFile,
} from "../apps-script-runner/config-file.js";
import { APPS_SCRIPT_BUILD as DEXTOOLS_SCRIPT } from "../crypto-price-fetchers.js";
import { APPS_SCRIPT_BUILD as EXCHANGE_SCRIPT } from "../fetch-from-centralized-exchange/getCryptoPriceFromCentralizedExchange.js";
import { messageOf } from "../lib/message-of.js";
import { builtFiles } from "./built-script.js";
import {
  copyToClipboard,
  findClipboardTool,
  installCommand,
} from "./clipboard.js";

/**
 * A Sheets script the build gives, as its Node version describes it.
 *
 * @typedef {Object} BuildSpec
 * @property {string} name - The script's name, as `npm run build apps-script <script>` takes it
 * @property {import('./built-script.js').ScriptFile[]} files - Its files, in the order Apps Script loads them; the values are set at the end of the first
 * @property {string[]} services - The services whose keys it sends, as the top config.json names them
 * @property {function(Object<string, ?string>): Object<string, Object>} keyConfig - The config values that hand it the keys given, as its Node version hands them
 * @property {string} defaultConfigFile - The config.json its Node version reads, which may be missing
 */

/** The Sheets scripts the build gives. */
export const APPS_SCRIPTS = Object.freeze([DEXTOOLS_SCRIPT, EXCHANGE_SCRIPT]);

/** Where the files go when there is no clipboard, from the repo's top. */
export const BUILD_FOLDER = path.join("build", "apps-script");

/** What the help says after the commands. */
const HELP_AFTER = `
The keys come from the repo's key file (npm run api-keys saves them),
opened with the password in API_KEYS_PASSWORD (source ./unlock-api-keys.sh
keeps it for a terminal), or else one asked for. No line printed shows a
key: each file goes to the clipboard, which is cleared after the last, or,
with no clipboard tool installed and none installed when offered, to a
file in ${BUILD_FOLDER}/ that only you can read.`;

/**
 * Asks a question at the terminal and gives the line typed.
 *
 * @param {string} prompt - The question
 * @param {{input: NodeJS.ReadableStream, output: NodeJS.WritableStream}} streams - Where it is asked
 * @returns {Promise<?string>} The line typed, or null when the input ended first
 */
function askLine(prompt, { input, output }) {
  return new Promise((resolve) => {
    const lines = readline.createInterface({ input, terminal: false });
    let answered = false;
    lines.once("line", (line) => {
      answered = true;
      lines.close();
      resolve(line);
    });
    lines.once("close", () => {
      if (!answered) resolve(null);
    });
    output.write(prompt);
  });
}

/**
 * Runs an install command at the terminal, its prompts and output the
 * terminal's, and gives its exit code.
 *
 * @param {{command: string, args: string[]}} install - The command (`installCommand`)
 * @returns {Promise<number>} Its exit code
 */
function runInstall(install) {
  return new Promise((resolve) => {
    const child = nodeSpawn(install.command, install.args, {
      stdio: "inherit",
    });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/**
 * Opens the keys the scripts send and builds each script's files.
 *
 * @param {BuildSpec[]} specs - The scripts
 * @param {Object} run - The run (`runBuild`)
 * @returns {Promise<Array<{spec: BuildSpec, files: import('./built-script.js').BuiltFile[]}>>} Each script's files
 * @throws {Error} When the keys cannot be opened, a service refuses its key, or a script does not have a field its values name
 */
async function buildScripts(specs, run) {
  const keys = await unlockProjectKeys({
    projectTop: run.projectTop,
    services: [...new Set(specs.flatMap((spec) => spec.services))],
    env: run.env,
    ask: run.askSecret,
    say: run.tell,
    checkOptions: run.checkOptions,
  });
  return specs.map((spec) => {
    const keyValues = spec.keyConfig(keys);
    const values = layConfig(
      readConfigFile(spec.defaultConfigFile, { required: false }),
      keyValues,
    );
    return {
      spec,
      files: builtFiles(spec.files, values, Object.keys(keyValues).length > 0),
    };
  });
}

/**
 * Finds the clipboard tool, or offers to install one and installs it on a
 * yes.
 *
 * @param {Object} run - The run (`runBuild`)
 * @returns {Promise<?{command: string, args: string[]}>} The tool, or null for none
 */
async function clipboardTool(run) {
  const tool = findClipboardTool(run.computer);
  if (tool !== null) return tool;
  const install = installCommand(run.computer);
  if (install === null) return null;
  const answer = await run.ask(
    `No clipboard tool is installed, so the scripts cannot go to the clipboard. ` +
      `Install ${install.packageName} now, with: ${install.command} ${install.args.join(" ")}? (y/N) `,
  );
  if (!/^y(es)?$/i.test((answer ?? "").trim())) return null;
  const code = await run.runInstall(install);
  if (code !== 0) {
    run.say(`The install ended with exit code ${code}.`);
    return null;
  }
  return findClipboardTool(run.computer);
}

/**
 * Where to paste a file, for a person at the spreadsheet.
 *
 * @param {import('./built-script.js').BuiltFile} file - The file
 * @returns {string} The steps, indented
 */
function pasteSteps(file) {
  const steps =
    `  In the spreadsheet: Extensions > Apps Script. Open the script file ${file.appsScriptName} ` +
    `(Files, +, Script makes it; name it ${file.appsScriptName}), select all of its text, ` +
    "paste over it, and save.";
  return file.optional
    ? `${steps}\n  This one is optional: the sheet works without it.`
    : steps;
}

/**
 * Puts each file on the clipboard in turn, with where to paste it, waits
 * for Enter after each, and clears the clipboard after the last.
 *
 * @param {import('./built-script.js').BuiltFile[]} files - The files, in order
 * @param {{command: string, args: string[]}} tool - The clipboard tool
 * @param {Object} run - The run (`runBuild`)
 * @returns {Promise<void>} Settles once the clipboard is cleared
 */
async function copyEach(files, tool, run) {
  for (const [index, file] of files.entries()) {
    await run.copy(tool, file.text);
    const lines = file.text.split("\n").length;
    run.say(
      `${index + 1} of ${files.length}: ${file.appsScriptName}.gs is on your clipboard (${lines} lines).`,
    );
    run.say(pasteSteps(file));
    await run.ask(
      index < files.length - 1
        ? "Press Enter once it is pasted, for the next file. "
        : "Press Enter once it is pasted, to clear the clipboard. ",
    );
  }
  await run.copy(tool, "");
  run.say("The clipboard is cleared.");
}

/**
 * Writes each file to the build folder, readable by its owner alone,
 * having said first that the api keys in them go to disk in the clear.
 *
 * @param {import('./built-script.js').BuiltFile[]} files - The files, in order
 * @param {Object} run - The run (`runBuild`)
 * @returns {void}
 */
function writeEach(files, run) {
  const folder = path.join(run.projectTop, BUILD_FOLDER);
  if (files.some((file) => file.holdsKeys)) {
    run.say(
      "The scripts go to files instead, and the api keys in them are written to disk " +
        "in the clear, readable by you alone. Delete the files once they are pasted.",
    );
  }
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  fs.chmodSync(folder, 0o700);
  for (const file of files) {
    const target = path.join(folder, `${file.appsScriptName}.gs`);
    fs.writeFileSync(target, file.text, { mode: 0o600 });
    fs.chmodSync(target, 0o600);
    run.say(`${target}:`);
    run.say(pasteSteps(file));
  }
}

/**
 * Builds the Sheets scripts, or one of them, and hands each file over.
 *
 * @param {?string} name - The script to build, or null for every one
 * @param {Object} run - The run (`runBuild`)
 * @returns {Promise<number>} The exit code
 */
async function buildAppsScripts(name, run) {
  const specs =
    name === null
      ? run.scripts
      : run.scripts.filter((spec) => spec.name === name);
  const files = (await buildScripts(specs, run)).flatMap(
    (script) => script.files,
  );
  const tool = await clipboardTool(run);
  if (tool === null) writeEach(files, run);
  else await copyEach(files, tool, run);
  return 0;
}

/**
 * Runs the build step, in process.
 *
 * @param {string[]} argv - The arguments, shaped as `process.argv`
 * @param {Object} project - The project
 * @param {string} project.projectTop - Its top folder, which holds `config.json` and the key file
 * @param {BuildSpec[]} [project.scripts=APPS_SCRIPTS] - The Sheets scripts it gives
 * @param {Object} [deps] - What a test replaces
 * @param {Object<string, string>} [deps.env=process.env] - The environment: `API_KEYS_PASSWORD`, `API_KEYS_FILE_PATH`, `PATH` and the desktop session's display
 * @param {string} [deps.platform=process.platform] - The platform, as Node names it
 * @param {function(string): boolean} [deps.onPath] - Whether a command is installed; looked up on `PATH` when absent
 * @param {function(string): Promise<?string>} [deps.ask] - Answers a question, in place of the terminal
 * @param {function(string): Promise<string>} [deps.askSecret] - Answers the password prompt, in place of the terminal
 * @param {import('../api-key-store/services.js').CheckOptions} [deps.checkOptions] - What the services' key checks are handed, such as a stand-in fetch
 * @param {function({command: string, args: string[]}, string): Promise<void>} [deps.copy] - Puts text on the clipboard (`copyToClipboard`)
 * @param {function({command: string, args: string[]}): Promise<number>} [deps.runInstall] - Runs the install command, giving its exit code
 * @param {{write: function(string): void}} [deps.stdout=process.stdout] - Where the steps go
 * @param {{write: function(string): void}} [deps.stderr=process.stderr] - Where the questions and messages go
 * @returns {Promise<number>} The exit code
 */
export async function runBuild(argv, project, deps = {}) {
  const io = {
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
  };
  const env = deps.env ?? process.env;
  const run = {
    projectTop: project.projectTop,
    scripts: project.scripts ?? APPS_SCRIPTS,
    env,
    computer: {
      platform: deps.platform ?? process.platform,
      env,
      onPath: deps.onPath,
    },
    say: (line) => io.stdout.write(`${line}\n`),
    tell: (line) => io.stderr.write(`${line}\n`),
    ask:
      deps.ask ??
      ((prompt) =>
        askLine(prompt, { input: process.stdin, output: io.stderr })),
    askSecret: deps.askSecret,
    checkOptions: deps.checkOptions,
    copy: deps.copy ?? copyToClipboard,
    runInstall: deps.runInstall ?? runInstall,
  };
  const names = run.scripts.map((spec) => spec.name);
  let exitCode = 0;
  const program = new Command()
    .name("build")
    .description("Builds the repo's Sheets scripts for Apps Script.")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.stdout.write(text),
      writeErr: (text) => io.stderr.write(text),
    });
  program
    .command("apps-script")
    .description(
      "gives the Sheets scripts with the saved api keys set in them, one file at a time on the clipboard, with where to paste each",
    )
    .argument("[script]", `one script only: ${names.join(" or ")}`, (value) => {
      if (!names.includes(value)) {
        throw new InvalidArgumentError(
          `No Sheets script is named that; the scripts are ${names.join(", ")}.`,
        );
      }
      return value;
    })
    .addHelpText("after", HELP_AFTER)
    .action(async (name) => {
      exitCode = await buildAppsScripts(name ?? null, run);
    });
  try {
    await program.parseAsync(argv);
  } catch (thrown) {
    if (thrown instanceof CommanderError) return thrown.exitCode;
    io.stderr.write(`${messageOf(thrown)}\n`);
    return 1;
  }
  return exitCode;
}
