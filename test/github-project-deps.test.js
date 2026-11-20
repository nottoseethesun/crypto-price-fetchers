/**
 * Tests for `github-project-deps/`, which sets the dependencies a project
 * installs from GitHub to their projects' main branch or latest release,
 * and makes each lockfile again. Part two,
 * `github-project-deps-files.test.js`, covers which package.json files a
 * run reads and what this package ships for the bin.
 * @module test/github-project-deps.test
 *
 * Each run works on a project in a temp folder of its own, with a stand-in
 * npm that records what it is asked and writes the lockfile an install
 * would (`helpers/github-project-deps-stand-ins.js`), so no test installs
 * a package or asks GitHub.
 */

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  MODE_REFS,
  installedAt,
  specInMode,
  switchedPackage,
} from "../github-project-deps/index.js";
import {
  NEW_COMMIT,
  OLD_COMMIT,
  PINNED,
  PROJECT,
  lockText,
  makeProject,
  manifestText,
  readFile,
  runOn,
  standInNpm,
} from "./helpers/github-project-deps-stand-ins.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

after(removeTempFolders);

describe("specInMode", () => {
  it("installs main at main, and a release at the highest version tag", () => {
    assert.deepEqual(MODE_REFS, { main: "main", release: "semver:*" });
  });

  it("gives a dependency from GitHub the mode's ref in place of its own", () => {
    assert.equal(specInMode(PINNED, "main"), `${PROJECT}#main`);
    assert.equal(specInMode(PINNED, "release"), `${PROJECT}#semver:*`);
    assert.equal(specInMode(`${PROJECT}#semver:*`, "main"), `${PROJECT}#main`);
  });

  it("gives a dependency from GitHub that names no ref the mode's", () => {
    assert.equal(
      specInMode("github:owner/repo", "release"),
      "github:owner/repo#semver:*",
    );
  });

  it("gives null for a dependency not installed from GitHub", () => {
    assert.equal(specInMode("^12.1.0", "main"), null);
    assert.equal(
      specInMode("git+https://github.com/owner/repo.git", "main"),
      null,
    );
    assert.equal(specInMode(undefined, "main"), null);
  });
});

describe("switchedPackage", () => {
  it("names each dependency from GitHub in the groups npm installs, and changes those not in the mode", () => {
    const switched = switchedPackage(
      manifestText({
        dependencies: { "crypto-price-fetchers": PINNED, commander: "^12.1.0" },
        devDependencies: { "other-project": "github:owner/other#main" },
        optionalDependencies: { "third-project": "github:owner/third#1.2.0" },
        peerDependencies: { "peer-project": "github:owner/peer#abc1234" },
      }),
      "main",
    );

    assert.deepEqual(switched.names, [
      "crypto-price-fetchers",
      "other-project",
      "third-project",
    ]);
    assert.deepEqual(switched.changes, [
      { name: "crypto-price-fetchers", from: PINNED, to: `${PROJECT}#main` },
      {
        name: "third-project",
        from: "github:owner/third#1.2.0",
        to: "github:owner/third#main",
      },
    ]);
    const manifest = JSON.parse(switched.text);
    assert.equal(
      manifest.dependencies["crypto-price-fetchers"],
      `${PROJECT}#main`,
    );
    assert.equal(manifest.dependencies.commander, "^12.1.0");
    assert.equal(
      manifest.peerDependencies["peer-project"],
      "github:owner/peer#abc1234",
    );
    assert.ok(switched.text.endsWith("}\n"));
  });
});

describe("installedAt", () => {
  it("reads a dependency's version and commit from a lockfile", () => {
    assert.equal(
      installedAt(lockText(NEW_COMMIT), "crypto-price-fetchers"),
      "1.0.0, commit 2b04e2e",
    );
  });

  it("gives the version alone when the lockfile names no commit", () => {
    const lock = JSON.stringify({
      packages: {
        "node_modules/crypto-price-fetchers": {
          version: "1.4.0",
          resolved: "https://registry.stand-in.test/crypto-price-fetchers.tgz",
        },
      },
    });
    assert.equal(installedAt(lock, "crypto-price-fetchers"), "1.4.0");
  });

  it("gives null with no lockfile, or one that does not hold the dependency", () => {
    assert.equal(installedAt(null, "crypto-price-fetchers"), null);
    assert.equal(installedAt(lockText(NEW_COMMIT), "other-project"), null);
  });
});

