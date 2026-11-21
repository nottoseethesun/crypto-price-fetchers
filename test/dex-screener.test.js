/**
 * Tests for apps-script-build/dex-screener.js, which downloads DEX
 * Screener's Google Sheets functions at one commit and compiles them for
 * the built file.
 * @module test/dex-screener.test
 *
 * DEX Screener's code is not in this repo, and the tests ask no outside
 * service, so they download stand-in sources, written here in TypeScript
 * as DEX Screener's are, with their SHA-256 worked out here, from a
 * stand-in fetch (`helpers/stand-in-web.js`), and compile them with the
 * real esbuild and this repo's zod and lodash. The audit of the files,
 * `npm run audit:dex-screener`, is tested the same way.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createAppsScriptServices } from "../apps-script-runner/apps-script-services.js";
import { loadAppsScript } from "../apps-script-runner/load-apps-script.js";
import { combinedScript } from "../apps-script-build/built-script.js";
import {
  HOLDER,
  RETRY_ADVICE,
  dexScreenerPart,
} from "../apps-script-build/dex-screener.js";
import {
  DEX_SCREENER,
  auditDexScreenerFiles,
  runDexScreenerAudit,
  sha256,
} from "../apps-script-build/dex-screener-files.js";
import { capturedOutput } from "./helpers/captured-output.js";
import { standInFetch } from "./helpers/stand-in-web.js";

/** This repo's top folder, whose packages hold zod and lodash. */
const PROJECT_TOP = fileURLToPath(new URL("..", import.meta.url));

/** A version of stand-in functions, shaped as DEX Screener's, without its files. */
const BASE_VERSION = Object.freeze({
  repo: "example/sheets-functions",
  commit: "0123456789abcdef0123456789abcdef01234567",
  date: "2026-01-02",
  entry: "src/index.ts",
  functions: [
    {
      name: "DEX_SCREENER_PAIR_PROP",
      summary: "One field of a pair.",
      params: ["@param {string} chainId The chain's id"],
    },
    {
      name: "DEX_SCREENER_REFRESH_INTERVAL",
      summary: "Milliseconds from seconds.",
      params: ["@param {number} [seconds=30] The seconds"],
    },
  ],
});

/** The stand-in sources, by their paths in the repo: the entry, a file, a folder's index, and a file nothing imports. */
const SOURCES = Object.freeze({
  "src/index.ts": [
    "import { pairProp } from './pairs';",
    "import { later } from './lib';",
    "",
    "declare let global: any;",
    "const onOpen = (): void => {",
    '  throw new Error("DEX Screener\'s onOpen ran");',
    "};",
    "global.onOpen = onOpen;",
    "global.DEX_SCREENER_PAIR_PROP = (chainId: string, pairAddress: string, prop: string): unknown =>",
    "  pairProp(chainId, pairAddress, prop);",
    "global.DEX_SCREENER_REFRESH_INTERVAL = (seconds: number = 30): number => later(seconds);",
  ].join("\n"),
  "src/pairs.ts": [
    "import result from 'lodash/result';",
    "import { z } from 'zod';",
    "",
    "const pairSchema = z.object({ priceUsd: z.string() });",
    "",
    "export const pairProp = (chainId: string, pairAddress: string, prop: string): unknown =>",
    "  result(pairSchema.parse({ priceUsd: `${chainId}:${pairAddress}` }), prop);",
  ].join("\n"),
  "src/lib/index.ts":
    "export const later = (seconds: number): number => seconds * 1000;",
  "src/notes.ts": "export const unusedNote = 'not imported';",
});

/**
 * The version, with the SHA-256 of each source given.
 *
 * @param {Object<string, string>} sources - The files, by their paths in the repo
 * @returns {Object} The version
 */
function versionOf(sources) {
  return {
    ...BASE_VERSION,
    files: Object.fromEntries(
      Object.entries(sources).map(([file, text]) => [file, sha256(text)]),
    ),
  };
}

/** The version of the stand-in sources. */
const VERSION = versionOf(SOURCES);

/**
 * A fetch that serves sources at the version's commit, as
 * raw.githubusercontent.com does, and 404 for anything else.
 *
 * @param {Object<string, string>} sources - The files, by their paths in the repo
 * @returns {function(string): Promise<Response>} The fetch, with its `requests`
 */
function serving(sources) {
  const prefix = `https://raw.githubusercontent.com/${VERSION.repo}/${VERSION.commit}/`;
  return standInFetch(({ url }) => {
    const file = url.startsWith(prefix) ? url.slice(prefix.length) : null;
    return file !== null && Object.hasOwn(sources, file)
      ? { status: 200, text: sources[file] }
      : null;
  });
}

