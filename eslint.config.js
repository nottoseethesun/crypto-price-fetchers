/**
 * ESLint's settings for crypto-price-fetchers, with LP Ranger's rules: no
 * function above cyclomatic complexity 17, no file above 500 lines of code,
 * no line above 80 characters but strings, urls and comments, `===` always,
 * no unused name, no comment that tells Prettier to skip code, no
 * `Math.random`, and no default made with `||` (`no-or-default`, in
 * `eslint-rules/`), which takes its fallback for every falsy value.
 * @file eslint.config.js
 *
 * Every JavaScript file in the repo is linted, crypto-price-filler's among
 * them, and so are the Sheets scripts, as the scripts they are:
 *
 * - The Node code, its tests and crypto-price-filler's are ES modules on
 *   Node, whose imports must resolve (`n/no-missing-import`).
 * - A Sheets script (`.gs`) is a plain script that Apps Script loads, with
 *   the Apps Script services as globals. Sheets calls its functions by
 *   name, so a function declared at its top is never unused, and no
 *   `'use strict'` is asked of it: the directive would change how the code
 *   the owner pastes into Apps Script runs.
 *
 * `build/`, where the build step writes the file it gives when there is no
 * clipboard, is not linted: git ignores it, and the file holds code that is
 * not this repo's.
 *
 * `npm run lint` runs it with `--max-warnings 0`, so a warning fails too.
 * The security rules are in `eslint-security.config.js`, which
 * `npm run audit:security` runs.
 */

import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import nPlugin from "eslint-plugin-n";
import globals from "globals";
import noOrDefault from "./eslint-rules/no-or-default.js";

/** The rules every file is held to: LP Ranger's. */
const SHARED_RULES = {
  ...js.configs.recommended.rules,
  complexity: ["error", { max: 17 }],
  "max-len": [
    "error",
    {
      code: 80,
      ignoreUrls: true,
      ignoreStrings: true,
      ignoreTemplateLiterals: true,
      ignoreRegExpLiterals: true,
      ignoreComments: true,
    },
  ],
  "max-lines": [
    "error",
    { max: 500, skipBlankLines: true, skipComments: true },
  ],
  "no-var": "error",
  "prefer-const": ["error", { destructuring: "all" }],
  eqeqeq: ["error", "always"],
  strict: ["error", "global"],
  "no-extend-native": "error",
  "no-unused-vars": [
    "error",
    {
      vars: "all",
      args: "after-used",
      argsIgnorePattern: "^_",
      caughtErrors: "all",
      caughtErrorsIgnorePattern: "^_",
    },
  ],
  "no-warning-comments": [
    "error",
    { terms: ["prettier-ignore"], location: "anywhere" },
  ],
  "local/no-or-default": "error",
  "no-restricted-syntax": [
    "error",
    {
      selector:
        'CallExpression[callee.object.name="Math"][callee.property.name="random"]',
      message:
        "Use crypto.randomBytes() instead of Math.random(): it is not cryptographically secure.",
    },
  ],
};

/** This repo's own rules, which every file is held to. */
const LOCAL_RULES = { rules: { "no-or-default": noOrDefault } };

/** The services Apps Script gives a Sheets script, as globals. */
const APPS_SCRIPT_GLOBALS = {
  CacheService: "readonly",
  HtmlService: "readonly",
  LockService: "readonly",
  Logger: "readonly",
  PropertiesService: "readonly",
  Session: "readonly",
  SpreadsheetApp: "readonly",
  UrlFetchApp: "readonly",
  Utilities: "readonly",
};

export default [
  { ignores: ["**/node_modules/**", "**/coverage/**", "build/**"] },
  {
    files: ["**/*.js"],
    plugins: { n: nPlugin, local: LOCAL_RULES },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: { ...SHARED_RULES, "n/no-missing-import": "error" },
  },
  {
    files: ["**/*.gs"],
    plugins: { local: LOCAL_RULES },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.es2021,
        console: "readonly",
        ...APPS_SCRIPT_GLOBALS,
      },
    },
    rules: {
      ...SHARED_RULES,
      strict: "off",
      "no-unused-vars": [
        "error",
        {
          vars: "local",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  prettierConfig,
  // eslint-config-prettier turns max-len off, as it turns off every rule of
  // form that Prettier sees to; the line length is LP Ranger's rule, and
  // Prettier leaves strings and comments as they are, so it is set again.
  { rules: { "max-len": SHARED_RULES["max-len"] } },
];
