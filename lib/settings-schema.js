/**
 * JSON Schema for settings files, as LP Ranger checks its own: the one
 * Ajv setup, the formats code checks, the kinds of value with the words a
 * refusal uses, a command-line parser made from a kind, and the problems
 * a file has, in those words.
 * @module lib/settings-schema
 *
 * What: a tool keeps its settings in a JSON file, such as its
 * `config.json`. Before a tool reads a setting, it checks the file against
 * a JSON Schema, a description of the keys the file may hold and the kind
 * of value each takes: an object of settings names each key it takes and
 * refuses any other (`additionalProperties: false`), so a misspelled or
 * misplaced setting stops the run instead of being ignored, and a value of
 * the wrong kind is refused before the tool uses it. An object keyed by
 * names or addresses the owner chooses, such as a list of tokens by
 * symbol, holds each key to a form (`propertyNames`) rather than to a
 * list. Every problem is listed at once.
 *
 * How: Ajv, the JSON Schema validator, compiles each schema once, the
 * first time it is asked for, by draft 2020-12, strict, so a keyword or
 * format it does not know is a mistake refused as the schema compiles
 * rather than a rule skipped, with every error, so a check lists every
 * problem, and verbose, so each error
 * carries the schema and the value it is about. What JSON Schema cannot
 * say, code says, as a named format: `http-url`, an http or https url
 * (`lib/http-url.js`), and `eip55-address`, an address in its EIP-55
 * form (`eip55`, `lib/repo-checks.js`); a project adds formats of its own
 * to `compileSettingsSchema`. `KINDS` holds the kinds of value the
 * settings files share, each a schema whose `description` is the words
 * for what passes it, such as "a whole number above 0". `kindParser`
 * makes a command line's option parser from a kind, so a value typed and
 * the same value in a settings file meet one rule. `settingsProblems`
 * words Ajv's errors, one line for each value at fault:
 * "config.json → maxCandles must be a whole number above 0; it is 0",
 * "config.json → colour is not a setting this tool reads",
 * "config.json → apiKeys is missing". A value that fits no shape a schema
 * offers it (`oneOf`, `anyOf`) is refused in one line, in the words of the
 * schema that offers the shapes, a key another key needs
 * (`dependentRequired`) is named missing with the key that needs it, and a
 * key that fails its object's `propertyNames`, such as an address that
 * keys a list of names, is named as the key, in its schema's words.
 *
 * Fit: `lib/settings-file.js` reads a settings file and checks it with
 * these; the projects that install this repo build their schemas from
 * `KINDS`, as `crypto-price-fetchers/lib/settings-schema`.
 */

import Ajv2020 from "ajv/dist/2020.js";
import { InvalidArgumentError } from "commander";
import { isHttpUrl } from "./http-url.js";
import { eip55 } from "./repo-checks.js";
import { LONGEST_TIME_LIMIT_MS } from "./time-limited-fetch.js";

/** The longest time limit Node's timers keep, in whole seconds. */
const LONGEST_TIME_LIMIT_SECONDS = Math.floor(LONGEST_TIME_LIMIT_MS / 1000);

/**
 * Says whether a text is an address in its EIP-55 form: 0x and 40 hex
 * digits, in the case its checksum gives.
 *
 * @param {string} text - The text
 * @returns {boolean} Whether it is
 */
function isEip55Address(text) {
  return /^0x[0-9a-fA-F]{40}$/.test(text) && eip55(text) === text;
}

/** The formats every settings schema may name, each checked by code. */
export const FORMATS = Object.freeze({
  "http-url": isHttpUrl,
  "eip55-address": isEip55Address,
});

/** No formats of the project's own. */
const NO_FORMATS = Object.freeze({});

/**
 * Each schema compiled, by the schema and then by the project's formats,
 * so a file read again, as crypto-price-filler reads its token list for
 * every row, is checked without compiling its schema anew, which takes
 * Ajv some 10 ms.
 */
