/**
 * Tests of `lib/ask-line.js`, which asks a question at the terminal and
 * gives the line typed, for the build step and the install of the
 * operating system's programs.
 * @module test/ask-line.test
 *
 * The terminal is a stand-in: a stream the test writes the answer to, and
 * one that keeps the question.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { askLine } from "../lib/ask-line.js";
import { capturedOutput } from "./helpers/captured-output.js";

describe("askLine", () => {
  it("writes the question and gives the line typed, without its newline", async () => {
    const input = new PassThrough();
    const output = capturedOutput();
    const answer = askLine("Go on? (y/N) ", { input, output });
    input.write("y\n");
    assert.equal(await answer, "y");
    assert.equal(output.text, "Go on? (y/N) ");
  });

  it("gives null when the input ends before a line, as a closed pipe does", async () => {
    const input = new PassThrough();
    const answer = askLine("Go on? ", { input, output: capturedOutput() });
    input.end();
    assert.equal(await answer, null);
  });
});
