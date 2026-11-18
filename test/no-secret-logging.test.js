/**
 * Tests for `eslint-rules/no-secret-logging.js`, the security lint's rule
 * against printing a name that may hold a secret, run by ESLint's own
 * RuleTester on Node's test runner.
 * @module test/no-secret-logging.test
 */

import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import noSecretLogging from "../eslint-rules/no-secret-logging.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

/** The error each refused print gives. */
const REFUSED = [{ messageId: "secret" }];

new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
}).run("no-secret-logging", noSecretLogging, {
  valid: [
    'console.log("Loading the api key...")',
    "console.error(error.message)",
    "say(`The ${service.name} api key is saved, encrypted, in ${file}.`)",
    "io.stdout.write(`  ${service.name}  ${state}\\n`)",
    "fs.writeFileSync(file, apiKeys)",
    "keyRefused(apiKey)",
  ],
  invalid: [
    { code: "console.log(apiKey)", errors: REFUSED },
    { code: "console.error(config.API_KEY)", errors: REFUSED },
    {
      code: "console.info(`The key is ${keys.dextools_api_key}`)",
      errors: REFUSED,
    },
    { code: 'console.warn("password: " + password)', errors: REFUSED },
    { code: "say(privateKey)", errors: REFUSED },
    { code: "spec.say(`${mnemonic}`)", errors: REFUSED },
    { code: "process.stderr.write(secret)", errors: REFUSED },
    { code: "io.stdout.write(`${seedPhrase}\\n`)", errors: REFUSED },
    {
      code: "console.log(signingKey, apiKeyFile)",
      errors: [{ messageId: "secret" }, { messageId: "secret" }],
    },
  ],
});
