/**
 * The build step of crypto-price-fetchers: `npm run build apps-script`.
 * @module build
 *
 * What: gives the Sheets scripts as the sheet should run them, joined into
 * one file with the api keys saved in the repo set in it, on the clipboard
 * or in `build/apps-script/`; `--help` gives the rest.
 *
 * How: the build is `apps-script-build/`'s, run with this folder as the
 * repo's top folder.
 */

import { fileURLToPath } from "node:url";
import { runBuild } from "./apps-script-build/index.js";
import { endQuietlyWhenOutputCloses } from "./lib/closed-output.js";

endQuietlyWhenOutputCloses();

process.exitCode = await runBuild(process.argv, {
  projectTop: fileURLToPath(new URL(".", import.meta.url)),
});