/**
 * Builds the part from sources.
 *
 * @param {function(string): Promise<Response>} fetch - Serves the downloads
 * @param {Object} [version=VERSION] - The version, with its checksums
 * @param {function(string): void} [say] - Takes the audit's line
 * @returns {Promise<{text: string, required: string[]}>} The part
 */
function partFrom(fetch, version = VERSION, say = undefined) {
  return dexScreenerPart({ projectTop: PROJECT_TOP, fetch, version, say });
}

/**
 * Joins parts into a file and loads it with the runner's services.
 *
 * @param {Array<{name: string, source: string}>} parts - The parts
 * @param {string[]} required - The functions the file must hold
 * @returns {Object} The loaded file's context
 */
function loadJoined(parts, required) {
  const text = combinedScript({
    preamble: "/** test */",
    parts,
    values: {},
    required,
  });
  return loadAppsScript(
    [{ source: text, filename: "joined.gs" }],
    createAppsScriptServices({ fetchSync: () => ({ failure: "no web" }) }),
  );
}

describe("dexScreenerPart", () => {
  it("runs the audit first, downloading every file the version names from the commit, each once, and says its line", async () => {
    const fetch = serving(SOURCES);
    const said = [];
    const part = await partFrom(fetch, VERSION, (line) => said.push(line));
    const prefix = `https://raw.githubusercontent.com/${VERSION.repo}/${VERSION.commit}/`;
    assert.deepEqual(
      fetch.requests.map((request) => request.url.slice(prefix.length)).sort(),
      ["src/index.ts", "src/lib/index.ts", "src/notes.ts", "src/pairs.ts"],
    );
    assert.deepEqual(said, [
      `DEX Screener's 4 files at commit ${VERSION.commit} match the SHA-256 the build checks.`,
    ]);
    assert.ok(!part.text.includes("unusedNote"));
  });

  it("gives a part whose functions a cell can call, each with the comment Sheets shows, and keeps the code's own names inside it", async () => {
    const part = await partFrom(serving(SOURCES));
    assert.deepEqual(part.required, [
      "DEX_SCREENER_PAIR_PROP",
      `${HOLDER}.DEX_SCREENER_PAIR_PROP`,
      "DEX_SCREENER_REFRESH_INTERVAL",
      `${HOLDER}.DEX_SCREENER_REFRESH_INTERVAL`,
    ]);
    assert.ok(
      part.text.includes(
        `https://github.com/${VERSION.repo}/tree/${VERSION.commit}`,
      ),
    );
    assert.match(
      part.text,
      /\/\*\*\n \* One field of a pair\.\n \*\n \* @param \{string\} chainId The chain's id\n \* @return \{\*\} What DEX Screener's DEX_SCREENER_PAIR_PROP gives\n \* @customfunction\n \*\/\nfunction DEX_SCREENER_PAIR_PROP\(\.\.\.args\) \{/,
    );
    const context = loadJoined(
      [{ name: "dex.gs", source: part.text }],
      part.required,
    );
    assert.equal(
      context.DEX_SCREENER_PAIR_PROP("pulsechain", "0xabc", "priceUsd"),
      "pulsechain:0xabc",
    );
    assert.equal(context.DEX_SCREENER_REFRESH_INTERVAL(2), 2000);
    for (const name of ["onOpen", "pairProp", "later", "global"]) {
      assert.equal(typeof context[name], "undefined", name);
    }
  });

  it("goes in one file with the menu, whose onOpen stays the one Sheets calls", async () => {
    const part = await partFrom(serving(SOURCES));
    const menu = fs.readFileSync(
      new URL("../crypto-price-fetchers-menu.gs", import.meta.url),
      "utf8",
    );
    const context = loadJoined(
      [
        { name: "crypto-price-fetchers-menu.gs", source: menu },
        { name: "dex.gs", source: part.text },
      ],
      part.required,
    );
    assert.match(
      String(context.onOpen),
      /createMenu\("Crypto Price Fetchers"\)/,
    );
  });

  it("stops, saying the step is optional, when a file cannot be downloaded", async () => {
    const failing = standInFetch(() => ({ status: 500, text: "down" }));
    await assert.rejects(partFrom(failing), (error) => {
      assert.ok(
        error.message.startsWith(
          `DEX Screener's files at commit ${VERSION.commit} fail the check:\n`,
        ),
      );
      assert.match(
        error.message,
        /Could not download https:\/\/raw\.githubusercontent\.com\/example\/sheets-functions\/0123456789abcdef0123456789abcdef01234567\/src\/index\.ts: status 500/,
      );
      assert.ok(error.message.endsWith(`\n${RETRY_ADVICE}`));
      return true;
    });
    await assert.rejects(
      partFrom(serving({})),
      /src\/index\.ts: status 404[\s\S]*answer n to leave them out/,
    );
    await assert.rejects(
      partFrom(async () => {
        throw new TypeError("fetch failed");
      }),
      /Could not download https:\/\/raw\.githubusercontent\.com\/.*src\/index\.ts: fetch failed/,
    );
  });

  it("stops, saying the step is optional, when a file's SHA-256 differs, or a file imports one whose SHA-256 it does not know", async () => {
    await assert.rejects(
      partFrom(serving({ ...SOURCES, "src/pairs.ts": "export const x = 1;" })),
      /src\/pairs\.ts is not the file this build knows: its SHA-256 differs from the one in apps-script-build\/dex-screener-files\.js[\s\S]*answer n/,
    );
    const importing = { ...SOURCES, "src/index.ts": "import './missing';" };
    await assert.rejects(
      partFrom(serving(importing), versionOf(importing)),
      /Could not compile DEX Screener's code[\s\S]*src\/index\.ts imports \.\/missing, which is not among the files of example\/sheets-functions whose SHA-256 this build knows[\s\S]*answer n/,
    );
  });

  it("stops, saying the step is optional, when the code does not compile", async () => {
    const broken = { ...SOURCES, "src/index.ts": "const x: = ;" };
    await assert.rejects(
      partFrom(serving(broken), versionOf(broken)),
      /Could not compile DEX Screener's code[\s\S]*answer n to leave them out/,
    );
  });
});

describe("the audit of DEX Screener's files", () => {
  it("downloads every file the version names, and gives them when each one's SHA-256 matches", async () => {
    assert.deepEqual(
      await auditDexScreenerFiles({
        fetch: serving(SOURCES),
        version: VERSION,
      }),
      SOURCES,
    );
    const stdout = capturedOutput();
    const code = await runDexScreenerAudit({
      fetch: serving(SOURCES),
      version: VERSION,
      stdout,
      stderr: capturedOutput(),
    });
    assert.equal(code, 0);
    assert.equal(
      stdout.text,
      `DEX Screener's 4 files at commit ${VERSION.commit} match the SHA-256 the build checks.\n`,
    );
  });

  it("names each file that differs or cannot be downloaded, one to a line, with exit code 1", async () => {
    const changed = {
      "src/index.ts": SOURCES["src/index.ts"],
      "src/notes.ts": SOURCES["src/notes.ts"],
      "src/pairs.ts": "changed",
    };
    const stderr = capturedOutput();
    const code = await runDexScreenerAudit({
      fetch: serving(changed),
      version: VERSION,
      stdout: capturedOutput(),
      stderr,
    });
    assert.equal(code, 1);
    const lines = stderr.text.trimEnd().split("\n");
    assert.equal(
      lines[0],
      `DEX Screener's files at commit ${VERSION.commit} fail the check:`,
    );
    assert.equal(lines.length, 3);
    assert.match(
      lines[1],
      /src\/lib\/index\.ts: status 404|src\/pairs\.ts is not the file/,
    );
    assert.ok(
      lines.some((line) =>
        /src\/pairs\.ts is not the file this build knows/.test(line),
      ),
    );
    assert.ok(
      lines.some((line) => /src\/lib\/index\.ts: status 404/.test(line)),
    );
  });
});

describe("DEX_SCREENER", () => {
  it("names one commit of DEX Screener's repo, the SHA-256 of each file, its entry, and the functions it offers", () => {
    assert.equal(DEX_SCREENER.repo, "dexscreener/google-sheets");
    assert.match(DEX_SCREENER.commit, /^[0-9a-f]{40}$/);
    assert.match(DEX_SCREENER.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(DEX_SCREENER.entry, "src/index.ts");
    assert.equal(Object.keys(DEX_SCREENER.files).length, 7);
    assert.ok(Object.hasOwn(DEX_SCREENER.files, DEX_SCREENER.entry));
    for (const checksum of Object.values(DEX_SCREENER.files)) {
      assert.match(checksum, /^[0-9a-f]{64}$/);
    }
    assert.deepEqual(
      DEX_SCREENER.functions.map((fn) => fn.name),
      [
        "DEX_SCREENER_PAIR_PROP",
        "DEX_SCREENER_PAIR",
        "DEX_SCREENER_REFRESH_INTERVAL",
      ],
    );
    for (const fn of DEX_SCREENER.functions) {
      assert.ok(fn.params.every((line) => line.startsWith("@param {")));
    }
  });
});
