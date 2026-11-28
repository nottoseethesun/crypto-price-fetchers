/**
 * Helpers for the tests of the key manager (`api-key-store/key-manager.js`):
 * a project folder of the test's own, stand-in services, a stand-in
 * prompt, and a run of the manager that keeps what it prints.
 * @module test/helpers/key-manager-runs
 *
 * A project folder is a temp folder (`temp-folders.js`), removed with the
 * others. A run's visible question, the one for the order of priority,
 * answers from the test, or fails the test when it is asked with no answer
 * given, so no run reads the terminal.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runKeyManager } from "../../api-key-store/index.js";
import { capturedOutput } from "./captured-output.js";
import { makeTempFolder } from "./temp-folders.js";

/**
 * Makes a project folder whose `config.json` lists the services given.
 *
 * @param {Array<string>|undefined} apiKeys - The services, or undefined for a config.json without the list
 * @returns {string} The folder
 */
export function makeProject(apiKeys) {
  const folder = makeTempFolder("key-manager");
  fs.writeFileSync(
    path.join(folder, "config.json"),
    JSON.stringify(apiKeys === undefined ? {} : { apiKeys }),
  );
  return folder;
}

/**
 * Stand-in services, alpha, beta and gamma, whose checks take any key but
 * those named `refused-key`.
 *
 * @returns {Object<string, Object>} The services, by name
 */
export function standInServices() {
  const check = async (key) => (key === "refused-key" ? "invalid" : "valid");
  return {
    alpha: { service: "alpha", name: "Alpha", check },
    beta: { service: "beta", name: "Beta", check },
    gamma: { service: "gamma", name: "Gamma", check },
  };
}

/**
 * Answers the prompts in turn from `answers`, keeping what was asked.
 *
 * @param {Array<?string>} answers - What is typed at each prompt; null for an input that ended
 * @returns {function(string): Promise<?string>} The stand-in prompt, with the prompts in `asked`
 */
export function typing(answers) {
  const queue = [...answers];
  const ask = async (prompt) => {
    ask.asked.push(prompt);
    if (queue.length === 0) assert.fail(`Asked ${prompt} with no answer left`);
    return queue.shift();
  };
  ask.asked = [];
  return ask;
}

/**
 * Runs the manager on a project, keeping what it prints.
 *
 * @param {string[]} args - The arguments after the file's name
 * @param {{projectTop: string, known: (Object<string, Object>|undefined)}} project - The project (`runKeyManager`)
 * @param {Object} deps - The prompts, the environment and the checks' options (`runKeyManager`), stdout and stderr aside; with no `askLine`, the question of the order of priority fails the test
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>} What it did
 */
export async function runManager(args, project, deps) {
  const stdout = capturedOutput();
  const stderr = capturedOutput();
  const exitCode = await runKeyManager(
    ["node", "bin/end-user/manage-api-keys.js", ...args],
    project,
    { askLine: typing([]), ...deps, stdout, stderr },
  );
  return { exitCode, stdout: stdout.text, stderr: stderr.text };
}
