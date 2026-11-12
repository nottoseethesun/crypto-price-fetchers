/**
 * Tests for `openAppsScript`, which runs a Sheets script in a worker
 * thread and does its web requests on the caller's thread.
 * @module test/run-apps-script.test
 *
 * The requests go to a stand-in web server on this computer, through
 * Node's own fetch, or to a stand-in fetch (`helpers/stand-in-web.js`), so
 * the tests ask nothing outside the computer. The script is
 * `fixtures/runner-check.gs`.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { openAppsScript } from '../apps-script-runner/run-apps-script.js';
import { standInFetch, startStandInWeb } from './helpers/stand-in-web.js';

const RUNNER_CHECK = new URL('./fixtures/runner-check.gs', import.meta.url);

/**
 * Opens the fixture with the options given, runs `use` on it, and closes it.
 *
 * @param {Object} options - `openAppsScript`'s options
 * @param {function(Object): Promise<void>} use - What to do with the open script
 * @returns {Promise<void>} Settles once the script is closed
 */
async function withScript(options, use) {
  const script = await openAppsScript(RUNNER_CHECK, options);
  try {
    await use(script);
  } finally {
    await script.close();
  }
}

describe("openAppsScript, with Node's own fetch", () => {
  let web;
  let script;

  before(async () => {
    web = await startStandInWeb((request) => {
      if (request.url === '/echo') {
        return { method: request.method, key: request.headers['x-key'] ?? null, body: request.body };
      }
      if (request.url === '/json') return { got: JSON.parse(request.body) };
      if (request.url === '/missing') return null;
      return { status: 500, text: `The stand-in web has no ${request.url}` };
    });
    script = await openAppsScript(RUNNER_CHECK, { config: { CONFIG: { BASE_URL: web.url, KEY: 'key-from-config' } } });
  });

  after(async () => {
    if (script !== undefined) await script.close();
    if (web !== undefined) await web.close();
  });

  it('does a GET, with the header the script sets from its config', async () => {
    const text = await script.call('getText', '/echo');
    assert.equal(text, `200 ${JSON.stringify({ method: 'GET', key: 'key-from-config', body: '' })}`);
  });

  it('does a POST with the JSON payload, and returns the object the script made', async () => {
    assert.deepEqual(await script.call('postJson', '/json', { a: 1 }), { got: { a: 1 } });
  });

  it('gives a muted error status to the script', async () => {
    assert.equal(await script.call('getText', '/missing'), '404 Not found');
  });

  it('throws into the script on an error status it did not mute', async () => {
    assert.match(await script.call('getOrMessage', '/missing'), /^caught: Request failed for .*\/missing returned code 404/);
  });

  it('fails the call with what the script throws', async () => {
    await assert.rejects(script.call('getStrict', '/missing'), /returned code 404/);
  });

  it('keeps the cache, the properties and the lock between calls', async () => {
    assert.equal(await script.call('countCalls', 'k'), 1);
    assert.equal(await script.call('countCalls', 'k'), 2);
    assert.equal(await script.call('rememberAndRecall', 'last', 'v'), 'v');
    assert.equal(await script.call('lockAndRelease'), true);
  });

  it('answers calls made together, each with its own result', async () => {
    const results = await Promise.all([
      script.call('shout', 'a'),
      script.call('getText', '/missing'),
      script.call('shout', 'b')
    ]);
    assert.deepEqual(results, ['A', '404 Not found', 'B']);
  });
});

describe("openAppsScript, with a fetch of the caller's", () => {
  it("does the script's requests with that fetch", async () => {
    const fetch = standInFetch(() => ({ status: 200, text: 'from the stand-in' }));
    await withScript({ fetch }, async (script) => {
      assert.equal(await script.call('getText', '/a'), '200 from the stand-in');
      assert.equal(fetch.requests[0].url, 'http://placeholder.invalid/a');
      assert.equal(fetch.requests[0].headers['x-key'], 'placeholder');
    });
  });

  it('tells the script when a request gets no response', async () => {
    const fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND placeholder.invalid');
    };
    await withScript({ fetch }, async (script) => {
      assert.equal(
        await script.call('getOrMessage', '/a'),
        'caught: The request for http://placeholder.invalid/a got no response: getaddrinfo ENOTFOUND placeholder.invalid'
      );
    });
  });

  it('gives up on a request that takes longer than the timeout', async () => {
    const fetch = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    await withScript({ fetch, requestTimeoutMs: 100 }, async (script) => {
      assert.match(await script.call('getOrMessage', '/a'), /^caught: The request for .* got no response: .*timeout/);
    });
  });
});

