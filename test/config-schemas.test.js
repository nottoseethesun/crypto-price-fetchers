/**
 * Tests for the JSON Schemas each Node version gives the config objects of
 * its Sheets script (`CONFIG_SCHEMAS`), which its config.json is checked
 * against before the script opens and before the build sets the values.
 * @module test/config-schemas.test
 *
 * The runner and the build lay config values over the script's objects
 * after the script's top-level code has run, so a field that code reads
 * keeps the value written in the script. Each script is loaded here as the
 * build joins it, with each of its config objects watched as it loads,
 * and each schema is held to what the watch saw: it names every field the
 * script did not read as it loaded, the api keys aside, which the key
 * store sets, and no other field; and the script's own values hold to it.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { APPS_SCRIPTS } from "../apps-script-build/index.js";
import { createAppsScriptServices } from "../apps-script-runner/apps-script-services.js";
import { readConfigFile } from "../apps-script-runner/config-file.js";
import { loadAppsScript } from "../apps-script-runner/load-apps-script.js";
import {
  compileSettingsSchema,
  settingsProblems,
} from "../lib/settings-schema.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

/**
 * The text of a script's files, with each config object named wrapped,
 * where the script declares it, in a call to `watchConfigObject`, a global
 * the test gives the script.
 *
 * @param {string[]} paths - The script's files, in the build's order
 * @param {string[]} names - The config objects to watch
 * @returns {Array<{source: string, filename: string}>} The files, for `loadAppsScript`
 */
function watchedFiles(paths, names) {
  const files = paths.map((file) => ({
    source: fs.readFileSync(file, "utf8"),
    filename: file,
  }));
  for (const name of names) {
    const start = `\nconst ${name} = {`;
    const holders = files.filter((file) => file.source.includes(start));
    assert.equal(holders.length, 1, `one file declares ${name}`);
    const [file] = holders;
    const at = file.source.indexOf(start);
    assert.equal(
      at,
      file.source.lastIndexOf(start),
      `${name} is declared once`,
    );
    const end = file.source.indexOf("\n};", at);
    assert.notEqual(end, -1, `${name} ends on a line "};"`);
    file.source = [
      file.source.slice(0, at),
      `\nconst ${name} = watchConfigObject("${name}", {`,
      file.source.slice(at + start.length, end),
      "\n});",
      file.source.slice(end + "\n};".length),
    ].join("");
  }
  return files;
}

/**
 * Loads a script as the build joins it, and records each field of its
 * config objects that the script reads as it loads.
 *
 * @param {Object} spec - The Node version's build spec (`APPS_SCRIPTS`)
 * @param {string[]} names - The config objects to watch
 * @returns {{objects: Object<string, Object>, readAsItLoads: Object<string, Set<string>>}} Each object, and the fields read of it as the script loaded
 */
function loadWatching(spec, names) {
  const objects = {};
  const readAsItLoads = Object.fromEntries(
    names.map((name) => [name, new Set()]),
  );
  let loading = true;
  const services = createAppsScriptServices({
    fetchSync: () => ({ failure: "the test asks no service" }),
  });
  loadAppsScript(
    watchedFiles(
      spec.files.map((file) => file.path),
      names,
    ),
    {
      ...services,
      watchConfigObject(name, object) {
        objects[name] = object;
        return new Proxy(object, {
          get(target, field, receiver) {
            if (loading && typeof field === "string")
              readAsItLoads[name].add(field);
            return Reflect.get(target, field, receiver);
          },
        });
      },
    },
  );
  loading = false;
  return { objects, readAsItLoads };
}

for (const spec of APPS_SCRIPTS) {
  describe(`${spec.name}'s schemas of its config objects`, () => {
    const keyFields = spec.keyConfig(
      Object.fromEntries(spec.services.map((service) => [service, "key"])),
    );
    const names = [
      ...new Set([
        ...Object.keys(keyFields),
        ...Object.keys(spec.configSchemas),
      ]),
    ];
    const { objects, readAsItLoads } = loadWatching(spec, names);

    for (const name of names) {
      it(`names each field of ${name} that the script reads only when called, the api keys aside`, () => {
        const keys = new Set(Object.keys(keyFields[name] ?? {}));
        const settable = Object.keys(objects[name]).filter(
          (field) => !keys.has(field) && !readAsItLoads[name].has(field),
        );
        const named = Object.keys(spec.configSchemas[name]?.properties ?? {});
        assert.deepEqual(named.toSorted(), settable.toSorted());
      });
    }

    for (const [name, schema] of Object.entries(spec.configSchemas)) {
      it(`takes the values the script gives ${name}`, () => {
        const values = Object.fromEntries(
          Object.keys(schema.properties).map((field) => [
            field,
            objects[name][field],
          ]),
        );
        assert.deepEqual(
          settingsProblems(name, compileSettingsSchema(schema), values),
          [],
        );
      });
    }
  });
}

