/**
 * Chooses the versions of the dependencies a project installs straight
 * from GitHub: `github-project-deps main|release`.
 * @module github-project-deps/index
 *
 * What: a dependency installed from GitHub names its project and a ref,
 * as `github:owner/repo#main` does. npm installs the commit the ref names
 * when it makes the lockfile, and keeps that commit in the lockfile, which
 * `npm ci` installs from then on. `main` sets every such dependency to its
 * project's main branch (`#main`); `release` sets it to its project's
 * latest release (`#semver:*`, the project's highest version tag, such as
 * `1.4.0`). Either way the lockfile is made again, so the commit installed
 * is the newest the ref names, and running the same mode again moves to a
 * newer commit of main, or a newer release. A project needs none of this:
 * its lockfile already names a commit of each such dependency, which
 * `npm ci` installs.
 *
 * How:
 *
 * - The package.json files are those the project's git keeps, at its top
 *   and in its folders. A folder whose package.json installs nothing from
 *   GitHub is left alone.
 * - In each of the others, every dependency in `dependencies`,
 *   `devDependencies` or `optionalDependencies` whose spec starts with
 *   `github:` gets the mode's ref in place of its own. A package.json is
 *   written again only when one of its specs changes.
 * - Each such folder's lockfile is then made again, as LP Ranger makes one
 *   for a change of dependency: its package-lock.json is deleted first,
 *   then its node_modules, and then `npm install` runs there.
 * - When an install fails, as one does for a release whose top folder has
 *   no package.json, every package.json and package-lock.json goes back to
 *   what it held before the run, and node_modules is installed again from
 *   them in each folder whose node_modules was deleted.
 * - The run ends by naming the version and commit each dependency from
 *   GitHub is installed at, as the new lockfile holds them.
 *
 * Fit: `bin/github-project-deps.js` runs
 * `runGithubProjectDeps`, as this package's bin, `github-project-deps`.
 * The projects that install this repo from GitHub run it as
 * `npm run github-project-deps -- main` or `-- release`.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn as nodeSpawn } from "node:child_process";
import { Argument, Command, CommanderError } from "commander";
import { messageOf } from "../lib/message-of.js";

/** The ref each mode installs a GitHub project at. */
export const MODE_REFS = Object.freeze({ main: "main", release: "semver:*" });

/** What each mode follows, for the lines a run prints. */
const MODE_NAMES = Object.freeze({
  main: "its project's main branch",
  release: "its project's latest release",
});

/** The groups of a package.json whose packages npm installs. */
const DEPENDENCY_GROUPS = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
]);

/** What the spec of a dependency installed from GitHub starts with. */
const GITHUB_PREFIX = "github:";

/** The lockfile beside a package.json. */
const LOCKFILE = "package-lock.json";

/** The end of the help: what each mode does. */
const HELP_AFTER = `
Modes:
  main     each dependency installed from GitHub follows its project's main
           branch
  release  each follows its project's latest release, its highest version
           tag

Either way, each folder's ${LOCKFILE} is made again, so the newest commit
of main, or the newest release, is installed. The project needs none of
this: its lockfile already names a commit of each such dependency, which
npm ci installs.

Examples:
  In a project that installs crypto-price-fetchers, move it to the newest
  commit of its main branch, after a change there:
    $ npm run github-project-deps -- main
  Move every such dependency to its project's latest release instead:
    $ npm run github-project-deps -- release

Exit codes: 0 when each lockfile was made again, or no package.json here
installs a dependency from GitHub; 1 when npm install failed, which puts
every package.json and lockfile back as it was, or the mode is not main or
release.`;

/**
 * The spec a dependency installed from GitHub has in a mode: its project,
 * with the mode's ref in place of its own.
 *
 * @param {*} spec - The dependency's spec, as package.json gives it
 * @param {string} mode - 'main' or 'release'
 * @returns {(string|null)} The spec, or null for a dependency not installed from GitHub
 */
export function specInMode(spec, mode) {
  if (typeof spec !== "string" || !spec.startsWith(GITHUB_PREFIX)) return null;
  return `${spec.split("#")[0]}#${MODE_REFS[mode]}`;
}

/**
 * A package.json with the dependencies it installs from GitHub set to a
 * mode.
 *
 * @typedef {Object} SwitchedPackage
 * @property {string[]} names - The dependencies it installs from GitHub
 * @property {Array<{name: string, from: string, to: string}>} changes - Those whose spec changes, with the spec before and after
 * @property {string} text - Its text with the new specs, laid out as npm writes a package.json
 */

/**
 * Sets the dependencies a package.json installs from GitHub to a mode.
 *
 * @param {string} text - The package.json's text
 * @param {string} mode - 'main' or 'release'
 * @returns {SwitchedPackage} The dependencies, the changes, and the new text
 * @throws {SyntaxError} When the text is not JSON
 */
