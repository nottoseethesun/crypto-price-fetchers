/**
 * Installs the programs of the computer's operating system, outside npm,
 * that the repo's tools use.
 * @module install/os-dependencies
 *
 * What: today one program: the clipboard tool the build step,
 * `npm run build apps-script`, puts its file on the clipboard with
 * (`lib/clipboard.js`). macOS and Windows come with theirs, pbcopy and
 * clip. A Linux desktop session needs wl-clipboard in a Wayland session or
 * xclip in an X11 one, unless a tool for the session is installed.
 * `installOsDependencies` says what is there, and installs what is
 * missing:
 *
 * - with Homebrew, the package manager for macOS and Linux, when `brew` is
 *   installed: `brew install <package>`;
 * - else it recommends installing Homebrew, as https://brew.sh says, since
 *   it works on Linux and macOS alike, and running the install again; and,
 *   when apt, the package manager of Debian and Ubuntu, is installed, it
 *   asks whether to install the package with `sudo apt install -y
 *   <package>` instead, sudo asking for the computer's password at its own
 *   prompt;
 * - with neither, with the apt install declined, or when an install fails,
 *   it names the package to install by hand.
 *
 * With no desktop session open, as over ssh, no clipboard can be reached,
 * so nothing is installed.
 *
 * How: an install runs at the terminal (`runAtTerminal`), its prompts and
 * output the terminal's. After an install that ended well, the tool is
 * looked for again, on `PATH`, before the install counts as done.
 *
 * The command line, `runInstallCommandLine`, takes no option but
 * `--help`. Its questions go to stderr and are answered on stdin; its
 * lines go to stdout.
 *
 * Fit: `install/install-os-dependencies.js`, `npm run os-dependencies`,
 * runs the command line, and the build step runs `installOsDependencies`
 * when it finds no clipboard tool and the person building says yes.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { Command, CommanderError } from "commander";
import { askLine } from "../lib/ask-line.js";
import {
  clipboardPackage,
  commandInstalled,
  findClipboardTool,
} from "../lib/clipboard.js";
import { messageOf } from "../lib/message-of.js";

/** The command that runs the install again, which the messages name. */
export const INSTALL_COMMAND = "npm run os-dependencies";

/** Homebrew's page, which says how to install it. */
export const HOMEBREW_PAGE = "https://brew.sh";

/**
 * Runs a command at the terminal, its prompts and output the terminal's,
 * and gives its exit code.
 *
 * @param {{command: string, args: string[]}} command - The command and its arguments
 * @param {function(string, string[], Object): import('node:child_process').ChildProcess} [spawn] - Starts it; Node's spawn when absent
 * @returns {Promise<number>} Its exit code; 1 when it cannot start or a signal ends it
 */
