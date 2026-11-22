/**
 * The build step for the Sheets scripts: `npm run build apps-script`.
 * @module apps-script-build
 *
 * What: gives the one file to paste into a spreadsheet's Apps Script
 * project: every Sheets script of the repo, joined, with the api keys
 * saved in the repo (`npm run api-keys`), the values of the config.json
 * each script's Node version reads, and the page the menu's Help item
 * shows, all set at its end, so no key is typed into a script by hand.
 * DEX Screener's Google Sheets functions go in too when the person
 * building says so. The file goes to the clipboard, with how to paste it.
 *
 * How:
 *
 * - The parts, in the order they run in Apps Script: the menu
 *   (`crypto-price-fetchers-menu.gs`), then the files of each Sheets
 *   script whose Node version exports a build spec, `APPS_SCRIPT_BUILD`
 *   (`APPS_SCRIPTS` below): crypto-price-fetchers.gs, with the DexTools and
 *   x1.ninja keys, and getCryptoPriceFromCentralizedExchange.gs with its
 *   sources and its in-editor tests, with the CoinGecko and CoinPaprika
 *   keys.
 * - Each script's config.json is read first and checked against the
 *   spec's schemas of the script's config objects (`configSchemas`), as
 *   its Node version checks it, so a file they refuse stops the build
 *   before it asks anything or opens a key, with every problem listed.
 * - Every build then asks whether to include DEX Screener's functions:
 *   Enter, or y, includes them, and n leaves them out. The question names
 *   the version, a commit of DEX Screener's repo, and says the step is
 *   optional, and that a build that fails should be run again with n. On
 *   a yes, the build runs the audit `npm run audit:dex-screener` runs,
 *   which downloads their files and checks each one's SHA-256, says its
 *   line, and compiles the files it checked (`dex-screener.js`). It does
 *   so before the keys are opened, so a failed download costs no
 *   password.
 * - The keys are opened as the programs open them (`unlockProjectKeys`):
 *   with the password in `API_KEYS_PASSWORD`, or else one asked for, and
 *   each service is asked once whether it takes its key. Each script's
 *   values are its config.json's, with the keys laid over them by the
 *   spec's `keyConfig`, as its Node version lays them.
 * - The Help page is made from the help section of the menu's header, of
 *   each script's first file, and of DEX Screener's functions when they go
 *   in (`help-page.js`).
 * - The parts are joined and checked as one Apps Script project
 *   (`built-script.js`).
 * - With no clipboard tool installed (`lib/clipboard.js`), on a desktop
 *   with Homebrew or apt to install one with, the run offers the install
 *   `npm run os-dependencies` runs (`install/os-dependencies.js`), and
 *   runs it on a yes. Declined, failed, or where no install can be
 *   offered, the run says first that the api keys will be written to disk
 *   in the clear, then writes the file to `dist/apps-script/` at the
 *   repo's top, which git ignores, readable by its owner alone, and prints
 *   its path.
 * - No line printed holds any character of a key: the file's text goes
 *   only to the clipboard or to that file.
 *
 * Fit: `build/tools/build.js` runs `runBuild`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError } from "commander";
import { unlockProjectKeys } from "../../../api-key-store/index.js";
import {
  layConfig,
  readConfigFile,
} from "../../../apps-script-runner/config-file.js";
import { APPS_SCRIPT_BUILD as DEXTOOLS_SCRIPT } from "../../../bin/crypto-price-fetchers.js";
import { APPS_SCRIPT_BUILD as EXCHANGE_SCRIPT } from "../../../bin/getCryptoPriceFromCentralizedExchange.js";
import { messageOf } from "../../../lib/message-of.js";
import { BUILT_FILE_NAME, combinedScript } from "./built-script.js";
import { askLine } from "../../../lib/ask-line.js";
import {
  clipboardPackage,
  commandInstalled,
  copyToClipboard,
  findClipboardTool,
} from "../../../lib/clipboard.js";
import {
  INSTALL_COMMAND,
  installByHand,
  installOsDependencies,
  runAtTerminal,
} from "../../../install/os-dependencies.js";
import { dexScreenerPart } from "./dex-screener.js";
import { DEX_SCREENER } from "./dex-screener-files.js";
import { helpPage, helpSection } from "./help-page.js";

/**
 * One file of a Sheets script, as a build spec names it.
 *
 * @typedef {Object} ScriptFile
 * @property {string} path - The file on this computer
 * @property {boolean} [help=false] - Whether its header holds a help section, for the Help page
 */

