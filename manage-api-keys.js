/**
 * The api key manager of crypto-price-fetchers: `npm run api-keys`.
 * @module manage-api-keys
 *
 * What: lists the api keys of the services this project's `config.json`
 * names under `apiKeys` (CoinGecko, DexTools and x1.ninja), each saved or
 * not, never showing their characters, and asks for each one not saved,
 * keeping it encrypted in `api-keys.json` here, which git ignores.
 * `npm run api-keys -- set <service>` replaces one, and `check-password`
 * is what `unlock-api-keys.sh` runs; `--help` gives the rest.
 *
 * How: the manager is the key store's (`api-key-store/key-manager.js`),
 * run with this folder as the project's top folder.
 */

import { fileURLToPath } from 'node:url';
import { runKeyManager } from './api-key-store/index.js';

process.exitCode = await runKeyManager(process.argv, { projectTop: fileURLToPath(new URL('.', import.meta.url)) });