export function switchedPackage(text, mode) {
  const manifest = JSON.parse(text);
  const names = [];
  const changes = [];
  for (const group of DEPENDENCY_GROUPS) {
    const specs = manifest[group];
    if (specs === undefined || specs === null) continue;
    for (const [name, spec] of Object.entries(specs)) {
      const switched = specInMode(spec, mode);
      if (switched === null) continue;
      names.push(name);
      if (switched !== spec) {
        changes.push({ name, from: spec, to: switched });
        specs[name] = switched;
      }
    }
  }
  return { names, changes, text: `${JSON.stringify(manifest, null, 2)}\n` };
}

/**
 * The version and commit a dependency is installed at, as a lockfile
 * holds them.
 *
 * @param {(string|null)} lockText - The lockfile's text, or null when there is none
 * @param {string} name - The dependency
 * @returns {(string|null)} Such as '1.0.0, commit 2b04e2e', the version alone when the lockfile names no commit, or null when it does not hold the dependency
 */
export function installedAt(lockText, name) {
  if (lockText === null) return null;
  const entry = JSON.parse(lockText).packages?.[`node_modules/${name}`];
  if (entry === undefined || entry === null) return null;
  const resolved = typeof entry.resolved === "string" ? entry.resolved : "";
  const commit = resolved.split("#")[1];
  return commit === undefined
    ? entry.version
    : `${entry.version}, commit ${commit.slice(0, 7)}`;
}

/**
 * Lists the package.json files a project's git keeps.
 *
 * @param {string} projectTop - The project's top folder
 * @returns {string[]} Their paths, from the top folder
 * @throws {Error} When git cannot list them, as outside a git project
 */
