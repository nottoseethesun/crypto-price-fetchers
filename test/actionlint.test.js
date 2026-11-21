/**
 * Tests for actionlint/, which runs actionlint, the checker of GitHub
 * Actions workflow files, from its official release, checked against the
 * SHA-256 this repo pins.
 * @module test/actionlint.test
 *
 * The tests ask no outside service: a stand-in fetch serves archives built
 * here, each a tar file compressed with gzip that holds a stand-in
 * program, a shell script, with the SHA-256 of each worked out here. The
 * programs are kept in temp folders of the test's own.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  archiveFor,
  checkArchives,
  fileFromTar,
  installedActionlint,
  programFromArchive,
  runActionlint,
} from "../actionlint/index.js";
import { ACTIONLINT, archiveUrl } from "../actionlint/release.js";
import { capturedOutput } from "./helpers/captured-output.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

after(removeTempFolders);

/** The stand-in program: prints its arguments, and exits as actionlint does on finding a problem. */
const PROGRAM = '#!/bin/sh\necho "stand-in actionlint $*"\nexit 1\n';

/**
 * A tar archive of files, in the ustar layout actionlint's archives use.
 *
 * @param {Array<{name: string, bytes: Buffer, type?: string}>} files - Its files, in order
 * @returns {Buffer} The archive, uncompressed
 */
