/**
 * A question asked at the terminal, answered with one line.
 * @module lib/ask-line
 *
 * What: `askLine` writes the question and gives the line typed, or null
 * when the input ends before a line, as when it is a pipe that closes or
 * an empty file, so a program run with no one to answer takes its
 * default.
 *
 * How: each question reads the input until it has a line, then stops
 * listening and pauses the input, so the input is not held open after
 * the answer and another reader, such as the key store's password
 * prompt, can read it next. What came past the answer, as piped answers
 * do, is kept for the input: whole lines, and the start of the next,
 * which, once the input has ended, is the last line. The next question,
 * and `takeLinesRead`, take what is kept before reading again; a
 * question asked once the input has ended, with nothing kept, gets null.
 *
 * Fit: the build step's questions (`build/tools/apps-script-build/`) and
 * the install of the operating system's programs (`install/`) ask with
 * it; the key store's password prompt (`api-key-store/ask-password.js`)
 * takes the lines it kept.
 */

import { StringDecoder } from "node:string_decoder";

/**
 * What each input gave past the answers taken: the whole lines, the start
 * of the next line, and the decoder of its bytes, which holds a
 * character cut between two chunks.
 */
const readsOf = new WeakMap();

/**
 * What an input gave past the answers taken, kept from one question to
 * the next.
 *
 * @param {NodeJS.ReadableStream} input - The input
 * @returns {{lines: string[], partial: string, decoder: StringDecoder}} What it kept
 */
function readOf(input) {
  let read = readsOf.get(input);
  if (read === undefined) {
    read = { lines: [], partial: "", decoder: new StringDecoder("utf8") };
    readsOf.set(input, read);
  }
  return read;
}

/**
 * Takes the next line an input gave past the answers taken, or, once the
 * input has ended, the last line it ended without a line end.
 *
 * @param {NodeJS.ReadableStream} input - The input
 * @returns {string|undefined} The line, or undefined when none is kept
 */
function takeLine(input) {
  const read = readOf(input);
  if (read.lines.length > 0) return read.lines.shift();
  if (!input.readableEnded || read.partial === "") return undefined;
  const last = read.partial;
  read.partial = "";
  return last;
}

/**
 * Takes the lines an input gave past the answers `askLine` took, and,
 * once the input has ended, the last line it ended without a line end,
 * for another reader of the same input to answer first.
 *
 * @param {NodeJS.ReadableStream} input - The input
 * @returns {string[]} The lines, oldest first; none when nothing is kept
 */
export function takeLinesRead(input) {
  const read = readOf(input);
  const lines = read.lines.splice(0);
  if (input.readableEnded && read.partial !== "") {
    lines.push(read.partial);
    read.partial = "";
  }
  return lines;
}

/**
 * Asks a question at the terminal and gives the line typed.
 *
 * @param {string} prompt - The question
 * @param {{input: NodeJS.ReadableStream, output: NodeJS.WritableStream}} streams - Where it is asked
 * @returns {Promise<?string>} The line typed, or null when the input ended first
 */
export function askLine(prompt, { input, output }) {
  output.write(prompt);
  const kept = takeLine(input);
  if (kept !== undefined) return Promise.resolve(kept);
  if (input.readableEnded) return Promise.resolve(null);
  const read = readOf(input);
  return new Promise((resolve) => {
    const answer = (line) => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.pause();
      resolve(line);
    };
    const onData = (chunk) => {
      const parts = (read.partial + read.decoder.write(chunk)).split(/\r?\n/);
      read.partial = parts.pop();
      read.lines.push(...parts);
      if (read.lines.length > 0) answer(read.lines.shift());
    };
    const onEnd = () => {
      const last = read.partial + read.decoder.end();
      read.partial = "";
      answer(last === "" ? null : last);
    };
    input.on("data", onData);
    input.once("end", onEnd);
    input.resume();
  });
}
