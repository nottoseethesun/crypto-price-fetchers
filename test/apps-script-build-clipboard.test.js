/**
 * Tests for apps-script-build/clipboard.js, which finds the desktop's
 * clipboard tool for the build step, offers its install, and copies text
 * with it.
 * @module test/apps-script-build-clipboard.test
 *
 * The computer is a stand-in: its platform, environment and installed
 * commands are given, and a stand-in spawn plays the tool.
 */

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import {
  copyToClipboard,
  findClipboardTool,
  installCommand,
} from "../apps-script-build/clipboard.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

after(removeTempFolders);

describe("findClipboardTool and installCommand", () => {
  /**
   * A computer with the commands named installed.
   *
   * @param {string} platform - As Node names it
   * @param {Object<string, string>} env - The environment
   * @param {string[]} commands - The commands installed
   * @returns {Object} The computer
   */
  function computer(platform, env, commands) {
    return { platform, env, onPath: (command) => commands.includes(command) };
  }

  it("finds wl-copy first in a Wayland session, xclip then xsel in an X11 one, pbcopy on macOS and clip on Windows", () => {
    const tool = (platform, env, commands) =>
      findClipboardTool(computer(platform, env, commands))?.command ?? null;
    assert.equal(
      tool("linux", { WAYLAND_DISPLAY: "w" }, ["xclip", "wl-copy"]),
      "wl-copy",
    );
    assert.equal(
      tool("linux", { DISPLAY: ":0" }, ["xsel", "xclip", "wl-copy"]),
      "xclip",
    );
    assert.equal(tool("linux", { DISPLAY: ":0" }, ["xsel"]), "xsel");
    assert.equal(tool("darwin", {}, ["pbcopy"]), "pbcopy");
    assert.equal(tool("win32", {}, ["clip"]), "clip");
    assert.equal(tool("linux", {}, ["xclip"]), null);
    assert.equal(tool("linux", { DISPLAY: ":0" }, []), null);
  });

  it("looks for a command on PATH when no lookup is given", () => {
    const folder = makeTempFolder("path");
    const xclip = path.join(folder, "xclip");
    fs.writeFileSync(xclip, "#!/bin/sh\n", { mode: 0o755 });
    assert.equal(
      findClipboardTool({
        platform: "linux",
        env: { DISPLAY: ":0", PATH: folder },
      })?.command,
      "xclip",
    );
    assert.equal(
      findClipboardTool({
        platform: "linux",
        env: { DISPLAY: ":0", PATH: "" },
      }),
      null,
    );
  });

  it("installs with apt on a Linux desktop alone", () => {
    const command = (platform, env, commands) =>
      installCommand(computer(platform, env, commands));
    assert.deepEqual(command("linux", { DISPLAY: ":0" }, ["apt"])?.args, [
      "apt",
      "install",
      "-y",
      "xclip",
    ]);
    assert.equal(
      command("linux", { WAYLAND_DISPLAY: "w" }, ["apt"])?.packageName,
      "wl-clipboard",
    );
    assert.equal(command("linux", { DISPLAY: ":0" }, []), null);
    assert.equal(command("linux", {}, ["apt"]), null);
    assert.equal(command("darwin", {}, ["apt"]), null);
  });
});

describe("copyToClipboard", () => {
  /**
   * A stand-in for spawn, whose tool exits as told once it has its text.
   *
   * @param {?number} code - The exit code, or null to fail to start
   * @returns {{spawn: function, got: Array}} The stand-in, and what each tool was given
   */
  function tool(code) {
    const got = [];
    const spawn = (command, args, options) => {
      const child = new EventEmitter();
      child.stdin = {
        end: (text) => {
          got.push({ command, args, stdio: options.stdio, text });
          setImmediate(() =>
            code === null
              ? child.emit("error", new Error("not found"))
              : child.emit("exit", code),
          );
        },
      };
      return child;
    };
    return { spawn, got };
  }

  it("hands the tool the text on its stdin alone, and settles once it exits", async () => {
    const { spawn, got } = tool(0);
    await copyToClipboard(
      { command: "xclip", args: ["-selection", "clipboard"] },
      "text",
      spawn,
    );
    assert.deepEqual(got, [
      {
        command: "xclip",
        args: ["-selection", "clipboard"],
        stdio: ["pipe", "ignore", "ignore"],
        text: "text",
      },
    ]);
  });

  it("fails when the tool exits with an error or cannot start", async () => {
    await assert.rejects(
      copyToClipboard({ command: "xclip", args: [] }, "text", tool(1).spawn),
      /xclip exited with code 1/,
    );
    await assert.rejects(
      copyToClipboard({ command: "xclip", args: [] }, "text", tool(null).spawn),
      /not found/,
    );
  });
});
