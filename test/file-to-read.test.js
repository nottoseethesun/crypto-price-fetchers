/**
 * Tests of `lib/file-to-read.js`, the check of the option that names a
 * file a command line will read: each mistake it refuses, with the words
 * commander prints after the option's name, and a good path, which it
 * gives back as it is.
 * @module test/file-to-read.test
 */

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { InvalidArgumentError } from "commander";
import { fileToReadArgument } from "../lib/file-to-read.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

after(removeTempFolders);

describe("fileToReadArgument", () => {
  it("gives back the path of a file that is there", () => {
    const file = path.join(makeTempFolder("file-to-read"), "rows.json");
    fs.writeFileSync(file, "[]");
    assert.equal(fileToReadArgument(file), file);
  });

  it("refuses an empty name, a path at which no file is, and a folder, saying which", () => {
    const folder = makeTempFolder("file-to-read");
    const missing = path.join(folder, "no-such-file.json");
    const refusals = [
      ["", "It names no file."],
      [missing, `No file is at ${missing}.`],
      [folder, `No file is at ${folder}.`],
    ];
    for (const [value, message] of refusals)
      assert.throws(() => fileToReadArgument(value), {
        name: InvalidArgumentError.name,
        message,
      });
  });
});
