/**
 * Tests for apps-script-build/, the build step: `npm run build apps-script`.
 * @module test/apps-script-build.test
 *
 * The build runs in process with stand-ins for what reaches outside it: the
 * clipboard (`copy`), the install command, the questions, and the web,
 * where the services check the keys (`helpers/stand-in-web.js`). Its
 * project top is a temp folder, removed afterwards, whose config.json
 * lists the four services the scripts send keys to, and whose key file the
 * test saves; the scripts themselves are the repo's. No test opens the
 * owner's key file, and none passes a password it did not set.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { saveEncryptedKey } from "../api-key-store/index.js";
import { createAppsScriptServices } from "../apps-script-runner/apps-script-services.js";
import { loadAppsScript } from "../apps-script-runner/load-apps-script.js";
import {
  APPS_SCRIPTS,
  BUILD_FOLDER,
  runBuild,
} from "../apps-script-build/index.js";
import { builtFiles, configBlock } from "../apps-script-build/built-script.js";
import {
  copyToClipboard,
  findClipboardTool,
  installCommand,
} from "../apps-script-build/clipboard.js";
import { capturedOutput } from "./helpers/captured-output.js";
import { standInFetch } from "./helpers/stand-in-web.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

/** The keys the test saves, none of which any output may show. */
const KEYS = Object.freeze({
  coingecko: "gecko-key-1",
  coinpaprika: "paprika-key-2",
  dextools: "dex-key-3",
  x1ninja: "x1-key-4",
});

/** The committed text of each file the build gives, in its order. */
const COMMITTED = APPS_SCRIPTS.flatMap((spec) => spec.files).map((file) =>
  fs.readFileSync(file.path, "utf8"),
);

/** The scripts, each reading a config.json that does not exist, whatever the owner's hold. */
let scripts;

/**
 * Answers the services' key checks as each takes a key: 200 for every one.
 *
 * @returns {Object} An empty json body, with status 200
 */
function takeEveryKey() {
  return {};
}

let top;
let keyFile;

before(async () => {
  top = makeTempFolder("apps-script-build");
  fs.writeFileSync(
    path.join(top, "config.json"),
    JSON.stringify({ apiKeys: Object.keys(KEYS) }),
  );
  keyFile = path.join(top, "api-keys.json");
  for (const [service, key] of Object.entries(KEYS)) {
    await saveEncryptedKey(keyFile, service, key, "pw");
  }
  scripts = APPS_SCRIPTS.map((spec) => ({
    ...spec,
    defaultConfigFile: path.join(top, `${spec.name}-config.json`),
  }));
});

after(removeTempFolders);

/**
 * Runs the build with stand-ins, recording what it copied and asked.
 *
 * @param {string[]} args - The arguments after `build`
 * @param {Object} [options] - What differs from a desktop with xclip and saved keys
 * @param {Object<string, string>} [options.env] - More environment
 * @param {string[]} [options.installed=['xclip']] - The commands installed
 * @param {function(string): ?string} [options.answer] - Answers each question; Enter when absent
 * @param {function(Object): *} [options.web=takeEveryKey] - The services' answers
 * @param {function(Object): number} [options.install] - Runs the install, giving its exit code
 * @returns {Promise<Object>} The exit code, the output, the copies, the questions and the installs
 */
async function build(args, options = {}) {
  const installed = new Set(options.installed ?? ["xclip"]);
  const copies = [];
  const questions = [];
  const installs = [];
  const stdout = capturedOutput();
  const stderr = capturedOutput();
  const exitCode = await runBuild(
    ["node", "build.js", ...args],
    { projectTop: top, scripts },
    {
      env: {
        API_KEYS_FILE_PATH: keyFile,
        API_KEYS_PASSWORD: "pw",
        DISPLAY: ":0",
        ...options.env,
      },
      platform: "linux",
      onPath: (command) => installed.has(command),
      ask: async (prompt) => {
        questions.push(prompt);
        return options.answer === undefined ? "" : options.answer(prompt);
      },
      askSecret: async () => assert.fail("asked for a password"),
      checkOptions: {
        fetch: standInFetch(options.web ?? takeEveryKey),
        sleep: async () => {},
      },
      copy: async (tool, text) => copies.push({ tool: tool.command, text }),
      runInstall: async (install) => {
        installs.push([install.command, ...install.args]);
        const code = options.install === undefined ? 0 : options.install();
        if (code === 0)
          installed.add(install.packageName === "xclip" ? "xclip" : "wl-copy");
        return code;
      },
      stdout,
      stderr,
    },
  );
  const output = stdout.text + stderr.text;
  return { exitCode, output, stdout: stdout.text, copies, questions, installs };
}

