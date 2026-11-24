/**
 * Runs actionlint, the checker of GitHub Actions workflow files, from its
 * official release, checked against the SHA-256 this repo pins: the bin
 * `run-actionlint`, which each repo's lint runs on its workflows.
 * @module actionlint
 *
 * What: actionlint (rhysd/actionlint) reads a repo's workflow files in
 * `.github/workflows/` and reports mistakes in their syntax, their
 * expressions and the scripts their steps run. Its author publishes it as
 * a program built for each system. `run-actionlint` takes the release
 * `release.js` names: the first time, it downloads the archive for the
 * system it runs on, refuses it unless its SHA-256 is the one written
 * there, takes the program out, refuses it unless its own SHA-256 is the
 * one written beside the archive's, and keeps it in `node_modules/.cache/`
 * of the project it runs in. Each run checks the kept program's SHA-256
 * again before it runs it, and downloads the archive again when the
 * program has changed. Then it runs the program on the files given and
 * exits with its exit code. With `--check` it runs nothing: it downloads
 * every archive `release.js` names and checks each SHA-256 and its
 * program's, the check `npm run audit:actionlint` runs beside npm audit,
 * which covers only what npm installs.
 *
 * How:
 *
 * - A download that has no answer within `DOWNLOAD_LIMIT_MS` is stopped
 *   and named, as is one whose status is not 200.
 * - An archive is a tar file compressed with gzip. Node's zlib opens it,
 *   and `fileFromTar` reads its entries, each a 512-byte header (the
 *   entry's name, its size in octal, its type) followed by its bytes in
 *   blocks of 512, to the entry named `actionlint`.
 * - The program is written beside its final name and then renamed, so a
 *   run that stops halfway leaves nothing a later run would take.
 *
 * Fit: `bin/run-actionlint.js` is the bin. Each repo's
 * `npm run lint` runs it on `.github/workflows/*.yml`, and its
 * `npm run audit:deps` runs it with `--check`.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Command, CommanderError } from "commander";
import { messageOf } from "../lib/message-of.js";
import { fetchWithinTimeLimit } from "../lib/time-limited-fetch.js";
import { ACTIONLINT, archiveUrl } from "./release.js";

/** How long one download may take, in milliseconds, before it is stopped. */
export const DOWNLOAD_LIMIT_MS = 60_000;

/** The size of a tar header, and of each block an entry's bytes fill. */
const TAR_BLOCK = 512;

/** What the help says after the options: examples and exit codes. */
const HELP_AFTER = `
The first run downloads actionlint ${ACTIONLINT.version} for this system from
its GitHub release, checks the archive's SHA-256, and the program's in it,
against those written in crypto-price-fetchers' actionlint/release.js, and
keeps the program in node_modules/.cache/actionlint/. Later runs check the
kept program's SHA-256 again and run it, or download it again when it has
changed. A download with no answer within ${DOWNLOAD_LIMIT_MS / 1000} seconds is stopped and
counted as failed.

Examples:
  From crypto-price-fetchers' top folder, check its workflow files, as npm
  run lint does:
    $ node bin/run-actionlint.js .github/workflows/*.yml
  Check one workflow file:
    $ node bin/run-actionlint.js .github/workflows/ci.yml
  Check every archive of the release, and its program, against their
  SHA-256, running nothing, as npm run audit:actionlint does:
    $ node bin/run-actionlint.js --check
  From the top folder of a project that installs crypto-price-fetchers,
  check its workflow files, as its npm run lint does:
    $ node_modules/.bin/run-actionlint .github/workflows/*.yml

Exit codes: actionlint's own: 0 when it finds no problem, 1 when it finds
one or more, 2 when its arguments are wrong, 3 when it fails. 1 also when
an archive cannot be downloaded, its SHA-256 or its program's differs, or
the release has no archive for this system; 0 for --check when every
archive and program matches.`;

/**
 * The SHA-256 of some bytes.
 *
 * @param {Uint8Array} bytes - The bytes
 * @returns {string} Their checksum, in hex
 */
