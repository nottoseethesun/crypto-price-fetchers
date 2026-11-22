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
 * so the input is not held open after the answer.
 *
 * Fit: the build step's questions (`build/tools/apps-script-build/`) and
 * the install of the operating system's programs (`install/`) ask with it.
 */

import readline from "node:readline";

/**
 * Asks a question at the terminal and gives the line typed.
 *
 * @param {string} prompt - The question
 * @param {{input: NodeJS.ReadableStream, output: NodeJS.WritableStream}} streams - Where it is asked
 * @returns {Promise<?string>} The line typed, or null when the input ended first
 */
export function askLine(prompt, { input, output }) {
  return new Promise((resolve) => {
    const lines = readline.createInterface({ input, terminal: false });
    let answered = false;
    lines.once("line", (line) => {
      answered = true;
      lines.close();
      resolve(line);
    });
    lines.once("close", () => {
      if (!answered) resolve(null);
    });
    output.write(prompt);
  });
}