/**
 * A Sheets script the build joins into the file, as its Node version
 * describes it.
 *
 * @typedef {Object} BuildSpec
 * @property {string} name - The script's name
 * @property {ScriptFile[]} files - Its files, in the order Apps Script runs them
 * @property {string[]} services - The services whose keys it sends, as the top config.json names them
 * @property {function(Object<string, ?string>): Object<string, Object>} keyConfig - The config values that hand it the keys given, as its Node version hands them
 * @property {string} defaultConfigFile - The config.json its Node version reads, which may be missing
 * @property {Object<string, Object>} configSchemas - Each of its config objects' JSON Schema, by name, which that config.json is checked against
 */

/** The Sheets scripts the build joins, after the menu. */
export const APPS_SCRIPTS = Object.freeze([DEXTOOLS_SCRIPT, EXCHANGE_SCRIPT]);

/** This repo's top folder, from which each part is named. */
const REPO_TOP = fileURLToPath(new URL("../../..", import.meta.url));

/** The menu, the file's first part. */
const MENU_FILE = Object.freeze({
  path: fileURLToPath(
    new URL("../../../src/crypto-price-fetchers-menu.gs", import.meta.url),
  ),
  help: true,
});

/** The help section of DEX Screener's functions. */
const DEX_SCREENER_HELP = fileURLToPath(
  new URL("./dex-screener-help.md", import.meta.url),
);

/** Where the file goes when there is no clipboard, from the repo's top. */
export const BUILD_FOLDER = path.join("dist", "apps-script");

/** The script file in Apps Script that the file is pasted into. */
const APPS_SCRIPT_FILE = path.basename(BUILT_FILE_NAME, ".gs");

/** The script files of earlier installs that the one file replaces. */
const REPLACED_FILES = Object.freeze([
  "getCryptoPriceFromCentralizedExchange",
  "getCryptoPriceFromCentralizedExchange-sources",
  "getCryptoPriceFromCentralizedExchange-tests",
]);

/** What the help says after the commands. */
const HELP_AFTER = `
It first reads the config.json each script's Node version reads and checks
it as that Node version does, stopping, with every problem listed, when a
file sets a field the script does not take or a value of the wrong kind.
It then asks whether to include DEX Screener's Google Sheets functions,
downloaded from DEX Screener's repo at one commit and compiled; Enter
includes them. The keys come from the repo's key file (npm run api-keys
saves them), opened with the password in API_KEYS_PASSWORD (source
./bin/unlock-api-keys.sh keeps it for a terminal), or else one asked for. No
line printed shows a key: the file goes to the clipboard, which is cleared
once you press Enter, or, with no clipboard tool installed and none
installed when offered, to ${BUILD_FOLDER}/${BUILT_FILE_NAME}, which only
you can read.

Examples:
  Build the one file to paste into a spreadsheet; at the question, Enter
  includes DEX Screener's functions and n leaves them out:
    $ npm run build apps-script
  Keep the key file's password for this terminal first, so the build does
  not ask for it:
    $ source ./bin/unlock-api-keys.sh
    $ npm run build apps-script

Exit codes: 0 once the file is on the clipboard or written; 1 when a
config.json is refused, DEX Screener's functions cannot be downloaded,
checked or compiled, the keys cannot be opened, a service refuses its key,
the parts do not make one Apps Script project, or the arguments are wrong.`;

/** What the help of the build's own command says after its commands. */
const BUILD_HELP_AFTER = `
Examples:
  Build the Sheets scripts as one file for a spreadsheet's Apps Script
  project:
    $ npm run build apps-script
  Show what the apps-script command does, its question and its exit codes:
    $ npm run build -- apps-script --help

Exit codes: 0 when the command named succeeds, or for --help; 1 when no
command is named, the command is not one of these, or it fails.`;

/**
 * Asks whether to include DEX Screener's functions, until the answer is
 * Enter, y or n. Enter, and an input that ends, take the default: include.
 *
 * @param {Object} run - The run (`runBuild`)
 * @returns {Promise<boolean>} Whether to include them
 */