describe("a config.json checked against a Node version's schemas", () => {
  const [dexTools, exchange] = APPS_SCRIPTS;
  let folder;

  before(() => {
    folder = makeTempFolder("config-schemas");
  });

  after(removeTempFolders);

  /**
   * Writes a config.json into a temp folder and reads it as the spec's
   * Node version reads it.
   *
   * @param {Object} spec - The Node version's build spec
   * @param {Object} values - What the file holds
   * @returns {{file: string, read: function(): Object}} The file, and its reading
   */
  function configOf(spec, values) {
    const file = `${folder}/config-${spec.name}.json`;
    fs.writeFileSync(file, JSON.stringify(values));
    return {
      file,
      read: () => readConfigFile(file, { schemas: spec.configSchemas }),
    };
  }

  it("is refused when it sets a field the script reads as it loads, or an api key, naming each", () => {
    const { file, read } = configOf(dexTools, {
      DEXTOOLS_CONFIG: { SUBSCRIPTION_PLAN: "pro", API_KEY: "k" },
      X1_CONFIG: { API_HOST: "https://api.x1.ninja" },
    });
    assert.throws(read, {
      message: [
        `${file} → X1_CONFIG is not a setting this tool reads`,
        `${file} → DEXTOOLS_CONFIG.SUBSCRIPTION_PLAN is not a setting this tool reads`,
        `${file} → DEXTOOLS_CONFIG.API_KEY is not a setting this tool reads`,
      ].join("\n"),
    });
  });

  it("is refused when a url, a time or a time zone is of the wrong kind, listing every problem", () => {
    const { file, read } = configOf(exchange, {
      CONFIG: {
        EXCHANGE_BASE_URL: "ftp://api.mexc.com/api/v3",
        TIMEZONE_OFFSETS: { UTC: 1, est: -5, IST: 15 },
        CACHE_EXPIRY_SECONDS: { DAILY_PRICE: 0 },
        RETRY_DELAYS_MS: [5000, -1],
        MAX_LOCK_RETRIES: 0,
      },
    });
    assert.throws(read, {
      message: [
        `${file} → CONFIG.EXCHANGE_BASE_URL must be an http or https url; it is "ftp://api.mexc.com/api/v3"`,
        `${file} → CONFIG.TIMEZONE_OFFSETS has the key "est", which must be a time zone's abbreviation, with no lower-case letter`,
        `${file} → CONFIG.TIMEZONE_OFFSETS.IST must be an offset from UTC in hours, from -12 to 14; it is 15`,
        `${file} → CONFIG.TIMEZONE_OFFSETS.UTC must be 0; it is 1`,
        `${file} → CONFIG.CACHE_EXPIRY_SECONDS.NEGATIVE_CACHE is missing`,
        `${file} → CONFIG.CACHE_EXPIRY_SECONDS.DAILY_PRICE must be a whole number above 0; it is 0`,
        `${file} → CONFIG.RETRY_DELAYS_MS[1] must be a whole number of at least 0; it is -1`,
        `${file} → CONFIG.MAX_LOCK_RETRIES must be a whole number above 0; it is 0`,
      ].join("\n"),
    });
  });

  it("gives the values that hold to the schemas, the project's list of api keys left out", () => {
    const { read } = configOf(exchange, {
      apiKeys: ["coingecko"],
      CONFIG: {
        COINGECKO_BASE: "https://pro-api.coingecko.com/api/v3",
        TIMEZONE_OFFSETS: { UTC: 0, IST: 5.5 },
      },
    });
    assert.deepEqual(read(), {
      CONFIG: {
        COINGECKO_BASE: "https://pro-api.coingecko.com/api/v3",
        TIMEZONE_OFFSETS: { UTC: 0, IST: 5.5 },
      },
    });
  });
});
