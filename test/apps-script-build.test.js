/**
 * Tests for build/tools/apps-script-build/, the build step: `npm run build apps-script`.
 * @module test/apps-script-build.test
 *
 * The build runs in process with stand-ins for what reaches outside it: the
 * clipboard (`copy`), the install command, the questions, DEX Screener's
 * part, whose download and compile `dex-screener.test.js` tests, and the
 * web, where the services check the keys (`helpers/stand-in-web.js`). Its
 * project top is a temp folder, removed afterwards, whose config.json
 * lists the four services the scripts send keys to, and whose key file the
 * test saves; the scripts themselves are the repo's. No test opens the
 * owner's key file, and none passes a password it did not set.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
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
} from "../build/tools/apps-script-build/index.js";
import { BUILT_FILE_NAME } from "../build/tools/apps-script-build/built-script.js";
import { RETRY_ADVICE } from "../build/tools/apps-script-build/dex-screener.js";
import { DEX_SCREENER } from "../build/tools/apps-script-build/dex-screener-files.js";
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

/** The menu, the built file's first part. */
const MENU_SOURCE = fs.readFileSync(
  new URL("../src/crypto-price-fetchers-menu.gs", import.meta.url),
  "utf8",
);

/** The committed text of each script file the build joins after the menu, in its order. */
const COMMITTED = APPS_SCRIPTS.flatMap((spec) => spec.files).map((file) =>
  fs.readFileSync(file.path, "utf8"),
);

/** A stand-in for DEX Screener's part: one function, held as the real part holds them. */
const STAND_IN_DEX_SCREENER = Object.freeze({
  text: [
    "const DEX_SCREENER_FUNCTIONS = { DEX_SCREENER_PAIR_PROP: () => 7 };",
    "function DEX_SCREENER_PAIR_PROP(...args) {",
    "  return DEX_SCREENER_FUNCTIONS.DEX_SCREENER_PAIR_PROP(...args);",
    "}",
  ].join("\n"),
  required: [
    "DEX_SCREENER_PAIR_PROP",
    "DEX_SCREENER_FUNCTIONS.DEX_SCREENER_PAIR_PROP",
  ],
});

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
 * @param {function(Object): number} [options.install] - Runs an install, giving its exit code
 * @param {function(Object): Promise<Object>} [options.dexScreener] - Gives DEX Screener's part; the stand-in when absent
 * @returns {Promise<Object>} The exit code, the output, the copies, the questions, the installs, the web's requests and DEX Screener's calls
 */
async function build(args, options = {}) {
  const installed = new Set(options.installed ?? ["xclip"]);
  const copies = [];
  const questions = [];
  const installs = [];
  const dexScreenerCalls = [];
  const web = standInFetch(options.web ?? takeEveryKey);
  const stdout = capturedOutput();
  const stderr = capturedOutput();
  const exitCode = await runBuild(
    ["node", "build/tools/build.js", ...args],
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
      checkOptions: { fetch: web, sleep: async () => {} },
      dexScreener: async (request) => {
        dexScreenerCalls.push(request);
        request.say("The audit's line.");
        return options.dexScreener === undefined
          ? STAND_IN_DEX_SCREENER
          : options.dexScreener(request);
      },
      now: () => Date.UTC(2026, 10, 20, 12),
      copy: async (tool, text) => copies.push({ tool: tool.command, text }),
      runCommand: async (install) => {
        installs.push([install.command, ...install.args]);
        const code = options.install === undefined ? 0 : options.install();
        if (code === 0)
          installed.add(install.args.includes("xclip") ? "xclip" : "wl-copy");
        return code;
      },
      stdout,
      stderr,
    },
  );
  const output = stdout.text + stderr.text;
  return {
    exitCode,
    output,
    stdout: stdout.text,
    stderr: stderr.text,
    copies,
    questions,
    installs,
    webRequests: web.requests,
    dexScreenerCalls,
  };
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

/**
 * Asserts that each text is in the file, each after the one before.
 *
 * @param {string} file - The file's text
 * @param {string[]} texts - The texts, in order
 * @returns {void}
 */
function assertInOrder(file, texts) {
  let from = 0;
  for (const text of texts) {
    const at = file.indexOf(text.trimEnd(), from);
    assert.ok(
      at >= from,
      `a part is missing or out of order: ${text.slice(0, 60)}`,
    );
    from = at + text.trimEnd().length;
  }
}

/**
 * Loads a built file as Apps Script would, with the runner's services.
 *
 * @param {string} text - The file
 * @returns {Object} Its context
 */
