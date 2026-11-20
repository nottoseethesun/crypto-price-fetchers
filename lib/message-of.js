/**
 * The message of something thrown, for the lines a program prints.
 * @module lib/message-of
 *
 * What: `messageOf` gives the message of what a `catch` caught: an error's
 * message, or, for a thrown value that holds none, the value as text.
 *
 * How: it reads `message` from any object that holds one as a string,
 * rather than asking `instanceof Error`. An error thrown by a Sheets
 * script comes from the script's own context (`vm.createContext`, in
 * `apps-script-runner/load-apps-script.js`), whose Error is not this
 * context's, so `instanceof Error` is false for it.
 *
 * Fit: the key manager (`api-key-store/key-manager.js`), the runner
 * (`apps-script-runner/`), the build step (`apps-script-build/`) and the
 * versions tool (`github-project-deps/`) write what they catch through it.
 * It ships with the package, since the runner, the key store and the
 * versions tool, which other projects install and run, import it.
 */

/**
 * The message of something thrown.
 *
 * @param {*} thrown - What was thrown
 * @returns {string} Its message, or, when it holds none, the thrown value as text
 */
export function messageOf(thrown) {
  if (
    thrown !== null &&
    typeof thrown === "object" &&
    typeof thrown.message === "string"
  )
    return thrown.message;
  return String(thrown);
}
