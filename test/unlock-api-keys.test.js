/**
 * Tests for `bin/unlock-api-keys.sh`, the script a terminal sources to keep
 * the password of the project's api keys in `API_KEYS_PASSWORD`.
 * @module test/unlock-api-keys.test
 *
 * Each test sources the real script in bash, with the password typed on
 * its stdin, then has bash say whether `API_KEYS_PASSWORD` holds it, and
 * end with the status the script returned. The
 * script checks the password with the real `bin/end-user/manage-api-keys.js`, against a
 * key file in a temp folder of the test's own, which `API_KEYS_FILE_PATH`
 * names, removed afterwards. The same tests run in zsh only when the
 * environment variable `UNLOCK_SCRIPT_IN_ZSH` is 1, as docs/engineering.md's
 * "In zsh, by Hand" sets it for their run by hand, on a computer with zsh:
 * the automated tests rely on Node and on programs every computer they run
 * on has, bash, git and the programs a shell script calls, such as
 * sh, cat, dirname and basename, and zsh is not on every such computer.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveEncryptedKey } from "../api-key-store/index.js";
import { makeTempFolder, removeTempFolders } from "./helpers/temp-folders.js";

/** The script. */
const SCRIPT = fileURLToPath(
  new URL("../bin/unlock-api-keys.sh", import.meta.url),
);

/**
 * What a shell runs: source the script, then say whether
 * `API_KEYS_PASSWORD` holds the password expected, without printing it,
 * and end with the status the script returned.
 */
const SOURCE_AND_TELL =
  'source "$1"; returned=$?; if [ "${API_KEYS_PASSWORD+set}" = set ] && [ "$API_KEYS_PASSWORD" = "$2" ]; then echo kept; else echo "not kept"; fi; exit "$returned"';

/**
 * Says whether a shell is installed.
 *
 * @param {string} shell - Its name
 * @returns {boolean} Whether it is
 */
function installed(shell) {
  return spawnSync(shell, ["-c", "exit 0"]).status === 0;
}

/**
 * Says why a shell's tests are skipped, or that they run: bash's always
 * run, and zsh's only when `UNLOCK_SCRIPT_IN_ZSH` is 1; each only where
 * its shell is installed.
 *
 * @param {string} shell - Its name
 * @returns {string|false} The reason, or false when they run
 */
function skipReason(shell) {
  if (shell === "zsh" && process.env.UNLOCK_SCRIPT_IN_ZSH !== "1")
    return "run by hand, with UNLOCK_SCRIPT_IN_ZSH=1, as docs/engineering.md's In zsh, by Hand says";
  return installed(shell) ? false : `${shell} is not installed`;
}

for (const shell of ["bash", "zsh"]) {
  describe(
    `unlock-api-keys.sh in ${shell}`,
    { skip: skipReason(shell) },
    () => {
      let folder;
      let keyFile;

      before(async () => {
        folder = makeTempFolder("unlock");
        keyFile = path.join(folder, "api-keys.json");
        await saveEncryptedKey(
          keyFile,
          "coingecko",
          "gecko-key",
          "right-password",
        );
      });

      after(removeTempFolders);

      /**
       * Sources the script with `typed` on stdin, the key file given, and no
       * password kept before.
       *
       * @param {string} typed - What is typed
       * @param {string} expected - The password `API_KEYS_PASSWORD` should hold
       * @param {string} [file=keyFile] - The key file
       * @returns {import('node:child_process').SpawnSyncReturns<string>} How it ended
       */
      function source(typed, expected, file = keyFile) {
        const env = { ...process.env, API_KEYS_FILE_PATH: file };
        delete env.API_KEYS_PASSWORD;
        return spawnSync(
          shell,
          ["-c", SOURCE_AND_TELL, shell, SCRIPT, expected],
          {
            env,
            input: typed,
            encoding: "utf8",
            timeout: 30000,
          },
        );
      }

      it("keeps a password that opens the keys saved, saying so, and shows nothing of it", () => {
        const run = source("right-password\n", "right-password");
        assert.equal(run.status, 0);
        assert.equal(
          run.stdout,
          "The password opens the api key saved in " + keyFile + ".\nkept\n",
        );
        assert.match(
          run.stderr,
          /^Password for the api keys of [^:\n]+: \nAPI_KEYS_PASSWORD is set for this terminal\.\n$/,
        );
        assert.ok(
          !`${run.stdout}${run.stderr}`.includes("right-password"),
          "the password was shown",
        );
      });

      it("keeps no password that does not open them", () => {
        const run = source("wrong-password\n", "wrong-password");
        assert.equal(run.status, 1);
        assert.equal(run.stdout, "not kept\n");
        assert.match(
          run.stderr,
          /That password does not open the api keys saved in .*\nThe password is not kept\.\n$/,
        );
      });

      it("keeps no empty password", () => {
        const run = source("\n", "");
        assert.equal(run.status, 1);
        assert.equal(run.stdout, "not kept\n");
        assert.match(run.stderr, /No password was typed, so none is kept\.\n$/);
      });

      it("keeps any password when no key is saved yet, for the manager to save keys with", () => {
        const run = source(
          "first-password\n",
          "first-password",
          path.join(folder, "no-keys-yet.json"),
        );
        assert.equal(run.status, 0);
        assert.match(
          run.stdout,
          /^No api key is saved in .* yet; npm run api-keys saves them with this password\.\nkept\n$/,
        );
      });

      it("answers --help and -h, sourced, with its help, asking nothing and keeping no password", () => {
        const env = { ...process.env, API_KEYS_FILE_PATH: keyFile };
        delete env.API_KEYS_PASSWORD;
        for (const flag of ["--help", "-h"]) {
          const run = spawnSync(
            shell,
            [
              "-c",
              'source "$1" "$2"; echo "returned $? ${API_KEYS_PASSWORD+kept}"',
              shell,
              SCRIPT,
              flag,
            ],
            {
              env,
              input: "right-password\n",
              encoding: "utf8",
              timeout: 30000,
            },
          );
          assert.match(
            run.stdout,
            /^Usage: source \.\/bin\/unlock-api-keys\.sh \[options\]\n[^]*\nreturned 0 \n$/,
          );
          assert.equal(run.stderr, "");
        }
      });

      it("run as a program, says to source it, and stops with exit code 1", () => {
        const run = spawnSync(shell, [SCRIPT], {
          input: "right-password\n",
          encoding: "utf8",
          timeout: 30000,
        });
        assert.equal(run.status, 1);
        assert.match(
          run.stderr,
          /^Run it with source, so it can keep the password in this terminal:\n {2}source .*unlock-api-keys\.sh\n$/,
        );
      });
    },
  );
}
