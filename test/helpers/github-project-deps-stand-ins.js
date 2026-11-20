/**
 * Stand-ins for the tests of `github-project-deps/`: a project in a temp
 * folder, an npm that installs nothing, and a run of the tool that
 * collects what it prints.
 * @module test/helpers/github-project-deps-stand-ins
 *
 * `makeProject` writes a project's package.json files into a temp folder
 * of its own (`temp-folders.js`), each with a lockfile that installs
 * crypto-price-fetchers at `OLD_COMMIT` and a node_modules folder holding
 * `installed-before`, so a test can see which folders the tool installed
 * again. `standInNpm` records each npm command, and for an install writes
 * the lockfile an install of `NEW_COMMIT` would, unless that folder's
 * install is set to fail. `runOn` runs the tool on a project with what a
 * test hands it in place of npm and git, and gives its exit code and what
 * it printed.
 */

import fs from "node:fs";
import path from "node:path";
import { runGithubProjectDeps } from "../../github-project-deps/index.js";
import { capturedOutput } from "./captured-output.js";
import { makeTempFolder } from "./temp-folders.js";

/** The commit a project's lockfiles name before a run. */
export const OLD_COMMIT = "fe16b549d574b958dd174d4377ea2a5175dc3e60";

/** The commit the stand-in npm installs. */
export const NEW_COMMIT = "2b04e2e973b1d689b08a2e9d6964c79b5850bfd8";

/** The project the tests' dependency from GitHub installs. */
export const PROJECT = "github:nottoseethesun/crypto-price-fetchers";

/** That dependency, at the old commit. */
export const PINNED = `${PROJECT}#${OLD_COMMIT}`;

/**
 * A package.json's text, laid out as npm writes one.
 *
 * @param {Object} fields - Its fields besides its name and version
 * @returns {string} The text
 */
export function manifestText(fields) {
  const manifest = { name: "project", version: "1.0.0", ...fields };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * A lockfile's text that installs crypto-price-fetchers at a commit.
 *
 * @param {string} commit - The commit
 * @returns {string} The text
 */
export function lockText(commit) {
  const lock = {
    name: "project",
    lockfileVersion: 3,
    packages: {
      "": { name: "project" },
      "node_modules/crypto-price-fetchers": {
        version: "1.0.0",
        resolved: `git+ssh://git@github.com/nottoseethesun/crypto-price-fetchers.git#${commit}`,
      },
    },
  };
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/**
 * Makes a project in a temp folder: each package.json given, with a
 * lockfile at the old commit and an installed node_modules beside it.
 *
 * @param {Object<string, string>} manifests - Each package.json's text, by its path from the top folder
 * @returns {string} The project's top folder
 */
export function makeProject(manifests) {
  const top = makeTempFolder("github-project-deps");
  for (const [file, text] of Object.entries(manifests)) {
    const folder = path.dirname(path.join(top, file));
    fs.mkdirSync(path.join(folder, "node_modules", "installed-before"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(top, file), text);
    fs.writeFileSync(
      path.join(folder, "package-lock.json"),
      lockText(OLD_COMMIT),
    );
  }
  return top;
}

/**
 * A stand-in npm: records each call, and for an install writes the
 * lockfile of the new commit, as npm would, unless that folder's install
 * is to fail.
 *
 * @param {string[]} [failingFolders=[]] - The folders whose install fails
 * @returns {{runNpm: function(string[], string): Promise<number>, calls: Array<{args: string[], folder: string}>}} The stand-in and its calls
 */
export function standInNpm(failingFolders = []) {
  const calls = [];
  const runNpm = async (args, folder) => {
    calls.push({ args, folder });
    if (args[0] !== "install") return 0;
    if (failingFolders.includes(folder)) return 1;
    fs.writeFileSync(
      path.join(folder, "package-lock.json"),
      lockText(NEW_COMMIT),
    );
    return 0;
  };
  return { runNpm, calls };
}

/**
 * Runs the tool on a project, keeping what it prints
 * (`captured-output.js`).
 *
 * @param {string} top - The project's top folder
 * @param {string[]} args - The tool's arguments
 * @param {Object} deps - What the run is handed in place of npm and git (`runGithubProjectDeps`)
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>} What the run gave
 */
export async function runOn(top, args, deps) {
  const stdout = capturedOutput();
  const stderr = capturedOutput();
  const exitCode = await runGithubProjectDeps(
    ["node", "github-project-deps", ...args],
    { projectTop: top },
    { ...deps, stdout, stderr },
  );
  return { exitCode, stdout: stdout.text, stderr: stderr.text };
}

/**
 * Reads a file of a project.
 *
 * @param {string} top - The project's top folder
 * @param {string} file - The file, from the top folder
 * @returns {string} Its text
 */
export function readFile(top, file) {
  return fs.readFileSync(path.join(top, file), "utf8");
}
