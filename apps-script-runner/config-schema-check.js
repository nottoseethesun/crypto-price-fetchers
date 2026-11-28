/**
 * Holds a Node version's schemas of its Sheets script's config objects to
 * the script itself.
 * @module apps-script-runner/config-schema-check
 *
 * What: a Node version gives each config object of its script a JSON
 * Schema (`configSchemas`), and its config.json is checked against them
 * before the runner or the build lays the file's values over the objects.
 * Both lay them after the script's top-level code has run, so a field that
 * code reads keeps the value written in the script, whatever the file
 * says. `configSchemaProblems` finds where the schemas and the script
 * part: a field a schema names that the script reads as it loads, that
 * the key store sets, an api key or a key's type, or that the object lacks; a
 * field the script does not read as it loads that no schema names; a value
 * the script gives a field that its schema refuses; and an object the
 * script does not declare.
 *
 * How: the script's files are loaded as the runner loads them
 * (`loadAppsScript`), each config object named wrapped, where the script
 * declares it as `const NAME = {` down to a line `};`, in a proxy that
 * records each field read until the load ends.
 *
 * Fit: this repo's tests run it on each Node version
 * (`test/config-schemas.test.js`), and pulsechain-analytics' on its own,
 * from `crypto-price-fetchers/apps-script-runner`.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  compileSettingsSchema,
  settingsProblems,
} from "../lib/settings-schema.js";
import { createAppsScriptServices } from "./apps-script-services.js";
import { loadAppsScript } from "./load-apps-script.js";

/** The global each wrapped declaration calls, a name no script declares. */
const WATCH = "watchConfigObjectAsItLoads";

/** The end of a config object's declaration: a line `};`. */
const DECLARATION_END = "\n};";

/**
 * The script's files, each config object named wrapped where the script
 * declares it, and a problem for each it does not declare as the check
 * looks for.
 *
 * @param {string[]} paths - The script's files, in the order Apps Script loads them
 * @param {string[]} names - The config objects
 * @returns {{files: Array<{source: string, filename: string}>, watched: string[], problems: string[]}} The files for `loadAppsScript`, the objects wrapped, and the problems
 */
function watchedFiles(paths, names) {
  const files = paths.map((file) => ({
    source: fs.readFileSync(file, "utf8"),
    filename: file,
  }));
  const watched = [];
  const problems = [];
  for (const name of names) {
    const start = `\nconst ${name} = {`;
    const holders = files.filter((file) => file.source.includes(start));
    const [file] = holders;
    const at = file?.source.indexOf(start) ?? -1;
    const end = at === -1 ? -1 : file.source.indexOf(DECLARATION_END, at);
    if (
      holders.length !== 1 ||
      at !== file.source.lastIndexOf(start) ||
      end === -1
    ) {
      problems.push(
        `${name} is not declared once as "const ${name} = {", down to a line "};", as the check needs`,
      );
      continue;
    }
    file.source = [
      file.source.slice(0, at),
      `\nconst ${name} = ${WATCH}(${JSON.stringify(name)}, {`,
      file.source.slice(at + start.length, end),
      "\n});",
      file.source.slice(end + DECLARATION_END.length),
    ].join("");
    watched.push(name);
  }
  return { files, watched, problems };
}

/**
 * Loads the script and records each field of the wrapped objects that it
 * reads as it loads.
 *
 * @param {Array<{source: string, filename: string}>} files - The script's files, wrapped (`watchedFiles`)
 * @returns {{objects: Object<string, Object>, readAsItLoads: Object<string, Set<string>>}} Each object, and the fields read of it as the script loaded
 */
function loadWatching(files) {
  const objects = {};
  const readAsItLoads = {};
  let loading = true;
  const services = createAppsScriptServices({
    fetchSync: () => ({ failure: "the check asks no service" }),
  });
  loadAppsScript(files, {
    ...services,
    [WATCH](name, object) {
      objects[name] = object;
      readAsItLoads[name] = new Set();
      return new Proxy(object, {
        get(target, field, receiver) {
          if (loading && typeof field === "string")
            readAsItLoads[name].add(field);
          return Reflect.get(target, field, receiver);
        },
      });
    },
  });
  loading = false;
  return { objects, readAsItLoads };
}

/**
 * The problems of one config object's schema.
 *
 * @param {string} name - The object's name in the script
 * @param {Object} object - The object, as the script made it
 * @param {Set<string>} readAsItLoads - The fields the script read of it as it loaded
 * @param {Object|undefined} schema - Its schema, if the Node version gives one
 * @param {Set<string>} keys - The fields the key store sets: the api keys and their types
 * @returns {string[]} The problems
 */
function objectProblems(name, object, readAsItLoads, schema, keys) {
  const problems = [];
  const named = new Set(Object.keys(schema?.properties ?? {}));
  for (const field of named) {
    if (!Object.hasOwn(object, field)) {
      problems.push(
        `${name}.${field} is named in its schema, and the script's ${name} has no such field`,
      );
    } else if (keys.has(field)) {
      problems.push(
        `${name}.${field} is set by the key store, as an api key or a key's type, and its schema names it`,
      );
    } else if (readAsItLoads.has(field)) {
      problems.push(
        `${name}.${field} is read as the script loads, so a value laid after the load does not reach it, and its schema names it`,
      );
    }
  }
  for (const field of Object.keys(object)) {
    if (!named.has(field) && !keys.has(field) && !readAsItLoads.has(field)) {
      problems.push(
        `${name}.${field} is not read as the script loads, so a config may set it, and no schema names it`,
      );
    }
  }
  if (schema === undefined) return problems;
  const values = Object.fromEntries(
    [...named]
      .filter((field) => Object.hasOwn(object, field))
      .map((field) => [field, object[field]]),
  );
  return [
    ...problems,
    ...settingsProblems(
      `the script's ${name}`,
      compileSettingsSchema(schema),
      values,
    ),
  ];
}

/**
 * Every problem in a Node version's schemas of its script's config
 * objects, held to the script.
 *
 * @param {Object} spec - The script and its schemas
 * @param {Array<string|URL>} spec.files - The script's files, in the order Apps Script loads them
 * @param {Object<string, Object>} spec.configSchemas - Each config object's JSON Schema, by its name in the script
 * @param {Object<string, Object>} [spec.keyFields={}] - The fields the key store sets, the api keys and their types, by config object, as the Node version's `keyConfig` gives them
 * @returns {string[]} The problems, one line each; none when the schemas fit the script
 * @throws {Error} When a file cannot be read, does not compile, or throws as it loads
 */
export function configSchemaProblems({ files, configSchemas, keyFields = {} }) {
  const names = [
    ...new Set([...Object.keys(configSchemas), ...Object.keys(keyFields)]),
  ];
  const paths = files.map((file) =>
    file instanceof URL ? fileURLToPath(file) : file,
  );
  const watch = watchedFiles(paths, names);
  const { objects, readAsItLoads } = loadWatching(watch.files);
  return [
    ...watch.problems,
    ...watch.watched.flatMap((name) =>
      objectProblems(
        name,
        objects[name],
        readAsItLoads[name],
        configSchemas[name],
        new Set(Object.keys(keyFields[name] ?? {})),
      ),
    ),
  ];
}
