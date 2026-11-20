#!/usr/bin/env node
/**
 * The entry point of the Summ csv utility, `npm run summ-csv`, and the bin
 * `summ-csv` of a project that installs this repo from GitHub.
 * @module summ-csv
 *
 * What: writes a csv file for Summ's custom import from a JSON file of
 * rows, once every row has passed the rules; `--help` gives the rest.
 *
 * How: the command line is `summ-csv/command-line.js`'s; a program that
 * writes such a file calls `writeSummCsv` from `summ-csv/index.js`
 * instead.
 */

import { runSummCsv } from "./summ-csv/command-line.js";

process.exitCode = runSummCsv(process.argv);
