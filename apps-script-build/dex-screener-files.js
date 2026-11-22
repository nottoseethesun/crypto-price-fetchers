/**
 * The version of DEX Screener's Google Sheets functions that the build
 * step can put in its file, with the SHA-256 of each of its files, the
 * download that checks them, and the audit that downloads and checks them
 * all.
 * @module apps-script-build/dex-screener-files
 *
 * What: DEX Screener, a service that lists the pairs of decentralized
 * exchanges with their prices, published Google Sheets functions of its
 * own in its repo,
 * [dexscreener/google-sheets](https://github.com/dexscreener/google-sheets).
 * That code is not this repo's, and npm audit, which checks the packages
 * this repo installs from npm, does not cover it. So `DEX_SCREENER` names
 * one commit of that repo and the SHA-256 of each file the build takes from
 * it, and one audit downloads those files and checks each checksum:
 * `npm run audit:dex-screener` (`audit-dex-screener.js` at the repo's
 * top, whose command line `runDexScreenerAudit` declares), which
 * `npm run audit:deps` runs after npm audit, runs it, and so does the build
 * (`dex-screener.js`) before it compiles the files.
 *
 * How:
 *
 * - Each file is downloaded from raw.githubusercontent.com at the commit,
 *   within `DOWNLOAD_LIMIT_MS`, 30 seconds: a download that has no answer
 *   by then is stopped and named, so a stalled connection never holds the
 *   build until Node's fetch gives up, 300 seconds later.
 * - The audit, `auditDexScreenerFiles`, downloads every file written here
 *   and refuses each one that cannot be downloaded or whose SHA-256
 *   differs, naming each, one to a line. `npm run audit:dex-screener` runs
 *   it and reports; the build runs the same audit first and compiles only
 *   the files it gives, so the build compiles only the code these checksums
 *   name, and a change on GitHub's side shows in the audits before a build
 *   meets it.
 *
 * Fit: `dex-screener.js` compiles the files `auditDexScreenerFiles`
 * gives; `index.js` names the version in the question it asks at every
 * build.
 */

import { createHash } from "node:crypto";
import { Command, CommanderError } from "commander";
import { messageOf } from "../lib/message-of.js";
import { fetchWithinTimeLimit } from "../lib/time-limited-fetch.js";

/** How long one download may take, in milliseconds, before it is stopped. */
export const DOWNLOAD_LIMIT_MS = 30_000;

/**
 * One custom function DEX Screener's code offers.
 *
 * @typedef {Object} DexScreenerFunction
 * @property {string} name - Its name, as a cell calls it
 * @property {string} summary - The line Sheets shows for it
 * @property {string[]} params - Its JSDoc `@param` lines, without the leading ` * `
 */

/**
 * A version of DEX Screener's functions.
 *
 * @typedef {Object} DexScreenerVersion
 * @property {string} repo - The GitHub repo, as owner/name
 * @property {string} commit - The commit's full hash
 * @property {string} date - The commit's date, YYYY-MM-DD
 * @property {string} entry - The file the code starts from, by its path in the repo
 * @property {Object<string, string>} files - The SHA-256 of each file the build takes, by its path in the repo
 * @property {DexScreenerFunction[]} functions - The custom functions it offers
 */

