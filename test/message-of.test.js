/**
 * Tests for `lib/message-of.js`, which gives the message of something
 * thrown. The test of what the package ships asks npm what it would pack,
 * which reads only this repo.
 * @module test/message-of.test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { messageOf } from "../lib/message-of.js";

describe("messageOf", () => {
  it("gives an error's message", () => {
    assert.equal(messageOf(new TypeError("no answer")), "no answer");
  });

  it("gives the message of an error from another context, which is no instance of this one's Error", () => {
    const foreign = vm.runInNewContext("new Error('from the script')");
    assert.equal(foreign instanceof Error, false);
    assert.equal(messageOf(foreign), "from the script");
  });

  it("gives the message of any object that holds one as a string", () => {
    assert.equal(messageOf({ message: "refused" }), "refused");
  });

  it("gives a thrown value that holds no message as text", () => {
    assert.equal(messageOf("plain text"), "plain text");
    assert.equal(messageOf(42), "42");
    assert.equal(messageOf(null), "null");
    assert.equal(messageOf(undefined), "undefined");
    assert.equal(messageOf({ message: 7 }), "[object Object]");
  });

  it("ships with the package, since the runner and the key store, which other projects install, import it", () => {
    const packed = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: path.resolve(import.meta.dirname, ".."),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    )[0];
    assert.ok(packed.files.some((file) => file.path === "lib/message-of.js"));
  });
});
