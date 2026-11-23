/**
 * The clipboard, reached through the desktop's own tool, and the package
 * that holds such a tool.
 * @module lib/clipboard
 *
 * What: Node has no clipboard of its own. The clipboard belongs to the
 * desktop session, and a program reaches it through that session's tool:
 * wl-copy in a Wayland session, xclip or xsel in an X11 one, pbcopy on
 * macOS, clip on Windows. `findClipboardTool` names the one installed, or
 * gives null when none is, or when no desktop session is open, as over
 * ssh, where no tool could reach a clipboard. `copyToClipboard` hands the
 * tool the text on its stdin. `clipboardPackage` names the package that
 * holds a tool for a Linux desktop session: xclip for X11, wl-clipboard,
 * which holds wl-copy, for Wayland. `commandInstalled` says whether a
 * command, such as a package manager, is installed.
 *
 * How: xclip and wl-copy keep running in the background to serve the text
 * until something else is copied, so the copy is done once the tool's
 * first process exits, and the tool is handed no pipe but its stdin, which
 * it would otherwise hold open after the copy.
 *
 * Fit: the build step (`build/tools/apps-script-build/index.js`) copies
 * the built file with these, and `install/os-dependencies.js` installs a
 * tool when none is found.
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
export function commandInstalled(command, computer) {
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
  const name = names.find((candidate) => commandInstalled(candidate, computer));
  return name === undefined ? null : CLIPBOARD_TOOLS[name];
}

/**
 * Names the package that holds a clipboard tool for a desktop session
 * outside macOS and Windows, whose own tools come with them: xclip for an
 * X11 session, wl-clipboard, which holds wl-copy, for a Wayland one.
 *
 * @param {Computer} computer - The platform and the environment
 * @returns {?{packageName: string, session: string}} The package and the kind of session; null on macOS and Windows, or when no desktop session is open
 */
export function clipboardPackage(computer) {
  if (computer.platform === "darwin" || computer.platform === "win32")
    return null;
  if (computer.env.WAYLAND_DISPLAY)
    return { packageName: "wl-clipboard", session: "Wayland" };
  if (computer.env.DISPLAY) return { packageName: "xclip", session: "X11" };
  return null;
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
    // A tool that exits without reading its input, as xclip does when it
    // cannot open the display, closes the pipe: its exit code then says why
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${tool.command} exited with code ${code}`));
    });
    child.stdin.end(text);
  });
}