function loadBuilt(text) {
  return loadAppsScript(
    [{ source: text, filename: BUILT_FILE_NAME }],
    createAppsScriptServices({ fetchSync: () => ({ failure: "no web here" }) }),
  );
}

describe("npm run build apps-script, on a desktop with a clipboard tool", () => {
  it("asks about DEX Screener's functions first, naming the commit and saying the step is optional", async () => {
    const result = await build(["apps-script"]);
    assert.equal(result.exitCode, 0, result.output);
    const question = result.questions[0];
    assert.match(
      question,
      /DEX Screener's Google Sheets functions \(DEX_SCREENER_PAIR_PROP, DEX_SCREENER_PAIR and DEX_SCREENER_REFRESH_INTERVAL\)/,
    );
    assert.ok(question.includes(`https://github.com/${DEX_SCREENER.repo}`));
    assert.ok(question.includes(`commit ${DEX_SCREENER.commit}`));
    assert.match(
      question,
      /This step is optional: if the build fails, run it again and answer n\./,
    );
    assert.match(question, /\(Y\/n\) $/);
    const [call] = result.dexScreenerCalls;
    assert.equal(result.dexScreenerCalls.length, 1);
    assert.equal(call.projectTop, top);
    assert.equal(call.fetch, globalThis.fetch);
    assert.equal(call.version, DEX_SCREENER);
    assert.match(result.stdout, /^The audit's line\.$/m);
  });

  it("copies the one file, every part in order with the keys set at its end, then clears the clipboard", async () => {
    const result = await build(["apps-script"]);
    assert.deepEqual(
      result.copies.map((copy) => copy.tool),
      ["xclip", "xclip"],
    );
    const [file, cleared] = result.copies.map((copy) => copy.text);
    assert.equal(cleared, "");
    assert.match(
      file,
      /^\/\*\*\n \* Crypto Price Fetchers – the one script file/,
    );
    assert.match(file, /Built on 2026-11-20 \(UTC\)/);
    assertInOrder(file, [
      MENU_SOURCE,
      ...COMMITTED,
      STAND_IN_DEX_SCREENER.text,
    ]);
    for (const name of [
      "src/crypto-price-fetchers-menu.gs",
      "crypto-price-fetchers/src/crypto-price-fetchers.gs",
      "fetch-from-centralized-exchange/src/getCryptoPriceFromCentralizedExchange-tests.gs",
    ]) {
      assert.ok(file.includes(`\n// ${name}\n`), name);
    }
    assert.ok(!file.includes("\n// ../"));
    assert.match(file, /\nDEXTOOLS_CONFIG\.API_KEY = "dex-key-3";\n/);
    assert.match(file, /\nX1_CONFIG\.API_KEY = "x1-key-4";\n/);
    assert.match(file, /\nCONFIG\.COINGECKO_API_KEY = "gecko-key-1";\n/);
    assert.match(file, /\nCONFIG\.COINPAPRIKA_API_KEY = "paprika-key-2";\n/);
    assert.match(file, /\nHELP_PAGE\.HTML = "<!DOCTYPE html>.*";\n$/);
    assert.match(
      result.stdout,
      /^The script, \d+ lines, is on your clipboard\.$/m,
    );
    assert.match(result.stdout, /Extensions > Apps Script/);
    assert.match(
      result.stdout,
      /getCryptoPriceFromCentralizedExchange-tests, DEX Screener's own file\./,
    );
    assert.match(result.stdout, /The clipboard is cleared\./);
    assert.equal(result.questions.length, 2);
    assertNoKey(result.output);
  });

  it("gives a file that loads as one Apps Script project, with the keys, the menu and the Help page set", async () => {
    const result = await build(["apps-script"]);
    const context = loadBuilt(result.copies[0].text);
    const read = (expression) => vm.runInContext(expression, context);
    assert.equal(read("DEXTOOLS_CONFIG.API_KEY"), "dex-key-3");
    assert.equal(read("CONFIG.COINPAPRIKA_API_KEY"), "paprika-key-2");
    for (const name of [
      "onOpen",
      "dexToolsGetTokenPrice",
      "getCryptoPrice",
      "testGetCryptoPrice",
      "DEX_SCREENER_PAIR_PROP",
    ]) {
      assert.equal(typeof context[name], "function", name);
    }
    assert.equal(context.DEX_SCREENER_PAIR_PROP(), 7);
    const help = read("HELP_PAGE.HTML");
    for (const heading of [
      "The Crypto Price Fetchers menu",
      "Current prices: dexToolsGetTokenPrice and dexToolsGetTokenFDV",
      "Past prices: getCryptoPrice",
      "DEX Screener's functions",
    ]) {
      assert.ok(help.includes(`<h2>${heading}</h2>`), heading);
    }
  });

  it("answered n, leaves DEX Screener's functions and their help out, and says how to keep DEX Screener's own file", async () => {
    const result = await build(["apps-script"], {
      answer: (prompt) => (prompt.includes("DEX Screener") ? "n" : ""),
    });
    assert.equal(result.exitCode, 0, result.output);
    assert.deepEqual(result.dexScreenerCalls, []);
    const file = result.copies[0].text;
    assert.ok(!file.includes("DEX_SCREENER_FUNCTIONS"));
    assert.ok(!file.includes("<h2>DEX Screener"));
    assert.match(result.stdout, /either menu can be the one that appears/);
    assert.ok(!result.stdout.includes("DEX Screener's own file."));
  });

  it("asks again on an answer that is neither y nor n, and takes y when the input ends", async () => {
    const answers = ["maybe", "Y"];
    const asked = await build(["apps-script"], {
      answer: (prompt) =>
        prompt.includes("DEX Screener") ? answers.shift() : "",
    });
    assert.equal(asked.questions.filter((q) => q.includes("DEX")).length, 2);
    assert.match(asked.stderr, /Answer y or n, or press Enter for y\./);
    assert.equal(asked.dexScreenerCalls.length, 1);
    const ended = await build(["apps-script"], {
      answer: (prompt) => (prompt.includes("DEX Screener") ? null : ""),
    });
    assert.equal(ended.dexScreenerCalls.length, 1);
  });

  it("stops with exit code 1, before opening the keys, when DEX Screener's functions cannot be had, saying to build again with n", async () => {
    const result = await build(["apps-script"], {
      dexScreener: async () => {
        throw new Error(
          `Could not download the file: status 500\n${RETRY_ADVICE}`,
        );
      },
    });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes(RETRY_ADVICE));
    assert.deepEqual(result.webRequests, []);
    assert.deepEqual(result.copies, []);
  });

  it("sets the values of the config.json each Node version reads, with the keys laid over them", async () => {
    const configFile = scripts[1].defaultConfigFile;
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        CONFIG: { GENERAL_DELAY_MS: 500 },
      }),
    );
    try {
      const result = await build(["apps-script"]);
      assert.match(
        result.copies[0].text,
        /\nCONFIG\.GENERAL_DELAY_MS = 500;\nCONFIG\.COINGECKO_API_KEY = "gecko-key-1";\nCONFIG\.COINPAPRIKA_API_KEY = "paprika-key-2";\n/,
      );
    } finally {
      fs.rmSync(configFile);
    }
  });

  it("refuses a config.json its Node version's schemas refuse, listing every problem, before it asks anything or opens a key", async () => {
    const configFile = scripts[0].defaultConfigFile;
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        DEXTOOLS_CONFIG: { SUBSCRIPTION_PLAN: "pro", CACHE_SECONDS: 0 },
      }),
    );
    try {
      const result = await build(["apps-script"]);
      assert.equal(result.exitCode, 1);
      assert.ok(
        result.stderr.includes(
          [
            `${configFile} → DEXTOOLS_CONFIG.SUBSCRIPTION_PLAN is not a setting this tool reads`,
            `${configFile} → DEXTOOLS_CONFIG.CACHE_SECONDS must be a whole number of seconds from 1 to 21600; it is 0`,
          ].join("\n"),
        ),
      );
      assert.deepEqual(result.questions, []);
      assert.deepEqual(result.webRequests, []);
      assert.deepEqual(result.dexScreenerCalls, []);
      assert.deepEqual(result.copies, []);
    } finally {
      fs.rmSync(configFile);
    }
  });

  it("refuses an argument after apps-script, since every script goes in the one file", async () => {
    const result = await build(["apps-script", "crypto-price-fetchers"]);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /too many arguments for 'apps-script'/);
    assert.deepEqual(result.copies, []);
  });

  it("gives the scripts as committed, with only the Help page set, when no key is saved", async () => {
    const result = await build(["apps-script"], {
      env: { API_KEYS_FILE_PATH: path.join(top, "no-such-keys.json") },
    });
    assert.equal(result.exitCode, 0, result.output);
    const file = result.copies[0].text;
    assertInOrder(file, [MENU_SOURCE, ...COMMITTED]);
    const block = file.slice(file.lastIndexOf("// ---"));
    assert.deepEqual(
      block
        .split("\n")
        .filter((line) => / = /.test(line))
        .map((line) => line.split(" = ")[0]),
      ["HELP_PAGE.HTML"],
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

  it("answers --help, asking nothing", async () => {
    const result = await build(["apps-script", "--help"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Usage: build apps-script \[options\]\n/);
    assert.match(result.stdout, /DEX Screener's Google Sheets functions/);
    assert.match(
      result.stdout,
      /Exit codes: 0 once the file is on the clipboard or written; 1 when a\nconfig\.json is refused, DEX/,
    );
    assert.deepEqual(result.questions, []);
  });
});

describe("npm run build apps-script, with no clipboard tool installed", () => {
  /**
   * Answers the DEX Screener question with Enter, the build's install
   * question as given, and the install's apt question as given.
   *
   * @param {string} install - The answer to the build's install question
   * @param {string} [apt=install] - The answer to the apt question
   * @returns {function(string): string} The answers
   */
  const answering =
    (install, apt = install) =>
    (prompt) => {
      if (prompt.includes("with apt")) return apt;
      return prompt.includes("Install") ? install : "";
    };

  it("offers the install npm run os-dependencies runs, installs xclip with Homebrew on a yes, then copies", async () => {
    const result = await build(["apps-script"], {
      installed: ["brew"],
      answer: answering("y"),
    });
    assert.equal(result.exitCode, 0, result.output);
    assert.match(
      result.questions[1],
      /Install xclip now, as npm run os-dependencies does\? \(y\/N\)/,
    );
    assert.ok(
      !result.questions.some((question) => question.includes("with apt")),
    );
    assert.deepEqual(result.installs, [["brew", "install", "xclip"]]);
    assert.equal(result.copies.length, 2);
  });

  it("without Homebrew, recommends it and installs with apt on a second yes, wl-clipboard in a Wayland session", async () => {
    const result = await build(["apps-script"], {
      env: { WAYLAND_DISPLAY: "wayland-0" },
      installed: ["apt"],
      answer: answering("y"),
    });
    assert.match(
      result.stdout,
      /Homebrew, the package manager for macOS and Linux, is not installed/,
    );
    assert.match(
      result.questions[2],
      /Or install wl-clipboard, the clipboard tool of Wayland sessions, now, with apt: sudo apt install -y wl-clipboard\? \(y\/N\)/,
    );
    assert.deepEqual(result.installs, [
      ["sudo", "apt", "install", "-y", "wl-clipboard"],
    ]);
    assert.equal(result.copies[0].tool, "wl-copy");
  });

  it("declined, says the keys go to disk in the clear, then writes the file readable by its owner alone", async () => {
    const result = await build(["apps-script"], {
      installed: ["apt"],
      answer: answering("n"),
    });
    assert.equal(result.exitCode, 0, result.output);
    assert.deepEqual(result.copies, []);
    assert.deepEqual(result.installs, []);
    const warning = result.stdout.indexOf("written to disk in the clear");
    const folder = path.join(top, BUILD_FOLDER);
    assert.ok(warning >= 0 && warning < result.stdout.indexOf(folder));
    assert.equal(fs.statSync(folder).mode & 0o777, 0o700);
    const file = path.join(folder, BUILT_FILE_NAME);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.match(
      fs.readFileSync(file, "utf8"),
      /\nDEXTOOLS_CONFIG\.API_KEY = "dex-key-3";\n/,
    );
    assert.match(result.stdout, /Open it in a text editor, select all/);
    assertNoKey(result.output);
  });

  it("writes the file when the apt install is declined or fails, and offers no install without Homebrew or apt, or with no desktop session", async () => {
    const aptDeclined = await build(["apps-script"], {
      installed: ["apt"],
      answer: answering("y", "n"),
    });
    assert.deepEqual(aptDeclined.installs, []);
    assert.match(aptDeclined.stdout, /Install xclip yourself/);
    assert.match(aptDeclined.stdout, /in the clear/);
    const failed = await build(["apps-script"], {
      installed: ["apt"],
      answer: answering("y"),
      install: () => 100,
    });
    assert.match(failed.stdout, /The install ended with exit code 100\./);
    assert.deepEqual(failed.copies, []);
    const noInstaller = await build(["apps-script"], { installed: [] });
    assert.equal(noInstaller.questions.length, 1);
    assert.match(noInstaller.stdout, /Install xclip yourself/);
    assert.match(noInstaller.stdout, /in the clear/);
    const noSession = await build(["apps-script"], {
      installed: ["apt", "xclip"],
      env: { DISPLAY: "" },
    });
    assert.equal(noSession.questions.length, 1);
    assert.deepEqual(noSession.copies, []);
    assert.match(noSession.stdout, /in the clear/);
  });
});
