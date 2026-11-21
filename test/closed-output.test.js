/**
 * Tests of `lib/closed-output.js`, which ends a command line quietly when
 * the program reading its output closes the pipe, and of
 * `helpIntoClosedPipe` (`lib/command-line-help.js`), the check every
 * repo's tests make of each of its command lines with it.
 * @module test/closed-output.test
 *
 * Each test writes a small command line into a temp folder of its own and
 * runs it with `helpIntoClosedPipe`: one whose entry point calls
 * `endQuietlyWhenOutputCloses`, and one that does not. Each writes its
 * help in two writes, as commander writes a help and the text added after
 * it.
 */

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { helpIntoClosedPipe } from "../lib/command-line-help.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

after(removeTempFolders);

/** The url of the helper tested. */
const HELPER = new URL("../lib/closed-output.js", import.meta.url).href;

/**
 * Writes a command line that prints a help in two writes and sets its exit
 * code, into a temp folder of its own.
 *
 * @param {boolean} withHelper - Whether its entry point calls the helper
 * @param {number} [exitCode=0] - The exit code it sets after writing
 * @returns {string} The temp folder, which holds it as cli.mjs
 */
function commandLine(withHelper, exitCode = 0) {
  const folder = makeTempFolder("closed-output");
  const lines = [
    withHelper
      ? `import { endQuietlyWhenOutputCloses } from ${JSON.stringify(HELPER)};`
      : "",
    withHelper ? "endQuietlyWhenOutputCloses();" : "",
    'process.stdout.write("Usage: cli [options]\\n");',
    'process.stdout.write("Examples:\\n  $ cli --help\\n");',
    `process.exitCode = ${exitCode};`,
  ];
  fs.writeFileSync(path.join(folder, "cli.mjs"), lines.join("\n"));
  return folder;
}

describe("endQuietlyWhenOutputCloses", () => {
  it("ends a command line with exit code 0, writing nothing to stderr, when its output's reader has closed the pipe", async () => {
    assert.deepEqual(
      await helpIntoClosedPipe(commandLine(true), {
        file: "cli.mjs",
        command: [],
      }),
      { status: 0, stderr: "" },
    );
  });

  it("keeps the exit code the run set before the pipe closed", async () => {
    const run = await helpIntoClosedPipe(commandLine(true, 3), {
      file: "cli.mjs",
      command: [],
    });
    assert.equal(run.status, 3);
    assert.equal(run.stderr, "");
  });
});

describe("helpIntoClosedPipe", () => {
  it("shows the stack trace and exit code 1 of a command line whose entry point does not call the helper", async () => {
    const run = await helpIntoClosedPipe(commandLine(false), {
      file: "cli.mjs",
      command: [],
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /EPIPE/);
  });
});
