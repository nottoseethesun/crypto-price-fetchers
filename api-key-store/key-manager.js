/**
 * The api key manager each project runs from its top folder:
 * `npm run api-keys`.
 * @module api-key-store/key-manager
 *
 * What:
 *
 * - With no command, it lists the services the project's `config.json`
 *   names under `apiKeys`, each with its key "saved" or "not saved", and
 *   asks for each key not saved; Enter alone skips one.
 * - `set <service>` asks for one key, in place of the one saved.
 * - `check-password` says whether the password in `API_KEYS_PASSWORD`
 *   opens every key saved. `bin/unlock-api-keys.sh` runs it before it keeps a
 *   password for a terminal.
 *
 * How:
 *
 * - Keys and the password are typed at a prompt that shows nothing of what
 *   is typed, and no line shows any character of a key: the list says only
 *   whether each is saved.
 * - Every key is saved with one password: the one in `API_KEYS_PASSWORD`
 *   when that is set, so a terminal unlocked once saves keys with the
 *   password it opens them with; else one typed (`key-prompts.js`).
 * - A key is saved only once its service takes it. A key not saved is
 *   reported and the next one is asked; a password that does not open the
 *   keys saved stops the run.
 * - Help goes to stdout with exit code 0. The list goes to stdout and the
 *   prompts and messages to stderr. A key not saved, a password that opens
 *   nothing, or a mistake in the arguments ends with exit code 1.
 *
 * Fit: a project's `bin/manage-api-keys.js`, in this repo
 * `bin/end-user/manage-api-keys.js`, runs `runKeyManager` with its top
 * folder.
 */

import { Command, CommanderError } from "commander";
import { messageOf } from "../lib/message-of.js";
import { openSecretPrompt } from "./ask-password.js";
import { checkPasswordOpensKeys, hasEncryptedKey } from "./key-file.js";
import {
  enterApiKey,
  MANAGE_COMMAND,
  UNLOCK_VARIABLE,
  savingPassword,
  UNLOCK_COMMAND,
} from "./key-prompts.js";
import {
  keyFileFor,
  PROJECT_CONFIG_FILE,
  readNeededKeys,
} from "./project-keys.js";
import { SERVICES } from "./services.js";

/** What the help says after the commands. */
const HELP_AFTER = `
Keys and the password are typed at a prompt that shows nothing of what is
typed, and no line shows a key's characters. Every key is saved with one
password: the one in ${UNLOCK_VARIABLE} when it is set (${UNLOCK_COMMAND}
sets it for a terminal), else one typed.

Examples:
  List each service's key, saved or not, and ask for each one not saved:
    $ npm run api-keys
  Replace the saved DexTools key, as after DexTools issues a new one:
    $ npm run api-keys -- set dextools
  Check that the password kept for this terminal opens every saved key:
    $ source ./bin/unlock-api-keys.sh
    $ npm run api-keys -- check-password

Exit codes:
  0  every key asked for is saved or skipped; check-password: the password opens the keys
  1  a key was not saved, the password does not open the keys, or the arguments were wrong`;

/** What the help of `set` says after its arguments. */
const SET_HELP_AFTER = `
Examples:
  Replace the saved CoinGecko key, after CoinGecko answers 401 to it:
    $ npm run api-keys -- set coingecko
  Save a Moralis key for the first time, in a project whose config.json
  names Moralis:
    $ npm run api-keys -- set moralis

Exit codes:
  0  the key is saved, or Enter alone was typed, which saves nothing and
     leaves a key already saved as it was
  1  the key was not saved, as when its service refuses it, or the project names no such service`;

/** What the help of `check-password` says after its usage. */
const CHECK_PASSWORD_HELP_AFTER = `
Examples:
  Check the password kept for this terminal, before a long run that needs
  the keys:
    $ source ./bin/unlock-api-keys.sh
    $ npm run api-keys -- check-password

Exit codes:
  0  the password opens every saved key, or no key is saved yet, so any
     password does
  1  it does not, or no password is set`;

/**
 * Runs `use` with the test's prompt, or with one prompt on the terminal
 * for every question of the run, closed after them.
 *
 * @param {Object} run - The run (`runKeyManager`)
 * @param {function(function(string): Promise<string>): Promise<number>} use - Asks its questions with the function it is given
 * @returns {Promise<number>} What `use` returns
 */
async function withPrompt(run, use) {
  if (run.ask !== undefined) return use(run.ask);
  const prompt = openSecretPrompt();
  try {
    return await use(prompt.ask);
  } finally {
    prompt.close();
  }
}

/**
 * Asks for each key given, in turn, and saves each its service takes.
 *
 * @param {Object} run - The run (`runKeyManager`)
 * @param {Array<import('./services.js').Service>} services - The services whose keys to ask for
 * @returns {Promise<number>} The exit code: 1 when a key was not saved
 * @throws {Error} When the key file cannot be read
 */
function enterKeys(run, services) {
  return withPrompt(run, async (ask) => {
    const password = savingPassword(run.spec);
    let exitCode = 0;
    for (const service of services) {
      try {
        await enterApiKey(run.spec, service, password, ask);
      } catch (error) {
        if (error.keyRefused !== true) throw error;
        run.io.stderr.write(`${error.message}\n`);
        exitCode = 1;
        if (error.passwordRefused === true) break;
      }
    }
    return exitCode;
  });
}

/**
 * Lists the services the project uses, each with its key saved or not,
 * and asks for each key not saved.
 *
 * @param {Object} run - The run (`runKeyManager`)
 * @returns {Promise<number>} The exit code
 */
