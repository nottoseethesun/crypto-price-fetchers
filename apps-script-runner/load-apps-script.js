/**
 * Loads a Sheets script into a Node `vm` context, configures it, and calls
 * its functions.
 * @module apps-script-runner/load-apps-script
 *
 * What: three steps of running a Sheets script under Node, unchanged.
 *
 * How:
 *
 * - `loadAppsScript` runs the text of the script's files, in order, in one
 *   fresh `vm` context whose globals are the Apps Script services
 *   (`apps-script-services.js`), as Apps Script loads every script file of
 *   a project into one global scope. A script too long for one file, by LP
 *   Ranger's 500 lines of code, is so split into several. Every file is
 *   compiled before any runs. Their top-level function declarations become
 *   properties of the context, and their top-level `const` and `let` values
 *   stay reachable by code run later in the same context, a later file's
 *   among it.
 * - `applyConfig` sets fields of the script's own config objects, such as
 *   `CONFIG.API_KEY`, from a config object shaped
 *   `{ CONFIG: { API_KEY: '...' } }`. It runs after the script has loaded,
 *   so it reaches a value the script reads when a function is called, such
 *   as a key it sends with each request, and not one the script worked out
 *   as it loaded, such as a url built from a config field at the top
 *   level. Each object and field must already be in the script, so a
 *   misspelt name fails, naming it, instead of being ignored. Values are
 *   made in the script's own realm, so the script's `instanceof Array`
 *   holds for them.
 * - `callScriptFunction` calls one of the script's functions by name. A
 *   Date or an array among the arguments is remade in the script's realm
 *   first, so the script's `instanceof Date` and `instanceof Array` hold
 *   for them, as they do for what Sheets passes from a cell.
 *
 * Fit: `script-worker.js` runs these in its worker thread; tests run them
 * directly.
 */

import vm from "node:vm";

/** What a name a script declares looks like. */
const DECLARED_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Compiles one of a script's files.
 *
 * @param {{source: string, filename: string}} file - Its text, and its path for error messages
 * @returns {vm.Script} The compiled file
 * @throws {Error} When it does not compile, naming it
 */
function compileFile({ source, filename }) {
  try {
    return new vm.Script(source, { filename });
  } catch (error) {
    throw new Error(
      `The script ${filename} does not compile: ${error.message}`,
      { cause: error },
    );
  }
}

/**
 * Runs a Sheets script's files, in order, in one fresh context whose
 * globals are the services.
 *
 * @param {Array<{source: string, filename: string}>} files - The script's files, in the order Apps Script loads them: each one's text, and its path for error messages
 * @param {Object} services - The Apps Script services, by name (`createAppsScriptServices`)
 * @returns {Object} The context, holding the script's top-level functions
 * @throws {Error} When a file does not compile, naming it, before any file runs; or what the script throws as it loads
 */
export function loadAppsScript(files, services) {
  const compiled = files.map(compileFile);
  const context = vm.createContext({ ...services });
  for (const script of compiled) script.runInContext(context);
  return context;
}

/**
 * Sets the fields of one of the script's config objects.
 *
 * @param {Object} context - The script's context (`loadAppsScript`)
 * @param {string} name - The config object's name in the script, such as `CONFIG`
 * @param {Object} fields - The fields to set, by name
 * @returns {void}
 * @throws {Error} When the name is not one a script can declare, the fields are not an object, the script has no such object, or the object has no such field
 */
function applyConfigObject(context, name, fields) {
  if (!DECLARED_NAME.test(name)) {
    throw new Error(
      `The config names "${name}", which is not a name a script can declare`,
    );
  }
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error(`The config's ${name} is not an object of fields`);
  }
  const target = vm.runInContext(
    `typeof ${name} === 'undefined' ? undefined : ${name}`,
    context,
  );
  if (target === null || typeof target !== "object") {
    throw new Error(`The script has no object named ${name} to configure`);
  }
  const inScriptRealm = vm.runInContext("(json) => JSON.parse(json)", context);
  for (const [field, value] of Object.entries(fields)) {
    if (!Object.hasOwn(target, field)) {
      throw new Error(
        `The script's ${name} has no field ${field}. Its fields: ${Object.keys(target).join(", ")}`,
      );
    }
    target[field] = inScriptRealm(JSON.stringify(value));
  }
}

/**
 * Sets fields of the script's own config objects.
 *
 * @param {Object} context - The script's context (`loadAppsScript`)
 * @param {Object<string, Object>} config - Fields to set, by config object, such as `{ CONFIG: { API_KEY: '...' } }`
 * @returns {void}
 * @throws {Error} When an object or field named is not in the script
 */
export function applyConfig(context, config) {
  for (const [name, fields] of Object.entries(config)) {
    applyConfigObject(context, name, fields);
  }
}

/**
 * Remakes a value in the script's realm: a Date as the script's Date, an
 * array as the script's array, with its items remade too. Anything else
 * passes as it is.
 *
 * @param {*} value - The value
 * @param {{Date: function, Array: function}} realm - The script's Date and Array
 * @returns {*} The value, in the script's realm
 */
function inRealm(value, realm) {
  if (value instanceof Date) return new realm.Date(value.getTime());
  if (Array.isArray(value))
    return realm.Array.from(value, (item) => inRealm(item, realm));
  return value;
}

/**
 * Calls one of the script's top-level functions.
 *
 * @param {Object} context - The script's context (`loadAppsScript`)
 * @param {string} name - The function's name
 * @param {Array} args - Its arguments
 * @returns {*} What the function returned
 * @throws {Error} When the script has no function by that name, or what the function throws
 */
export function callScriptFunction(context, name, args) {
  const fn = DECLARED_NAME.test(name) ? context[name] : undefined;
  if (typeof fn !== "function")
    throw new Error(`The script has no function named ${name}`);
  const realm = {
    Date: vm.runInContext("Date", context),
    Array: vm.runInContext("Array", context),
  };
  return fn(...args.map((arg) => inRealm(arg, realm)));
}
