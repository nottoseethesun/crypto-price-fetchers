/**
 * Vitest's settings for crypto-price-filler's tests.
 * @file vitest.config.js
 *
 * The tests run with `API_KEYS_FILE_PATH` naming a key file that does not
 * exist, and with `API_KEYS_PASSWORD` empty, so neither a test nor a run of
 * the command line a test starts finds the owner's saved CoinGecko key or
 * the password a terminal keeps for it. A test of the key itself saves a
 * key file of its own and names that one.
 *
 * A run with coverage fails below 80% of lines covered: LP Ranger's floor.
 */

import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      API_KEYS_FILE_PATH: fileURLToPath(
        new URL("./tests/no-api-keys-saved/api-keys.json", import.meta.url),
      ),
      API_KEYS_PASSWORD: "",
    },
    coverage: { thresholds: { lines: 80 } },
  },
});
