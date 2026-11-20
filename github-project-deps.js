#!/usr/bin/env node
/**
 * The bin of crypto-price-fetchers, `github-project-deps main|release`,
 * which a project that installs this repo from GitHub runs as
 * `npm run github-project-deps -- main` or `-- release`.
 * @module github-project-deps
 *
 * What: sets the dependencies the project installs from GitHub to their
 * projects' main branch or latest release, and makes each lockfile again;
 * `--help` gives the rest.
 *
 * How: the tool is `github-project-deps/`'s, run in the folder npm runs a
 * project's scripts in, which is the project's top folder.
 */

import { runGithubProjectDeps } from "./github-project-deps/index.js";

process.exitCode = await runGithubProjectDeps(process.argv, {
  projectTop: process.cwd(),
});
