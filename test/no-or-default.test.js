/**
 * Tests for `eslint-rules/no-or-default.js`, the lint's rule against a
 * default made with `||`, run by ESLint's own RuleTester on Node's test
 * runner.
 * @module test/no-or-default.test
 */

import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import noOrDefault from "../eslint-rules/no-or-default.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

/** The error each refused default gives. */
const REFUSED = [{ messageId: "orDefault" }];

new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
}).run("no-or-default", noOrDefault, {
  valid: [
    'const name = config.name ?? "unnamed";',
    "if (a || b) run();",
    "while (queue.length > 0 || pending) step();",
    "const label = full || short ? full : short;",
    "const none = !(a || b);",
    "if ((a || b) && c) run();",
    "const either = a === 1 || b === 2;",
    "const known = isSensitive(left) || isSensitive(right);",
    "const listed = seen.has(file) || seen.has(alias);",
    "const fits = /^0x/.test(id) || /^[0-9]+$/.test(id);",
    "const any = total > 0 || !empty;",
    "const flag = options.verbose || process.env.VERBOSE === '1';",
    "holdsKeys ||= Object.keys(values).length > 0;",
    "const done = ready || false;",
  ],
  invalid: [
    { code: 'const name = config.name || "unnamed";', errors: REFUSED },
    { code: "const total = (totals[address] || 0) + amount;", errors: REFUSED },
    { code: "const pool = given || tokenAddress;", errors: REFUSED },
    { code: "const list = response.items || [];", errors: REFUSED },
    { code: "use(options.output || input);", errors: REFUSED },
    {
      code: "const order = a.time - b.time || a.id.localeCompare(b.id);",
      errors: REFUSED,
    },
    { code: "count ||= 1;", errors: REFUSED },
    { code: "const value = (a || b) && c;", errors: REFUSED },
    { code: "const id = config.id || null;", errors: REFUSED },
  ],
});
