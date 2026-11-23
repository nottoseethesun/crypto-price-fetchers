/**
 * The api key manager of crypto-price-fetchers: `npm run api-keys`.
 * @module bin/end-user/manage-api-keys
 *
 * What: lists the api keys of the services this project's `config.json`
 * names under `apiKeys` (CoinGecko, CoinPaprika, DexTools, Moralis and
 * x1.ninja), each saved or not, never showing their characters, and asks
 * for each one not saved, keeping it encrypted in `api-keys.json` at the
 * repo's top,
 * which git ignores.
 * `npm run api-keys -- set <service>` replaces one, and `check-password`
 * is what `bin/unlock-api-keys.sh` runs; `--help` gives the rest.
 *
 * How: the manager is the key store's (`api-key-store/key-manager.js`),
 * run with the repo's top folder, two above this one, as the project's
 * top folder.
 */

import { fileURLToPath } from "node:url";
import { runKeyManager } from "../../api-key-store/index.js";
import { endQuietlyWhenOutputCloses } from "../../lib/closed-output.js";

endQuietlyWhenOutputCloses();

process.exitCode = await runKeyManager(process.argv, {
  projectTop: fileURLToPath(new URL("../..", import.meta.url)),
});
