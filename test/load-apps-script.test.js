/**
 * Tests for loading a Sheets script into a `vm` context, configuring it,
 * and calling its functions, in the test's own thread.
 * @module test/load-apps-script.test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAppsScriptServices } from '../apps-script-runner/apps-script-services.js';
import { applyConfig, callScriptFunction, loadAppsScript } from '../apps-script-runner/load-apps-script.js';

const RUNNER_CHECK = new URL('./fixtures/runner-check.gs', import.meta.url);

/**
 * Loads a fixture script with services whose requests all answer `ok`.
 *
 * @param {URL} [script=RUNNER_CHECK] - The fixture
 * @returns {Object} The script's context
 */
function loadFixture(script = RUNNER_CHECK) {
  const services = createAppsScriptServices({
    fetchSync: (request) => ({ status: 200, headers: {}, text: `ok ${request.url}` })
  });
  return loadAppsScript(fs.readFileSync(script, 'utf8'), script.pathname, services);
}

describe('loadAppsScript', () => {
  it('runs the script, whose functions then call the services', () => {
    const context = loadFixture();
    assert.equal(callScriptFunction(context, 'getText', ['/a']), '200 ok http://placeholder.invalid/a');
  });

  it('throws what a script throws as it loads', () => {
    assert.throws(() => loadFixture(new URL('./fixtures/throws-on-load.gs', import.meta.url)), /fails as it loads/);
  });

  it('throws when a script does not compile', () => {
    assert.throws(
      () => loadFixture(new URL('./fixtures/does-not-compile.gs', import.meta.url)),
      /The script .*does-not-compile\.gs does not compile: Unexpected end of input/
    );
  });
});

describe('applyConfig', () => {
  it('sets a field the script reads when it is called', () => {
    const context = loadFixture();
    applyConfig(context, { CONFIG: { KEY: 'from the config file' } });
    assert.equal(callScriptFunction(context, 'readKey', []), 'from the config file');
  });

  it("makes the values in the script's realm", () => {
    const context = loadFixture();
    applyConfig(context, { CONFIG: { TRIES: [3, 4] } });
    assert.equal(callScriptFunction(context, 'triesAreAnArray', []), true);
  });

  it('refuses an object the script does not have', () => {
    assert.throws(() => applyConfig(loadFixture(), { X1_CONFIG: { API_KEY: 'k' } }), /no object named X1_CONFIG/);
  });

  it('refuses a field the object does not have, naming the fields it has', () => {
    assert.throws(
      () => applyConfig(loadFixture(), { CONFIG: { API_KEY: 'k' } }),
      /CONFIG has no field API_KEY\. Its fields: BASE_URL, KEY, TRIES/
    );
  });

  it('refuses a name a script cannot declare', () => {
    assert.throws(() => applyConfig(loadFixture(), { 'CONFIG; x()': { KEY: 'k' } }), /not a name a script can declare/);
  });

  it('refuses fields that are not an object', () => {
    assert.throws(() => applyConfig(loadFixture(), { CONFIG: 'k' }), /not an object of fields/);
    assert.throws(() => applyConfig(loadFixture(), { CONFIG: ['k'] }), /not an object of fields/);
  });

  it('refuses a name that is not an object in the script', () => {
    assert.throws(() => applyConfig(loadFixture(), { getText: { KEY: 'k' } }), /no object named getText/);
  });
});

describe('callScriptFunction', () => {
  it("remakes a Date in the script's realm, as Sheets passes a date cell", () => {
    const date = new Date(Date.UTC(2025, 5, 15, 12, 30, 0));
    assert.equal(callScriptFunction(loadFixture(), 'describeDate', [date]), '2025-06-15 12:30:00');
  });

  it("remakes arrays in the script's realm, as Sheets passes a range", () => {
    assert.equal(callScriptFunction(loadFixture(), 'firstCell', [[['0xPool', 0]]]), '0xPool');
  });

  it('throws what the function throws', () => {
    assert.throws(() => callScriptFunction(loadFixture(), 'fail', ['no luck']), /no luck/);
  });

  it('refuses a function the script does not have', () => {
    assert.throws(() => callScriptFunction(loadFixture(), 'missing', []), /no function named missing/);
    assert.throws(() => callScriptFunction(loadFixture(), 'UrlFetchApp', []), /no function named UrlFetchApp/);
    assert.throws(() => callScriptFunction(loadFixture(), 'a.b', []), /no function named a\.b/);
  });
});