describe("a run", () => {
  it("sets each dependency from GitHub to main, and makes each of their folders' lockfiles again from a fresh node_modules", async () => {
    const manifests = {
      "package.json": manifestText({
        dependencies: { "crypto-price-fetchers": PINNED, commander: "^12.1.0" },
      }),
      "chart/package.json": manifestText({
        devDependencies: { "crypto-price-fetchers": PINNED },
      }),
      "plain/package.json": manifestText({
        dependencies: { commander: "^12.1.0" },
      }),
    };
    const top = makeProject(manifests);
    const npm = standInNpm();

    const { exitCode, stdout } = await runOn(top, ["main"], {
      runNpm: npm.runNpm,
      listPackageFiles: () => Object.keys(manifests),
    });

    assert.equal(exitCode, 0);
    const topManifest = JSON.parse(readFile(top, "package.json"));
    assert.equal(
      topManifest.dependencies["crypto-price-fetchers"],
      `${PROJECT}#main`,
    );
    assert.equal(topManifest.dependencies.commander, "^12.1.0");
    assert.equal(
      JSON.parse(readFile(top, "chart/package.json")).devDependencies[
        "crypto-price-fetchers"
      ],
      `${PROJECT}#main`,
    );
    assert.deepEqual(npm.calls, [
      { args: ["install"], folder: top },
      { args: ["install"], folder: path.join(top, "chart") },
    ]);
    for (const folder of ["", "chart"]) {
      assert.equal(
        fs.existsSync(
          path.join(top, folder, "node_modules", "installed-before"),
        ),
        false,
      );
      assert.equal(
        readFile(top, path.join(folder, "package-lock.json")),
        lockText(NEW_COMMIT),
      );
    }
    assert.equal(
      readFile(top, "plain/package.json"),
      manifests["plain/package.json"],
    );
    assert.equal(
      readFile(top, "plain/package-lock.json"),
      lockText(OLD_COMMIT),
    );
    assert.ok(
      fs.existsSync(
        path.join(top, "plain", "node_modules", "installed-before"),
      ),
    );
    assert.ok(
      stdout.includes(
        `package.json: crypto-price-fetchers now follows its project's main branch: ${PINNED} → ${PROJECT}#main`,
      ),
    );
    assert.ok(
      stdout.includes(
        "chart/package.json: crypto-price-fetchers is installed at 1.0.0, commit 2b04e2e.",
      ),
    );
  });

  it("sets each dependency from GitHub to its project's latest release", async () => {
    const top = makeProject({
      "package.json": manifestText({
        dependencies: { "crypto-price-fetchers": PINNED },
      }),
    });
    const npm = standInNpm();

    const { exitCode, stdout } = await runOn(top, ["release"], {
      runNpm: npm.runNpm,
      listPackageFiles: () => ["package.json"],
    });

    assert.equal(exitCode, 0);
    assert.equal(
      JSON.parse(readFile(top, "package.json")).dependencies[
        "crypto-price-fetchers"
      ],
      `${PROJECT}#semver:*`,
    );
    assert.deepEqual(npm.calls, [{ args: ["install"], folder: top }]);
    assert.match(stdout, /now follows its project's latest release/);
  });

  it("leaves a package.json already in the mode as it is, and still makes its lockfile again", async () => {
    const text = manifestText({
      dependencies: { "crypto-price-fetchers": `${PROJECT}#main` },
    });
    const top = makeProject({ "package.json": text });
    const npm = standInNpm();

    const { exitCode, stdout } = await runOn(top, ["main"], {
      runNpm: npm.runNpm,
      listPackageFiles: () => ["package.json"],
    });

    assert.equal(exitCode, 0);
    assert.equal(readFile(top, "package.json"), text);
    assert.deepEqual(npm.calls, [{ args: ["install"], folder: top }]);
    assert.equal(readFile(top, "package-lock.json"), lockText(NEW_COMMIT));
    assert.ok(
      stdout.includes(
        "package.json: crypto-price-fetchers already follows its project's main branch.",
      ),
    );
  });

  it("puts every package.json and lockfile back, and installs node_modules again from them, when an install fails", async () => {
    const manifests = {
      "package.json": manifestText({
        dependencies: { "crypto-price-fetchers": PINNED },
      }),
      "chart/package.json": manifestText({
        dependencies: { "crypto-price-fetchers": PINNED },
      }),
    };
    const top = makeProject(manifests);
    const npm = standInNpm([path.join(top, "chart")]);

    const { exitCode, stderr } = await runOn(top, ["release"], {
      runNpm: npm.runNpm,
      listPackageFiles: () => Object.keys(manifests),
    });

    assert.equal(exitCode, 1);
    for (const [file, text] of Object.entries(manifests)) {
      assert.equal(readFile(top, file), text);
      assert.equal(
        readFile(top, path.join(path.dirname(file), "package-lock.json")),
        lockText(OLD_COMMIT),
      );
    }
    assert.deepEqual(npm.calls, [
      { args: ["install"], folder: top },
      { args: ["install"], folder: path.join(top, "chart") },
      { args: ["ci"], folder: top },
      { args: ["ci"], folder: path.join(top, "chart") },
    ]);
    assert.ok(
      stderr.includes(
        "npm install failed for chart/package.json, so every package.json and package-lock.json is back as it was before the run.",
      ),
    );
    assert.ok(stderr.includes("node_modules is installed again from them."));
  });

  it("installs node_modules again only in the folders whose node_modules it deleted", async () => {
    const manifests = {
      "package.json": manifestText({
        dependencies: { "crypto-price-fetchers": PINNED },
      }),
      "chart/package.json": manifestText({
        dependencies: { "crypto-price-fetchers": PINNED },
      }),
    };
    const top = makeProject(manifests);
    const npm = standInNpm([top]);

    const { exitCode } = await runOn(top, ["main"], {
      runNpm: npm.runNpm,
      listPackageFiles: () => Object.keys(manifests),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(npm.calls, [
      { args: ["install"], folder: top },
      { args: ["ci"], folder: top },
    ]);
    assert.ok(
      fs.existsSync(
        path.join(top, "chart", "node_modules", "installed-before"),
      ),
    );
    assert.equal(
      readFile(top, "chart/package.json"),
      manifests["chart/package.json"],
    );
  });

  it("names the folders whose node_modules could not be installed again", async () => {
    const top = makeProject({
      "package.json": manifestText({
        dependencies: { "crypto-price-fetchers": PINNED },
      }),
    });
    const asked = [];

    const { exitCode, stderr } = await runOn(top, ["main"], {
      runNpm: async (args) => {
        asked.push(args[0]);
        return 1;
      },
      listPackageFiles: () => ["package.json"],
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(asked, ["install", "ci"]);
    assert.ok(
      stderr.includes(
        "node_modules could not be installed again for package.json: run npm ci in each of their folders.",
      ),
    );
  });

  it("leaves no lockfile in a folder that had none, and installs node_modules again there without one", async () => {
    const top = makeProject({
      "package.json": manifestText({
        dependencies: { "crypto-price-fetchers": PINNED },
      }),
    });
    fs.rmSync(path.join(top, "package-lock.json"));
    const asked = [];

    const { exitCode } = await runOn(top, ["main"], {
      runNpm: async (args, folder) => {
        asked.push(args);
        if (args.length > 1) return 0;
        fs.writeFileSync(
          path.join(folder, "package-lock.json"),
          lockText(NEW_COMMIT),
        );
        return 1;
      },
      listPackageFiles: () => ["package.json"],
    });

    assert.equal(exitCode, 1);
    assert.equal(fs.existsSync(path.join(top, "package-lock.json")), false);
    assert.deepEqual(asked, [["install"], ["install", "--no-package-lock"]]);
  });

  it("changes nothing in a project that installs nothing from GitHub", async () => {
    const text = manifestText({ dependencies: { commander: "^12.1.0" } });
    const top = makeProject({ "package.json": text });
    const npm = standInNpm();

    const { exitCode, stdout } = await runOn(top, ["main"], {
      runNpm: npm.runNpm,
      listPackageFiles: () => ["package.json"],
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(npm.calls, []);
    assert.equal(readFile(top, "package.json"), text);
    assert.ok(
      fs.existsSync(path.join(top, "node_modules", "installed-before")),
    );
    assert.ok(
      stdout.includes(
        "No package.json here installs a dependency from GitHub, so nothing changes.",
      ),
    );
  });

  it("refuses a mode other than main or release", async () => {
    const npm = standInNpm();
    const { exitCode, stderr } = await runOn(
      makeTempFolder("mode"),
      ["latest"],
      {
        runNpm: npm.runNpm,
        listPackageFiles: () => [],
      },
    );

    assert.equal(exitCode, 1);
    assert.match(stderr, /Allowed choices are main, release/);
    assert.deepEqual(npm.calls, []);
  });

  it("explains each mode in its help", async () => {
    const { exitCode, stdout } = await runOn(
      makeTempFolder("help"),
      ["--help"],
      {
        runNpm: standInNpm().runNpm,
        listPackageFiles: () => [],
      },
    );

    assert.equal(exitCode, 0);
    assert.match(
      stdout,
      /main {5}each dependency installed from GitHub follows/,
    );
    assert.match(
      stdout,
      /release {2}each follows its project's latest release/,
    );
    assert.match(stdout, /which\s+npm ci installs/);
  });
});
