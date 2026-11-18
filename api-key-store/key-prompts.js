/**
 * Opens the api keys a run uses, and saves new ones, with the password
 * from the environment variable `API_KEYS_PASSWORD` or typed at a prompt,
 * as LP Ranger's bookkeeping report does with its Moralis key
 * (`util/bookkeeping/moralis-key.js`).
 * @module api-key-store/key-prompts
 *
 * What:
 *
 * - `unlockApiKeys` opens the keys saved for the services a run uses, with
 *   one password, then asks each service once whether it takes its key,
 *   and keeps each in memory for the run (`key-holder.js`). A service with
 *   no key saved gets null, and the run goes on without one; with no key
 *   saved at all, no password is asked.
 * - `enterApiKey` asks for one service's key, asks the service whether it
 *   takes it, and saves it, encrypted, only if it does, in place of any key
 *   saved for the service. `savingPassword` gives the password the keys a
 *   run enters are saved with, asked once however many are entered.
 *
 * How:
 *
 * - The password is the one in `API_KEYS_PASSWORD` when that is set, as
 *   `unlock-api-keys.sh` sets it for a terminal. Otherwise it is typed, at
 *   a prompt that shows nothing of what is typed (`ask-password.js`): once
 *   to open the keys saved, or twice for a file that holds none yet.
 * - A key and a password are never arguments, which shell history and
 *   `ps` would keep, and no message shows any character of a key. The
 *   password is kept nowhere, and the plain keys only in memory.
 * - What a service says of a key comes from its `check` (`services.js`). A
 *   refused key stops the run. A saved key the service cannot be asked
 *   about is used, and a line says so, since the service may answer the
 *   run's own requests a moment later; a new key it cannot be asked about
 *   is not saved.
 * - An error that stops the run for want of a key, or of a password that
 *   opens the keys, carries `keyRefused: true`, and its message says what
 *   to do; one for want of a password to save keys with carries
 *   `passwordRefused: true` too.
 *
 * Fit: `project-keys.js` opens a project's keys through `unlockApiKeys`,
 * and the manager (`key-manager.js`) saves them through `enterApiKey`.
 */

import { openSecretPrompt } from './ask-password.js';
import { checkPasswordOpensKeys, hasEncryptedKey, loadEncryptedKey, saveEncryptedKey, savedServices } from './key-file.js';
import { setApiKey } from './key-holder.js';

/** The environment variable a terminal keeps the password in. */
export const PASSWORD_VARIABLE = 'API_KEYS_PASSWORD';

/** The command that keeps the password in a terminal, run in the project's top folder. */
export const UNLOCK_COMMAND = 'source ./unlock-api-keys.sh';

/** The command that saves a key, run in the project's top folder. */
export const MANAGE_COMMAND = 'npm run api-keys';

/**
 * Where the keys are kept and how to reach the person and the services:
 * what a run, or a test, gives the prompts.
 *
 * @typedef {Object} KeyStoreSpec
 * @property {string} file - The key file (`key-file.js`)
 * @property {function(string): void} say - Prints a line
 * @property {Object<string, string>} [env=process.env] - The environment, for `API_KEYS_PASSWORD`
 * @property {function(string): Promise<string>} [ask] - Prompts and answers what is typed; a prompt on the terminal unless a test gives its own
 * @property {import('./services.js').CheckOptions} [checkOptions] - What the services' checks are handed, such as a test's fetch
 */

/**
 * An error that stops the run for want of a key the service takes, or of
 * a password that opens the keys. Its message says what happened and what
 * to do.
 *
 * @param {string} message - The message
 * @returns {Error} The error, with `keyRefused` set
 */
export function keyRefused(message) {
  return Object.assign(new Error(message), { keyRefused: true });
}

/**
 * An error that stops a run from saving any key: no password, or one that
 * does not open the keys saved. It is a `keyRefused` error with
 * `passwordRefused` set too, so the manager asks for no more keys.
 *
 * @param {string} message - The message
 * @returns {Error} The error
 */
function passwordRefused(message) {
  return Object.assign(keyRefused(message), { passwordRefused: true });
}