export function runAtTerminal(command, spawn = nodeSpawn) {
  return new Promise((resolve) => {
    const child = spawn(command.command, [...command.args], {
      stdio: "inherit",
    });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/**
 * What the install needs of the run: what a test replaces.
 *
 * @typedef {Object} InstallRun
 * @property {import('../lib/clipboard.js').Computer} computer - The platform, the environment and the commands installed
 * @property {function(string): void} say - Prints a line
 * @property {function(string): Promise<?string>} ask - Asks a question and gives the line typed, or null for none
 * @property {function({command: string, args: string[]}): Promise<number>} runCommand - Runs a command at the terminal, giving its exit code (`runAtTerminal`)
 */

/**
 * Says to install the package by hand.
 *
 * @param {string} packageName - The package
 * @returns {string} The line
 */
export function installByHand(packageName) {
  return (
    `Install ${packageName} yourself, with your system's package manager: ` +
    "the build step puts its file on the clipboard with it, and writes the " +
    "file to dist/apps-script/ without it."
  );
}

/**
 * Says how an install ended, looking for the tool again after one that
 * ended well.
 *
 * @param {InstallRun} run - The run
 * @param {string} packageName - The package installed
 * @param {number} code - The install's exit code
 * @returns {number} 0 when the tool is installed now, else 1
 */
function ended(run, packageName, code) {
  if (code === 0 && findClipboardTool(run.computer) !== null) {
    run.say(`${packageName} is installed.`);
    return 0;
  }
  run.say(
    code === 0
      ? "The install ended, but no clipboard tool is on PATH."
      : `The install ended with exit code ${code}.`,
  );
  run.say(installByHand(packageName));
  return 1;
}

/**
 * Says what of the repo's programs outside npm is installed, and installs
 * what is missing.
 *
 * @param {InstallRun} run - The run
 * @returns {Promise<number>} 0 when nothing is missing: each program installed, now or before, come with the system, or of no use with no desktop session; else 1
 */
export async function installOsDependencies(run) {
  const { computer } = run;
  const tool = findClipboardTool(computer);
  if (tool !== null) {
    run.say(`The clipboard tool, ${tool.command}, is installed.`);
    return 0;
  }
  if (computer.platform === "darwin" || computer.platform === "win32") {
    const [command, system] =
      computer.platform === "darwin"
        ? ["pbcopy", "macOS"]
        : ["clip", "Windows"];
    run.say(
      `The clipboard tool, ${command}, comes with ${system}, but is not on PATH.`,
    );
    return 1;
  }
  const needed = clipboardPackage(computer);
  if (needed === null) {
    run.say(
      "No desktop session is open, as over ssh, so no clipboard can be " +
        "reached from here, and nothing is installed: the build step writes " +
        "its file to dist/apps-script/ instead. To install a clipboard " +
        `tool, run ${INSTALL_COMMAND} in a terminal of your desktop session.`,
    );
    return 0;
  }
  const { packageName, session } = needed;
  const what = `${packageName}, the clipboard tool of ${session} sessions`;
  if (commandInstalled("brew", computer)) {
    run.say(`Installing ${what}, with Homebrew: brew install ${packageName}`);
    const code = await run.runCommand({
      command: "brew",
      args: ["install", packageName],
    });
    return ended(run, packageName, code);
  }
  run.say(
    "Homebrew, the package manager for macOS and Linux, is not installed. " +
      `It is the way recommended here, on Linux and macOS alike: install it, as ${HOMEBREW_PAGE} says, ` +
      `then run ${INSTALL_COMMAND} again.`,
  );
  if (commandInstalled("apt", computer)) {
    const answer = await run.ask(
      `Or install ${what}, now, with apt: sudo apt install -y ${packageName}? (y/N) `,
    );
    if (/^y(es)?$/i.test((answer ?? "").trim())) {
      const code = await run.runCommand({
        command: "sudo",
        args: ["apt", "install", "-y", packageName],
      });
      return ended(run, packageName, code);
    }
  }
  run.say(installByHand(packageName));
  return 1;
}

/** What the help says after the options: what it does, examples and exit codes. */
const HELP_AFTER = `
Today the one such program is the clipboard tool that npm run build
apps-script puts its file on the clipboard with. macOS and Windows come
with theirs, pbcopy and clip; a Linux desktop needs wl-clipboard in a
Wayland session or xclip in an X11 one. It installs the tool with
Homebrew, the package manager for macOS and Linux, when brew is installed.
Without Homebrew, it recommends installing it, as ${HOMEBREW_PAGE} says,
then running this again, and, where apt is installed, asks whether to
install the tool with sudo apt install instead, sudo asking for your
computer's password at its own prompt. With neither, or when an install
fails, it names the package to install yourself. With no desktop session
open, as over ssh, no clipboard can be reached, and it installs nothing.

Examples:
  Install what is missing, from the repo's top folder:
    $ npm run os-dependencies
  The same, run with node:
    $ node install/install-os-dependencies.js

Exit codes:
  0  nothing is missing: each program is installed, now or before, or
     of no use here, with no desktop session open
  1  a program is still missing: no Homebrew or apt to install it with,
     the install with apt declined, or an install that failed; or an
     argument this command does not take`;

/**
 * Runs the command line.
 *
 * @param {string[]} argv - The arguments, shaped as `process.argv`
 * @param {Object} [deps] - What a test replaces
 * @param {string} [deps.platform=process.platform] - The platform, as Node names it
 * @param {Object<string, string>} [deps.env=process.env] - The environment, for `PATH` and the desktop session's display
 * @param {function(string): boolean} [deps.onPath] - Whether a command is installed; looked up on `PATH` when absent
 * @param {function(string): Promise<?string>} [deps.ask] - Answers a question, in place of the terminal
 * @param {function({command: string, args: string[]}): Promise<number>} [deps.runCommand=runAtTerminal] - Runs an install, giving its exit code
 * @param {{write: function(string): void}} [deps.stdout=process.stdout] - Where its lines go
 * @param {{write: function(string): void}} [deps.stderr=process.stderr] - Where its questions and errors go
 * @returns {Promise<number>} The exit code
 */
export async function runInstallCommandLine(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const env = deps.env ?? process.env;
  const run = {
    computer: {
      platform: deps.platform ?? process.platform,
      env,
      onPath: deps.onPath,
    },
    say: (line) => stdout.write(`${line}\n`),
    ask:
      deps.ask ??
      ((prompt) => askLine(prompt, { input: process.stdin, output: stderr })),
    runCommand: deps.runCommand ?? runAtTerminal,
  };
  let exitCode = 0;
  const program = new Command()
    .name("install-os-dependencies")
    .description(
      "Installs the programs of your computer's operating system, outside npm, that the repo's tools use, saying first what is installed.",
    )
    .allowExcessArguments(false)
    .addHelpText("after", HELP_AFTER)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => stdout.write(text),
      writeErr: (text) => stderr.write(text),
    })
    .action(async () => {
      exitCode = await installOsDependencies(run);
    });
  try {
    await program.parseAsync(argv);
  } catch (thrown) {
    if (thrown instanceof CommanderError) return thrown.exitCode;
    stderr.write(`${messageOf(thrown)}\n`);
    return 1;
  }
  return exitCode;
}