describe('openAppsScript, the script and its calls', () => {
  it("keeps the caller's thread free while the script sleeps", async () => {
    await withScript({}, async (script) => {
      let ticks = 0;
      const timer = setInterval(() => {
        ticks += 1;
      }, 10);
      const slept = await script.call('sleepFor', 200);
      clearInterval(timer);
      assert.ok(slept >= 190, `the script slept ${slept} ms`);
      assert.ok(ticks >= 5, `the caller's timer ran ${ticks} times`);
    });
  });

  it("hands the script's log lines to onLog, before the call returns", async () => {
    const lines = [];
    await withScript({ onLog: (line) => lines.push(line) }, async (script) => {
      assert.equal(await script.call('shout', 'hi'), 'HI');
      assert.deepEqual(lines, [
        { level: 'log', text: 'said hi' },
        { level: 'warn', text: 'warned hi' }
      ]);
    });
  });

  it('passes a Date and a range as Sheets passes them', async () => {
    await withScript({}, async (script) => {
      assert.equal(await script.call('describeDate', new Date(Date.UTC(2025, 5, 15, 12, 30))), '2025-06-15 12:30:00');
      assert.equal(await script.call('firstCell', [['0xPool', 0]]), '0xPool');
    });
  });

  it('fails a call to a function the script lacks', async () => {
    await withScript({}, async (script) => {
      await assert.rejects(script.call('missing'), /no function named missing/);
    });
  });

  it('fails a call whose value cannot come back to Node', async () => {
    await withScript({}, async (script) => {
      await assert.rejects(script.call('giveFunction'), /cannot be passed back to Node/);
    });
  });

  it('fails a call whose arguments cannot go to the script', async () => {
    await withScript({}, async (script) => {
      await assert.rejects(script.call('shout', () => 'a function'), /cannot be passed to the script/);
      assert.equal(await script.call('shout', 'still open'), 'STILL OPEN');
    });
  });

  it('fails calls once the script is closed, and closes twice without error', async () => {
    const script = await openAppsScript(RUNNER_CHECK);
    await script.close();
    await script.close();
    await assert.rejects(script.call('shout', 'a'), /closed/);
  });

  it('lets a program that never closes the script exit when its work is done', () => {
    const runner = new URL('../apps-script-runner/run-apps-script.js', import.meta.url).href;
    const program = `
      const { openAppsScript } = await import(${JSON.stringify(runner)});
      const script = await openAppsScript(new URL(${JSON.stringify(RUNNER_CHECK.href)}));
      console.log(await script.call('shout', 'done'));
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', program], {
      encoding: 'utf8',
      timeout: 15000
    });
    assert.equal(output.trim(), 'DONE');
  });
});

describe('openAppsScript, refusing to open', () => {
  it('a script that throws as it loads', async () => {
    await assert.rejects(openAppsScript(new URL('./fixtures/throws-on-load.gs', import.meta.url)), /fails as it loads/);
  });

  it('a script that does not compile', async () => {
    await assert.rejects(
      openAppsScript(new URL('./fixtures/does-not-compile.gs', import.meta.url)),
      /does-not-compile\.gs does not compile: Unexpected end of input/
    );
  });

  it('a script file that is missing', async () => {
    await assert.rejects(openAppsScript(new URL('./fixtures/no-such-script.gs', import.meta.url)), /ENOENT/);
  });

  it('with a config naming a field the script lacks', async () => {
    await assert.rejects(
      openAppsScript(RUNNER_CHECK, { config: { CONFIG: { API_KEY: 'k' } } }),
      /CONFIG has no field API_KEY/
    );
  });

  it('with options of the wrong kind', async () => {
    await assert.rejects(openAppsScript(RUNNER_CHECK, { fetch: 'not a function' }), /fetch must be a function/);
    await assert.rejects(openAppsScript(RUNNER_CHECK, { onLog: 'not a function' }), /onLog must be a function/);
    await assert.rejects(openAppsScript(RUNNER_CHECK, { config: ['not', 'an', 'object'] }), /config must be an object/);
    await assert.rejects(openAppsScript(RUNNER_CHECK, { requestTimeoutMs: 0 }), /requestTimeoutMs must be/);
  });
});
