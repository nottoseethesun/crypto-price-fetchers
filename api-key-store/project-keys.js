/**
 * A project's api keys: the services its `config.json` names, the file the
 * keys are kept in, and the call a program makes to open the ones it uses.
 * @module api-key-store/project-keys
 *
 * What:
 *
 * - `readNeededKeys` reads the services a project's programs use from its
 *   top folder's `config.json`, which lists them under `apiKeys`, such as
 *   `{ "apiKeys": ["coingecko", "dextools"] }`, and finds each among the
 *   services known (`services.js`). The manager asks for these keys.
 * - `keyFileFor` names the project's key file: `api-keys.json` in its top
 *   folder, which its `.gitignore` names, or the file the environment
 *   variable `API_KEYS_FILE_PATH` names, as a test names a file of its own.
 * - `unlockProjectKeys` opens the keys a program uses (`unlockApiKeys`),
 *   once it has checked that `config.json` lists each, so that the manager
 *   offers every key a program asks for.
 *
 * Fit: each project's programs call `unlockProjectKeys`; its
 * `manage-api-keys.js` runs the manager (`key-manager.js`), which reads
 * the same `config.json`.
 */

import fs from "node:fs";
import path from "node:path";
import { unlockApiKeys } from "./key-prompts.js";
import { SERVICES, serviceNamed } from "./services.js";

/** The file, in a project's top folder, that lists the services it uses. */
export const PROJECT_CONFIG_FILE = "config.json";

/** The key file, in a project's top folder. */
export const KEY_FILE = "api-keys.json";

/**
 * Names a project's key file.
 *
 * @param {string} projectTop - The project's top folder
 * @param {Object<string, string>} [env=process.env] - The environment
 * @returns {string} `API_KEYS_FILE_PATH` when it names a file, else `api-keys.json` in the top folder
 */
export function keyFileFor(projectTop, env = process.env) {
  const named = env.API_KEYS_FILE_PATH;
  return typeof named === "string" && named !== ""
    ? named
    : path.join(projectTop, KEY_FILE);
}

/**
 * Reads the services a project's `config.json` lists under `apiKeys`.
 *
 * @param {string} projectTop - The project's top folder
 * @param {Object<string, import('./services.js').Service>} [services=SERVICES] - The services known
 * @returns {Array<import('./services.js').Service>} The services, in the order listed
 * @throws {Error} When the file cannot be read, is not JSON, or its `apiKeys` is not a list of known services, each once
 */
export function readNeededKeys(projectTop, services = SERVICES) {
  const file = path.join(projectTop, PROJECT_CONFIG_FILE);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read the api keys the project uses from ${file}: ${error.message}`,
      { cause: error },
    );
  }
  const listed =
    config !== null && typeof config === "object" ? config.apiKeys : undefined;
  if (!Array.isArray(listed)) {
    throw new Error(
      `${file} lists no apiKeys: give the services the project's programs use, such as "apiKeys": ["coingecko"]`,
    );
  }
  if (new Set(listed).size !== listed.length)
    throw new Error(`${file} lists a service twice under apiKeys`);
  return listed.map((name) => serviceNamed(name, services));
}

/**
 * Opens the keys saved for the services a program uses, once its
 * project's `config.json` is found to list each.
 *
 * @param {Object} options - The project, the services, and what a test replaces
 * @param {string} options.projectTop - The project's top folder
 * @param {string[]} options.services - The services the program uses, as `config.json` names them
 * @param {Object<string, string>} [options.env=process.env] - The environment, for `API_KEYS_PASSWORD` and `API_KEYS_FILE_PATH`
 * @param {function(string): Promise<string>} [options.ask] - Answers the password prompt, in place of the terminal
 * @param {function(string): void} [options.say] - Prints a line, in place of stderr
 * @param {import('./services.js').CheckOptions} [options.checkOptions] - What the services' checks are handed, such as a test's fetch
 * @param {Object<string, import('./services.js').Service>} [options.known=SERVICES] - The services known
 * @returns {Promise<Object<string, ?string>>} Each service's key, or null when none is saved
 * @throws {Error} When `config.json` does not list a service the program uses; with `keyRefused` set, when the keys cannot be opened or a service refuses its key
 */
export function unlockProjectKeys(options) {
  const known = options.known ?? SERVICES;
  const listed = new Set(
    readNeededKeys(options.projectTop, known).map((service) => service.service),
  );
  const unlisted = options.services.filter((name) => !listed.has(name));
  if (unlisted.length > 0) {
    throw new Error(
      `${path.join(options.projectTop, PROJECT_CONFIG_FILE)} does not list ${unlisted.join(", ")} under apiKeys, which a program uses`,
    );
  }
  const env = options.env ?? process.env;
  return unlockApiKeys(
    {
      file: keyFileFor(options.projectTop, env),
      env,
      ask: options.ask,
      say: options.say ?? ((line) => console.error(line)),
      checkOptions: options.checkOptions,
    },
    options.services.map((name) => serviceNamed(name, known)),
  );
}
