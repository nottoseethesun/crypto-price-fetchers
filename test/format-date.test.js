/**
 * Tests for `Utilities.formatDate` under Node.
 * @module test/format-date.test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { formatDate, readPattern } from '../apps-script-runner/format-date.js';

/** 03:04:05.006 UTC on 2025-03-15, which is 22:04 on the 14th in Chicago (daylight time, UTC-5). */
const MOMENT = new Date(Date.UTC(2025, 2, 15, 3, 4, 5, 6));

describe('formatDate', () => {
  it('writes the date and time in UTC', () => {
    assert.equal(formatDate(MOMENT, 'UTC', 'yyyy-MM-dd HH:mm:ss'), '2025-03-15 03:04:05');
  });

  it('writes the day first, as the CoinGecko script asks', () => {
    assert.equal(formatDate(MOMENT, 'UTC', 'dd-MM-yyyy'), '15-03-2025');
  });

  it('writes the date as it is in the time zone asked', () => {
    assert.equal(formatDate(MOMENT, 'America/Chicago', 'dd-MM-yyyy HH:mm'), '14-03-2025 22:04');
  });

  it('writes midnight as hour 00', () => {
    assert.equal(formatDate(new Date(Date.UTC(2025, 0, 2, 0, 30)), 'UTC', 'HH:mm'), '00:30');
  });

  it('writes two-digit years, unpadded fields and milliseconds', () => {
    assert.equal(formatDate(MOMENT, 'UTC', 'yy M d H m s SSS'), '25 3 15 3 4 5 006');
  });

  it('copies quoted text, and writes a quote for two', () => {
    assert.equal(formatDate(MOMENT, 'UTC', "yyyy-MM-dd'T'HH 'o''clock' ''"), "2025-03-15T03 o'clock '");
  });

  it('takes a Date made in another realm, as a script passes its own', () => {
    const scriptDate = vm.runInNewContext('new Date(Date.UTC(2025, 2, 15, 3, 4, 5))');
    assert.equal(formatDate(scriptDate, 'UTC', 'yyyy-MM-dd HH:mm:ss'), '2025-03-15 03:04:05');
  });

  it('refuses a letter it cannot write, naming it', () => {
    assert.throws(() => formatDate(MOMENT, 'UTC', 'EEE dd'), /has no "EEE"/);
  });

  it('refuses a month written as a name', () => {
    assert.throws(() => formatDate(MOMENT, 'UTC', 'dd MMM yyyy'), /has no "MMM"/);
  });

  it('refuses a pattern that leaves a quote open', () => {
    assert.throws(() => formatDate(MOMENT, 'UTC', "yyyy 'at"), /leaves a quote open/);
  });

  it('refuses something that is not a date, and an invalid date', () => {
    assert.throws(() => formatDate('2025-03-15', 'UTC', 'yyyy'), /needs a date/);
    assert.throws(() => formatDate(new Date(Number.NaN), 'UTC', 'yyyy'), /needs a valid date/);
  });

  it('refuses a time zone the platform does not know', () => {
    assert.throws(() => formatDate(MOMENT, 'Mars/Olympus_Mons', 'yyyy'), RangeError);
  });
});

describe('readPattern', () => {
  it('reads runs of one letter as fields, and the rest as text', () => {
    assert.deepEqual(readPattern("yyyy-M 'at' HH"), [
      { letter: 'y', width: 4 },
      { text: '-' },
      { letter: 'M', width: 1 },
      { text: ' ' },
      { text: 'at' },
      { text: ' ' },
      { letter: 'H', width: 2 }
    ]);
  });
});
