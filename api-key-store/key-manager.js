/**
 * The api key manager each project runs from its top folder:
 * `npm run api-keys`.
 * @module api-key-store/key-manager
 *
 * What:
 *
 * - With no command, it lists the services the project's `config.json`
 *   names under `apiKeys`, numbered in their order of priority
 *   (`projectPriority`), each with its key "saved" or "not saved", a
 *   saved key of a service whose keys come in types with its type, such
 *   as "saved, a paid plan's key", and asks for each key not saved; Enter
 *   alone skips one. Then, for two services or more, when the key file
 *   holds no order of priority that ranks exactly those services, it asks
 *   for one (`key-ranking.js`): where more than one service can do one
 *   job, a program asks them in that order.
 * - `set <service>` asks for one key, in place of the one saved, and then
 *   for an order of priority when none is saved, as above.
 * - `rank` shows the order of priority and asks for a new one.
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
 * - A key is saved only once its service takes it: a key of a service
 *   whose keys come in types, such as CoinGecko's Demo keys and its paid
 *   plans' keys, once the service takes it as one type, which is saved
 *   with it (`key-prompts.js`). A key not saved is reported and the next
 *   one is asked; a password that does not open the keys saved stops the
 *   run.
 * - The order of priority is no secret, so its question shows what is
 *   typed (`lib/ask-line.js`), asked once the prompt for keys has closed.
 * - Help goes to stdout with exit code 0. The list goes to stdout and the
 *   prompts and messages to stderr. A key not saved, a password that opens
 *   nothing, an input that ends before an order of priority is typed, or a
 *   mistake in the arguments ends with exit code 1.
 *
 * Fit: a project's `bin/end-user/manage-api-keys.js`, this repo's among
 * them, runs `runKeyManager` with its top folder.
 */

import { Command, CommanderError, InvalidArgumentError } from "commander";
import { askLine } from "../lib/ask-line.js";
import { messageOf } from "../lib/message-of.js";
import { openSecretPrompt } from "./ask-password.js";
import {
  checkPasswordOpensKeys,
  hasEncryptedKey,
  savedKeyType,
  savedServices,
} from "./key-file.js";
import {
  enterApiKey,
  MANAGE_COMMAND,
  UNLOCK_VARIABLE,
  savingPassword,
  UNLOCK_COMMAND,
} from "./key-prompts.js";
import { askPriority } from "./key-ranking.js";
import {
  keyFileFor,
  PROJECT_CONFIG_FILE,
  projectPriority,
  readNeededKeys,
} from "./project-keys.js";
import { SERVICES, serviceNamed } from "./services.js";

/** What the help says after the commands. */
const HELP_AFTER = `
Keys and the password are typed at a prompt that shows nothing of what is
typed, and no line shows a key's characters. Every key is saved with one
password: the one in ${UNLOCK_VARIABLE} when it is set (${UNLOCK_COMMAND}
sets it for a terminal), else one typed.

A key is saved once its service takes it. CoinGecko gives two types of
key in one form, a Demo key and a paid plan's key, each taken at an api of
its own, so a CoinGecko key is checked as a Demo key, then as a paid plan's
key, and saved with the type CoinGecko takes it as, which the list shows.

The list numbers the services in their order of priority: where more than
one can do one job, as CoinGecko and CoinPaprika can each give a past
price, the programs ask them in that order. Until one is saved, they ask
them in the order config.json lists them in, and the manager asks for an
order, typed as the services' numbers, highest priority first.

Examples:
  List each service's key, saved or not, and ask for each one not saved,
  and for an order of priority when none is saved:
    $ npm run api-keys
  Replace the saved DexTools key, as after DexTools issues a new one:
    $ npm run api-keys -- set dextools
  Change the services' order of priority:
    $ npm run api-keys -- rank
  Check that the password kept for this terminal opens every saved key:
    $ source ./bin/unlock-api-keys.sh
    $ npm run api-keys -- check-password

Exit codes:
  0  every key asked for is saved or skipped, and an order of priority is saved; check-password: the password opens the keys
  1  a key was not saved, the input ended before an order of priority was typed, the password does not open the keys, or the arguments were wrong`;

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
     leaves a key already saved as it was; and an order of priority is saved
  1  the key was not saved, as when its service refuses it, the input ended
     before an order of priority was typed, or the project names no such service`;

/** What the help of `rank` says after its usage. */
const RANK_HELP_AFTER = `
The services are shown numbered in their order of priority, the one saved
or, before one is, the order config.json lists them in. Type their numbers,
highest priority first, such as 2 1 3 4 5, to save that order; Enter alone
saves the order shown.

