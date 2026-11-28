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
 *   offers every key a program asks for, and gives them with the services'
 *   order of priority, which it keeps for the run (`key-holder.js`).
 * - `projectPriority` gives that order: the one the owner ranked the
 *   services in, saved in the key file, when it ranks exactly the services
 *   `config.json` lists; else the order `config.json` lists them in. Where
 *   more than one service can do one job, a program asks them in it.
 *
 * Fit: each project's programs call `unlockProjectKeys`; its
 * `bin/end-user/manage-api-keys.js` runs the manager (`key-manager.js`),
 * which reads the same `config.json`.
 */

import path from "node:path";
import { readSettingsFile } from "../lib/settings-file.js";
import { savedPriority } from "./key-file.js";
import { setApiKeyPriority } from "./key-holder.js";
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
 * The JSON Schema of the part of a project's `config.json` the key store
 * reads: `apiKeys`, a list of services it knows, each once. The file's
 * other keys are the project's, which its own schema holds.
 *
 * @param {Object<string, import('./services.js').Service>} services - The services known
 * @returns {Object} The schema
 */
function apiKeysSchema(services) {
  const names = Object.keys(services);
  return {
    type: "object",
    required: ["apiKeys"],
    properties: {
      apiKeys: {
        type: "array",
        uniqueItems: true,
        items: {
          enum: names,
          description: `a service the key store knows: ${names.join(", ")}`,
        },
        description:
          "a list of the services the project's programs use, each once",
      },
    },
  };
}

/**
 * Reads the services a project's `config.json` lists under `apiKeys`,
 * once the file holds to `apiKeysSchema` (`lib/settings-file.js`).
 *
 * @param {string} projectTop - The project's top folder
 * @param {Object<string, import('./services.js').Service>} [services=SERVICES] - The services known
 * @returns {Array<import('./services.js').Service>} The services, in the order listed
 * @throws {Error} When the file is missing, cannot be read or is not JSON, or its `apiKeys` is missing or is not a list of known services, each once, every problem listed
 */
export function readNeededKeys(projectTop, services = SERVICES) {
  const file = path.join(projectTop, PROJECT_CONFIG_FILE);
  const config = readSettingsFile(file, {
    required: true,
    schema: apiKeysSchema(services),
  });
  return config.apiKeys.map((name) => serviceNamed(name, services));
}

/**
 * The order of priority of the services a project lists: the one saved in
 * its key file, when it ranks exactly those services, each once; else the
 * order they are listed in.
 *
 * @param {Array<string>} listed - The services `config.json` lists, in its order
 * @param {string} file - The key file (`keyFileFor`)
 * @returns {{services: Array<string>, saved: boolean}} The services, highest priority first, and whether that order is the one saved
 * @throws {Error} When the key file cannot be read (`key-file.js`)
 */
function priorityOf(listed, file) {
  const saved = savedPriority(file);
  const ranksListed =
    saved !== null &&
    saved.length === listed.length &&
    listed.every((name) => saved.includes(name));
  return ranksListed
    ? { services: saved, saved: true }
    : { services: [...listed], saved: false };
}

/**
 * Gives a project's order of priority: the order the owner ranked the
 * services its `config.json` lists in, saved in its key file
 * (`npm run api-keys -- rank`), when it ranks exactly those services; else
 * the order `config.json` lists them in.
 *
 * @param {string} projectTop - The project's top folder
 * @param {Object} [options] - What a test replaces
 * @param {Object<string, string>} [options.env=process.env] - The environment, for `API_KEYS_FILE_PATH`
 * @param {Object<string, import('./services.js').Service>} [options.known=SERVICES] - The services known
 * @returns {{services: Array<string>, saved: boolean}} The services' names, highest priority first, and whether that order is the one the owner saved
 * @throws {Error} When `config.json` or the key file cannot be read, or breaks its schema
 */
export function projectPriority(projectTop, options = {}) {
  const listed = readNeededKeys(projectTop, options.known ?? SERVICES).map(
    (service) => service.service,
  );
  return priorityOf(listed, keyFileFor(projectTop, options.env));
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
 * @returns {Promise<Object<string, *>>} Each service's key, or null when none is saved; beside the key of a service whose keys come in types, its type (`unlockApiKeys`); and `priority`, the names of the services `config.json` lists, highest priority first (`projectPriority`), which it keeps for the run (`setApiKeyPriority`)
 * @throws {Error} When `config.json` does not list a service the program uses; with `keyRefused` set, when the keys cannot be opened or a service refuses its key
 */
export async function unlockProjectKeys(options) {
  const known = options.known ?? SERVICES;
  const listed = readNeededKeys(options.projectTop, known).map(
    (service) => service.service,
  );
  const unlisted = options.services.filter((name) => !listed.includes(name));
  if (unlisted.length > 0) {
    throw new Error(
      `${path.join(options.projectTop, PROJECT_CONFIG_FILE)} does not list ${unlisted.join(", ")} under apiKeys, which a program uses`,
    );
  }
  const env = options.env ?? process.env;
  const file = keyFileFor(options.projectTop, env);
  const keys = await unlockApiKeys(
    {
      file,
      env,
      ask: options.ask,
      say: options.say ?? ((line) => console.error(line)),
      checkOptions: options.checkOptions,
    },
    options.services.map((name) => serviceNamed(name, known)),
  );
  const { services: priority } = priorityOf(listed, file);
  setApiKeyPriority(priority);
  return { ...keys, priority };
}