function sha256Of(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The archive a release has for a system.
 *
 * @param {import('./release.js').ActionlintRelease} release - The release
 * @param {string} platform - Node's name of the system, as `process.platform`
 * @param {string} arch - Node's name of the processor, as `process.arch`
 * @returns {import('./release.js').ActionlintArchive} The archive
 * @throws {Error} When the release names no archive for the system
 */
export function archiveFor(release, platform, arch) {
  const key = `${platform}-${arch}`;
  if (!Object.hasOwn(release.archives, key)) {
    throw new Error(
      `actionlint ${release.version} has no archive for ${key} among those crypto-price-fetchers' actionlint/release.js pins (${Object.keys(release.archives).join(", ")}).`,
    );
  }
  return release.archives[key];
}

/**
 * Downloads one archive of a release and checks its SHA-256.
 *
 * @param {import('./release.js').ActionlintRelease} release - The release
 * @param {import('./release.js').ActionlintArchive} archive - The archive
 * @param {function(string, Object): Promise<Response>} fetch - Does the download
 * @param {number} limitMs - How long the download may take
 * @returns {Promise<Buffer>} The archive's bytes
 * @throws {Error} When the download fails or the SHA-256 differs
 */
export async function downloadArchive(release, archive, fetch, limitMs) {
  const url = archiveUrl(release, archive.file);
  let response;
  try {
    response = await fetchWithinTimeLimit(
      url,
      {},
      { timeoutMs: limitMs, name: "GitHub", fetch },
    );
  } catch (error) {
    throw new Error(`Could not download ${url}: ${messageOf(error)}`, {
      cause: error,
    });
  }
  if (response.status !== 200) {
    throw new Error(`Could not download ${url}: status ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = sha256Of(bytes);
  if (sha256 !== archive.sha256) {
    throw new Error(
      `${archive.file} is not the archive crypto-price-fetchers pins: its SHA-256 is ${sha256}, not the ${archive.sha256} written in actionlint/release.js.`,
    );
  }
  return bytes;
}

/**
 * The text of a field of a tar header, up to its first zero byte.
 *
 * @param {Buffer} header - The header
 * @param {number} start - Where the field starts
 * @param {number} length - Its length
 * @returns {string} Its text
 */
function headerField(header, start, length) {
  const field = header.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.toString("utf8", 0, end === -1 ? field.length : end);
}

/**
 * The bytes of the regular file of a name in a tar archive.
 *
 * @param {Buffer} tar - The archive, uncompressed
 * @param {string} name - The file's name in it
 * @returns {?Buffer} Its bytes, or null when the archive has no such file
 */
export function fileFromTar(tar, name) {
  let offset = 0;
  while (offset + TAR_BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK);
    if (header.every((byte) => byte === 0)) return null;
    const prefix = headerField(header, 345, 155);
    const entryName = headerField(header, 0, 100);
    const fullName = prefix === "" ? entryName : `${prefix}/${entryName}`;
    const size = Number.parseInt(headerField(header, 124, 12).trim(), 8);
    const type = headerField(header, 156, 1);
    const start = offset + TAR_BLOCK;
    if (fullName === name && (type === "0" || type === "")) {
      return Buffer.from(tar.subarray(start, start + size));
    }
    offset = start + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
  }
  return null;
}

/**
 * The program in an archive of a release, checked against the SHA-256
 * pinned for it.
 *
 * @param {Buffer} archiveBytes - The archive, compressed with gzip
 * @param {import('./release.js').ActionlintArchive} archive - The archive's pins
 * @returns {Buffer} The program
 * @throws {Error} When the archive holds no program named actionlint, or
 *   its SHA-256 differs, naming the one it has
 */
export function programFromArchive(archiveBytes, archive) {
  const program = fileFromTar(gunzipSync(archiveBytes), "actionlint");
  if (program === null) {
    throw new Error(`${archive.file} holds no file named actionlint.`);
  }
  const sha256 = sha256Of(program);
  if (sha256 !== archive.programSha256) {
    throw new Error(
      `The program in ${archive.file} is not the one crypto-price-fetchers pins: its SHA-256 is ${sha256}, not the ${archive.programSha256} written in actionlint/release.js.`,
    );
  }
  return program;
}

/**
 * Whether a kept program is the one pinned: a file whose SHA-256 is the
 * one written for it.
 *
 * @param {string} programPath - The program's path
 * @param {import('./release.js').ActionlintArchive} archive - The archive's pins
 * @returns {boolean} Whether it is
 */
function keptProgramMatches(programPath, archive) {
  return (
    fs.existsSync(programPath) &&
    sha256Of(fs.readFileSync(programPath)) === archive.programSha256
  );
}

/**
 * The path of actionlint's program for this system, downloaded, checked
 * and kept the first time it is asked for, and again whenever the kept
 * program's SHA-256 is not the one pinned.
 *
 * @param {Object} options - Where and how
 * @param {import('./release.js').ActionlintRelease} options.release - The release
 * @param {string} options.cacheTop - The folder that keeps each version's program
 * @param {string} options.platform - Node's name of the system
 * @param {string} options.arch - Node's name of the processor
 * @param {function(string, Object): Promise<Response>} options.fetch - Does a download
 * @param {number} options.limitMs - How long a download may take
 * @returns {Promise<string>} The program's path
 */
export async function installedActionlint({
  release,
  cacheTop,
  platform,
  arch,
  fetch,
  limitMs,
}) {
  const folder = path.join(cacheTop, release.version, `${platform}-${arch}`);
  const programPath = path.join(folder, "actionlint");
  const archive = archiveFor(release, platform, arch);
  if (keptProgramMatches(programPath, archive)) return programPath;
  const bytes = await downloadArchive(release, archive, fetch, limitMs);
  const program = programFromArchive(bytes, archive);
  fs.mkdirSync(folder, { recursive: true });
  const partPath = `${programPath}.${process.pid}.part`;
  fs.writeFileSync(partPath, program, { mode: 0o755 });
  fs.renameSync(partPath, programPath);
  return programPath;
}

/**
 * Downloads every archive of a release and checks each SHA-256, and the
 * SHA-256 of the program in it.
 *
 * @param {Object} options - What and how
 * @param {import('./release.js').ActionlintRelease} options.release - The release
 * @param {function(string, Object): Promise<Response>} options.fetch - Does a download
 * @param {number} options.limitMs - How long a download may take
 * @returns {Promise<number>} The number of archives checked
 * @throws {Error} Naming, one to a line, each archive that failed
 */
export async function checkArchives({ release, fetch, limitMs }) {
  const archives = Object.values(release.archives);
  const problems = [];
  for (const archive of archives) {
    try {
      programFromArchive(
        await downloadArchive(release, archive, fetch, limitMs),
        archive,
      );
    } catch (error) {
      problems.push(messageOf(error));
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `actionlint ${release.version}'s archives fail the check:\n${problems.join("\n")}`,
    );
  }
  return archives.length;
}

/**
 * Runs the command line of `run-actionlint`, declared with commander.
 *
 * @param {string[]} argv - The arguments, as `process.argv`
 * @param {Object} [options] - What it uses, for tests
 * @param {function(string, Object): Promise<Response>} [options.fetch] - Does a download
 * @param {import('./release.js').ActionlintRelease} [options.release] - The release
 * @param {string} [options.cacheTop] - The folder that keeps each version's program
 * @param {string} [options.platform] - Node's name of the system
 * @param {string} [options.arch] - Node's name of the processor
 * @param {number} [options.limitMs] - How long a download may take
 * @param {function(string, string[]): {status: ?number, error?: Error}} [options.run] - Runs the program on the files
 * @param {{write: function(string): void}} [options.stdout] - Takes what it prints
 * @param {{write: function(string): void}} [options.stderr] - Takes its messages
 * @returns {Promise<number>} The exit code
 */
export async function runActionlint(
  argv,
  {
    fetch = globalThis.fetch,
    release = ACTIONLINT,
    cacheTop = path.join(process.cwd(), "node_modules", ".cache", "actionlint"),
    platform = process.platform,
    arch = process.arch,
    limitMs = DOWNLOAD_LIMIT_MS,
    run = (program, files) => spawnSync(program, files, { stdio: "inherit" }),
    stdout = process.stdout,
    stderr = process.stderr,
  } = {},
) {
  let exitCode = 0;
  const program = new Command()
    .name("run-actionlint")
    .description(
      "Checks GitHub Actions workflow files with actionlint, from its official release, whose SHA-256 this repo pins.",
    )
    .argument("[files...]", "the workflow files to check")
    .option(
      "--check",
      "download every archive of the release and check its SHA-256 and its program's, running nothing",
    )
    .exitOverride()
    .configureOutput({
      writeOut: (text) => stdout.write(text),
      writeErr: (text) => stderr.write(text),
    })
    .addHelpText("after", HELP_AFTER)
    .action(async (files, options) => {
      try {
        if (options.check === true) {
          const count = await checkArchives({ release, fetch, limitMs });
          stdout.write(
            `actionlint ${release.version}'s ${count} archives, and the program in each, match the SHA-256 crypto-price-fetchers pins.\n`,
          );
          return;
        }
        const programPath = await installedActionlint({
          release,
          cacheTop,
          platform,
          arch,
          fetch,
          limitMs,
        });
        const result = run(programPath, files);
        if (result.error !== undefined && result.error !== null) {
          throw result.error;
        }
        exitCode = result.status ?? 1;
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
