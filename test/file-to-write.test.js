/**
 * Tests of `lib/file-to-write.js`, the check of the option that names a
 * file a command line will write: each mistake it refuses, with the words
 * commander prints after the option's name, and a good path, which it
 * gives back as it is, leaving the folder as it was.
 * @module test/file-to-write.test
 */

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { InvalidArgumentError } from "commander";
import { fileToWriteArgument } from "../lib/file-to-write.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

after(removeTempFolders);

describe("fileToWriteArgument", () => {
  it("gives back a path in a folder that takes a new file, and writes nothing there", () => {
    const folder = makeTempFolder("file-to-write");
    const file = path.join(folder, "out.csv");
    assert.equal(fileToWriteArgument(file), file);
    assert.deepEqual(fs.readdirSync(folder), []);
  });

  it("refuses an empty name, a missing folder and a folder, saying which", () => {
    const folder = makeTempFolder("file-to-write");
    const missing = path.join(folder, "no-such-folder");
    const refusals = [
      ["", "It names no file."],
      [
        path.join(missing, "out.csv"),
        `Its folder, ${missing}, does not exist.`,
      ],
      [folder, "It is a folder, not a file."],
    ];
    for (const [value, message] of refusals)
      assert.throws(() => fileToWriteArgument(value), {
        name: InvalidArgumentError.name,
        message,
      });
  });

  it(
    "refuses a file in a folder that takes no new file, naming the system's code",
    { skip: !fs.existsSync("/proc") && "this system has no /proc" },
    () => {
      assert.throws(
        () => fileToWriteArgument("/proc/file-to-write-test.csv"),
        /^InvalidArgumentError: Its folder, \/proc, takes no new file \(E[A-Z]+\)\.$/,
      );
    },
  );
});
