/**
 * A prompt on the terminal for a secret, such as a password or an api key,
 * that shows nothing of what is typed, as LP Ranger's
 * `src/lib/ask-password.js` is.
 * @module api-key-store/ask-password
 *
 * What: `askPassword` asks one question; `openSecretPrompt` asks several in
 * a row, such as a key and then its password twice. Each prompt goes to
 * stderr, so stdout stays clean for piped output, and the answer is what
 * was typed, without the line end.
 *
 * How: Node has no option that hides what is typed, so readline gets an
 * output that shows nothing. With `terminal: true`, readline turns off the
 * terminal's own echo and edits the line itself, writing each key typed,
 * and each redraw of the line, to its output; here that output drops
 * whatever it is given. So the keys still edit the line, a backspace or a
 * paste, and none of it reaches the screen. Only the prompt, written to
 * stderr itself, and the line break after the answer appear.
 *
 * One readline interface answers every question of a prompt, in order, so
 * answers piped in together are each kept for their question. Ctrl+C, or
 * the input ending before an answer, stops the question with an error.
 *
 * Fit: `key-prompts.js` asks for keys and passwords through this.
 */

import readline from 'node:readline';
import { Writable } from 'node:stream';

/**
 * A stream that takes whatever is written to it and shows none of it.
 *
 * @returns {Writable} The stream
 */
function showsNothing() {
  return new Writable({
    write(_chunk, _encoding, done) {
      done();
    }
  });
}

/**
 * Opens a prompt that asks for secrets, one after another, showing nothing
 * of what is typed.
 *
 * @param {Object} [streams] - Where answers are typed and prompts go: stdin and stderr, unless a test passes its own
 * @param {import('node:stream').Readable} [streams.input=process.stdin] - Where answers are typed
 * @param {import('node:stream').Writable} [streams.output=process.stderr] - Where prompts go
 * @returns {{ask: function(string): Promise<string>, close: function(): void}} `ask(prompt)` asks one question; `close()` ends the prompt
 */
export function openSecretPrompt(streams = {}) {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stderr;
  const lines = [];
  const waiting = [];
  let stopped = null;
  const rl = readline.createInterface({ input, output: showsNothing(), terminal: true });
  rl.on('line', (line) => {
    const next = waiting.shift();
    if (next === undefined) lines.push(line);
    else next.resolve(line);
  });
  rl.on('SIGINT', () => {
    stopped = 'Stopped at the prompt';
    rl.close();
  });
  rl.on('close', () => {
    stopped ??= 'The input ended before an answer was typed';
    for (const next of waiting.splice(0)) next.reject(new Error(stopped));
  });
  const ask = async (prompt) => {
    output.write(prompt);
    let answer;
    if (lines.length > 0) answer = lines.shift();
    else if (stopped !== null) throw new Error(stopped);
    else answer = await new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    output.write('\n');
    return answer;
  };
  return { ask, close: () => rl.close() };
}

/**
 * Asks for one secret on the terminal, showing nothing of what is typed.
 *
 * @param {string} prompt - Text written before the answer is typed
 * @param {Object} [streams] - Where the answer is typed and the prompt goes (`openSecretPrompt`)
 * @returns {Promise<string>} What was typed, without the line end
 * @throws {Error} When Ctrl+C is pressed, or the input ends, before an answer
 */
export async function askPassword(prompt, streams = {}) {
  const prompts = openSecretPrompt(streams);
  try {
    return await prompts.ask(prompt);
  } finally {
    prompts.close();
  }
}