async function askDexScreener(run) {
  const { repo, commit, date, functions } = run.dexScreenerVersion;
  const names = functions.map((fn) => fn.name);
  const listed =
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
      : names.join("");
  const question =
    `DEX Screener's Google Sheets functions (${listed}) can go in the file,\n` +
    `downloaded from https://github.com/${repo} at commit ${commit} (${date}) and compiled here.\n` +
    "This step is optional: if the build fails, run it again and answer n.\n" +
    "Include DEX Screener's functions? (Y/n) ";
  for (;;) {
    const answer = await run.ask(question);
    if (answer === null) return true;
    const typed = answer.trim();
    if (typed === "" || /^y(es)?$/i.test(typed)) return true;
    if (/^no?$/i.test(typed)) return false;
    run.tell("Answer y or n, or press Enter for y.");
  }
}

/**
 * The parts of the file, with their text, in the order they run.
 *
 * @param {Object} run - The run (`runBuild`)
 * @param {?{text: string}} dexScreener - DEX Screener's part, or null for none
 * @returns {Array<{name: string, source: string, help: boolean}>} The parts
 */
function partsOf(run, dexScreener) {
  const files = [MENU_FILE, ...run.scripts.flatMap((spec) => spec.files)];
  const parts = files.map((file) => ({
    name: path.relative(REPO_TOP, file.path).split(path.sep).join("/"),
    source: fs.readFileSync(file.path, "utf8"),
    help: file.help === true,
  }));
  if (dexScreener !== null) {
    const { repo, commit } = run.dexScreenerVersion;
    parts.push({
      name: `DEX Screener's functions, from https://github.com/${repo} at commit ${commit}`,
      source: dexScreener.text,
      help: false,
    });
  }
  return parts;
}

/**
 * The comment that opens the file: what it is, how to install it, and its
 * parts.
 *
 * @param {Object} run - The run (`runBuild`)
 * @param {Array<{name: string}>} parts - The parts
 * @returns {string} The comment
 */
function preambleOf(run, parts) {
  const day = new Date(run.now()).toISOString().slice(0, 10);
  return [
    "/**",
    " * Crypto Price Fetchers – the one script file for a Google Sheets spreadsheet",
    " *",
    ` * Built on ${day} (UTC) by \`npm run build apps-script\`, the build step`,
    " * of the crypto-price-fetchers repo:",
    " * https://github.com/nottoseethesun/crypto-price-fetchers",
    " *",
    " * INSTALL",
    " *   In the spreadsheet: Extensions > Apps Script. Paste this whole text",
    ` *   over the text of the script file ${APPS_SCRIPT_FILE}, save, and`,
    " *   delete the files it replaces; the README's Install section, at the",
    " *   url above, lists them. Then reload the spreadsheet: the Crypto Price",
    " *   Fetchers menu appears, and its Help item says how to use each",
    " *   function.",
    " *",
    " * THE PARTS, in the order they run, each after a comment naming it",
    ...parts.map((part) => ` *   - ${part.name}`),
    " *   - the values the build sets, at the end: api keys, settings and the",
    " *     Help page",
    " *",
    " * A copy with api keys in it is for pasting into Apps Script: never",
    " * commit or share it.",
    " */",
  ].join("\n");
}

/**
 * Builds the file's text: reads each script's config.json, asks about DEX
 * Screener's functions, fetches them when asked, opens the keys, and joins
 * the parts.
 *
 * @param {Object} run - The run (`runBuild`)
 * @returns {Promise<{text: string, holdsKeys: boolean, withDexScreener: boolean}>} The text, whether it holds a key, and whether DEX Screener's functions are in it
 * @throws {Error} When a config.json breaks its Node version's schemas, DEX Screener's functions cannot be had, the keys cannot be opened, a service refuses its key, or the parts do not make one project
 */
