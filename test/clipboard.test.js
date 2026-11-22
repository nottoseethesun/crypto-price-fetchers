/**
 * Tests for lib/clipboard.js, which finds the desktop's clipboard tool for
 * the build step, names the package that holds one for the install of the
 * operating system's programs, and copies text with the tool.
 * @module test/clipboard.test
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
  clipboardPackage,
  commandInstalled,
  copyToClipboard,
  findClipboardTool,
} from "../lib/clipboard.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

after(removeTempFolders);

describe("findClipboardTool, clipboardPackage and commandInstalled", () => {
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

  it("names xclip for an X11 session and wl-clipboard for a Wayland one, and no package on macOS, on Windows or with no desktop session", () => {
    const needed = (platform, env) =>
      clipboardPackage(computer(platform, env, []));
    assert.deepEqual(needed("linux", { DISPLAY: ":0" }), {
      packageName: "xclip",
      session: "X11",
    });
    assert.deepEqual(needed("linux", { WAYLAND_DISPLAY: "w", DISPLAY: ":0" }), {
      packageName: "wl-clipboard",
      session: "Wayland",
    });
    assert.equal(needed("linux", {}), null);
    assert.equal(needed("darwin", { DISPLAY: ":0" }), null);
    assert.equal(needed("win32", {}), null);
  });

  it("says whether a command is installed, by the lookup given or on PATH", () => {
    assert.equal(
      commandInstalled("brew", computer("linux", {}, ["brew"])),
      true,
    );
    assert.equal(
      commandInstalled("apt", computer("linux", {}, ["brew"])),
      false,
    );
    const folder = makeTempFolder("path");
    fs.writeFileSync(path.join(folder, "apt"), "#!/bin/sh\n", { mode: 0o755 });
    fs.writeFileSync(path.join(folder, "brew"), "not run\n", { mode: 0o644 });
    const onPath = { platform: "linux", env: { PATH: folder } };
    assert.equal(commandInstalled("apt", onPath), true);
    assert.equal(commandInstalled("brew", onPath), false);
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
