/**
 * Tests of `lib/repo-checks.js`, the checks of a repo's tracked files that
 * the owner's rules ask for, and this repo held to them.
 * @module test/repo-checks.test
 *
 * The checks run on small repos the tests make in temp folders, with git,
 * and then on this repo: its EVM addresses written in EIP-55's form, but
 * those its tests write otherwise on purpose (this file's own among them,
 * the forms it tests the check with), its npm targets named in
 * `docs/npm-project-commands.md`, its test files and helpers named in
 * `docs/engineering.md` or `CLAUDE.md`, and its docs' links and paths
 * pointing at what it keeps.
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
  headingAnchors,
  localReferencesMissing,
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

describe("the anchors of a doc's headings", () => {
  it("are GitHub's: lower case, each space a hyphen, each mark but a hyphen or an underscore left out, and a number after one that came before", () => {
    const text = [
      "# The Tool",
      "## `npm run check`, the gate",
      "### Node 24 and 26: what_runs",
      "```bash",
      "# not a heading",
      "```",
      "## The Tool",
      "#### Closed ##",
    ].join("\n");
    assert.deepEqual(
      [...headingAnchors(text)],
      [
        "the-tool",
        "npm-run-check-the-gate",
        "node-24-and-26-what_runs",
        "the-tool-1",
        "closed",
      ],
    );
  });
});

describe("the check of the docs' pointers, on a repo made for the test", () => {
  it("finds each link to a missing file, folder or heading, and each path from the doc's folder to a missing file or outside the repo, and passes over code blocks and sites", () => {
    const top = repoWith({
      "README.md": [
        "# Top",
        "See [the tool](tool/README.md), [its docs](docs/), and [the gate](docs/guide.md#the-gate).",
        "A [lost page](docs/lost.md) and [a lost part](docs/guide.md#lost).",
        "A [site](https://example.com/x.md) and [mail](mailto:a@example.com).",
        "[Up here](#top) and [not here](#bottom).",
        "```bash",
        "cat ../outside.md",
        "[not checked](nowhere.md)",
        "```",
      ].join("\n"),
      "docs/guide.md": "# Guide\n\n## The gate\n",
      "tool/README.md": [
        "# Tool",
        "Contributing is in `../README.md`; outside is `../../README.md`.",
        "The script is `./run.sh`, and `./gone.sh` is not.",
      ].join("\n"),
      "tool/run.sh": "",
    });
    assert.deepEqual(localReferencesMissing(top), [
      {
        file: "README.md",
        line: 3,
        pointer: "docs/lost.md",
        why: "the repo keeps no such file or folder",
      },
      {
        file: "README.md",
        line: 3,
        pointer: "docs/guide.md#lost",
        why: "docs/guide.md has no heading with that anchor",
      },
      {
        file: "README.md",
        line: 5,
        pointer: "#bottom",
        why: "README.md has no heading with that anchor",
      },
      {
        file: "tool/README.md",
        line: 2,
        pointer: "../../README.md",
        why: "it points outside the repo",
      },
      {
        file: "tool/README.md",
        line: 3,
        pointer: "./gone.sh",
        why: "the repo keeps no such file or folder",
      },
    ]);
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

  it("points its docs' links and paths only at files, folders and headings it keeps", () => {
    assert.deepEqual(localReferencesMissing(REPO_TOP), []);
  });
});
