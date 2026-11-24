/**
 * crypto-price-filler's backfill: `node bin/end-user/backfill.js`.
 * @module bin/end-user/backfill
 *
 * What: fills the prices crypto-price-filler marked `Error` in a CSV file
 * it wrote, from the nearest priced rows, asking no service; `--help`
 * gives its options, examples and exit codes.
 *
 * How: runs `backfillCommandLine` of the package's `backfill.js`, after the
 * run is set to end quietly when the program reading its output stops
 * reading.
 */

import { endQuietlyWhenOutputCloses } from "../../lib/closed-output.js";
import { backfillCommandLine } from "../../fetch-from-any-exchange/crypto-price-filler/backfill.js";

endQuietlyWhenOutputCloses();
await backfillCommandLine();