function tarOf(files) {
  const blocks = [];
  for (const { name, bytes, type = "0" } of files) {
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 100, "utf8");
    header.write("0000755\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header.write("        ", 148);
    header.write(type, 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, bytes);
    blocks.push(Buffer.alloc((512 - (bytes.length % 512)) % 512, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

/** A stand-in archive, as a release's: docs first, then the program. */
const ARCHIVE = gzipSync(
  tarOf([
    { name: "README.md", bytes: Buffer.from("# actionlint\n") },
    { name: "actionlint", bytes: Buffer.from(PROGRAM) },
  ]),
);

/**
 * The SHA-256 of some bytes.
 *
 * @param {Buffer} bytes - The bytes
 * @returns {string} Their checksum, in hex
 */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A stand-in release with two archives, each the stand-in archive. */
const RELEASE = Object.freeze({
  version: "9.9.9",
  archives: {
    "linux-x64": {
      file: "actionlint_9.9.9_linux_amd64.tar.gz",
      sha256: sha256(ARCHIVE),
      programSha256: sha256(Buffer.from(PROGRAM)),
    },
    "darwin-arm64": {
      file: "actionlint_9.9.9_darwin_arm64.tar.gz",
      sha256: sha256(ARCHIVE),
      programSha256: sha256(Buffer.from(PROGRAM)),
    },
  },
});

/**
 * A fetch that serves bytes by url, and 404 for any other, keeping the
 * urls asked for in its `requests` array; it gives up when the request's
 * signal aborts, as Node's fetch does.
 *
 * @param {Object<string, Buffer>} served - The bytes, by url
 * @returns {function(string, Object): Promise<Response>} The fetch
 */
function serving(served) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    init.signal?.throwIfAborted();
    requests.push(url);
    return Object.hasOwn(served, url)
      ? new Response(served[url], { status: 200 })
      : new Response("Not found", { status: 404 });
  };
  fetch.requests = requests;
  return fetch;
}

/** The stand-in release's archives, served at their urls. */
const SERVED = Object.fromEntries(
  Object.values(RELEASE.archives).map((archive) => [
    archiveUrl(RELEASE, archive.file),
    ARCHIVE,
  ]),
);

/**
 * Keeps the stand-in release's program for Linux on x64, as a run would.
 *
 * @param {function(string, Object): Promise<Response>} fetch - Serves the downloads
 * @param {string} [cacheTop] - The folder that keeps the programs
 * @returns {Promise<string>} The program's path
 */
function install(fetch, cacheTop = makeTempFolder("actionlint")) {
  return installedActionlint({
    release: RELEASE,
    cacheTop,
    platform: "linux",
    arch: "x64",
    fetch,
    limitMs: 1000,
  });
}

describe("fileFromTar", () => {
  it("gives the bytes of a file among others, past an extended header, and null for a file the archive lacks", () => {
    const tar = tarOf([
      {
        name: "PaxHeader",
        bytes: Buffer.from("30 path=actionlint\n"),
        type: "x",
      },
      { name: "docs/usage.md", bytes: Buffer.alloc(700, 65) },
      { name: "actionlint", bytes: Buffer.from(PROGRAM) },
    ]);
    assert.equal(fileFromTar(tar, "actionlint").toString(), PROGRAM);
    assert.equal(fileFromTar(tar, "docs/usage.md").length, 700);
    assert.equal(fileFromTar(tar, "missing"), null);
  });

  it("refuses an archive that holds no program named actionlint", () => {
    const empty = gzipSync(
      tarOf([{ name: "README.md", bytes: Buffer.from("x") }]),
    );
    assert.throws(
      () => programFromArchive(empty, RELEASE.archives["linux-x64"]),
      /actionlint_9\.9\.9_linux_amd64\.tar\.gz holds no file named actionlint/,
    );
  });

  it("refuses a program whose SHA-256 differs from the one pinned for it, naming the one it has", () => {
    const other = gzipSync(
      tarOf([
        { name: "actionlint", bytes: Buffer.from("#!/bin/sh\nexit 0\n") },
      ]),
    );
    assert.throws(
      () => programFromArchive(other, RELEASE.archives["linux-x64"]),
      /The program in actionlint_9\.9\.9_linux_amd64\.tar\.gz is not the one crypto-price-fetchers pins: its SHA-256 is [0-9a-f]{64}, not the [0-9a-f]{64} written in actionlint\/release\.js/,
    );
  });
});

describe("installedActionlint", () => {
  it("downloads the archive for the system the first time, checks its SHA-256, and keeps the program, which later runs use without downloading", async () => {
    const fetch = serving(SERVED);
    const cacheTop = makeTempFolder("actionlint-cache");
    const programPath = await install(fetch, cacheTop);
    assert.equal(
      programPath,
      path.join(cacheTop, "9.9.9", "linux-x64", "actionlint"),
    );
    assert.deepEqual(fetch.requests, [
      "https://github.com/rhysd/actionlint/releases/download/v9.9.9/actionlint_9.9.9_linux_amd64.tar.gz",
    ]);
    assert.equal(fs.readFileSync(programPath, "utf8"), PROGRAM);
    assert.equal(fs.statSync(programPath).mode & 0o111, 0o111);
    assert.equal(await install(fetch, cacheTop), programPath);
    assert.equal(fetch.requests.length, 1);
    assert.deepEqual(fs.readdirSync(path.dirname(programPath)), ["actionlint"]);
  });

  it("downloads the archive again when the kept program has changed since it was checked, and keeps the pinned one", async () => {
    const fetch = serving(SERVED);
    const cacheTop = makeTempFolder("actionlint-tampered");
    const programPath = await install(fetch, cacheTop);
    fs.writeFileSync(programPath, "#!/bin/sh\necho changed\n");
    assert.equal(await install(fetch, cacheTop), programPath);
    assert.equal(fetch.requests.length, 2);
    assert.equal(fs.readFileSync(programPath, "utf8"), PROGRAM);
  });

  it("refuses an archive whose SHA-256 differs, keeping nothing", async () => {
    const changed = Object.fromEntries(
      Object.keys(SERVED).map((url) => [url, gzipSync(Buffer.from("other"))]),
    );
    const cacheTop = makeTempFolder("actionlint-changed");
    await assert.rejects(
      install(serving(changed), cacheTop),
      /actionlint_9\.9\.9_linux_amd64\.tar\.gz is not the archive crypto-price-fetchers pins: its SHA-256 is [0-9a-f]{64}, not the [0-9a-f]{64} written in actionlint\/release\.js/,
    );
    assert.equal(fs.existsSync(path.join(cacheTop, "9.9.9")), false);
  });

  it("names the system when the release has no archive for it", async () => {
    await assert.rejects(
      installedActionlint({
        release: RELEASE,
        cacheTop: makeTempFolder("actionlint-system"),
        platform: "win32",
        arch: "x64",
        fetch: serving(SERVED),
        limitMs: 1000,
      }),
      /actionlint 9\.9\.9 has no archive for win32-x64 among those crypto-price-fetchers' actionlint\/release\.js pins \(linux-x64, darwin-arm64\)/,
    );
    assert.equal(
      archiveFor(RELEASE, "darwin", "arm64"),
      RELEASE.archives["darwin-arm64"],
    );
  });

  it("names the url of a download that fails, or that has no answer in time", async () => {
    await assert.rejects(
      install(serving({})),
      /Could not download https:\/\/github\.com\/rhysd\/actionlint\/releases\/download\/v9\.9\.9\/actionlint_9\.9\.9_linux_amd64\.tar\.gz: status 404/,
    );
    // AbortSignal.timeout's timer keeps no process alive, as an open
    // socket would, so the stand-in holds an interval until the abort
    const stalled = (url, init) =>
      new Promise((resolve, reject) => {
        const openSocket = setInterval(() => {}, 1000);
        init.signal.addEventListener("abort", () => {
          clearInterval(openSocket);
          reject(init.signal.reason);
        });
      });
    await assert.rejects(
      installedActionlint({
        release: RELEASE,
        cacheTop: makeTempFolder("actionlint-stalled"),
        platform: "linux",
        arch: "x64",
        fetch: stalled,
        limitMs: 50,
      }),
      /Could not download .*linux_amd64\.tar\.gz: no answer within 0\.05 seconds/,
    );
  });
});

describe("checkArchives", () => {
  it("downloads every archive and checks each SHA-256, naming each that fails, one to a line", async () => {
    assert.equal(
      await checkArchives({
        release: RELEASE,
        fetch: serving(SERVED),
        limitMs: 1000,
      }),
      2,
    );
    const linuxOnly = {
      [archiveUrl(RELEASE, RELEASE.archives["linux-x64"].file)]: ARCHIVE,
    };
    await assert.rejects(
      checkArchives({
        release: RELEASE,
        fetch: serving(linuxOnly),
        limitMs: 1000,
      }),
      (error) => {
        const lines = error.message.split("\n");
        assert.equal(lines[0], "actionlint 9.9.9's archives fail the check:");
        assert.equal(lines.length, 2);
        assert.match(lines[1], /darwin_arm64\.tar\.gz: status 404/);
        return true;
      },
    );
  });
});

describe("runActionlint, the command line", () => {
  it("runs the kept program on the files given, and exits with its exit code", async () => {
    const output = { stdout: capturedOutput(), stderr: capturedOutput() };
    const ran = [];
    const exitCode = await runActionlint(
      ["node", "run-actionlint.js", ".github/workflows/ci.yml", "a.yml"],
      {
        fetch: serving(SERVED),
        release: RELEASE,
        cacheTop: makeTempFolder("actionlint-run"),
        platform: "linux",
        arch: "x64",
        run: (programPath, files) => {
          const result = spawnSync(programPath, files, { encoding: "utf8" });
          ran.push(result.stdout);
          return result;
        },
        stdout: output.stdout,
        stderr: output.stderr,
      },
    );
    assert.equal(exitCode, 1);
    assert.deepEqual(ran, [
      "stand-in actionlint .github/workflows/ci.yml a.yml\n",
    ]);
    assert.equal(output.stderr.text, "");
  });

  it("checks every archive with --check, running nothing, and exits with 1 when one fails", async () => {
    const output = { stdout: capturedOutput(), stderr: capturedOutput() };
    let ran = false;
    const options = {
      release: RELEASE,
      cacheTop: makeTempFolder("actionlint-check"),
      run: () => {
        ran = true;
        return { status: 0 };
      },
      stdout: output.stdout,
      stderr: output.stderr,
      limitMs: 1000,
    };
    assert.equal(
      await runActionlint(["node", "run-actionlint.js", "--check"], {
        ...options,
        fetch: serving(SERVED),
      }),
      0,
    );
    assert.equal(
      output.stdout.text,
      "actionlint 9.9.9's 2 archives, and the program in each, match the SHA-256 crypto-price-fetchers pins.\n",
    );
    assert.equal(
      await runActionlint(["node", "run-actionlint.js", "--check"], {
        ...options,
        fetch: serving({}),
      }),
      1,
    );
    assert.match(
      output.stderr.text,
      /fail the check:\n.*status 404\n.*status 404\n$/,
    );
    assert.equal(ran, false);
  });

  it("exits with 1, saying why, when the program cannot be had", async () => {
    const output = { stdout: capturedOutput(), stderr: capturedOutput() };
    const exitCode = await runActionlint(
      ["node", "run-actionlint.js", "ci.yml"],
      {
        fetch: serving({}),
        release: RELEASE,
        cacheTop: makeTempFolder("actionlint-none"),
        platform: "linux",
        arch: "x64",
        stdout: output.stdout,
        stderr: output.stderr,
      },
    );
    assert.equal(exitCode, 1);
    assert.match(output.stderr.text, /^Could not download .*: status 404\n$/);
  });
});

describe("ACTIONLINT", () => {
  it("names one release of actionlint and the SHA-256 of its archives for Linux and macOS, on x64 and arm64, and of the program in each", () => {
    assert.match(ACTIONLINT.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(Object.keys(ACTIONLINT.archives).sort(), [
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
    ]);
    for (const [system, archive] of Object.entries(ACTIONLINT.archives)) {
      const [platform, arch] = system.split("-");
      const name = arch === "x64" ? "amd64" : arch;
      assert.equal(
        archive.file,
        `actionlint_${ACTIONLINT.version}_${platform}_${name}.tar.gz`,
      );
      assert.match(archive.sha256, /^[0-9a-f]{64}$/);
      assert.match(archive.programSha256, /^[0-9a-f]{64}$/);
    }
    assert.equal(
      archiveUrl(ACTIONLINT, "a.tar.gz"),
      `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT.version}/a.tar.gz`,
    );
  });
});