Examples:
  Put the second service first, keeping the others in turn:
    $ npm run api-keys -- rank
    (then type: 2 1 3 4 5)

Exit codes:
  0  an order of priority is saved, or the project lists fewer than two
     services, which need none
  1  the input ended before an order was typed, or the arguments were wrong`;

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
  1  it does not, no password is set, or the key file cannot be read or
     breaks its schema`;

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
 * Says whether a service's key is saved, with its type for a saved key of
 * a service whose keys come in types.
 *
 * @param {string} file - The key file
 * @param {import('./services.js').Service} service - The service
 * @returns {string} "not saved", "saved", or such as "saved, a paid plan's key"
 * @throws {Error} When the key file cannot be read
 */
function keyState(file, service) {
  if (!hasEncryptedKey(file, service.service)) return "not saved";
  const keyType = savedKeyType(file, service.service);
  return keyType === null
    ? "saved"
    : `saved, ${service.keyTypes[keyType].name}`;
}

/**
 * The services the project lists, in its order of priority
 * (`projectPriority`), and whether that order is the one saved.
 *
 * @param {Object} run - The run (`runKeyManager`)
 * @returns {{services: Array<import('./services.js').Service>, saved: boolean}} The services, highest priority first, and whether the order is saved
 * @throws {Error} When config.json or the key file cannot be read, or breaks its schema
 */
function rankedServices(run) {
  const { services, saved } = projectPriority(run.projectTop, {
    env: run.spec.env,
    known: run.known,
  });
  return {
    services: services.map((name) => serviceNamed(name, run.known)),
    saved,
  };
}

/**
 * Asks for an order of priority when the project lists two services or
 * more and none is saved for them (`key-ranking.js`).
 *
 * @param {Object} run - The run (`runKeyManager`)
 * @returns {Promise<number>} The exit code: 1 when the input ended before an order was typed
 */
async function rankWhenUnranked(run) {
  const ranked = rankedServices(run);
  if (ranked.saved || ranked.services.length < 2) return 0;
  return askPriority(run.ranking, ranked.services, false);
}

/**
 * Lists the services the project uses, numbered in their order of
 * priority, each with its key saved or not, asks for each key not saved,
 * and then for an order of priority when none is saved.
 *
 * @param {Object} run - The run (`runKeyManager`)
 * @returns {Promise<number>} The exit code
 */
async function listAndAsk(run) {
  const ranked = rankedServices(run);
  if (ranked.services.length === 0) {
    run.io.stdout.write(
      `The project's ${PROJECT_CONFIG_FILE} lists no service, so it keeps no api key.\n`,
    );
    return 0;
  }
  const width = Math.max(
    ...ranked.services.map((service) => service.name.length),
  );
  run.io.stdout.write(
    `Api keys of the services ${PROJECT_CONFIG_FILE} lists, in their order of priority, kept in ${run.spec.file}:\n`,
  );
  for (const [index, service] of ranked.services.entries()) {
    run.io.stdout.write(
      `  ${index + 1}. ${service.name.padEnd(width)}  ${keyState(run.spec.file, service)}\n`,
    );
  }
  const missing = ranked.services.filter(
    (service) => !hasEncryptedKey(run.spec.file, service.service),
  );
  const ranks = ranked.services.length > 1;
  if (missing.length === 0 && (ranked.saved || !ranks)) {
    const rankHint = ranks
      ? `; to change their order of priority: ${MANAGE_COMMAND} -- rank`
      : "";
    run.io.stdout.write(
      `Every key is saved. To replace one: ${MANAGE_COMMAND} -- set <service>${rankHint}\n`,
    );
    return 0;
  }
  const keysExit = missing.length === 0 ? 0 : await enterKeys(run, missing);
  return Math.max(keysExit, await rankWhenUnranked(run));
}

