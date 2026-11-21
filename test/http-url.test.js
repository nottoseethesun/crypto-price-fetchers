/**
 * Tests of `lib/http-url.js`, which says whether a text is an http or
 * https url.
 * @module test/http-url.test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isHttpUrl } from "../lib/http-url.js";

describe("isHttpUrl", () => {
  it("takes an http or https url, with a port, a path or a query", () => {
    for (const url of [
      "https://rpc-pulsechain.g4mm4.io",
      "http://127.0.0.1:8545",
      "https://public-api.dextools.io/standard/v2?sort=name",
    ])
      assert.equal(isHttpUrl(url), true, url);
  });

  it("refuses a url of another scheme, text that is no url, and what is no text", () => {
    for (const url of [
      "ftp://example.com",
      "file:///etc/passwd",
      "notaurl",
      "rpc-pulsechain.g4mm4.io",
      "",
      undefined,
      null,
    ])
      assert.equal(isHttpUrl(url), false, String(url));
  });
});