function listAndAsk(run) {
  const services = readNeededKeys(run.projectTop, run.known);
  if (services.length === 0) {
    run.io.stdout.write(
      `The project's ${PROJECT_CONFIG_FILE} lists no service, so it keeps no api key.\n`,
    );
    return 0;
  }
  const width = Math.max(...services.map((service) => service.name.length));
  run.io.stdout.write(
    `Api keys of the services ${PROJECT_CONFIG_FILE} lists, kept in ${run.spec.file}:\n`,
  );
  for (const service of services) {
    const state = hasEncryptedKey(run.spec.file, service.service)
      ? "saved"
      : "not saved";
    run.io.stdout.write(`  ${service.name.padEnd(width)}  ${state}\n`);
  }
  const missing = services.filter(
    (service) => !hasEncryptedKey(run.spec.file, service.service),
  );
  if (missing.length === 0) {
    run.io.stdout.write(
      `Every key is saved. To replace one: ${MANAGE_COMMAND} -- set <service>\n`,
    );
    return 0;
  }
  return enterKeys(run, missing);
}

/**
 * Asks for one key, in place of the one saved.
 *
 * @param {Object} run - The run (`runKeyManager`)
 * @param {string} name - The service, as `config.json` lists it
 * @returns {Promise<number>} The exit code
 */
function setOne(run, name) {
  const service = readNeededKeys(run.projectTop, run.known).find(
    (listed) => listed.service === name,
  );
  if (service === undefined) {
    run.io.stderr.write(
      `The project's ${PROJECT_CONFIG_FILE} lists no service ${JSON.stringify(name)} under apiKeys.\n`,
    );
    return 1;
  }
  return enterKeys(run, [service]);
}

/**
 * Says whether the password in `API_KEYS_PASSWORD` opens every key saved.
 *
 * @param {Object} run - The run (`runKeyManager`)
 * @returns {Promise<number>} The exit code: 0 when it opens them, or none is saved
 */
async function checkPassword(run) {
  const password = run.spec.env[UNLOCK_VARIABLE];
  if (typeof password !== "string" || password === "") {
    run.io.stderr.write(
      `${UNLOCK_VARIABLE} is not set. ${UNLOCK_COMMAND} asks for the password and sets it.\n`,
    );
    return 1;
  }
  let count;
  try {
    count = await checkPasswordOpensKeys(run.spec.file, password);
  } catch (error) {
    run.io.stderr.write(
      `That password does not open the api keys saved in ${run.spec.file}: ${messageOf(error)}\n`,
    );
    return 1;
  }
  run.io.stdout.write(
    count === 0
      ? `No api key is saved in ${run.spec.file} yet; ${MANAGE_COMMAND} saves them with this password.\n`
      : `The password opens the ${count === 1 ? "api key" : `${count} api keys`} saved in ${run.spec.file}.\n`,
  );
  return 0;
}

/**
 * Runs the manager, in process.
 *
 * @param {string[]} argv - The arguments, shaped as `process.argv`
 * @param {Object} project - The project
 * @param {string} project.projectTop - Its top folder, which holds `config.json` and the key file
 * @param {Object<string, import('./services.js').Service>} [project.known=SERVICES] - The services known
 * @param {Object} [deps] - What a test replaces
 * @param {Object<string, string>} [deps.env=process.env] - The environment, for `API_KEYS_PASSWORD` and `API_KEYS_FILE_PATH`
 * @param {function(string): Promise<string>} [deps.ask] - Answers the prompts, in place of the terminal
 * @param {import('./services.js').CheckOptions} [deps.checkOptions] - What the services' checks are handed, such as a stand-in fetch
 * @param {{write: function(string): void}} [deps.stdout=process.stdout] - Where the list goes
 * @param {{write: function(string): void}} [deps.stderr=process.stderr] - Where messages go
 * @returns {Promise<number>} The exit code
 */
export async function runKeyManager(argv, project, deps = {}) {
  const io = {
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
  };
  const env = deps.env ?? process.env;
  const say = (line) => io.stderr.write(`${line}\n`);
  const spec = {
    file: keyFileFor(project.projectTop, env),
    env,
    say,
    checkOptions: deps.checkOptions,
  };
  const run = {
    projectTop: project.projectTop,
    known: project.known ?? SERVICES,
    spec,
    io,
    ask: deps.ask,
  };
  let exitCode = 0;
  const program = new Command()
    .name("manage-api-keys")
    .description(
      `Lists the api keys of the services the project's ${PROJECT_CONFIG_FILE} names, each saved or not, ` +
        "and asks for each one not saved, keeping it encrypted.",
    )
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.stdout.write(text),
      writeErr: (text) => io.stderr.write(text),
    })
    .addHelpText("after", HELP_AFTER)
    .allowExcessArguments(false)
    .action(async () => {
      exitCode = await listAndAsk(run);
    });
  program
    .command("set")
    .description("asks for one key, in place of the one saved")
    .argument(
      "<service>",
      `the service, as ${PROJECT_CONFIG_FILE} names it under apiKeys`,
    )
    .addHelpText("after", SET_HELP_AFTER)
    .allowExcessArguments(false)
    .action(async (name) => {
      exitCode = await setOne(run, name);
    });
  program
    .command("check-password")
    .description(
      `says whether the password in ${UNLOCK_VARIABLE} opens every key saved`,
    )
    .addHelpText("after", CHECK_PASSWORD_HELP_AFTER)
    .allowExcessArguments(false)
    .action(async () => {
      exitCode = await checkPassword(run);
    });
  try {
    await program.parseAsync(argv);
  } catch (thrown) {
    if (thrown instanceof CommanderError) return thrown.exitCode;
    io.stderr.write(`${messageOf(thrown)}\n`);
    return 1;
  }
  return exitCode;
}