const COMPILED = new WeakMap();

/**
 * Compiles a settings file's schema with Ajv, by draft 2020-12, strict,
 * with every error and verbose ones, and the formats `FORMATS` names and
 * any of the project's own; or gives the check compiled before for the
 * same schema and formats, each the same object as then.
 *
 * @param {Object} schema - The JSON Schema
 * @param {Object<string, function(string): boolean>} [formats] - The project's own formats, each a check of a text
 * @returns {import('ajv').ValidateFunction} The compiled check, whose `errors` hold the problems of the last value it refused
 * @throws {Error} When the schema uses a keyword or a format Ajv does not know
 */
export function compileSettingsSchema(schema, formats = NO_FORMATS) {
  if (!COMPILED.has(schema)) COMPILED.set(schema, new WeakMap());
  const byFormats = COMPILED.get(schema);
  if (!byFormats.has(formats)) {
    const ajv = new Ajv2020({ strict: true, allErrors: true, verbose: true });
    for (const [name, check] of Object.entries({ ...FORMATS, ...formats })) {
      ajv.addFormat(name, { type: "string", validate: check });
    }
    byFormats.set(formats, ajv.compile(schema));
  }
  return byFormats.get(formats);
}

/**
 * A kind of value: its schema, whose `description` is the words for what
 * passes it.
 *
 * @param {string} what - The words, such as "a number above 0"
 * @param {Object} schema - The JSON Schema
 * @returns {Readonly<Object>} The schema, described
 */
function kind(what, schema) {
  return Object.freeze({ ...schema, description: what });
}

/** The kinds of value the settings files share. */
export const KINDS = Object.freeze({
  bool: kind("true or false", { type: "boolean" }),
  text: kind("text that is not empty", { type: "string", minLength: 1 }),
  textOrNone: kind("text that is not empty, or null for none", {
    type: ["string", "null"],
    minLength: 1,
  }),
  wholeAbove0: kind("a whole number above 0", { type: "integer", minimum: 1 }),
  wholeAbove0OrNone: kind("a whole number above 0, or null for none", {
    type: ["integer", "null"],
    minimum: 1,
  }),
  wholeAtLeast0: kind("a whole number of at least 0", {
    type: "integer",
    minimum: 0,
  }),
  above0: kind("a number above 0", { type: "number", exclusiveMinimum: 0 }),
  timeLimitSeconds: kind(
    `a whole number of seconds from 1 to ${LONGEST_TIME_LIMIT_SECONDS}, the longest Node's timers keep`,
    { type: "integer", minimum: 1, maximum: LONGEST_TIME_LIMIT_SECONDS },
  ),
  waitMs: kind(
    `a whole number of milliseconds from 0 to ${LONGEST_TIME_LIMIT_MS}, the longest Node's timers keep`,
    { type: "integer", minimum: 0, maximum: LONGEST_TIME_LIMIT_MS },
  ),
  timeLimitMs: kind(
    `a whole number of milliseconds from 1 to ${LONGEST_TIME_LIMIT_MS}, the longest Node's timers keep`,
    { type: "integer", minimum: 1, maximum: LONGEST_TIME_LIMIT_MS },
  ),
  url: kind("an http or https url", { type: "string", format: "http-url" }),
  address: kind("an EIP-55 address", {
    type: "string",
    format: "eip55-address",
  }),
});

/**
 * Reads a whole number written in digits, as a command line's text.
 *
 * @param {string} text - The text typed
 * @returns {number} The number, or NaN when the text is not digits alone
 */
export function asWholeNumber(text) {
  return /^[0-9]+$/.test(text) ? Number(text) : Number.NaN;
}

/**
 * Makes a command line's option parser from a kind of value: it reads the
 * text typed, then checks the value against the kind's schema, refusing
 * it in the kind's words, as commander shows a refused value.
 *
 * @param {Object} valueKind - The kind, one of `KINDS` or a schema with a `description`
 * @param {function(string): *} [read] - Reads the text typed into the value, such as `asWholeNumber`; the text itself when absent
 * @param {Object<string, function(string): boolean>} [formats] - The project's own formats the kind names
 * @returns {function(string): *} The parser
 */
