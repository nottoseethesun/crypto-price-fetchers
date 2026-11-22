/**
 * Tests of `install/os-dependencies.js`, the install of the operating
 * system's programs the repo's tools use, outside npm, which
 * `npm run os-dependencies` runs: what it says is installed, what it
 * installs with Homebrew or apt, what it leaves to be installed by hand,
 * its command line, and `runAtTerminal`, which runs an install.
 * @module test/os-dependencies.test
 *
 * The computer is a stand-in: its platform, environment and installed
 * commands are given, and a stand-in runs each install, recording it and
 * giving the exit code the test chooses. Only `runAtTerminal`'s own tests
 * start real programs: Node itself, and a command no computer has.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  installOsDependencies,
  runAtTerminal,
  runInstallCommandLine,
} from "../install/os-dependencies.js";
import { capturedOutput } from "./helpers/captured-output.js";

/**
 * Runs the install on a stand-in computer.
 *
 * @param {Object} options - The computer and the answers
 * @param {string} [options.platform='linux'] - As Node names it
 * @param {Object<string, string>} [options.env] - The environment
 * @param {string[]} [options.installed=[]] - The commands installed
 * @param {string} [options.answer] - The answer to the apt question; none when absent
 * @param {number} [options.code=0] - Each install's exit code
 * @param {boolean} [options.toolAfter=true] - Whether a clipboard tool is installed after an install that ended well
 * @returns {Promise<{code: number, said: string, questions: string[], installs: string[][]}>} What it returned, said, asked and ran
 */
async function install(options) {
  const installed = new Set(options.installed ?? []);
  const questions = [];
  const installs = [];
  const said = [];
  const code = await installOsDependencies({
    computer: {
      platform: options.platform ?? "linux",
      env: options.env ?? { DISPLAY: ":0" },
      onPath: (command) => installed.has(command),
    },
    say: (line) => said.push(line),
    ask: async (prompt) => {
      questions.push(prompt);
      return options.answer ?? null;
    },
    runCommand: async (command) => {
      installs.push([command.command, ...command.args]);
      const exit = options.code ?? 0;
      if (exit === 0 && options.toolAfter !== false) {
        installed.add(command.args.includes("xclip") ? "xclip" : "wl-copy");
      }
      return exit;
    },
  });
  return { code, said: said.join("\n"), questions, installs };
}