async function buildText(run) {
  const configs = run.scripts.map((spec) =>
    readConfigFile(spec.defaultConfigFile, {
      required: false,
      schemas: spec.configSchemas,
    }),
  );
  const withDexScreener = await askDexScreener(run);
  const dexScreener = withDexScreener
    ? await run.dexScreener({
        projectTop: run.projectTop,
        fetch: run.fetch,
        version: run.dexScreenerVersion,
        say: run.say,
      })
    : null;
  const keys = await unlockProjectKeys({
    projectTop: run.projectTop,
    services: [...new Set(run.scripts.flatMap((spec) => spec.services))],
    env: run.env,
    ask: run.askSecret,
    say: run.tell,
    checkOptions: run.checkOptions,
  });
  let values = {};
  let holdsKeys = false;
  for (const [index, spec] of run.scripts.entries()) {
    const keyValues = spec.keyConfig(keys);
    holdsKeys ||= Object.keys(keyValues).length > 0;
    values = layConfig(values, layConfig(configs[index], keyValues));
  }
  const parts = partsOf(run, dexScreener);
  const sections = parts
    .filter((part) => part.help)
    .map((part) => helpSection(part.source, part.name));
  if (dexScreener !== null) {
    sections.push(
      helpSection(
        fs.readFileSync(DEX_SCREENER_HELP, "utf8"),
        "build/tools/apps-script-build/dex-screener-help.md",
      ),
    );
  }
  values = layConfig(values, { HELP_PAGE: { HTML: helpPage(sections) } });
  const text = combinedScript({
    preamble: preambleOf(run, parts),
    parts,
    values,
    required: dexScreener?.required ?? [],
  });
  return { text, holdsKeys, withDexScreener };
}

/**
 * Finds the clipboard tool, or, on a desktop with Homebrew or apt to
 * install one with, offers the install `npm run os-dependencies` runs, and
 * runs it on a yes.
 *
 * @param {Object} run - The run (`runBuild`)
 * @returns {Promise<?{command: string, args: string[]}>} The tool, or null for none
 */
async function clipboardTool(run) {
  const tool = findClipboardTool(run.computer);
  if (tool !== null) return tool;
  const needed = clipboardPackage(run.computer);
  if (needed === null) return null;
  const installers = ["brew", "apt"].filter((command) =>
    commandInstalled(command, run.computer),
  );
  if (installers.length === 0) {
    run.say(installByHand(needed.packageName));
    return null;
  }
  const answer = await run.ask(
    "No clipboard tool is installed, so the script cannot go to the clipboard. " +
      `Install ${needed.packageName} now, as ${INSTALL_COMMAND} does? (y/N) `,
  );
  if (!/^y(es)?$/i.test((answer ?? "").trim())) return null;
  await installOsDependencies(run);
  return findClipboardTool(run.computer);
}

/**
 * How to paste the file, for a person at the spreadsheet.
 *
 * @param {boolean} withDexScreener - Whether DEX Screener's functions are in the file
 * @returns {string} The steps, indented
 */
function pasteSteps(withDexScreener) {
  const replaced = withDexScreener
    ? [...REPLACED_FILES, "DEX Screener's own file"]
    : REPLACED_FILES;
  const lines = [
    `  1. In the spreadsheet: Extensions > Apps Script. Open the script file ${APPS_SCRIPT_FILE}`,
    `     (Files, +, Script makes it; name it ${APPS_SCRIPT_FILE}), select all of its text,`,
    "     paste over it, and save.",
    `  2. Delete the script files it replaces, where the project has them: ${replaced.join(", ")}.`,
  ];
  if (!withDexScreener) {
    lines.push(
      "     DEX Screener's own file, if you keep it, sets an onOpen of its own, so either menu can be the one that appears;",
      "     build again and press Enter at the first question to have DEX Screener's functions under this menu.",
    );
  }
  lines.push(
    "  3. Reload the spreadsheet: the Crypto Price Fetchers menu appears, and its Help item says how to use each function.",
  );
  return lines.join("\n");
}

/**
 * Puts the file on the clipboard, says how to paste it, waits for Enter,
 * and clears the clipboard.
 *
 * @param {{text: string, withDexScreener: boolean}} built - The file
 * @param {{command: string, args: string[]}} tool - The clipboard tool
 * @param {Object} run - The run (`runBuild`)
 * @returns {Promise<void>} Settles once the clipboard is cleared
 */
async function copyFile(built, tool, run) {
  await run.copy(tool, built.text);
  const lines = built.text.split("\n").length;
  run.say(`The script, ${lines} lines, is on your clipboard.`);
  run.say(pasteSteps(built.withDexScreener));
  await run.ask("Press Enter once it is pasted, to clear the clipboard. ");
  await run.copy(tool, "");
  run.say("The clipboard is cleared.");
}

