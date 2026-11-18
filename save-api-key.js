/**
 * Saves an api key the tools in this repo send, encrypted with a password,
 * in the repo's key file: `npm run save-api-key -- coingecko`.
 * @module save-api-key
 *
 * What: asks for the key, then for a password twice, at a prompt that
 * shows nothing of what is typed; asks the service whether it takes the
 * key; and saves it, encrypted with the password, only if it does, in
 * place of any key saved for the service before. Each run of a tool that
 * sends the key then asks for the password and opens it
 * (`coingecko-api-key.js`).
 *
 * How: the service is the one argument. The key and the password are
 * never arguments, which shell history and `ps` would keep. Help goes to
 * stdout with exit code 0; a key not saved, or a mistake in the
 * arguments, ends with its message on stderr and exit code 1.
 *
 * Fit: the program `npm run save-api-key` runs, from the repo's top
 * folder; the messages of both tools name it when a key needs saving.
 */

import { Argument, Command, CommanderError } from 'commander';
import { isEntryPoint } from './apps-script-runner/index.js';
import { saveCoinGeckoKey } from './coingecko-api-key.js';

/** What saves each service's key. */
const SAVERS = Object.freeze({ coingecko: saveCoinGeckoKey });

/** What the help says after the options. */
const HELP_AFTER = `
The key and the password are typed at a prompt that shows nothing of what is
typed. The password is kept nowhere: a tool that sends the key asks for it
each time it runs. Every key in the file is saved with one password.

Exit codes:
  0  the key is saved
  1  no key was saved, or the arguments were wrong; the message says why`;

/**
 * The message of something thrown.
 *
 * @param {*} thrown - What was thrown
 * @returns {string} Its message
 */
function messageOf(thrown) {
  if (thrown !== null && typeof thrown === 'object' && typeof thrown.message === 'string') return thrown.message;
  return String(thrown);
}

/**
 * Runs the command line, in process.
 *
 * @param {string[]} argv - The arguments, shaped as `process.argv`
 * @param {Object} [deps] - What a test replaces
 * @param {string} [deps.file] - The key file, in place of `apiKeysFile()`
 * @param {function(string): Promise<string>} [deps.ask] - Answers the prompts, in place of the terminal
 * @param {function(string, Object): Promise<Response>} [deps.fetch] - Asks the service, in place of Node's fetch
 * @param {{write: function(string): void}} [deps.stdout=process.stdout] - Where output goes
 * @param {{write: function(string): void}} [deps.stderr=process.stderr] - Where messages go
 * @returns {Promise<number>} The exit code
 */
export async function runSaveApiKey(argv, deps = {}) {
  const io = { stdout: deps.stdout ?? process.stdout, stderr: deps.stderr ?? process.stderr };
  const program = new Command()
    .name('save-api-key')
    .description(
      "Saves an api key the tools in this repo send, encrypted with a password you type, in api-keys.json at the repo's top, which git ignores."
    )
    .addArgument(new Argument('<service>', 'the service the key is for').choices(Object.keys(SAVERS)))
    .exitOverride()
    .configureOutput({ writeOut: (text) => io.stdout.write(text), writeErr: (text) => io.stderr.write(text) })
    .addHelpText('after', HELP_AFTER)
    .action((service) =>
      SAVERS[service]({ file: deps.file, ask: deps.ask, fetch: deps.fetch, say: (line) => io.stdout.write(`${line}\n`) })
    );
  try {
    await program.parseAsync(argv);
  } catch (thrown) {
    if (thrown instanceof CommanderError) return thrown.exitCode;
    io.stderr.write(`${messageOf(thrown)}\n`);
    return 1;
  }
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await runSaveApiKey(process.argv);
}
