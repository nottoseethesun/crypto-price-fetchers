/**
 * The one file the build gives for the sheet: every Sheets script of the
 * repo, in order, ending with the values the build sets.
 * @module apps-script-build/built-script
 *
 * What: `combinedScript` joins the scripts' files, and the parts the build
 * makes, into one text, each file as written, its comments, JSDoc and
 * in-editor test functions included, so one paste puts all of them in a
 * spreadsheet's Apps Script project. The text ends with a block of
 * assignments, written by `configBlock`, that set the values each
 * script's Node version would set as it opens the script: the fields of
 * the config.json that version reads, with the api keys laid over them,
 * and the page the menu's Help item shows (`HELP_PAGE.HTML`).
 *
 * How:
 *
 * - Each part follows a comment that names where it came from.
 * - Apps Script runs every file of a project in one global scope, so the
 *   parts must not declare one name twice. A name declared twice with
 *   `const`, `let` or `class` stops the script from loading; a function
 *   declared twice loads, and the later one replaces the earlier without
 *   a word. So each part is loaded alone, with the runner's services, and
 *   the names it puts on the global object (its functions and `var`s) are
 *   compared with every other part's: a name two parts declare stops the
 *   build.
 * - The whole text is then loaded, as Apps Script loads it, and the values
 *   are applied to it as the runner applies them under Node (`applyConfig`
 *   in `apps-script-runner/load-apps-script.js`): each field replaced by
 *   the value given, written as JSON. So a text that does not load, or a
 *   field the scripts do not have, stops the build, as it would stop the
 *   script in Apps Script or its Node version. The functions the caller
 *   names as required must then be functions.
 * - The block comes last, after every top-level statement, so a field a
 *   script reads as it loads keeps the value written in the file, as
 *   under Node.
 *
 * Fit: `index.js` builds the file this way, then copies it to the
 * clipboard or writes it.
 */

import vm from "node:vm";
import { createAppsScriptServices } from "../../../apps-script-runner/apps-script-services.js";
import {
  applyConfig,
  loadAppsScript,
} from "../../../apps-script-runner/load-apps-script.js";
import { messageOf } from "../../../lib/message-of.js";

/** A name that can follow a dot, as each part of a dotted name must be. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The name of the built file, as the messages and Apps Script name it. */
export const BUILT_FILE_NAME = "crypto-price-fetchers.gs";

/** The rule of `=` signs around the comment that names a part. */
const RULE = `// ${"=".repeat(74)}`;

/** The comment that opens the block, saying where it came from and how to treat the copy. */
const BLOCK_HEAD = Object.freeze([
  "",
  "// ---------------------------------------------------------------------------",
  "// Set by `npm run build apps-script`, in the crypto-price-fetchers repo,",
  "// from the api keys saved there (npm run api-keys), the config.json each",
  "// script's Node version reads, and the help sections of the scripts'",
  "// headers. A copy with api keys here is for pasting into Apps Script:",
  "// never commit or share it.",
  "// ---------------------------------------------------------------------------",
]);

/**
 * One part of the file: a script file, or text the build made.
 *
 * @typedef {Object} ScriptPart
 * @property {string} name - Where it came from, for the comment before it and the messages
 * @property {string} source - Its text
 */

/**
 * Writes the assignments that set the values, after the comment that says
 * where they came from.
 *
 * @param {Object<string, Object>} values - Fields to set, by object, such as `{ DEXTOOLS_CONFIG: { API_KEY: '...' } }`
 * @returns {string} The block, starting with a line break; empty when there is nothing to set
 */
export function configBlock(values) {
  const lines = [];
  for (const [name, fields] of Object.entries(values)) {
    for (const [field, value] of Object.entries(fields)) {
      const target = IDENTIFIER.test(field)
        ? `${name}.${field}`
        : `${name}[${JSON.stringify(field)}]`;
      lines.push(`${target} = ${JSON.stringify(value)};`);
    }
  }
  if (lines.length === 0) return "";
  return `${[...BLOCK_HEAD, ...lines].join("\n")}\n`;
}

/**
 * The runner's services, for loading the text, which asks nothing of the
 * web as it loads.
 *
 * @returns {Object} The services
 */
