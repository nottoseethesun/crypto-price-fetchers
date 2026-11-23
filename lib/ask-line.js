/**
 * A question asked at the terminal, answered with one line.
 * @module lib/ask-line
 *
 * What: `askLine` writes the question and gives the line typed, or null
 * when the input ends before a line, as when it is a pipe that closes or
 * an empty file, so a program run with no one to answer takes its
 * default.
 *
 * How: one readline interface per question, closed once it is answered,
 * so the input is not held open after the answer. Lines that came in the
 * same chunk as the answer, as piped answers do, are kept for the next
 * questions on that input, which take them before reading again; a
 * question asked once the input has ended, with no line kept, gets null
 * at once, since a new interface would wait for an end that has passed.
 *
 * Fit: the build step's questions (`build/tools/apps-script-build/`) and
 * the install of the operating system's programs (`install/`) ask with it.
 */

import readline from "node:readline";

/**
 * The lines each input gave past an answer, which the next questions on
 * it take first. readline goes on giving the lines of a chunk after the
 * interface is closed, so they are caught here rather than lost.
 */
const linesKept = new WeakMap();

/**
 * Asks a question at the terminal and gives the line typed.
 *
 * @param {string} prompt - The question
 * @param {{input: NodeJS.ReadableStream, output: NodeJS.WritableStream}} streams - Where it is asked
 * @returns {Promise<?string>} The line typed, or null when the input ended first
 */
export function askLine(prompt, { input, output }) {
  output.write(prompt);
  const kept = linesKept.get(input);
  if (kept !== undefined && kept.length > 0)
    return Promise.resolve(kept.shift());
  if (input.readableEnded) return Promise.resolve(null);
  return new Promise((resolve) => {
    const lines = readline.createInterface({ input, terminal: false });
    let answered = false;
    lines.on("line", (line) => {
      if (answered) {
        const rest = linesKept.get(input) ?? [];
        rest.push(line);
        linesKept.set(input, rest);
        return;
      }
      answered = true;
      resolve(line);
      lines.close();
    });
    lines.once("close", () => {
      if (!answered) resolve(null);
    });
  });
}