/**
 * Asserts that a text shows no character run of any saved key.
 *
 * @param {string} text - The text
 * @returns {void}
 */
function assertNoKey(text) {
  for (const key of Object.values(KEYS)) {
    assert.ok(!text.includes(key), "a key was shown");
  }
}

describe("npm run build apps-script, on a desktop with a clipboard tool", () => {
  it("copies each file in turn, the first of each script with its keys set at its end, then clears the clipboard", async () => {
    const result = await build(["apps-script"]);
    assert.equal(result.exitCode, 0, result.output);
    assert.deepEqual(
      result.copies.map((copy) => copy.tool),
      ["xclip", "xclip", "xclip", "xclip", "xclip"],
    );
    const texts = result.copies.map((copy) => copy.text);
    assert.ok(texts[0].startsWith(COMMITTED[0]));
    assert.match(texts[0], /\nCONFIG\.API_KEY = "dex-key-3";\n/);
    assert.match(texts[0], /\nX1_CONFIG\.API_KEY = "x1-key-4";\n$/);
    assert.ok(texts[1].startsWith(COMMITTED[1]));
    assert.match(texts[1], /\nCONFIG\.COINGECKO_API_KEY = "gecko-key-1";\n/);
    assert.match(
      texts[1],
      /\nCONFIG\.COINPAPRIKA_API_KEY = "paprika-key-2";\n$/,
    );
    assert.equal(texts[2], COMMITTED[2]);
    assert.equal(texts[3], COMMITTED[3]);
    assert.equal(texts[4], "");
    assert.equal(result.questions.length, 4);
    assert.match(
      result.stdout,
      /^1 of 4: crypto-price-fetchers\.gs is on your clipboard/m,
    );
    assert.match(result.stdout, /Extensions > Apps Script/);
    assert.match(result.stdout, /This one is optional/);
    assert.match(result.stdout, /The clipboard is cleared\./);
    assertNoKey(result.output);
  });

  it("gives a script that runs with the keys set, as its Node version sets them", async () => {
    const result = await build([
      "apps-script",
      "getCryptoPriceFromCentralizedExchange",
    ]);
    const services = createAppsScriptServices({
      fetchSync: () => ({ failure: "no web here" }),
    });
    const context = loadAppsScript(
      [
        { source: result.copies[0].text, filename: "main.gs" },
        { source: result.copies[1].text, filename: "sources.gs" },
      ],
      services,
    );
    assert.equal(
      vm.runInContext("CONFIG.COINGECKO_API_KEY", context),
      "gecko-key-1",
    );
    assert.equal(
      vm.runInContext("CONFIG.COINPAPRIKA_API_KEY", context),
      "paprika-key-2",
    );
    assert.equal(result.copies.length, 4);
  });

  it("sets the values of the config.json the Node version reads, with the keys laid over them", async () => {
    const configFile = scripts[1].defaultConfigFile;
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        CONFIG: { GENERAL_DELAY_MS: 500, COINGECKO_API_KEY: "" },
      }),
    );
    try {
      const result = await build([
        "apps-script",
        "getCryptoPriceFromCentralizedExchange",
      ]);
      assert.match(
        result.copies[0].text,
        /\nCONFIG\.GENERAL_DELAY_MS = 500;\nCONFIG\.COINGECKO_API_KEY = "gecko-key-1";\nCONFIG\.COINPAPRIKA_API_KEY = "paprika-key-2";\n$/,
      );
    } finally {
      fs.rmSync(configFile);
    }
  });

  it("refuses a script it does not know, with exit code 1", async () => {
    const result = await build(["apps-script", "no-such-script"]);
    assert.equal(result.exitCode, 1);
    assert.match(
      result.output,
      /No Sheets script is named that; the scripts are crypto-price-fetchers, getCryptoPriceFromCentralizedExchange/,
    );
    assert.deepEqual(result.copies, []);
  });

  it("gives the scripts as committed when no key is saved", async () => {
    const result = await build(["apps-script"], {
      env: { API_KEYS_FILE_PATH: path.join(top, "no-such-keys.json") },
    });
    assert.equal(result.exitCode, 0, result.output);
    assert.deepEqual(
      result.copies.slice(0, 4).map((copy) => copy.text),
      COMMITTED,
    );
  });

  it("stops with exit code 1, copying nothing and showing no key, when a service refuses a saved key", async () => {
    const result = await build(["apps-script"], {
      web: ({ url }) =>
        url.endsWith("/ping") ? { status: 401, text: "{}" } : {},
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /CoinGecko refused the api key saved in/);
    assert.deepEqual(result.copies, []);
    assertNoKey(result.output);
  });

  it("answers --help, asking for no password", async () => {
    const result = await build(["apps-script", "--help"]);
    assert.equal(result.exitCode, 0);
    assert.match(
      result.stdout,
      /Usage: build apps-script \[options\] \[script\]/,
    );
  });
});

