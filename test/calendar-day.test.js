/**
 * Tests of `lib/calendar-day.js`, which reads a day of the calendar written
 * YYYY-MM-DD as the start of that day in UTC.
 * @module test/calendar-day.test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dayStartSeconds } from "../lib/calendar-day.js";

describe("dayStartSeconds", () => {
  it("gives the seconds since 1970 at the start of a day, in UTC", () => {
    assert.equal(dayStartSeconds("2026-11-01"), Date.UTC(2026, 10, 1) / 1000);
    assert.equal(dayStartSeconds("2024-02-29"), Date.UTC(2024, 1, 29) / 1000);
    assert.equal(dayStartSeconds("1970-01-01"), 0);
  });

  it("refuses a day the calendar does not have, which Date reads as a later one", () => {
    for (const day of ["2026-02-30", "2025-02-29", "2026-04-31", "2026-13-01"])
      assert.equal(dayStartSeconds(day), null, day);
  });

  it("refuses a day written any other way, and what is no text", () => {
    for (const day of [
      "2026-11-1",
      "11/01/2026",
      "2026-11-01T00:00:00Z",
      " 2026-11-01",
      "",
      undefined,
      null,
      20261101,
    ])
      assert.equal(dayStartSeconds(day), null, String(day));
  });
});
