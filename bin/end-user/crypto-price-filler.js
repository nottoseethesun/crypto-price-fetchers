/**
 * crypto-price-filler's command line: `node bin/end-user/crypto-price-filler.js`.
 * @module bin/end-user/crypto-price-filler
 *
 * What: prices each row of a CSV file, as crypto-price-filler, the package
 * in `fetch-from-any-exchange/crypto-price-filler/`, does;
 * `--help` gives its options, examples and exit codes.
 *
 * How: loading the package's `index.js` runs it, with this process's
 * arguments, after the run is set to end quietly when the program reading
 * its output stops reading. The package's own imports resolve from its own
 * folder's packages.
 */

import { endQuietlyWhenOutputCloses } from "../../lib/closed-output.js";

endQuietlyWhenOutputCloses();
await import("../../fetch-from-any-exchange/crypto-price-filler/index.js");