/**
 * The password in `API_KEYS_PASSWORD`, when it holds one.
 *
 * @param {Object<string, string>} env - The environment
 * @returns {?string} The password, or null when the variable is unset or empty
 */
function environmentPassword(env) {
  const password = env[PASSWORD_VARIABLE];
  return typeof password === 'string' && password !== '' ? password : null;
}

/**
 * Runs `use` with the spec's `ask`, or with a prompt on the terminal,
 * opened for the questions `use` asks and closed after them.
 *
 * @param {KeyStoreSpec} spec - Where the keys are kept
 * @param {function(function(string): Promise<string>): Promise<*>} use - Asks its questions with the function it is given
 * @returns {Promise<*>} What `use` returns
 */
async function withAsk(spec, use) {
  if (spec.ask !== undefined) return use(spec.ask);
  const prompt = openSecretPrompt();
  try {
    return await use(prompt.ask);
  } finally {
    prompt.close();
  }
}

/**
 * Asks a service what it says of a key.
 *
 * @param {KeyStoreSpec} spec - Where the keys are kept
 * @param {import('./services.js').Service} service - The service
 * @param {string} key - The key
 * @returns {Promise<{verdict: string, reason: (string|undefined)}>} 'valid', 'invalid', or 'unanswered' with why
 */
async function askService(spec, service, key) {
  try {
    return { verdict: await service.check(key, spec.checkOptions ?? {}), reason: undefined };
  } catch (error) {
    return { verdict: 'unanswered', reason: error.message };
  }
}

/**
 * Opens the saved keys of the services given, with one password.
 *
 * @param {KeyStoreSpec} spec - Where the keys are kept
 * @param {Array<import('./services.js').Service>} saved - The services with a key saved
 * @param {{password: string, typed: boolean}} password - The password, and whether it was typed
 * @returns {Promise<Object<string, string>>} The keys, by service
 * @throws {Error} With `keyRefused` set, when the password does not open a key
 */
async function openSavedKeys(spec, saved, password) {
  const keys = {};
  for (const service of saved) {
    try {
      keys[service.service] = await loadEncryptedKey(spec.file, service.service, password.password);
    } catch (error) {
      const source = password.typed ? 'typed' : `in ${PASSWORD_VARIABLE}`;
      const whatToDo = password.typed
        ? 'Run again with the password the keys were saved with.'
        : `In the project's top folder, keep the right one with: ${UNLOCK_COMMAND}`;
      throw keyRefused(
        `Could not open the ${service.name} api key saved in ${spec.file} with the password ${source}: ${error.message}. ${whatToDo}`
      );
    }
  }
  return keys;
}

/**
 * Asks each service once about its key, before the run uses it.
 *
 * @param {KeyStoreSpec} spec - Where the keys are kept
 * @param {Array<import('./services.js').Service>} saved - The services with a key opened
 * @param {Object<string, string>} keys - The keys, by service
 * @returns {Promise<void>} Settles once every service has taken its key or not answered
 * @throws {Error} With `keyRefused` set, when a service refuses its key
 */
async function checkSavedKeys(spec, saved, keys) {
  for (const service of saved) {
    const { verdict, reason } = await askService(spec, service, keys[service.service]);
    if (verdict === 'unanswered') {
      spec.say(`${service.name} did not answer the check of its api key (${reason}), so the run uses the key unchecked.`);
    } else if (verdict !== 'valid') {
      throw keyRefused(
        `${service.name} refused the api key saved in ${spec.file}. ` +
          `Save a new one, in the project's top folder: ${MANAGE_COMMAND} -- set ${service.service}`
      );
    }
  }
}

/**
 * Opens the keys saved for the services a run uses, has each service check
 * its key once, and keeps them in memory for the run.
 *
 * @param {KeyStoreSpec} spec - Where the keys are kept, and how to reach the person and the services
 * @param {Array<import('./services.js').Service>} services - The services the run uses
 * @returns {Promise<Object<string, ?string>>} Each service's key, or null when none is saved
 * @throws {Error} With `keyRefused` set, when the password does not open the keys or a service refuses its key; or when the key file cannot be read
 */
