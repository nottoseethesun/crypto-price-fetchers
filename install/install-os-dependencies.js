#!/usr/bin/env node
/**
 * The install of the operating system's programs the repo's tools use,
 * outside npm: `npm run os-dependencies`.
 * @module install/install-os-dependencies
 *
 * What: says what is installed and installs what is missing, today the
 * clipboard tool the build step puts its file on the clipboard with;
 * `--help` gives its examples and exit codes.
 *
 * How: runs the command line of `os-dependencies.js`,
 * `runInstallCommandLine`, after the run is set to end with its exit code,
 * and no stack trace, when the program reading its output closes the pipe.
 *
 * Fit: in `install/`, the folder of the step of the README's Install that
 * installs what npm does not.
 */

import { endQuietlyWhenOutputCloses } from "../lib/closed-output.js";
import { runInstallCommandLine } from "./os-dependencies.js";

endQuietlyWhenOutputCloses();
process.exitCode = await runInstallCommandLine(process.argv);
