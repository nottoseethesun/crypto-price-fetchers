/**
 * Checks of a repo's tracked files that the owner's rules ask for, for the
 * tests of each of his repos: EVM addresses in EIP-55's form, and docs
 * that name every npm target and every test file.
 * @module lib/repo-checks
 *
 * What: three of the owner's rules can be checked by reading the files git
 * keeps, and each of his repos makes the same checks, from here:
 *
 * - LP Ranger, the owner's bot that manages his 9mm V3 liquidity
 *   positions, holds an EVM address in EIP-55's form, whose mixed case is
 *   a checksum of the address. `addressesNotInEip55` lists each address
 *   written in another form: all in one case, or in a mixed case that is
 *   not its checksum.
 * - Each repo's `docs/npm-project-commands.md` lists every npm target.
 *   `npmTargetsMissingFromDocs` lists each target of each package.json git
 *   keeps that the doc does not name, in a code span, as `target` or as
 *   `npm run target` followed by its arguments.
 * - Each repo's docs name every test file and test helper.
 *   `testFilesMissingFromDocs` lists each one that no doc given names.
 *
 * How: `trackedFiles` asks git for the files it keeps (`git ls-files`), so
 * a file git ignores, such as the owner's own config.json, is never read.
 * `eip55` writes an address as EIP-55 says: it takes the Keccak-256 hash
 * of the address's 40 hex digits in lower case, and writes each letter of
 * the address in upper case where the hash's hex digit at the same place
 * is 8 or more. Keccak-256 is @noble/hashes', a package of hash functions
 * written in JavaScript, since Node's own crypto offers SHA3-256, which
 * pads its input otherwise and so gives another hash.
 *
 * Fit: crypto-price-fetchers' `test/repo-checks.test.js` uses it, and the
 * package exports it as `crypto-price-fetchers/lib/repo-checks` for the
 * tests of pulsechain-analytics, pulsechain-validator-analytics and
 * x1-validator-analytics.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { keccak_256 as keccak256 } from "@noble/hashes/sha3.js";

/** An EVM address: 0x and 40 hex digits, not inside a longer hex number. */
const ADDRESS = /(?<![0-9a-fA-Fx])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;

/** The files that are not text: pictures, archives and lockfiles. */
const NOT_TEXT =
  /\.(?:png|jpe?g|gif|ico|webp|pdf|zip|gz|tgz)$|package-lock\.json$/i;

/** A test file, or a test helper. */
const TEST_FILE = /\.test\.m?js$|(?:^|\/)tests?\/helpers\/[^/]+\.m?js$/;

/**
 * The files git keeps in a repo.
 *
 * @param {string} repoTop - The repo's top folder
 * @returns {string[]} The files, from the repo's top, with forward slashes
 * @throws {Error} When git cannot list them
 */
export function trackedFiles(repoTop) {
  const run = spawnSync("git", ["ls-files", "-z"], {
    cwd: repoTop,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`git ls-files failed in ${repoTop}: ${run.stderr}`);
  }
  return run.stdout.split("\0").filter((file) => file !== "");
}

/**
 * The text of a tracked file, or null for one the working tree lacks.
 *
 * @param {string} repoTop - The repo's top folder
 * @param {string} file - The file, from the repo's top
 * @returns {?string} Its text
 */
function textOf(repoTop, file) {
  const full = path.join(repoTop, file);
  return fs.existsSync(full) && fs.statSync(full).isFile()
    ? fs.readFileSync(full, "utf8")
    : null;
}

/**
 * An EVM address in EIP-55's form.
 *
 * @param {string} address - The address: 0x and 40 hex digits, in any case
 * @returns {string} The address, each letter in the case its checksum asks
 */
export function eip55(address) {
  const digits = address.slice(2).toLowerCase();
  const hash = Buffer.from(
    keccak256(new TextEncoder().encode(digits)),
  ).toString("hex");
  let written = "0x";
  for (let place = 0; place < digits.length; place += 1) {
    const upper = Number.parseInt(hash[place], 16) >= 8;
    written += upper ? digits[place].toUpperCase() : digits[place];
  }
  return written;
}

/**
 * The EVM addresses in a repo's tracked text files that are not written in
 * EIP-55's form.
 *
 * @param {string} repoTop - The repo's top folder
 * @returns {Array<{file: string, line: number, address: string}>} Each one, with the file and line it is on
 */
export function addressesNotInEip55(repoTop) {
  const found = [];
  for (const file of trackedFiles(repoTop)) {
    const text = NOT_TEXT.test(file) ? null : textOf(repoTop, file);
    if (text === null) continue;
    text.split("\n").forEach((content, index) => {
      for (const [address] of content.matchAll(ADDRESS)) {
        if (address !== eip55(address))
          found.push({ file, line: index + 1, address });
      }
    });
  }
  return found;
}

/**
 * The npm targets of a repo's tracked package.json files that a doc does
 * not name.
 *
 * @param {string} repoTop - The repo's top folder
 * @param {string} docFile - The doc, from the repo's top, such as docs/npm-project-commands.md
 * @returns {Array<{packageFile: string, target: string}>} Each target not named, with its package.json
 */
export function npmTargetsMissingFromDocs(repoTop, docFile) {
  const doc = fs.readFileSync(path.join(repoTop, docFile), "utf8");
  const named = new Set(
    [...doc.matchAll(/`([^`\n]+)`/g)].map(
      ([, span]) => span.replace(/^npm run /, "").split(/\s/)[0],
    ),
  );
  const missing = [];
  for (const packageFile of trackedFiles(repoTop)) {
    if (path.posix.basename(packageFile) !== "package.json") continue;
    const scripts =
      JSON.parse(textOf(repoTop, packageFile) ?? "{}").scripts ?? {};
    for (const target of Object.keys(scripts)) {
      if (!named.has(target)) missing.push({ packageFile, target });
    }
  }
  return missing;
}

/**
 * The test files and test helpers of a repo that no doc given names.
 *
 * @param {string} repoTop - The repo's top folder
 * @param {string[]} docFiles - The docs, from the repo's top
 * @returns {string[]} Each file no doc names by its file name, from the repo's top
 */
export function testFilesMissingFromDocs(repoTop, docFiles) {
  const docs = docFiles
    .map((docFile) => fs.readFileSync(path.join(repoTop, docFile), "utf8"))
    .join("\n");
  return trackedFiles(repoTop).filter(
    (file) => TEST_FILE.test(file) && !docs.includes(path.posix.basename(file)),
  );
}