/** @type {DexScreenerVersion} The version the build downloads: the repo's last commit. */
export const DEX_SCREENER = Object.freeze({
  repo: "dexscreener/google-sheets",
  commit: "89138b2fbe2bb9ab9c4fd516e9121cf3b0b4abae",
  date: "2022-05-02",
  entry: "src/index.ts",
  files: Object.freeze({
    "src/index.ts":
      "7d7bcdfd60ee164910ad5ec955b77133883bc2d59f9af7e10fa754b281d7d50e",
    "src/lib/api.ts":
      "e790e5816978e0a49ec0d180e37556d78e906ba3c3cb95c1d81efacf1ca6a6ea",
    "src/lib/cache.ts":
      "ce1dcabb8aa19531598d1eb083babf832b3b8398cf93515d9b0db086d1fe4c5f",
    "src/lib/result.ts":
      "15eaa0ad3a9a4c059b5f8bb961201bbd5169ec3dba9e555886ce4f31b8e5f099",
    "src/pairs.ts":
      "6b38a14a6000d60be60a48acb52fa4bbb2f0b8608c15841d8a6abfe347f8f336",
    "src/refresh.ts":
      "e2e304db44ebfa3c8ecc20373bbc601acf78e28ca26782e1f68b283a6d6fb29a",
    "src/types.ts":
      "866d56f4c12159772099d684f440ef67026e14ccbc58300fdccebd109d1cb5df",
  }),
  functions: Object.freeze([
    Object.freeze({
      name: "DEX_SCREENER_PAIR_PROP",
      summary: "One field of a pair on DEX Screener, such as its priceUsd.",
      params: Object.freeze([
        '@param {string} chainId DEX Screener\'s id of the chain, such as "pulsechain", "ethereum" or "bsc"',
        "@param {string} pairAddress The pair's address",
        '@param {string} prop The field, such as "priceUsd" or "liquidity.usd"',
        "@param {Date} [refreshTime] A cell holding DEX_SCREENER_REFRESH_INTERVAL(), so this cell runs again when that one does; its value is not used",
      ]),
    }),
    Object.freeze({
      name: "DEX_SCREENER_PAIR",
      summary:
        "Fields of a pair on DEX Screener, across a row or down a column.",
      params: Object.freeze([
        '@param {string} chainId DEX Screener\'s id of the chain, such as "pulsechain"',
        "@param {string} pairAddress The pair's address",
        '@param {string} [props="all"] The fields, separated by commas, or "all"',
        '@param {string} [direction="horizontal"] "horizontal" for a row, "vertical" for a column',
        "@param {boolean} [includePropName=true] Whether each field's name comes before its value",
        "@param {Date} [refreshTime] A cell holding DEX_SCREENER_REFRESH_INTERVAL(), so this cell runs again when that one does; its value is not used",
      ]),
    }),
    Object.freeze({
      name: "DEX_SCREENER_REFRESH_INTERVAL",
      summary:
        "The time a number of seconds from now, for a cell the other DEX_SCREENER_ functions name as refreshTime.",
      params: Object.freeze(["@param {number} [seconds=30] The seconds"]),
    }),
  ]),
});

/**
 * The SHA-256 of a text.
 *
 * @param {string} text - The text
 * @returns {string} Its checksum, in hex
 */
export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The url of one of the version's files.
 *
 * @param {DexScreenerVersion} version - The version
 * @param {string} file - The file's path in the repo
 * @returns {string} Its url at the version's commit
 */
export function urlOf(version, file) {
  return `https://raw.githubusercontent.com/${version.repo}/${version.commit}/${file}`;
}

/**
 * Downloads one of the version's files, within a time limit, and checks
 * its SHA-256.
 *
 * @param {DexScreenerVersion} version - The version
 * @param {string} file - The file's path in the repo
 * @param {function(string, RequestInit): Promise<Response>} fetch - Does the download
 * @param {number} limitMs - How long the download may take, in milliseconds
 * @returns {Promise<string>} The file's text
 * @throws {Error} When the file is not written in the version, cannot be downloaded within the limit, or its checksum differs
 */
async function downloadChecked(version, file, fetch, limitMs) {
  const checksum = version.files[file];
  if (checksum === undefined) {
    throw new Error(
      `${file} is not among the files of ${version.repo} whose SHA-256 this build knows`,
    );
  }
  const url = urlOf(version, file);
  let text;
  try {
    const response = await fetchWithinTimeLimit(
      url,
      {},
      { timeoutMs: limitMs, name: "GitHub", fetch },
    );
    if (!response.ok) throw new Error(`status ${response.status}`);
    text = await response.text();
  } catch (error) {
    throw new Error(`Could not download ${url}: ${messageOf(error)}`, {
      cause: error,
    });
  }
  if (sha256(text) !== checksum) {
    throw new Error(
      `${url} is not the file this build knows: its SHA-256 differs from the one in apps-script-build/dex-screener-files.js`,
    );
  }
  return text;
}

/**
 * What the audit says when every file matches.
 *
 * @param {number} count - How many files it checked
 * @param {DexScreenerVersion} version - The version
 * @returns {string} The line
 */