function buildServices() {
  return createAppsScriptServices({
    fetchSync: () => ({ failure: "The build asks nothing of the web" }),
  });
}

/**
 * Loads one part alone and lists the names it puts on the global object:
 * its functions and `var`s.
 *
 * @param {ScriptPart} part - The part
 * @returns {string[]} The names
 * @throws {Error} When the part does not load
 */
function globalNamesOf(part) {
  const services = buildServices();
  let context;
  try {
    context = loadAppsScript(
      [{ source: part.source, filename: part.name }],
      services,
    );
  } catch (error) {
    throw new Error(`Loading ${part.name} alone failed: ${messageOf(error)}`, {
      cause: error,
    });
  }
  return Object.keys(context).filter((name) => !Object.hasOwn(services, name));
}

/**
 * Refuses a name that two parts put on the global object, where the later
 * would replace the earlier.
 *
 * @param {ScriptPart[]} parts - The parts
 * @returns {void}
 * @throws {Error} When two parts declare one name
 */
function refuseDoubleNames(parts) {
  const declaredBy = new Map();
  for (const part of parts) {
    for (const name of globalNamesOf(part)) {
      const earlier = declaredBy.get(name);
      if (earlier !== undefined) {
        throw new Error(
          `${earlier} and ${part.name} both declare ${name}; in one Apps Script project the later would replace the earlier`,
        );
      }
      declaredBy.set(name, part.name);
    }
  }
}

/**
 * The type of what a dotted name names in a loaded script. It is asked in
 * the script's own scope, since a top-level `const` is no property of the
 * context.
 *
 * @param {Object} context - The script's context (`loadAppsScript`)
 * @param {string} expression - A dotted name, such as `A.b`
 * @returns {string} Its `typeof`, or "undefined" when a part is missing
 * @throws {Error} When the name is not a dotted name
 */
function typeOf(context, expression) {
  const names = expression.split(".");
  if (!names.every((name) => IDENTIFIER.test(name))) {
    throw new Error(`"${expression}" is not a dotted name`);
  }
  const [first, ...rest] = names;
  const path = rest.map((name) => `?.${name}`).join("");
  return vm.runInContext(
    `typeof ${first} === "undefined" ? "undefined" : typeof ${first}${path}`,
    context,
  );
}

/**
 * Joins the parts, each after a comment naming where it came from.
 *
 * @param {string} preamble - The comment that opens the file
 * @param {ScriptPart[]} parts - The parts, in order
 * @returns {string} The text
 */
function joinParts(preamble, parts) {
  return [
    preamble.trimEnd(),
    ...parts.map((part) =>
      ["", RULE, `// ${part.name}`, RULE, "", part.source.trimEnd()].join("\n"),
    ),
  ].join("\n");
}

/**
 * Joins the parts into the one file, ending with the values set, and
 * checks that it loads as one Apps Script project.
 *
 * @param {Object} options - What goes in
 * @param {string} options.preamble - The comment that opens the file
 * @param {ScriptPart[]} options.parts - The parts, in the order Apps Script runs them
 * @param {Object<string, Object>} options.values - Fields to set, by object: the config's, the keys laid over them, and `HELP_PAGE.HTML`
 * @param {string[]} [options.required=[]] - Functions the loaded file must hold, by dotted name
 * @returns {string} The file's text, ready to paste
 * @throws {Error} When two parts declare one name, the text does not load, a field is missing, or a required function is not there
 */
export function combinedScript({ preamble, parts, values, required = [] }) {
  refuseDoubleNames(parts);
  const text = joinParts(preamble, parts);
  let context;
  try {
    context = loadAppsScript(
      [{ source: text, filename: BUILT_FILE_NAME }],
      buildServices(),
    );
  } catch (error) {
    throw new Error(`Loading the built file failed: ${messageOf(error)}`, {
      cause: error,
    });
  }
  applyConfig(context, values);
  for (const expression of required) {
    if (typeOf(context, expression) !== "function") {
      throw new Error(`The built file holds no function ${expression}`);
    }
  }
  return `${text}\n${configBlock(values)}`;
}