describe("npm run build apps-script, with no clipboard tool installed", () => {
  it("offers to install xclip, runs the install on a yes, then copies", async () => {
    const result = await build(["apps-script", "crypto-price-fetchers"], {
      installed: ["apt"],
      answer: (prompt) => (prompt.includes("Install") ? "y" : ""),
    });
    assert.equal(result.exitCode, 0, result.output);
    assert.match(
      result.questions[0],
      /Install xclip now, with: sudo apt install -y xclip\? \(y\/N\)/,
    );
    assert.deepEqual(result.installs, [
      ["sudo", "apt", "install", "-y", "xclip"],
    ]);
    assert.equal(result.copies.length, 2);
  });

  it("offers wl-clipboard in a Wayland session", async () => {
    const result = await build(["apps-script", "crypto-price-fetchers"], {
      env: { WAYLAND_DISPLAY: "wayland-0" },
      installed: ["apt"],
      answer: (prompt) => (prompt.includes("Install") ? "y" : ""),
    });
    assert.deepEqual(result.installs, [
      ["sudo", "apt", "install", "-y", "wl-clipboard"],
    ]);
    assert.equal(result.copies[0].tool, "wl-copy");
  });

  it("declined, says the keys go to disk in the clear, then writes each file readable by its owner alone", async () => {
    const result = await build(["apps-script"], {
      installed: ["apt"],
      answer: () => "n",
    });
    assert.equal(result.exitCode, 0, result.output);
    assert.deepEqual(result.copies, []);
    const warning = result.stdout.indexOf("written to disk in the clear");
    const folder = path.join(top, BUILD_FOLDER);
    assert.ok(warning >= 0 && warning < result.stdout.indexOf(folder));
    assert.equal(fs.statSync(folder).mode & 0o777, 0o700);
    const first = path.join(folder, "crypto-price-fetchers.gs");
    assert.equal(fs.statSync(first).mode & 0o777, 0o600);
    assert.match(
      fs.readFileSync(first, "utf8"),
      /CONFIG\.API_KEY = "dex-key-3";/,
    );
    assert.equal(
      fs.readFileSync(
        path.join(folder, "getCryptoPriceFromCentralizedExchange-sources.gs"),
        "utf8",
      ),
      COMMITTED[2],
    );
    assertNoKey(result.output);
  });

  it("offers no install and writes the files where the install would fail: when the install fails, without apt, or with no desktop session", async () => {
    const failed = await build(["apps-script", "crypto-price-fetchers"], {
      installed: ["apt"],
      answer: () => "y",
      install: () => 100,
    });
    assert.match(failed.stdout, /The install ended with exit code 100\./);
    assert.deepEqual(failed.copies, []);
    for (const options of [
      { installed: [] },
      { installed: ["apt", "xclip"], env: { DISPLAY: "" } },
    ]) {
      const result = await build(
        ["apps-script", "crypto-price-fetchers"],
        options,
      );
      assert.deepEqual(result.questions, []);
      assert.deepEqual(result.copies, []);
      assert.match(result.stdout, /in the clear/);
    }
  });
});

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

describe("the built script's block", () => {
  it("sets each field as JSON, after a dot when it can and in brackets otherwise", () => {
    const block = configBlock({
      CONFIG: { API_KEY: 'a "quoted" key', "odd-name": 2, LIST: [1, "b"] },
    });
    assert.match(block, /^\n\/\/ -+\n\/\/ Set by `npm run build apps-script`/);
    assert.match(block, /\nCONFIG\.API_KEY = "a \\"quoted\\" key";\n/);
    assert.match(block, /\nCONFIG\["odd-name"\] = 2;\n/);
    assert.match(block, /\nCONFIG\.LIST = \[1,"b"\];\n$/);
    assert.equal(configBlock({}), "");
    assert.equal(configBlock({ CONFIG: {} }), "");
  });

  it("refuses a field the script does not have, as the Node version does", () => {
    assert.throws(
      () =>
        builtFiles(
          APPS_SCRIPTS[0].files,
          { CONFIG: { NO_SUCH_FIELD: 1 } },
          false,
        ),
      /The script's CONFIG has no field NO_SUCH_FIELD/,
    );
  });
});
