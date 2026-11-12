/**
 * Tests for reading a Node version's config file.
 * @module test/config-file.test
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfigFile } from '../apps-script-runner/config-file.js';

describe('readConfigFile', () => {
  let folder;

  before(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-price-fetchers-test-config-'));
  });

  after(() => {
    fs.rmSync(folder, { recursive: true, force: true });
  });

  /**
   * Writes a file into the test's folder.
   *
   * @param {string} name - The file's name
   * @param {string} text - What it holds
   * @returns {string} Its path
   */
  function write(name, text) {
    const file = path.join(folder, name);
    fs.writeFileSync(file, text);
    return file;
  }

  it('reads the values for the config objects', () => {
    const file = write('config.json', '{ "CONFIG": { "API_KEY": "k" } }');
    assert.deepEqual(readConfigFile(file), { CONFIG: { API_KEY: 'k' } });
  });

  it('reads a missing optional file as no values', () => {
    assert.deepEqual(readConfigFile(path.join(folder, 'missing.json')), {});
  });

  it('refuses a missing file that is required, naming it', () => {
    const file = path.join(folder, 'missing.json');
    assert.throws(() => readConfigFile(file, { required: true }), new RegExp(`Cannot read the config file ${file}`));
  });

  it('refuses a file that is not JSON', () => {
    const file = write('broken.json', '{ "CONFIG": ');
    assert.throws(() => readConfigFile(file), /is not valid JSON/);
  });

  it('refuses JSON that is not an object', () => {
    assert.throws(() => readConfigFile(write('list.json', '["k"]')), /holds no JSON object/);
    assert.throws(() => readConfigFile(write('null.json', 'null')), /holds no JSON object/);
  });
});
