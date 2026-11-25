/**
 * Checks of a repo's tracked files that the owner's rules ask for, for the
 * tests of each of his repos: EVM addresses in EIP-55's form, docs that
 * name every npm target and every test file, docs that point only at what
 * the repo keeps, and a config-example.json beside every config.json.
 * @module lib/repo-checks
 *
 * What: five of the owner's rules can be checked by reading the files git
 * keeps, and each of his repos makes the same checks, from here:
 *
 * - LP Ranger, the owner's bot that manages his 9mm V3 liquidity
 *   positions, holds an EVM address in EIP-55's form, whose mixed case is
 *   a checksum of the address. `addressesNotInEip55` lists each address
 *   written in another form: all in one case, or in a mixed case that is
 *   not its checksum.
 * - Each repo's `docs/project-commands.md` lists every npm target.
 *   `npmTargetsMissingFromDocs` lists each target of each package.json git
 *   keeps that the doc does not name, in a code span, as `target` or as
 *   `npm run target` followed by its arguments.
 * - Each repo's docs name every test file and test helper.
 *   `testFilesMissingFromDocs` lists each one that no doc given names.
 * - A doc's every step must hold, its pointers to other files among them.
 *   `localReferencesMissing` lists, in each Markdown file git keeps, each
 *   link to a file or folder the repo does not keep, or to a heading its
 *   file does not have, and each code span that writes a path from the
 *   doc's own folder, `./…` or `../…`, to a file the repo does not keep or
 *   to a place outside the repo. A heading's anchor is GitHub's: its words
 *   in lower case, with each space a hyphen and each mark but a hyphen or
 *   an underscore left out, and `-1`, `-2` and on after a heading whose
 *   anchor came before. Code blocks are passed over, as is link syntax
 *   in a code span, which Markdown shows as code, and links to a site or
 *   an address are not checked.
 * - Each kind of `config.json` a repo has ships with a
 *   `config-example.json` beside it, which git keeps and never ignores,
 *   and which shows the file's settings with their default values.
 *   `configExampleProblems` lists each `config.json` git keeps, or the
 *   repo's top `.gitignore` names, with no `config-example.json` that git
 *   keeps in its folder; each `config-example.json` git keeps that the
 *   repo's ignore rules match; and each example beside a `config.json`
 *   git keeps that holds other settings than that file, whose settings
 *   are the repo's own defaults.
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
import { isDeepStrictEqual } from "node:util";
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
 * @param {string} docFile - The doc, from the repo's top, such as docs/project-commands.md
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

/** A link in Markdown: its target, which a title or the closing parenthesis follows. */
const MARKDOWN_LINK = /\]\(([^)\s]+)[\s)]/g;