function gitPackageFiles(projectTop) {
  let listed;
  try {
    listed = execFileSync(
      "git",
      ["ls-files", "-z", "--", ":(glob)**/package.json"],
      { cwd: projectTop, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    throw new Error(
      `git could not list the package.json files in ${projectTop}: github-project-deps runs in the top folder of a git project.`,
    );
  }
  return listed.split("\0").filter((file) => file !== "");
}

/**
 * Reads a file, or gives null when there is none.
 *
 * @param {string} file - The file
 * @returns {(string|null)} Its text, or null
 */
function readIfPresent(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

/**
 * Puts a file back as it was: its text, or no file when there was none.
 *
 * @param {string} file - The file
 * @param {(string|null)} text - What it held, or null when there was none
 */
function putBack(file, text) {
  if (text === null) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, text);
}

/**
 * Runs npm in a folder, its output the terminal's, and gives its exit
 * code.
 *
 * @param {string[]} args - npm's arguments, such as ['install']
 * @param {string} folder - The folder
 * @returns {Promise<number>} The exit code
 */
function runNpm(args, folder) {
  return new Promise((resolve) => {
    const child = nodeSpawn("npm", args, { cwd: folder, stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/**
 * A folder whose package.json installs a dependency from GitHub, with
 * what its files held before the run.
 *
 * @typedef {Object} ProjectPackage
 * @property {string} file - Its package.json, from the project's top folder
 * @property {string} folder - The folder
 * @property {string} manifestBefore - Its package.json's text before the run
 * @property {(string|null)} lockBefore - Its package-lock.json's text before the run, or null when it had none
 * @property {SwitchedPackage} switched - Its package.json in the mode
 */

/**
 * Finds the folders whose package.json installs a dependency from GitHub.
 *
 * @param {string} mode - 'main' or 'release'
 * @param {Object} run - The run (`runGithubProjectDeps`)
 * @returns {ProjectPackage[]} The folders, in the order their package.json files are listed
 */
function projectPackages(mode, run) {
  return run.listPackageFiles(run.projectTop).flatMap((file) => {
    const manifestPath = path.join(run.projectTop, file);
    const manifestBefore = fs.readFileSync(manifestPath, "utf8");
    const switched = switchedPackage(manifestBefore, mode);
    if (switched.names.length === 0) return [];
    const folder = path.dirname(manifestPath);
    const lockBefore = readIfPresent(path.join(folder, LOCKFILE));
    return [{ file, folder, manifestBefore, lockBefore, switched }];
  });
}

/**
 * Writes each package.json whose specs change, and says what each
 * dependency from GitHub follows.
 *
 * @param {ProjectPackage[]} packages - The folders
 * @param {string} mode - 'main' or 'release'
 * @param {Object} run - The run
 */
function writeSpecs(packages, mode, run) {
  for (const pkg of packages) {
    for (const name of pkg.switched.names) {
      const change = pkg.switched.changes.find((each) => each.name === name);
      run.say(
        change === undefined
          ? `${pkg.file}: ${name} already follows ${MODE_NAMES[mode]}.`
          : `${pkg.file}: ${name} now follows ${MODE_NAMES[mode]}: ${change.from} → ${change.to}`,
      );
    }
    if (pkg.switched.changes.length > 0) {
      fs.writeFileSync(path.join(run.projectTop, pkg.file), pkg.switched.text);
    }
  }
}

/**
 * Makes a folder's lockfile again, as LP Ranger makes one for a change of
 * dependency: deletes its package-lock.json, then its node_modules, then
 * runs npm install.
 *
 * @param {ProjectPackage} pkg - The folder
 * @param {Object} run - The run
 * @returns {Promise<number>} npm's exit code
 */
function reinstall(pkg, run) {
  run.say(`${pkg.file}: making ${LOCKFILE} again, from a fresh node_modules.`);
  fs.rmSync(path.join(pkg.folder, LOCKFILE), { force: true });
  fs.rmSync(path.join(pkg.folder, "node_modules"), {
    recursive: true,
    force: true,
  });
  return run.runNpm(["install"], pkg.folder);
}

/**
 * Puts every package.json and package-lock.json back as the run found
 * them, and installs node_modules again from them in each folder whose
 * node_modules was deleted: with `npm ci` from its lockfile, or, in a
 * folder that had none, with an install that writes none.
 *
 * @param {ProjectPackage[]} packages - The folders
 * @param {number} reached - How many of them, from the first, had their node_modules deleted
 * @param {Object} run - The run
 * @returns {Promise<string[]>} The package.json files whose folders could not be installed again
 */
async function putEverythingBack(packages, reached, run) {
  for (const pkg of packages) {
    putBack(path.join(run.projectTop, pkg.file), pkg.manifestBefore);
    putBack(path.join(pkg.folder, LOCKFILE), pkg.lockBefore);
  }
  const notInstalled = [];
  for (const pkg of packages.slice(0, reached)) {
    const args =
      pkg.lockBefore === null ? ["install", "--no-package-lock"] : ["ci"];
    if ((await run.runNpm(args, pkg.folder)) !== 0) notInstalled.push(pkg.file);
  }
  return notInstalled;
}

/**
 * Sets the project's dependencies from GitHub to a mode, and makes each
 * of their folders' lockfiles again.
 *
 * @param {string} mode - 'main' or 'release'
 * @param {Object} run - The run
 * @returns {Promise<number>} The exit code: 0 once every folder is installed again, 1 when an install failed and the files were put back
 */
async function switchProjects(mode, run) {
  const packages = projectPackages(mode, run);
  if (packages.length === 0) {
    run.say(
      "No package.json here installs a dependency from GitHub, so nothing changes.",
    );
    return 0;
  }
  writeSpecs(packages, mode, run);
  for (const [index, pkg] of packages.entries()) {
    if ((await reinstall(pkg, run)) !== 0) {
      const notInstalled = await putEverythingBack(packages, index + 1, run);
      run.tell(
        `npm install failed for ${pkg.file}, so every package.json and ${LOCKFILE} is back as it was before the run.`,
      );
      run.tell(
        notInstalled.length === 0
          ? "node_modules is installed again from them."
          : `node_modules could not be installed again for ${notInstalled.join(", ")}: run npm ci in each of their folders.`,
      );
      return 1;
    }
  }
  for (const pkg of packages) {
    const lockText = readIfPresent(path.join(pkg.folder, LOCKFILE));
    for (const name of pkg.switched.names) {
      const installed = installedAt(lockText, name);
      run.say(
        `${pkg.file}: ${name} is installed at ${installed ?? "no version the lockfile names"}.`,
      );
    }
  }
  return 0;
}

/**
 * Runs github-project-deps, in process.
 *
 * @param {string[]} argv - The arguments, shaped as `process.argv`
 * @param {{projectTop: string}} project - The project, by its top folder
 * @param {Object} [deps] - What a test replaces
 * @param {function(string): string[]} [deps.listPackageFiles] - Lists the package.json files the project keeps, from its top folder; git's list when absent
 * @param {function(string[], string): Promise<number>} [deps.runNpm] - Runs npm in a folder, giving its exit code
 * @param {{write: function(string): void}} [deps.stdout=process.stdout] - Where the run's lines go
 * @param {{write: function(string): void}} [deps.stderr=process.stderr] - Where its failures go
 * @returns {Promise<number>} The exit code
 */
export async function runGithubProjectDeps(argv, project, deps = {}) {
  const io = {
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
  };
  const run = {
    projectTop: project.projectTop,
    listPackageFiles: deps.listPackageFiles ?? gitPackageFiles,
    runNpm: deps.runNpm ?? runNpm,
    say: (line) => io.stdout.write(`${line}\n`),
    tell: (line) => io.stderr.write(`${line}\n`),
  };
  let exitCode = 0;
  const program = new Command()
    .name("github-project-deps")
    .description(
      "Sets the dependencies this project installs from GitHub to their projects' main branch or latest release, and makes each lockfile again.",
    )
    .addArgument(
      new Argument("<mode>", "main or release").choices(Object.keys(MODE_REFS)),
    )
    .addHelpText("after", HELP_AFTER)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.stdout.write(text),
      writeErr: (text) => io.stderr.write(text),
    })
    .action(async (mode) => {
      exitCode = await switchProjects(mode, run);
    });
  try {
    await program.parseAsync(argv);
  } catch (thrown) {
    if (thrown instanceof CommanderError) return thrown.exitCode;
    run.tell(messageOf(thrown));
    return 1;
  }
  return exitCode;
}
