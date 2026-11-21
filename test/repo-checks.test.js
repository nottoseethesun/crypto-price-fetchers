/**
 * Tests of `lib/repo-checks.js`, the checks of a repo's tracked files that
 * the owner's rules ask for, and this repo held to them.
 * @module test/repo-checks.test
 *
 * The checks run on small repos the tests make in temp folders, with git,
 * and then on this repo: its EVM addresses written in EIP-55's form, but
 * those its tests write otherwise on purpose (this file's own among them,
 * the forms it tests the check with), its npm targets named in
 * `docs/npm-project-commands.md`, and its test files and helpers named in
 * `docs/engineering.md` or `CLAUDE.md`.
 */

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addressesNotInEip55,
  eip55,
  npmTargetsMissingFromDocs,
  testFilesMissingFromDocs,
  trackedFiles,
} from "../lib/repo-checks.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

after(removeTempFolders);

/** The repo's top folder. */
const REPO_TOP = fileURLToPath(new URL("..", import.meta.url));

/** This file, which writes addresses in other forms to test the check. */
const THIS_FILE = "test/repo-checks.test.js";

/**
 * The addresses this repo's tests write in another form on purpose, by
 * file, with why.
 */
const ADDRESSES_WRITTEN_OTHERWISE = Object.freeze([
  {
    file: "fetch-from-centralized-exchange/crypto-price-filler/tests/geckoterminal-source.test.js",
    address: "0xa1077a294dde1b09bb078844df40758a5d0f9a27",
    why: "GeckoTerminal names a token in lower case, in its ids",
  },
  {
    file: "test/helpers/summ-csv-rows.js",
    address: "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01",
    why: "a made-up wallet in a mixed case, to show the Summ csv utility writes it in lower case",
  },
]);

/**
 * Makes a repo in a temp folder, with git, holding the files given, each
 * added to git's index.
 *
 * @param {Object<string, string>} files - Each file's text, by its path from the repo's top
 * @param {string[]} [untracked=[]] - Files written but not added
 * @returns {string} The repo's top folder
 */
function repoWith(files, untracked = []) {
  const top = makeTempFolder("repo-checks");
  execFileSync("git", ["init", "-q"], { cwd: top });
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(top, file)), { recursive: true });
    fs.writeFileSync(path.join(top, file), text);
  }
  execFileSync("git", ["add", "."], { cwd: top });
  for (const file of untracked) fs.writeFileSync(path.join(top, file), "");
  return top;
}

describe("eip55", () => {
  it("writes the addresses EIP-55 gives as its examples as EIP-55 writes them", () => {
    for (const address of [
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
      "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
      "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
    ]) {
      assert.equal(eip55(address.toLowerCase()), address);
      assert.equal(eip55(address.toUpperCase().replace("0X", "0x")), address);
    }
  });
});

describe("the checks, on a repo made for the test", () => {
  it("list the tracked files alone", () => {
    const top = repoWith({ "a.js": "", "docs/b.md": "" }, ["untracked.js"]);
    assert.deepEqual(trackedFiles(top).sort(), ["a.js", "docs/b.md"]);
  });

  it("find each address written in one case, or in a mixed case that is not its checksum, with its file and line", () => {
    const good = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    const top = repoWith({
      "a.js": `const ok = "${good}";\nconst low = "${good.toLowerCase()}";\n`,
      "b.md": `A hash, 0x${"ab".repeat(32)}, is no address.\nWrong case: 0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed.\n`,
      "picture.png": good.toLowerCase(),
    });
    assert.deepEqual(addressesNotInEip55(top), [
      { file: "a.js", line: 2, address: good.toLowerCase() },
      {
        file: "b.md",
        line: 2,
        address: "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      },
    ]);
  });

  it("find each npm target of each package.json that the doc names in no code span", () => {
    const top = repoWith({
      "package.json": JSON.stringify({
        scripts: { lint: "x", test: "x", "test:coverage": "x" },
      }),
      "tool/package.json": JSON.stringify({ scripts: { start: "x" } }),
      "docs/npm-project-commands.md":
        "| `lint` | … |\nRun `npm run test:coverage -- --watch` to …\nnpm start\n",
    });
    assert.deepEqual(
      npmTargetsMissingFromDocs(top, "docs/npm-project-commands.md"),
      [
        { packageFile: "package.json", target: "test" },
        { packageFile: "tool/package.json", target: "start" },
      ],
    );
  });

  it("find each test file and test helper that no doc given names", () => {
    const top = repoWith({
      "test/a.test.js": "",
      "test/b.test.js": "",
      "test/helpers/stand-in.js": "",
      "tool/tests/helpers/fake.js": "",
      "test/fixtures/data.js": "",
      "docs/engineering.md": "`a.test.js` covers …",
      "CLAUDE.md": "`stand-in.js` is …",
    });
    assert.deepEqual(
      testFilesMissingFromDocs(top, ["docs/engineering.md", "CLAUDE.md"]),
      ["test/b.test.js", "tool/tests/helpers/fake.js"],
    );
  });
});

describe("this repo", () => {
  it("writes every EVM address in EIP-55's form, but those its tests write otherwise on purpose", () => {
    const found = addressesNotInEip55(REPO_TOP)
      .filter(({ file }) => file !== THIS_FILE)
      .map(({ file, address }) => ({ file, address }));
    assert.deepEqual(
      found,
      ADDRESSES_WRITTEN_OTHERWISE.map(({ file, address }) => ({
        file,
        address,
      })),
    );
  });

  it("names every npm target in docs/npm-project-commands.md", () => {
    assert.deepEqual(
      npmTargetsMissingFromDocs(REPO_TOP, "docs/npm-project-commands.md"),
      [],
    );
  });

  it("names every test file and test helper in docs/engineering.md or CLAUDE.md", () => {
    assert.deepEqual(
      testFilesMissingFromDocs(REPO_TOP, ["docs/engineering.md", "CLAUDE.md"]),
      [],
    );
  });
});