export function auditPassed(count, version) {
  return `DEX Screener's ${count} files at commit ${version.commit} match the SHA-256 the build checks.`;
}

/**
 * The audit: downloads every file of the version and checks each one's
 * SHA-256. `npm run audit:dex-screener` and the build both run it.
 *
 * @param {Object} [options] - How
 * @param {function(string, RequestInit): Promise<Response>} [options.fetch=globalThis.fetch] - Does the downloads
 * @param {DexScreenerVersion} [options.version=DEX_SCREENER] - The version
 * @param {number} [options.limitMs=DOWNLOAD_LIMIT_MS] - How long each download may take, in milliseconds
 * @returns {Promise<Object<string, string>>} Each file's text, by its path in the repo
 * @throws {Error} When a file cannot be downloaded within the limit or its checksum differs; the message names each such file, one to a line, after a line that names the commit
 */
export async function auditDexScreenerFiles({
  fetch = globalThis.fetch,
  version = DEX_SCREENER,
  limitMs = DOWNLOAD_LIMIT_MS,
} = {}) {
  const files = Object.keys(version.files);
  const outcomes = await Promise.allSettled(
    files.map((file) => downloadChecked(version, file, fetch, limitMs)),
  );
  const failures = outcomes
    .filter((outcome) => outcome.status === "rejected")
    .map((outcome) => outcome.reason.message);
  if (failures.length > 0) {
    throw new Error(
      [
        `DEX Screener's files at commit ${version.commit} fail the check:`,
        ...failures,
      ].join("\n"),
    );
  }
  return Object.fromEntries(
    files.map((file, index) => [file, outcomes[index].value]),
  );
}

/** What the audit's help says after its usage. */
const AUDIT_HELP_AFTER = `
npm audit checks only the packages installed from npm, and the build step's
DEX Screener functions are not one, so this downloads each of their files
at the commit the build uses and checks its SHA-256 against the one written
in apps-script-build/dex-screener-files.js. A download with no answer
within ${DOWNLOAD_LIMIT_MS / 1000} seconds is stopped and counted as failed.

Examples:
  Check DEX Screener's files on their own, before a build:
    $ npm run audit:dex-screener
  Check them with npm audit's check of the packages, as CI does:
    $ npm run audit:deps

Exit codes: 0 when every file matches; 1 when a file cannot be downloaded
or its SHA-256 differs, or the arguments are wrong.`;

/**
 * Runs the audit's command line and says how it went:
 * `npm run audit:dex-screener`.
 *
 * @param {string[]} argv - The arguments, shaped as `process.argv`
 * @param {Object} [deps] - What a test replaces
 * @param {function(string): Promise<Response>} [deps.fetch=globalThis.fetch] - Does the downloads
 * @param {DexScreenerVersion} [deps.version=DEX_SCREENER] - The version
 * @param {{write: function(string): void}} [deps.stdout=process.stdout] - Where the help and a pass are said
 * @param {{write: function(string): void}} [deps.stderr=process.stderr] - Where the failures are said
 * @returns {Promise<number>} The exit code: 0 when every file matches or the help was asked for, 1 otherwise
 */
export async function runDexScreenerAudit(
  argv,
  {
    fetch = globalThis.fetch,
    version = DEX_SCREENER,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {},
) {
  let exitCode = 0;
  const program = new Command()
    .name("audit-dex-screener")
    .description(
      "Checks the files of DEX Screener's Google Sheets functions, which the build step downloads, against their SHA-256.",
    )
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => stdout.write(text),
      writeErr: (text) => stderr.write(text),
    })
    .addHelpText("after", AUDIT_HELP_AFTER)
    .action(async () => {
      try {
        const sources = await auditDexScreenerFiles({ fetch, version });
        stdout.write(`${auditPassed(Object.keys(sources).length, version)}\n`);
      } catch (error) {
        stderr.write(`${messageOf(error)}\n`);
        exitCode = 1;
      }
    });
  try {
    await program.parseAsync(argv);
  } catch (thrown) {
    if (thrown instanceof CommanderError) return thrown.exitCode;
    throw thrown;
  }
  return exitCode;
}