export function kindParser(valueKind, read = (text) => text, formats = {}) {
  const check = compileSettingsSchema(valueKind, formats);
  return (text) => {
    const value = read(text);
    if (!check(value)) {
      throw new InvalidArgumentError(`Not ${valueKind.description}.`);
    }
    return value;
  };
}

/**
 * A JSON pointer as the path a problem names: `/dextools/host` as
 * `dextools.host`, and `/apiKeys/0` as `apiKeys[0]`.
 *
 * @param {string} pointer - The pointer
 * @returns {string} The path
 */
function dotted(pointer) {
  return pointer
    .split("/")
    .slice(1)
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((at, part) => {
      if (/^[0-9]+$/.test(part)) return `${at}[${part}]`;
      return at === "" ? part : `${at}.${part}`;
    }, "");
}

/**
 * The path of a key under another.
 *
 * @param {string} at - The path of the object the key is in, "" for the file's top
 * @param {string} key - The key
 * @returns {string} The key's path
 */
function under(at, key) {
  return at === "" ? key : `${at}.${key}`;
}

/**
 * The keywords of a schema that offers a value a choice of shapes. When no
 * shape fits, Ajv reports each shape's own errors as well; the value is
 * refused in one line, in the words of the schema that offers the choice.
 */
const CHOICES = new Set(["anyOf", "oneOf"]);

/**
 * One of Ajv's errors, as the place it is about and the words for it.
 *
 * @param {string} file - The file's name, which the words begin with
 * @param {import('ajv').ErrorObject} error - The error, verbose
 * @returns {Array<string>} The place, and the words
 */
function refusal(file, error) {
  const at = dotted(error.instancePath);
  if (error.propertyName !== undefined) {
    const holder = at === "" ? file : `${file} → ${at}`;
    const what = error.parentSchema?.description ?? error.message;
    return [
      under(at, error.propertyName),
      `${holder} has the key ${JSON.stringify(error.propertyName)}, which must be ${what}`,
    ];
  }
  if (error.keyword === "additionalProperties") {
    const key = under(at, error.params.additionalProperty);
    return [key, `${file} → ${key} is not a setting this tool reads`];
  }
  if (error.keyword === "required") {
    const key = under(at, error.params.missingProperty);
    return [key, `${file} → ${key} is missing`];
  }
  if (error.keyword === "dependentRequired") {
    const key = under(at, error.params.missingProperty);
    const since = under(at, error.params.property);
    return [key, `${file} → ${key} is missing, since ${since} is set`];
  }
  const place = at === "" ? file : `${file} → ${at}`;
  const what = error.parentSchema?.description ?? error.message;
  return [at, `${place} must be ${what}; it is ${JSON.stringify(error.data)}`];
}

/**
 * Every problem a settings file has, one line for each value at fault,
 * in the words its schema carries.
 *
 * @param {string} file - The file's name, which each line begins with
 * @param {import('ajv').ValidateFunction} validate - The file's compiled schema (`compileSettingsSchema`)
 * @param {*} settings - The file's settings
 * @returns {Array<string>} The problems; none when the settings pass
 */
export function settingsProblems(file, validate, settings) {
  if (validate(settings)) return [];
  const choices = validate.errors
    .filter((error) => CHOICES.has(error.keyword))
    .map((error) => `${error.schemaPath}/`);
  const byPlace = new Map();
  for (const error of validate.errors) {
    if (error.keyword === "propertyNames") continue;
    if (choices.some((choice) => error.schemaPath.startsWith(choice))) continue;
    const [place, words] = refusal(file, error);
    if (!byPlace.has(place)) byPlace.set(place, words);
  }
  return [...byPlace.values()];
}
