/**
 * Tests that the command line, `bin/end-user/crypto-price-filler.js`, opens the
 * CoinGecko api key saved in the repo's key file before it prices anything.
 * @module tests/coingecko-api-key.test
 *
 * Each test runs the tool in a child process over one XTM row, with the
 * stand-in MEXC and CoinGecko of `helpers/stand-in-fetch-preload.js`, whose
 * ping takes one key alone. The key files are in a temp folder, removed
 * afterwards, and `API_KEYS_FILE_PATH` names the one a run reads. The
 * password is typed on the child's stdin, as at a terminal, or kept in
 * `API_KEYS_PASSWORD`, as `bin/unlock-api-keys.sh` keeps it.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { saveEncryptedKey } from "../../../api-key-store/index.js";
import { STAND_IN_GECKO_KEY } from "./helpers/stand-in-coingecko-key.js";
import { KEY_RUN_TIMEOUT_MS } from "./helpers/regression-runs.js";

const FILLER_DIR = path.resolve(__dirname, "..");
const COMMAND_LINE = path.resolve(
  __dirname,
  "../../../bin/end-user/crypto-price-filler.js",
);
const PRELOAD_URL = pathToFileURL(
  path.resolve(__dirname, "helpers/stand-in-fetch-preload.js"),
).href;

/** The password the keys are saved with. */
const PASSWORD = "typed-password";

let folder;
let input;
let takenKeyFile;
let refusedKeyFile;
let runs = 0;

beforeAll(async () => {
  folder = fs.mkdtempSync(
    path.join(os.tmpdir(), "crypto-price-filler-test-key-"),
  );
  input = path.join(folder, "in.csv");
  fs.writeFileSync(
    input,
    "date (UTC),amount,description\n2025-06-15 12:30:00,10,one XTM reward\n",
  );
  takenKeyFile = path.join(folder, "taken-api-keys.json");
  await saveEncryptedKey(
    takenKeyFile,
    "coingecko",
    STAND_IN_GECKO_KEY,
    PASSWORD,
  );
  refusedKeyFile = path.join(folder, "refused-api-keys.json");
  await saveEncryptedKey(refusedKeyFile, "coingecko", "refused-key", PASSWORD);
});

afterAll(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

/**
 * Runs the command line over the row, reading the key file given, with
 * `typed` on its stdin.
 *
 * @param {string} keyFile - The key file, which need not exist
 * @param {string} typed - What is typed at the prompts
 * @param {string} [kept=''] - The password kept in `API_KEYS_PASSWORD`; none when empty
 * @returns {{status: number, stdout: string, stderr: string, asked: string[], written: boolean}} How it ended, what it printed, the urls it asked for, and whether it wrote the output
 */
function runReading(keyFile, typed, kept = "") {
  runs += 1;
  const output = path.join(folder, `out-${runs}.csv`);
  const askedPath = path.join(folder, `asked-${runs}.json`);
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      PRELOAD_URL,
      COMMAND_LINE,
      "--token=xtm",
      `--input=${input}`,
      `--output=${output}`,
    ],
    {
      cwd: FILLER_DIR,
      env: {
        ...process.env,
        NODE_ENV: "test",
        API_KEYS_FILE_PATH: keyFile,
        API_KEYS_PASSWORD: kept,
        STAND_IN_ASKED: askedPath,
      },
      input: typed,
      encoding: "utf8",
      timeout: KEY_RUN_TIMEOUT_MS,
    },
  );
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    asked: fs.existsSync(askedPath)
      ? JSON.parse(fs.readFileSync(askedPath, "utf8"))
      : [],
    written: fs.existsSync(output),
  };
}

describe("the command line and the saved CoinGecko api key", () => {
  it(
    "asks for the password, has CoinGecko check the key, then prices the rows",
    () => {
      const run = runReading(takenKeyFile, `${PASSWORD}\n`);
      expect(run.status).toBe(0);
      expect(run.stderr).toContain(
        `Password for the api keys in ${takenKeyFile}: `,
      );
      expect(run.stderr).not.toContain(PASSWORD);
      expect(run.asked.filter((url) => url.endsWith("/ping"))).toEqual([
        "https://api.coingecko.com/api/v3/ping",
      ]);
      expect(run.written).toBe(true);
    },
    KEY_RUN_TIMEOUT_MS,
  );

  it(
    "stops before pricing, with exit code 1, when the password does not open the key",
    () => {
      const run = runReading(takenKeyFile, "wrong\n");
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(
        /Could not open the CoinGecko api key saved in .*taken-api-keys\.json with the password typed: The password does not open/,
      );
      expect(run.asked).toEqual([]);
      expect(run.written).toBe(false);
    },
    KEY_RUN_TIMEOUT_MS,
  );

  it(
    "stops before pricing, with exit code 1, when CoinGecko refuses the key",
    () => {
      const run = runReading(refusedKeyFile, `${PASSWORD}\n`);
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(
        /CoinGecko refused the api key saved in .*refused-api-keys\.json\. Save a new one, in the project's top folder: npm run api-keys -- set coingecko/,
      );
      expect(run.asked).toEqual(["https://api.coingecko.com/api/v3/ping"]);
      expect(run.written).toBe(false);
    },
    KEY_RUN_TIMEOUT_MS,
  );

  it(
    "opens the key with the password in API_KEYS_PASSWORD, asking for none",
    () => {
      const run = runReading(takenKeyFile, "", PASSWORD);
      expect(run.status).toBe(0);
      expect(run.stderr).not.toContain("Password");
      expect(run.asked.filter((url) => url.endsWith("/ping"))).toEqual([
        "https://api.coingecko.com/api/v3/ping",
      ]);
      expect(run.written).toBe(true);
    },
    KEY_RUN_TIMEOUT_MS,
  );

  it(
    "asks no password, and asks CoinGecko about no key, when none is saved",
    () => {
      const run = runReading(path.join(folder, "no-such-api-keys.json"), "");
      expect(run.status).toBe(0);
      expect(run.stderr).not.toContain("Password");
      expect(run.asked.some((url) => url.endsWith("/ping"))).toBe(false);
      expect(run.written).toBe(true);
    },
    KEY_RUN_TIMEOUT_MS,
  );
});
