/**
 * ESLint's security pass, apart from the main lint: LP Ranger's. It runs
 * eslint-plugin-security, for code patterns open to attack;
 * eslint-plugin-no-secrets, for strings that look like keys; and
 * `no-secret-logging` (`eslint-rules/`), which refuses printing a name
 * that may hold a key or a password. `npm run audit:security` runs it,
 * with `--max-warnings 0`, so a warning fails too.
 * @file eslint-security.config.js
 *
 * As in LP Ranger, two rules are off: `detect-non-literal-fs-filename`,
 * since every path here is built from the repo's own folders, a temp
 * folder or a path its owner names, and `detect-object-injection`, which
 * flags every `object[name]`.
 *
 * no-secrets passes the strings that hold `PUBLIC_ADDRESSES`: addresses
 * on X1, written in base58, which look random to it but are public.
 *
 * It passes over `dist/`, as the main lint does: the build step writes
 * the file to paste there when there is no clipboard, and that file holds
 * the api keys and the compiled code of DEX Screener, zod and lodash,
 * which are not this repo's.
 */

import noSecrets from "eslint-plugin-no-secrets";
import security from "eslint-plugin-security";
import noSecretLogging from "./eslint-rules/no-secret-logging.js";

/**
 * Public addresses on X1 that the code names: the pool x1.ninja's check
 * of a key asks about, and the pools in the Sheets script's examples.
 */
const PUBLIC_ADDRESSES = [
  "CAJeVEoSm1QQZccnCqYu9cnNF7TTD2fcUA3E5HQoxRvR",
  "DQ6sApYPMJ8LwpvyUjthL7amykNBJ3fx5jZi2koN7vHb",
  "6oTV8xMRP6w592xK79Untuq8vqCttFDHZnw3bN5Suxry",
];

export default [
  { ignores: ["**/node_modules/**", "**/coverage/**", "dist/**"] },
  {
    files: ["**/*.js", "**/*.gs"],
    plugins: {
      security,
      "no-secrets": noSecrets,
      local: { rules: { "no-secret-logging": noSecretLogging } },
    },
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: {
      "security/detect-unsafe-regex": "warn",
      "security/detect-non-literal-regexp": "warn",
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-eval-with-expression": "warn",
      "security/detect-no-csrf-before-method-override": "warn",
      "security/detect-possible-timing-attacks": "warn",
      "security/detect-pseudoRandomBytes": "warn",
      "security/detect-child-process": "warn",
      "security/detect-new-buffer": "warn",
      "security/detect-disable-mustache-escape": "warn",
      "security/detect-non-literal-require": "warn",
      "security/detect-object-injection": "off",
      "no-secrets/no-secrets": [
        "warn",
        {
          tolerance: 4.5,
          additionalDelimiters: ["0x"],
          ignoreContent: PUBLIC_ADDRESSES,
        },
      ],
      "local/no-secret-logging": "warn",
    },
  },
  { files: ["**/*.gs"], languageOptions: { sourceType: "script" } },
];
