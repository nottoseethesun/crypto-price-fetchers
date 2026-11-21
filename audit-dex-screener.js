/**
 * The audit of DEX Screener's files: `npm run audit:dex-screener`, which
 * `npm run audit:deps` runs after npm audit.
 * @module audit-dex-screener
 *
 * What: the build step (`npm run build apps-script`) can put DEX Screener's
 * Google Sheets functions in the file it gives, downloaded from DEX
 * Screener's repo at one commit. npm audit checks only the packages this
 * repo installs from npm, so this audit downloads each of DEX Screener's
 * files at that commit and checks its SHA-256 against the one the build
 * checks, and exits with 1 when a file cannot be downloaded or differs.
 *
 * How: `runDexScreenerAudit` in `apps-script-build/dex-screener-files.js`,
 * which holds the commit and the checksums, declares the command line with
 * commander: `--help` gives the rest, its exit codes included.
 */

import { runDexScreenerAudit } from "./apps-script-build/dex-screener-files.js";

process.exitCode = await runDexScreenerAudit(process.argv);
