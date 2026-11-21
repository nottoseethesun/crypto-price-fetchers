/**
 * Tests that every module the package exports, for the projects that
 * install this repo, loads by the package's own name, and ships.
 * @module test/package-exports.test
 *
 * Node resolves `crypto-price-fetchers/<path>` through the `exports` of
 * package.json, here as in a project that installs this repo; npm ships
 * only the files and folders `files` names.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/** This repo's package.json. */
const MANIFEST = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

describe("the package's exports", () => {
  for (const [name, file] of Object.entries(MANIFEST.exports)) {
    const specifier = `crypto-price-fetchers/${name.slice(2)}`;
    it(`${specifier} loads by the package's name, and ships`, async () => {
      const loaded = await import(specifier);
      assert.ok(Object.keys(loaded).length > 0, `${specifier} exports nothing`);
      const shipped = MANIFEST.files.some((entry) =>
        entry.endsWith("/")
          ? file.startsWith(`./${entry}`)
          : file === `./${entry}`,
      );
      assert.ok(shipped, `${file} is in no entry of "files"`);
    });
  }
});