/** A code span, which Markdown shows as code: link syntax in it is no link. */
const CODE_SPAN = /`[^`\n]*`/g;

/** A code span that holds nothing but a path from its file's folder. */
const RELATIVE_PATH_SPAN = /`(\.{1,2}\/[^`\s]*)`/g;

/** A line that opens or closes a block of code. */
const FENCE = /^\s*(?:```|~~~)/;

/** A target with a scheme, such as https: or mailto:, which names no file of the repo. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The lines of a Markdown file outside its blocks of code, each with its
 * number.
 *
 * @param {string} text - The file's text
 * @returns {Array<{content: string, line: number}>} The lines
 */
function proseLines(text) {
  const lines = [];
  let inCode = false;
  text.split("\n").forEach((content, index) => {
    if (FENCE.test(content)) inCode = !inCode;
    else if (!inCode) lines.push({ content, line: index + 1 });
  });
  return lines;
}

/**
 * The anchors GitHub gives a Markdown file's headings.
 *
 * @param {string} text - The file's text
 * @returns {Set<string>} The anchors
 */
export function headingAnchors(text) {
  const anchors = new Set();
  const times = new Map();
  for (const { content } of proseLines(text)) {
    const heading = /^#{1,6}[ \t](.*)$/.exec(content);
    if (heading === null) continue;
    const anchor = heading[1]
      .trim()
      .replace(/ #+$/, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replace(/ /g, "-");
    const before = times.get(anchor) ?? 0;
    anchors.add(before === 0 ? anchor : `${anchor}-${before}`);
    times.set(anchor, before + 1);
  }
  return anchors;
}

/**
 * The text of a link's target with each %-escape read, or as written when
 * an escape is not one.
 *
 * @param {string} written - The target as written
 * @returns {string} The target
 */
function unescaped(written) {
  try {
    return decodeURI(written);
  } catch {
    return written;
  }
}

/**
 * The place a doc's pointer names, from the repo's top folder.
 *
 * @param {string} docFile - The doc, from the repo's top folder
 * @param {string} written - The pointer, from the doc's folder
 * @returns {string} The place
 */
function placeFrom(docFile, written) {
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(docFile), written),
  );
}

/**
 * What a repo keeps, for the checks of its docs' pointers: its files, its
 * folders, and its Markdown files' heading anchors, read once each.
 *
 * @param {string} repoTop - The repo's top folder
 * @returns {{files: string[], kept: Set<string>, folders: Set<string>, anchorsOf: function(string): Set<string>}} What it keeps
 */
function keptByRepo(repoTop) {
  const files = trackedFiles(repoTop);
  const folders = new Set(
    files.flatMap((file) =>
      file
        .split("/")
        .slice(0, -1)
        .map((_, at, parts) => parts.slice(0, at + 1).join("/")),
    ),
  );
  const anchors = new Map();
  const anchorsOf = (file) => {
    if (!anchors.has(file))
      anchors.set(file, headingAnchors(textOf(repoTop, file) ?? ""));
    return anchors.get(file);
  };
  return { files, kept: new Set(files), folders, anchorsOf };
}

/**
 * Why a place a doc points at is missing, or null when the repo keeps it.
 *
 * @param {Object} repo - What the repo keeps (`keptByRepo`)
 * @param {string} place - The place, from the repo's top folder
 * @returns {?string} Why, in words, or null
 */
function placeProblem(repo, place) {
  if (place === ".." || place.startsWith("../"))
    return "it points outside the repo";
  return repo.kept.has(place) || repo.folders.has(place.replace(/\/$/, ""))
    ? null
    : "the repo keeps no such file or folder";
}

/**
 * Why a link of a doc names something missing, or null when the repo
 * keeps its file, or folder, and heading.
 *
 * @param {Object} repo - What the repo keeps (`keptByRepo`)
 * @param {string} docFile - The doc, from the repo's top folder
 * @param {string} target - The link's target
 * @returns {?string} Why, in words, or null
 */
function linkProblem(repo, docFile, target) {
  const [written, anchor] = target.split("#");
  const page =
    written === "" ? docFile : placeFrom(docFile, unescaped(written));
  const missing = written === "" ? null : placeProblem(repo, page);
  if (missing !== null) return missing;
  if (anchor === undefined || !page.endsWith(".md")) return null;
  return repo.anchorsOf(page).has(anchor)
    ? null
    : `${page} has no heading with that anchor`;
}

/**
 * Lists each pointer of a repo's Markdown files that names something the
 * repo does not keep: a link to a missing file, folder or heading, or a
 * path from the doc's folder, in a code span, to a missing file or to a
 * place outside the repo.
 *
 * @param {string} repoTop - The repo's top folder
 * @returns {Array<{file: string, line: number, pointer: string, why: string}>} Each one, with its file and line
 */
export function localReferencesMissing(repoTop) {
  const repo = keptByRepo(repoTop);
  const found = [];
  for (const file of repo.files.filter((name) => name.endsWith(".md"))) {
    for (const { content, line } of proseLines(textOf(repoTop, file) ?? "")) {
      const links = [...content.replace(CODE_SPAN, "").matchAll(MARKDOWN_LINK)]
        .map(([, target]) => target)
        .filter((target) => !SCHEME.test(target))
        .map((target) => [target, linkProblem(repo, file, target)]);
      const paths = [...content.matchAll(RELATIVE_PATH_SPAN)].map(
        ([, written]) => [
          written,
          placeProblem(repo, placeFrom(file, written)),
        ],
      );
      for (const [pointer, why] of [...links, ...paths])
        if (why !== null) found.push({ file, line, pointer, why });
    }
  }
  return found;
}

/** A folder written plainly, with none of the marks of a pattern. */
const PLAIN_FOLDER = /^[^\s#!*?[\]]*$/;

/**
 * The folder of the `config.json` a line of a `.gitignore` names, from the
 * repo's top, with its slash, or nothing for the top; null for a line that
 * names no `config.json`, or names one by a pattern.
 *
 * @param {string} line - The line
 * @returns {?string} The folder
 */
function ignoredConfigFolder(line) {
  const entry = line.trim().replace(/^\//, "");
  if (entry !== "config.json" && !entry.endsWith("/config.json")) return null;
  const folder = entry.slice(0, -"config.json".length);
  return PLAIN_FOLDER.test(folder) ? folder : null;
}

/**
 * The settings a JSON file of a repo holds, or undefined when it is not
 * JSON.
 *
 * @param {string} repoTop - The repo's top folder
 * @param {string} file - The file, from the repo's top
 * @returns {*} Its settings
 */
function jsonOf(repoTop, file) {
  try {
    return JSON.parse(textOf(repoTop, file) ?? "");
  } catch {
    return undefined;
  }
}

/**
 * Lists each `config.json` a repo has with no `config-example.json` beside
 * it that git keeps, each `config-example.json` git keeps that the repo's
 * ignore rules match, and each example beside a `config.json` git keeps
 * that holds other settings than it, or is not JSON: the `config.json`
 * files git keeps, which hold the repo's defaults, and those its top
 * `.gitignore` names, which the owner keeps on his own computer.
 *
 * @param {string} repoTop - The repo's top folder
 * @returns {Array<{file: string, why: string}>} Each file, from the repo's top, with what is wrong
 * @throws {Error} When git cannot list the files or check one
 */
export function configExampleProblems(repoTop) {
  const files = trackedFiles(repoTop);
  const kept = new Set(files);
  const named = (textOf(repoTop, ".gitignore") ?? "")
    .split("\n")
    .map(ignoredConfigFolder)
    .filter((folder) => folder !== null)
    .map((folder) => `${folder}config.json`);
  const configs = [
    ...new Set([
      ...files.filter((file) => path.posix.basename(file) === "config.json"),
      ...named,
    ]),
  ].sort();
  const missing = configs
    .filter(
      (config) =>
        !kept.has(
          path.posix.join(path.posix.dirname(config), "config-example.json"),
        ),
    )
    .map((file) => ({
      file,
      why: "no config-example.json that git keeps is beside it",
    }));
  const ignored = files
    .filter((file) => path.posix.basename(file) === "config-example.json")
    .filter(
      (file) =>
        spawnSync("git", ["check-ignore", "--no-index", "-q", file], {
          cwd: repoTop,
        }).status === 0,
    )
    .map((file) => ({ file, why: "git's ignore rules match it" }));
  const differing = files
    .filter((file) => path.posix.basename(file) === "config.json")
    .map((config) => ({
      config,
      example: path.posix.join(
        path.posix.dirname(config),
        "config-example.json",
      ),
    }))
    .filter(({ example }) => kept.has(example))
    .filter(({ config, example }) => {
      const settings = jsonOf(repoTop, example);
      return (
        settings === undefined ||
        !isDeepStrictEqual(settings, jsonOf(repoTop, config))
      );
    })
    .map(({ config, example }) => ({
      file: example,
      why: `it holds other settings than ${config}, which git keeps`,
    }));
  return [...missing, ...ignored, ...differing];
}
