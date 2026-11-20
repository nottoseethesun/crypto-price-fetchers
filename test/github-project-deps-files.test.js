/**
 * Tests for `github-project-deps/`, part two: which package.json files a
 * run reads, and what this package ships for the bin. Part one,
 * `github-project-deps.test.js`, covers the specs and the runs.
 * @module test/github-project-deps-files.test
 *
 * The tests of which package.json files a run reads run git itself, in a
 * temp git project, with the stand-in npm of
 * `helpers/github-project-deps-stand-ins.js`. The test of what this
 * package ships asks npm what it would pack, which reads only this repo.
 */

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  PINNED,
  makeProject,
  manifestText,
  readFile,
  runOn,
  standInNpm,
} from "./helpers/github-project-deps-stand-ins.js";
import { removeTempFolders } from "./helpers/temp-folders.js";

after(removeTempFolders);

describe("the package.json files a run reads", () => {
  it("are those git keeps, at the project's top and in its folders", async () => {
    const pinned = manifestText({
      dependencies: { "crypto-price-fetchers": PINNED },
    });
    const top = makeProject({
      "package.json": pinned,
      "chart/package.json": pinned,
      "untracked/package.json": pinned,
    });
    execFileSync("git", ["init", "-q"], { cwd: top });
    execFileSync("git", ["add", "package.json", "chart/package.json"], {
      cwd: top,
    });
    const npm = standInNpm();

    const { exitCode } = await runOn(top, ["main"], { runNpm: npm.runNpm });

    assert.equal(exitCode, 0);
    assert.deepEqual(
      npm.calls.map((call) => path.relative(top, call.folder)).sort(),
      ["", "chart"],
    );
    assert.equal(readFile(top, "untracked/package.json"), pinned);
  });

  it("cannot be listed outside a git project", async () => {
    const top = makeProject({
      "package.json": manifestText({
        dependencies: { "crypto-price-fetchers": PINNED },
      }),
    });
    const npm = standInNpm();

    const { exitCode, stderr } = await runOn(top, ["main"], {
      runNpm: npm.runNpm,
    });

    assert.equal(exitCode, 1);
    assert.match(stderr, /runs in the top folder of a git project/);
    assert.deepEqual(npm.calls, []);
  });
});

describe("the package", () => {
  it("ships the bin and its module to a project that installs it from GitHub", () => {
    const repoTop = path.resolve(import.meta.dirname, "..");
    const packed = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: repoTop,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    )[0];
    const files = packed.files.map((file) => file.path);
    const manifest = JSON.parse(readFile(repoTop, "package.json"));

    assert.equal(manifest.bin["github-project-deps"], "github-project-deps.js");
    assert.ok(files.includes("github-project-deps.js"));
    assert.ok(files.includes("github-project-deps/index.js"));
  });
});
