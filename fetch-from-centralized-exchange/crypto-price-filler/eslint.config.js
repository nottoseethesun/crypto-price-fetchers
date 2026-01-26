/**
 * ESLint Configuration for Crypto Price Filler
 * @file eslint.config.js
 * @description Flat config for ESLint 9+. Enforces cyclomatic complexity <= 17
 * and standard JavaScript best practices.
 */

import js from '@eslint/js';

export default [
  // Apply recommended rules as base
  js.configs.recommended,

  // Custom configuration for source JS files
  {
    files: ['**/*.js'],
    ignores: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        Response: 'readonly'
      }
    },
    rules: {
      // Cyclomatic complexity - max 17
      'complexity': ['error', 17],

      // Relax some rules for this project's style
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],

      // Allow console (CLI tool)
      'no-console': 'off'
    }
  },

  // Configuration for test files
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        require: 'readonly',
        // Vitest globals
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        test: 'readonly'
      }
    },
    rules: {
      // Cyclomatic complexity - max 17
      'complexity': ['error', 17],

      // Relax unused vars for tests (common to import but not use all)
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],

      // Allow console in tests
      'no-console': 'off'
    }
  },

  // Ignore patterns - files that use import attributes (with { type: 'json' })
  // ESLint parser doesn't yet support import attributes syntax
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      '*.json',
      // Files using import attributes syntax (not yet supported by ESLint parser)
      'sources/coingecko.js',
      'sources/coinpaprika.js',
      'sources/mexc.js',
      'sources/utils/btc.js',
      'utils/fetch.js'
    ]
  }
];
