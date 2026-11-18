/**
 * Puts a service's api key in memory for a run, opened from the key file
 * with its password or typed in and saved there, as LP Ranger's
 * bookkeeping report does with its Moralis key
 * (`util/bookkeeping/moralis-key.js`).
 * @module api-key-store/key-prompts
 *
 * What:
 *
 * - `unlockApiKey` asks for the password of the key saved for a service,
 *   opens the key with it, and asks the service once whether it takes the
 *   key, before the run uses it. With no key saved it answers null, and
 *   the run goes on without one.
 * - `enterApiKey` asks for a key, then for a password twice, asks the
 *   service whether it takes the key, and saves it, encrypted with the
 *   password, only if it does, in place of any key saved for the service.
 *
 * Either way the key the run uses is put in memory (`key-holder.js`).
 *
 * How:
 *
 * - The key and the password are typed at a prompt that shows nothing of
 *   what is typed (`ask-password.js`). Neither is ever an argument, which
 *   shell history and `ps` would keep. The password is kept nowhere, and
 *   the plain key only in memory.
 * - What a service says of a key comes from the caller's `check(key)`: it
 *   answers 'valid' when the service takes the key, 'invalid' when it
 *   refuses it, and throws when the service does not answer. A refused key
 *   stops the run. A saved key the service cannot be asked about is used,
 *   and a line says so: the service may answer the run's own requests a
 *   moment later. A new key it cannot be asked about is not saved.
 * - An error that stops the run for want of a key the service takes
 *   carries `keyRefused: true`, and its message says what to do.
 *
 * Fit: a project's own module for each service fills in a `KeySpec`, as
 * `coingecko-api-key.js` does for CoinGecko.
 */

import { openSecretPrompt } from './ask-password.js';
import { hasEncryptedKey, loadEncryptedKey, saveEncryptedKey } from './key-file.js';
import { setApiKey } from './key-holder.js';

/**
 * What the prompts need to know of a service and its key.
 *
 * @typedef {Object} KeySpec
 * @property {string} file - The key file (`key-file.js`)
 * @property {string} service - The service's name in the file, such as 'coingecko'
 * @property {string} name - The service's name in messages, such as 'CoinGecko'
 * @property {string} saveCommand - The command that saves a new key, which messages name
 * @property {function(string): Promise<string>} check - Asks the service about a key: 'valid' or 'invalid'; throws when the service does not answer
 * @property {function(string): Promise<string>} [ask] - Prompts and answers what is typed; a prompt on the terminal unless a test gives its own
 * @property {function(string): void} say - Prints a line
 */

/**
 * An error that stops the run for want of a key the service takes. Its
 * message says what happened and what to do.
 *
 * @param {string} message - The message
 * @returns {Error} The error, with `keyRefused` set
 */
export function keyRefused(message) {
  return Object.assign(new Error(message), { keyRefused: true });
}

/**
 * Runs `use` with the spec's `ask`, or with a prompt on the terminal,
 * opened for the questions `use` asks and closed after them.
 *
 * @param {KeySpec} spec - The key's spec
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
 * Asks the service what it says of a key.
 *
 * @param {KeySpec} spec - The key's spec
 * @param {string} key - The key
 * @returns {Promise<{verdict: string, reason: (string|undefined)}>} 'valid', 'invalid', or 'unanswered' with why
 */
async function askService(spec, key) {
  try {
    return { verdict: await spec.check(key), reason: undefined };
  } catch (error) {
    return { verdict: 'unanswered', reason: error.message };
  }
}

/**
 * Opens the saved key with its password, typed.
 *
 * @param {KeySpec} spec - The key's spec
 * @param {function(string): Promise<string>} ask - Prompts and answers what is typed
 * @returns {Promise<string>} The key
 * @throws {Error} With `keyRefused` set, when the password does not open the key, or the key is no longer saved
 */
async function openSavedKey(spec, ask) {
  const password = await ask(`Password for the ${spec.name} api key: `);
  let key;
  try {
    key = await loadEncryptedKey(spec.file, spec.service, password);
  } catch (error) {
    throw keyRefused(
      `Could not open the ${spec.name} api key saved in ${spec.file}: ${error.message}. ` +
        `Run again with the password it was saved with, or save the key again: ${spec.saveCommand}`
    );
  }
  if (key === null) throw keyRefused(`The ${spec.name} api key is no longer in ${spec.file}. Save it again: ${spec.saveCommand}`);
  return key;
}

/**
 * Puts the saved key in memory for the run, once the service takes it:
 * asks for its password, opens it, and asks the service about it once.
 *
 * @param {KeySpec} spec - The key's spec
 * @returns {Promise<?string>} The key, or null when none is saved
 * @throws {Error} With `keyRefused` set, when the password does not open the key or the service refuses it; or when the key file cannot be read
 */
export async function unlockApiKey(spec) {
  if (!hasEncryptedKey(spec.file, spec.service)) return null;
  const key = await withAsk(spec, (ask) => openSavedKey(spec, ask));
  const { verdict, reason } = await askService(spec, key);
  if (verdict === 'unanswered') {
    spec.say(`${spec.name} did not answer the check of its api key (${reason}), so the run uses the key unchecked.`);
  } else if (verdict !== 'valid') {
    throw keyRefused(`${spec.name} refused the api key saved in ${spec.file}. Save a new one: ${spec.saveCommand}`);
  }
  setApiKey(spec.service, key);
  return key;
}

/**
 * Asks for a new key and for its password, typed twice.
 *
 * @param {KeySpec} spec - The key's spec
 * @param {function(string): Promise<string>} ask - Prompts and answers what is typed
 * @returns {Promise<{key: string, password: string}>} The two
 * @throws {Error} With `keyRefused` set, when either is empty or the two passwords differ
 */
async function askNewKey(spec, ask) {
  const key = (await ask(`${spec.name} api key: `)).trim();
  if (key.length === 0) throw keyRefused(`No ${spec.name} api key was entered, so none was saved.`);
  const password = await ask(`Password to encrypt the ${spec.name} api key with: `);
  if (password.length === 0) throw keyRefused('No password was entered, so the key was not saved.');
  const again = await ask('That password again: ');
  if (again !== password) throw keyRefused('The two passwords differ, so the key was not saved.');
  return { key, password };
}

/**
 * Asks for a new key and its password, and saves the key, encrypted, once
 * the service takes it; then puts it in memory for the run.
 *
 * @param {KeySpec} spec - The key's spec
 * @returns {Promise<string>} The key
 * @throws {Error} With `keyRefused` set, when no key is saved: a key or password left empty, two passwords that differ, a key the service refuses or cannot be asked about, or a file the key cannot be saved in
 */
export async function enterApiKey(spec) {
  const { key, password } = await withAsk(spec, (ask) => askNewKey(spec, ask));
  const { verdict, reason } = await askService(spec, key);
  if (verdict === 'unanswered') {
    throw keyRefused(`${spec.name} did not answer the check of the api key (${reason}), so it was not saved. Try again later.`);
  }
  if (verdict !== 'valid') {
    throw keyRefused(`${spec.name} refused the api key, so it was not saved. Enter the key as ${spec.name} shows it.`);
  }
  try {
    await saveEncryptedKey(spec.file, spec.service, key, password);
  } catch (error) {
    throw keyRefused(`The ${spec.name} api key was not saved: ${error.message}`);
  }
  setApiKey(spec.service, key);
  spec.say(`The ${spec.name} api key is saved in ${spec.file}, encrypted with that password.`);
  return key;
}
