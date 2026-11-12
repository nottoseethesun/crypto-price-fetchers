/**
 * Tests for the Node versions of the Apps Script services.
 * @module test/apps-script-services.test
 *
 * The services are built here with a stand-in `fetchSync`, which answers
 * at once from the test, so these tests ask nothing outside the computer.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CACHE_SECONDS,
  MAX_CACHE_SECONDS,
  createAppsScriptServices,
  sleepSync,
  toRequest
} from '../apps-script-runner/apps-script-services.js';

/**
 * Builds the services with a `fetchSync` that records each request and
 * answers with `answer`.
 *
 * @param {Object} answer - What `fetchSync` returns
 * @param {Object} [options] - More options for `createAppsScriptServices`
 * @returns {{services: Object, requests: Array<Object>}} The services, and the requests `fetchSync` was handed
 */
function servicesAnswering(answer, options = {}) {
  const requests = [];
  const fetchSync = (request) => {
    requests.push(request);
    return answer;
  };
  return { services: createAppsScriptServices({ fetchSync, ...options }), requests };
}

const OK = { status: 200, headers: { 'content-type': 'text/plain' }, text: 'fine' };

describe('UrlFetchApp', () => {
  it('asks with GET and no body when no options are given', () => {
    assert.deepEqual(toRequest('https://example.test/a', {}), {
      url: 'https://example.test/a',
      method: 'GET',
      headers: {},
      body: undefined,
      redirect: 'follow'
    });
  });

  it('upper-cases the method, adds the content type, and sends a string payload as it is', () => {
    const request = toRequest('https://example.test/rpc', {
      method: 'post',
      contentType: 'application/json',
      payload: '{"id":1}',
      headers: { Accept: 'application/json' }
    });
    assert.equal(request.method, 'POST');
    assert.deepEqual(request.headers, { Accept: 'application/json', 'content-type': 'application/json' });
    assert.equal(request.body, '{"id":1}');
  });

  it('sends a payload object as a form', () => {
    const request = toRequest('https://example.test/form', { method: 'post', payload: { a: '1', b: 'two words' } });
    assert.equal(request.body, 'a=1&b=two+words');
    assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded');
  });

  it('does not follow redirects when the script says not to', () => {
    assert.equal(toRequest('https://example.test/', { followRedirects: false }).redirect, 'manual');
  });

  it("returns the response's code, text and headers", () => {
    const { services, requests } = servicesAnswering(OK);
    const response = services.UrlFetchApp.fetch('https://example.test/a');
    assert.equal(response.getResponseCode(), 200);
    assert.equal(response.getContentText(), 'fine');
    assert.deepEqual(response.getHeaders(), { 'content-type': 'text/plain' });
    assert.deepEqual(response.getAllHeaders(), { 'content-type': 'text/plain' });
    assert.equal(requests[0].url, 'https://example.test/a');
  });

  it('returns an error status when the script mutes http exceptions', () => {
    const { services } = servicesAnswering({ status: 404, headers: {}, text: 'missing' });
    const response = services.UrlFetchApp.fetch('https://example.test/a', { muteHttpExceptions: true });
    assert.equal(response.getResponseCode(), 404);
  });

  it('throws on an error status otherwise, quoting the response as Apps Script does', () => {
    const { services } = servicesAnswering({ status: 503, headers: {}, text: 'busy' });
    assert.throws(
      () => services.UrlFetchApp.fetch('https://example.test/a'),
      /Request failed for https:\/\/example\.test\/a returned code 503\. Truncated server response: busy/
    );
  });

  it('throws when the request got no response, muted or not', () => {
    const { services } = servicesAnswering({ failure: 'connect ECONNREFUSED' });
    assert.throws(
      () => services.UrlFetchApp.fetch('https://example.test/a', { muteHttpExceptions: true }),
      /The request for https:\/\/example\.test\/a got no response: connect ECONNREFUSED/
    );
  });
});