export async function unlockApiKeys(spec, services) {
  const keys = Object.fromEntries(services.map((service) => [service.service, null]));
  const saved = services.filter((service) => hasEncryptedKey(spec.file, service.service));
  if (saved.length === 0) return keys;
  const fromEnvironment = environmentPassword(spec.env ?? process.env);
  const password =
    fromEnvironment === null
      ? { password: await withAsk(spec, (ask) => ask(`Password for the api keys in ${spec.file}: `)), typed: true }
      : { password: fromEnvironment, typed: false };
  const opened = await openSavedKeys(spec, saved, password);
  await checkSavedKeys(spec, saved, opened);
  for (const service of saved) {
    setApiKey(service.service, opened[service.service]);
    keys[service.service] = opened[service.service];
  }
  return keys;
}

/**
 * Asks for the password new keys are saved with: `API_KEYS_PASSWORD`, or
 * typed once to open the keys saved, or twice for a file with none.
 *
 * @param {KeyStoreSpec} spec - Where the keys are kept
 * @param {function(string): Promise<string>} ask - Prompts and answers what is typed
 * @returns {Promise<string>} The password
 * @throws {Error} With `keyRefused` and `passwordRefused` set, when the password does not open the keys saved, is empty, or is not typed the same twice
 */
async function askSavingPassword(spec, ask) {
  const fromEnvironment = environmentPassword(spec.env ?? process.env);
  if (fromEnvironment === null && savedServices(spec.file).length === 0) {
    const password = await ask('Password to encrypt the api keys with: ');
    if (password === '') throw passwordRefused('No password was entered, so no key was saved.');
    if ((await ask('That password again: ')) !== password) throw passwordRefused('The two passwords differ, so no key was saved.');
    return password;
  }
  const password = fromEnvironment ?? (await ask(`Password for the api keys in ${spec.file}: `));
  try {
    await checkPasswordOpensKeys(spec.file, password);
  } catch {
    const source = fromEnvironment === null ? 'That password' : `The password in ${PASSWORD_VARIABLE}`;
    throw passwordRefused(
      `${source} does not open the api keys saved in ${spec.file}, and every key there is saved with one password, so no key was saved.`
    );
  }
  return password;
}

/**
 * Gives the password the keys a run enters are saved with, asked the
 * first time it is needed and kept for the rest of the run.
 *
 * @param {KeyStoreSpec} spec - Where the keys are kept
 * @returns {function(function(string): Promise<string>): Promise<string>} Given the prompt, gives the password
 */
export function savingPassword(spec) {
  let password = null;
  return async (ask) => {
    password ??= await askSavingPassword(spec, ask);
    return password;
  };
}

/**
 * Asks for one service's key, then for the password if the run has none
 * yet, has the service check the key, and saves it, encrypted, in place
 * of any key saved for the service; then keeps it in memory for the run.
 *
 * @param {KeyStoreSpec} spec - Where the keys are kept, and how to reach the person and the services
 * @param {import('./services.js').Service} service - The service
 * @param {function(function(string): Promise<string>): Promise<string>} password - Gives the password (`savingPassword`)
 * @param {function(string): Promise<string>} ask - Prompts and answers what is typed
 * @returns {Promise<?string>} The key, or null when none was entered
 * @throws {Error} With `keyRefused` set, when nothing is saved for want of a password, or because the service refused the key or did not answer
 */
export async function enterApiKey(spec, service, password, ask) {
  const key = (await ask(`${service.name} api key (Enter alone skips it): `)).trim();
  if (key === '') {
    spec.say(`No ${service.name} api key was entered, so none was saved.`);
    return null;
  }
  const saving = await password(ask);
  const { verdict, reason } = await askService(spec, service, key);
  if (verdict === 'unanswered') {
    throw keyRefused(`${service.name} did not answer the check of the api key (${reason}), so it was not saved. Try again later.`);
  }
  if (verdict !== 'valid') {
    throw keyRefused(`${service.name} refused the api key, so it was not saved. Enter the key as ${service.name} shows it.`);
  }
  try {
    await saveEncryptedKey(spec.file, service.service, key, saving);
  } catch (error) {
    throw keyRefused(`The ${service.name} api key was not saved: ${error.message}`);
  }
  setApiKey(service.service, key);
  spec.say(`The ${service.name} api key is saved, encrypted, in ${spec.file}.`);
  return key;
}
