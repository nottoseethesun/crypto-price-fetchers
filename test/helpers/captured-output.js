/**
 * A stream stand-in that keeps what is written to it, for the tests of the
 * command lines.
 * @module test/helpers/captured-output
 */

/**
 * Builds a writable stand-in that keeps what is written to it.
 *
 * @returns {{write: function(string): boolean, text: string}} The stand-in; `text` is everything written so far
 */
export function capturedOutput() {
  const output = {
    text: '',
    write(chunk) {
      output.text += chunk;
      return true;
    }
  };
  return output;
}