/**
 * Asks for one key, in place of the one saved, and then for an order of
 * priority when none is saved.
 *
 * @param {Object} run - The run (`runKeyManager`)
 * @param {Object} service - The service, as `config.json` lists it
 * @returns {Promise<number>} The exit code
 */
async function setOne(run, service) {
  const keysExit = await enterKeys(run, [service]);
  return Math.max(keysExit, await rankWhenUnranked(run));
}

/**
 * Shows the services' order of priority and asks for a new one; a project
 * that lists fewer than two services needs none.
 *
 * @param {Object} run - The run (`runKeyManager`)
 * @returns {Promise<number>} The exit code
 */
function rankServices(run) {
  const ranked = rankedServices(run);
  if (ranked.services.length < 2) {
    run.io.stdout.write(
      `The project's ${PROJECT_CONFIG_FILE} lists fewer than two services, so they need no order of priority.\n`,
    );
    return 0;
  }
  return askPriority(run.ranking, ranked.services, ranked.saved);
}

/**
 * Reads the service `set` names, as commander parses it: one the project's
 * config.json lists under apiKeys.
 *
 * @param {Object} run - The run (`runKeyManager`)
 * @param {string} name - The service, as typed
 * @returns {Object} The service, as the project's config.json lists it
 * @throws {InvalidArgumentError} When config.json lists no such service
 */
function serviceArgument(run, name) {
  const service = readNeededKeys(run.projectTop, run.known).find(
    (listed) => listed.service === name,
  );
  if (service === undefined)
    throw new InvalidArgumentError(
      `The project's ${PROJECT_CONFIG_FILE} lists no service ${JSON.stringify(name)} under apiKeys.`,
    );
  return service;
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
  /*-
   *  A key file that cannot be read, or that its schema refuses, stops the
   *  check here, in its own words, which runKeyManager prints with exit
   *  code 1, so no such problem is put down to the password.
   */
  savedServices(run.spec.file);
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
 * @param {function(string): Promise<string>} [deps.ask] - Answers the prompts for keys and passwords, in place of the terminal
 * @param {function(string): Promise<?string>} [deps.askLine] - Answers the question of the order of priority, in place of the terminal; null for an input that ended
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
    ranking: {
      file: spec.file,
      stderr: io.stderr,
      askLine:
        deps.askLine ??
        ((prompt) =>
          askLine(prompt, { input: process.stdin, output: io.stderr })),
    },
  };
  let exitCode = 0;
  const program = new Command()
    .name("manage-api-keys")
    .description(
      `Lists the api keys of the services the project's ${PROJECT_CONFIG_FILE} names, each saved or not, ` +
        "in their order of priority, asks for each one not saved, keeping it encrypted, " +
        "and asks for an order of priority when none is saved.",
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
      (name) => serviceArgument(run, name),
    )
    .addHelpText("after", SET_HELP_AFTER)
    .allowExcessArguments(false)
    .action(async (service) => {
      exitCode = await setOne(run, service);
    });
  program
    .command("rank")
    .description("shows the services' order of priority and asks for a new one")
    .addHelpText("after", RANK_HELP_AFTER)
    .allowExcessArguments(false)
    .action(async () => {
      exitCode = await rankServices(run);
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
