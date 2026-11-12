/**
 * ESLint configuration for the repo's root package: the runner that runs a
 * Sheets script under Node, the Node versions of the Sheets scripts, and
 * their tests.
 * @file eslint.config.js
 *
 * The limits are LP Ranger's: no function above cyclomatic complexity 17,
 * no file above 500 lines of code, and `===` always. crypto-price-filler,
 * in its own folder, is a package of its own with its own configuration
 * and its own lint run, so this one leaves it to that.
 */

import js from '@eslint/js';

/** The Node globals the code uses. */
const NODE_GLOBALS = {
  AbortSignal: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  Headers: 'readonly',
  process: 'readonly',
  Response: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly'
};

export default [
  { ignores: ['node_modules/**', 'fetch-from-centralized-exchange/crypto-price-filler/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: NODE_GLOBALS },
    rules: {
      complexity: ['error', 17],
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
      eqeqeq: ['error', 'always'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
    }
  }
];