/**
 * Writes the file to the build folder, readable by its owner alone,
 * having said first when the api keys in it go to disk in the clear.
 *
 * @param {{text: string, holdsKeys: boolean, withDexScreener: boolean}} built - The file
 * @param {Object} run - The run (`runBuild`)
 * @returns {void}
 */
function writeFile(built, run) {
  const folder = path.join(run.projectTop, BUILD_FOLDER);
  if (built.holdsKeys) {
    run.say(
      "The script goes to a file instead, and the api keys in it are written to disk " +
        "in the clear, readable by you alone. Delete the file once it is pasted.",
    );
  }
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  fs.chmodSync(folder, 0o700);
  const target = path.join(folder, BUILT_FILE_NAME);
  fs.writeFileSync(target, built.text, { mode: 0o600 });
  fs.chmodSync(target, 0o600);
  run.say(`${target}:`);
  run.say("  Open it in a text editor, select all of its text, and copy it.");
  run.say(pasteSteps(built.withDexScreener));
}

/**
 * Builds the file and hands it over.
 *
 * @param {Object} run - The run (`runBuild`)
 * @returns {Promise<number>} The exit code
 */
async function buildAppsScript(run) {
  const built = await buildText(run);
  const tool = await clipboardTool(run);
  if (tool === null) writeFile(built, run);
  else await copyFile(built, tool, run);
  return 0;
}

/**
 * Runs the build step, in process.
 *
 * @param {string[]} argv - The arguments, shaped as `process.argv`
 * @param {Object} project - The project
 * @param {string} project.projectTop - Its top folder, which holds `config.json` and the key file
 * @param {BuildSpec[]} [project.scripts=APPS_SCRIPTS] - The Sheets scripts it joins after the menu
 * @param {Object} [deps] - What a test replaces
 * @param {Object<string, string>} [deps.env=process.env] - The environment: `API_KEYS_PASSWORD`, `API_KEYS_FILE_PATH`, `PATH` and the desktop session's display
 * @param {string} [deps.platform=process.platform] - The platform, as Node names it
 * @param {function(string): boolean} [deps.onPath] - Whether a command is installed; looked up on `PATH` when absent
 * @param {function(string): Promise<?string>} [deps.ask] - Answers a question, in place of the terminal
 * @param {function(string): Promise<string>} [deps.askSecret] - Answers the password prompt, in place of the terminal
 * @param {import('../api-key-store/services.js').CheckOptions} [deps.checkOptions] - What the services' key checks are handed, such as a stand-in fetch
 * @param {function(Object): Promise<{text: string, required: string[]}>} [deps.dexScreener=dexScreenerPart] - Gives DEX Screener's part, after the audit of its files
 * @param {import('./dex-screener-files.js').DexScreenerVersion} [deps.dexScreenerVersion=DEX_SCREENER] - The version of DEX Screener's functions it offers
 * @param {function(string): Promise<Response>} [deps.fetch=globalThis.fetch] - Downloads DEX Screener's files
 * @param {function(): number} [deps.now=Date.now] - The time, for the build's date in the file
 * @param {function({command: string, args: string[]}, string): Promise<void>} [deps.copy] - Puts text on the clipboard (`copyToClipboard`)
 * @param {function({command: string, args: string[]}): Promise<number>} [deps.runCommand=runAtTerminal] - Runs an install at the terminal, giving its exit code
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
    dexScreener: deps.dexScreener ?? dexScreenerPart,
    dexScreenerVersion: deps.dexScreenerVersion ?? DEX_SCREENER,
    fetch: deps.fetch ?? globalThis.fetch,
    now: deps.now ?? Date.now,
    copy: deps.copy ?? copyToClipboard,
    runCommand: deps.runCommand ?? runAtTerminal,
  };
  let exitCode = 0;
  const program = new Command()
    .name("build")
    .description("Builds the repo's Sheets scripts for Apps Script.")
    .addHelpText("after", BUILD_HELP_AFTER)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.stdout.write(text),
      writeErr: (text) => io.stderr.write(text),
    });
  program
    .command("apps-script")
    .description(
      "gives every Sheets script of the repo as one file, with the saved api keys set in it, on the clipboard, with how to paste it into a spreadsheet",
    )
    .allowExcessArguments(false)
    .addHelpText("after", HELP_AFTER)
    .action(async () => {
      exitCode = await buildAppsScript(run);
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
