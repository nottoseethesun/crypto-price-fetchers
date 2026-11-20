/**
 * The clipboard, reached through the desktop's own tool, and the command
 * that installs such a tool.
 * @module apps-script-build/clipboard
 *
 * What: Node has no clipboard of its own. The clipboard belongs to the
 * desktop session, and a program reaches it through that session's tool:
 * wl-copy in a Wayland session, xclip or xsel in an X11 one, pbcopy on
 * macOS, clip on Windows. `findClipboardTool` names the one installed, or
 * gives null when none is, or when no desktop session is open, as over
 * ssh, where no tool could reach a clipboard. `copyToClipboard` hands the
 * tool the text on its stdin. `installCommand` gives the command that
 * installs one, on a Linux desktop with apt: xclip for X11, wl-clipboard
 * for Wayland.
 *
 * How: xclip and wl-copy keep running in the background to serve the text
 * until something else is copied, so the copy is done once the tool's
 * first process exits, and the tool is handed no pipe but its stdin, which
 * it would otherwise hold open after the copy.
 *
 * Fit: `index.js` copies each built file with these, and offers the
 * install when no tool is found.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";

/** The tools, by name, each with the arguments that make it copy its stdin. */
export const CLIPBOARD_TOOLS = Object.freeze({
  "wl-copy": Object.freeze({ command: "wl-copy", args: Object.freeze([]) }),
  xclip: Object.freeze({
    command: "xclip",
    args: Object.freeze(["-selection", "clipboard"]),
  }),
  xsel: Object.freeze({
    command: "xsel",
    args: Object.freeze(["--clipboard", "--input"]),
  }),
  pbcopy: Object.freeze({ command: "pbcopy", args: Object.freeze([]) }),
  clip: Object.freeze({ command: "clip", args: Object.freeze([]) }),
});

/**
 * What a lookup needs of the computer: what a test replaces.
 *
 * @typedef {Object} Computer
 * @property {string} platform - As `process.platform` names it
 * @property {Object<string, string>} env - The environment, for `PATH` and the session's display
 * @property {function(string): boolean} [onPath] - Whether a command is installed; looked up on `PATH` when absent
 */

/**
 * Says whether a command is installed: an executable file of that name in
 * one of the folders `PATH` lists.
 *
 * @param {string} command - The command, such as 'xclip'
 * @param {Computer} computer - The platform and the environment
 * @returns {boolean} Whether it is installed
 */
function installed(command, computer) {
  if (typeof computer.onPath === "function") return computer.onPath(command);
  const names =
    computer.platform === "win32" ? [`${command}.exe`, command] : [command];
  for (const folder of (computer.env.PATH ?? "").split(path.delimiter)) {
    for (const name of names) {
      try {
        fs.accessSync(path.join(folder, name), fs.constants.X_OK);
        return true;
      } catch {
        // Not in this folder
      }
    }
  }
  return false;
}

/**
 * The tools a Linux desktop session can use, in the order to try them.
 *
 * @param {Object<string, string>} env - The environment
 * @returns {string[]} The tools' names; none when no session is open
 */
function linuxTools(env) {
  if (env.WAYLAND_DISPLAY) return ["wl-copy", "xclip", "xsel"];
  if (env.DISPLAY) return ["xclip", "xsel"];
  return [];
}

/**
 * Names the tool that puts text on this computer's clipboard.
 *
 * @param {Computer} computer - The platform and the environment
 * @returns {?{command: string, args: string[]}} The tool, or null when none is installed or no desktop session is open
 */
export function findClipboardTool(computer) {
  let names;
  if (computer.platform === "darwin") names = ["pbcopy"];
  else if (computer.platform === "win32") names = ["clip"];
  else names = linuxTools(computer.env);
  const name = names.find((candidate) => installed(candidate, computer));
  return name === undefined ? null : CLIPBOARD_TOOLS[name];
}

/**
 * Gives the command that installs a clipboard tool: on a Linux desktop
 * with apt, xclip for an X11 session or wl-clipboard, which holds wl-copy,
 * for a Wayland one.
 *
 * @param {Computer} computer - The platform and the environment
 * @returns {?{packageName: string, command: string, args: string[]}} The command, run with sudo; null where apt cannot install one, or no desktop session is open
 */
export function installCommand(computer) {
  if (computer.platform !== "linux") return null;
  if (linuxTools(computer.env).length === 0) return null;
  if (!installed("apt", computer)) return null;
  const packageName = computer.env.WAYLAND_DISPLAY ? "wl-clipboard" : "xclip";
  return {
    packageName,
    command: "sudo",
    args: ["apt", "install", "-y", packageName],
  };
}

/**
 * Puts text on the clipboard through a tool.
 *
 * @param {{command: string, args: string[]}} tool - The tool (`findClipboardTool`)
 * @param {string} text - The text
 * @param {function(string, string[], Object): import('node:child_process').ChildProcess} [spawn] - Starts the tool; Node's spawn when absent
 * @returns {Promise<void>} Settles once the tool has the text
 * @throws {Error} When the tool cannot start, or exits with an error
 */
export function copyToClipboard(tool, text, spawn = nodeSpawn) {
  return new Promise((resolve, reject) => {
    const child = spawn(tool.command, [...tool.args], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${tool.command} exited with code ${code}`));
    });
    child.stdin.end(text);
  });
}
