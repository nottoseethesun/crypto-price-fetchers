#!/usr/bin/env node
/**
 * The bin of crypto-price-fetchers that runs actionlint, the checker of
 * GitHub Actions workflow files: `run-actionlint [files...]`, which each
 * repo's `npm run lint` runs on `.github/workflows/*.yml`, and
 * `run-actionlint --check`, which `npm run audit:actionlint` runs.
 * @module run-actionlint
 *
 * What: it runs actionlint from the official release that
 * `actionlint/release.js` pins, downloaded once and checked against the
 * SHA-256 written there, rather than from an npm package, so no package
 * between the release and the run can change what runs.
 *
 * How: `runActionlint` in `actionlint/index.js` declares the command line
 * with commander: `--help` gives the rest, its exit codes included.
 */

import { runActionlint } from "./actionlint/index.js";

process.exitCode = await runActionlint(process.argv);