describe("installOsDependencies", () => {
  it("installs nothing where a clipboard tool is installed, naming it", async () => {
    for (const [platform, env, installed, tool] of [
      ["linux", { DISPLAY: ":0" }, ["xsel"], "xsel"],
      ["linux", { WAYLAND_DISPLAY: "w" }, ["xclip"], "xclip"],
      ["darwin", {}, ["pbcopy"], "pbcopy"],
      ["win32", {}, ["clip"], "clip"],
    ]) {
      const result = await install({ platform, env, installed });
      assert.equal(result.code, 0);
      assert.equal(result.said, `The clipboard tool, ${tool}, is installed.`);
      assert.deepEqual(result.installs, []);
    }
  });

  it("names the tool macOS or Windows comes with when it is not on PATH, and ends with 1", async () => {
    const result = await install({ platform: "darwin", env: {} });
    assert.equal(result.code, 1);
    assert.match(result.said, /pbcopy, comes with macOS, but is not on PATH/);
  });

  it("installs nothing with no desktop session open, as over ssh, and ends with 0", async () => {
    const result = await install({ env: {}, installed: ["brew", "apt"] });
    assert.equal(result.code, 0);
    assert.match(result.said, /No desktop session is open/);
    assert.deepEqual(result.installs, []);
    assert.deepEqual(result.questions, []);
  });

  it("installs xclip for an X11 session, and wl-clipboard for a Wayland one, with Homebrew, asking nothing", async () => {
    const x11 = await install({ installed: ["brew", "apt"] });
    assert.equal(x11.code, 0);
    assert.deepEqual(x11.installs, [["brew", "install", "xclip"]]);
    assert.deepEqual(x11.questions, []);
    assert.match(
      x11.said,
      /^Installing xclip, the clipboard tool of X11 sessions, with Homebrew: brew install xclip\nxclip is installed\.$/,
    );
    const wayland = await install({
      env: { WAYLAND_DISPLAY: "w" },
      installed: ["brew"],
    });
    assert.deepEqual(wayland.installs, [["brew", "install", "wl-clipboard"]]);
    assert.equal(wayland.code, 0);
  });

  it("without Homebrew, recommends it, and installs with apt on a yes", async () => {
    const result = await install({ installed: ["apt"], answer: "y" });
    assert.match(
      result.said,
      /Homebrew, the package manager for macOS and Linux, is not installed\. It is the way recommended here, on Linux and macOS alike: install it, as https:\/\/brew\.sh says, then run npm run os-dependencies again\./,
    );
    assert.deepEqual(result.questions, [
      "Or install xclip, the clipboard tool of X11 sessions, now, with apt: sudo apt install -y xclip? (y/N) ",
    ]);
    assert.deepEqual(result.installs, [
      ["sudo", "apt", "install", "-y", "xclip"],
    ]);
    assert.equal(result.code, 0);
  });

  it("leaves the package to be installed by hand, ending with 1, when the apt question is declined or unanswered, or with neither Homebrew nor apt", async () => {
    for (const options of [
      { installed: ["apt"], answer: "n" },
      { installed: ["apt"], answer: "" },
      { installed: ["apt"] },
      { installed: [] },
    ]) {
      const result = await install(options);
      assert.equal(result.code, 1);
      assert.deepEqual(result.installs, []);
      assert.match(
        result.said,
        /Install xclip yourself, with your system's package manager: the build step puts its file on the clipboard with it, and writes the file to dist\/apps-script\/ without it\.$/,
      );
    }
  });

  it("names an install's exit code, or a tool still not on PATH after it, and leaves the package to be installed by hand", async () => {
    const failed = await install({ installed: ["brew"], code: 7 });
    assert.equal(failed.code, 1);
    assert.match(
      failed.said,
      /The install ended with exit code 7\.\nInstall xclip yourself/,
    );
    const missing = await install({ installed: ["brew"], toolAfter: false });
    assert.equal(missing.code, 1);
    assert.match(
      missing.said,
      /The install ended, but no clipboard tool is on PATH\./,
    );
  });
});

describe("runAtTerminal", () => {
  it("gives the command's exit code, and 1 when it cannot start", async () => {
    assert.equal(
      await runAtTerminal({
        command: process.execPath,
        args: ["-e", "process.exit(3)"],
      }),
      3,
    );
    assert.equal(
      await runAtTerminal({ command: "no-such-command-anywhere", args: [] }),
      1,
    );
  });
});

describe("runInstallCommandLine", () => {
  /**
   * Runs the command line on a stand-in computer.
   *
   * @param {string[]} args - The arguments after the file's name
   * @param {string[]} installed - The commands installed
   * @returns {Promise<{code: number, stdout: string, stderr: string, installs: string[][]}>} What it did
   */
  async function run(args, installed) {
    const stdout = capturedOutput();
    const stderr = capturedOutput();
    const installs = [];
    const code = await runInstallCommandLine(
      ["node", "install/install-os-dependencies.js", ...args],
      {
        platform: "linux",
        env: { DISPLAY: ":0" },
        onPath: (command) => installed.includes(command),
        ask: async () => null,
        runCommand: async (command) => {
          installs.push([command.command, ...command.args]);
          return 0;
        },
        stdout,
        stderr,
      },
    );
    return { code, stdout: stdout.text, stderr: stderr.text, installs };
  }

  it("ends with the install's exit code: 0 with a tool installed, 1 with one still missing", async () => {
    const present = await run([], ["xclip"]);
    assert.equal(present.code, 0);
    assert.equal(present.stdout, "The clipboard tool, xclip, is installed.\n");
    const missing = await run([], []);
    assert.equal(missing.code, 1);
    assert.match(missing.stdout, /Install xclip yourself/);
  });

  it("refuses an argument it does not take, with exit code 1, installing nothing", async () => {
    const result = await run(["xclip"], ["brew"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /too many arguments/);
    assert.deepEqual(result.installs, []);
  });
});
