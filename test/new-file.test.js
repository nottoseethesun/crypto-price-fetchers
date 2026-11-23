/**
 * Tests of `lib/new-file.js`, which says why a folder refuses a new file:
 * a folder that takes one, left as it was, and /proc, a folder of
 * Linux's that refuses one even to root, whom no folder's modes stop.
 * @module test/new-file.test
 */

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { newFileRefusal } from "../lib/new-file.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

after(removeTempFolders);

describe("newFileRefusal", () => {
  it("gives null for a folder that takes a new file, and leaves it as it was", () => {
    const folder = makeTempFolder("new-file");
    assert.equal(newFileRefusal(folder), null);
    assert.deepEqual(fs.readdirSync(folder), []);
  });

  it(
    "gives the system's code for /proc, which takes no new file even from root",
    { skip: !fs.existsSync("/proc") && "this system has no /proc" },
    () => {
      assert.match(newFileRefusal("/proc"), /^E[A-Z]+$/);
      if (process.getuid?.() === 0)
        assert.doesNotThrow(() => fs.accessSync("/proc", fs.constants.W_OK));
    },
  );
});