describe('CacheService', () => {
  it('keeps a value as text, and forgets a removed one', () => {
    const { services } = servicesAnswering(OK);
    const cache = services.CacheService.getScriptCache();
    assert.equal(cache.get('k'), null);
    cache.put('k', 12.5);
    assert.equal(cache.get('k'), '12.5');
    cache.remove('k');
    assert.equal(cache.get('k'), null);
  });

  it('forgets a value once its time is up: 600 seconds when the script gives none', () => {
    let nowMs = 0;
    const { services } = servicesAnswering(OK, { now: () => nowMs });
    const cache = services.CacheService.getScriptCache();
    cache.put('k', 'v');
    nowMs = DEFAULT_CACHE_SECONDS * 1000 - 1;
    assert.equal(cache.get('k'), 'v');
    nowMs = DEFAULT_CACHE_SECONDS * 1000;
    assert.equal(cache.get('k'), null);
  });

  it('keeps a value no longer than six hours, as Apps Script does', () => {
    let nowMs = 0;
    const { services } = servicesAnswering(OK, { now: () => nowMs });
    const cache = services.CacheService.getScriptCache();
    cache.put('k', 'v', 86400);
    nowMs = MAX_CACHE_SECONDS * 1000;
    assert.equal(cache.get('k'), null);
  });

  it('refuses an expiry that is not one second or more', () => {
    const { services } = servicesAnswering(OK);
    const cache = services.CacheService.getScriptCache();
    assert.throws(() => cache.put('k', 'v', 0), /one second or more/);
    assert.throws(() => cache.put('k', 'v', '60'), /one second or more/);
  });

  it('gives the same cache however the script asks for it', () => {
    const { services } = servicesAnswering(OK);
    services.CacheService.getUserCache().put('k', 'v');
    assert.equal(services.CacheService.getScriptCache().get('k'), 'v');
    assert.equal(services.CacheService.getDocumentCache().get('k'), 'v');
  });
});

describe('LockService', () => {
  it('gives a lock that is always free, and held until released', () => {
    const { services } = servicesAnswering(OK);
    const lock = services.LockService.getScriptLock();
    assert.equal(lock.hasLock(), false);
    assert.equal(lock.tryLock(1000), true);
    assert.equal(lock.hasLock(), true);
    lock.releaseLock();
    assert.equal(lock.hasLock(), false);
    lock.waitLock(1000);
    assert.equal(lock.hasLock(), true);
  });
});

describe('PropertiesService', () => {
  it('keeps properties as text, and forgets a deleted one', () => {
    const { services } = servicesAnswering(OK);
    const properties = services.PropertiesService.getScriptProperties();
    assert.equal(properties.getProperty('last'), null);
    assert.equal(properties.setProperty('last', 42), properties);
    assert.equal(services.PropertiesService.getUserProperties().getProperty('last'), '42');
    properties.deleteProperty('last');
    assert.equal(services.PropertiesService.getDocumentProperties().getProperty('last'), null);
  });
});

describe('Utilities', () => {
  it('sleeps for the time asked', () => {
    const started = Date.now();
    sleepSync(40);
    assert.ok(Date.now() - started >= 39, 'slept less than asked');
  });

  it('refuses a sleep that is not a number of milliseconds from zero up', () => {
    assert.throws(() => sleepSync(-1), /number of milliseconds/);
    assert.throws(() => sleepSync(Number.NaN), /number of milliseconds/);
    assert.throws(() => sleepSync('100'), /number of milliseconds/);
  });

  it('formats dates', () => {
    const { services } = servicesAnswering(OK);
    assert.equal(services.Utilities.formatDate(new Date(Date.UTC(2025, 5, 15)), 'UTC', 'dd-MM-yyyy'), '15-06-2025');
  });

  it('sleeps with the sleep it was built with', () => {
    const asked = [];
    const { services } = servicesAnswering(OK, { sleep: (ms) => asked.push(ms) });
    services.Utilities.sleep(5000);
    assert.deepEqual(asked, [5000]);
  });
});

describe('Logger and console', () => {
  it('hand each line to the log, with its level, formatted as console formats', () => {
    const lines = [];
    const { services } = servicesAnswering(OK, { log: (line) => lines.push(line) });
    assert.equal(services.Logger.log('price %s for %s', 1.5, 'xtm'), services.Logger);
    services.console.log('plain', 2);
    services.console.info('info');
    services.console.warn('warn');
    services.console.error('error');
    services.console.debug('debug');
    assert.deepEqual(lines, [
      { level: 'log', text: 'price 1.5 for xtm' },
      { level: 'log', text: 'plain 2' },
      { level: 'info', text: 'info' },
      { level: 'warn', text: 'warn' },
      { level: 'error', text: 'error' },
      { level: 'debug', text: 'debug' }
    ]);
  });

  it('drop the lines when there is no log', () => {
    const { services } = servicesAnswering(OK);
    assert.equal(services.Logger.log('dropped'), services.Logger);
    services.console.error('dropped too');
  });
});
