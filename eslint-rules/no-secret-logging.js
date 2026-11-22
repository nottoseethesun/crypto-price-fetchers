/**
 * An ESLint rule that refuses output given a name that may hold a secret:
 * an api key, a password, a private key, a mnemonic or seed phrase, a
 * secret or a signing key. LP Ranger's rule of the same name, with api
 * keys added, and with every way this repo's code prints: `console`, a
 * stream's `write` and `say`.
 * @module eslint-rules/no-secret-logging
 *
 * A string literal passes, since it holds no secret's value. The rule
 * looks at the names, of variables and properties, in each argument,
 * in the expressions of a template literal, and in a string built with
 * `+`. The security pass, `eslint-security.config.js`, runs it.
 *
 * pulsechain-analytics, pulsechain-validator-analytics and
 * x1-validator-analytics run it too, from this repo:
 * `crypto-price-fetchers/eslint-rules/no-secret-logging`.
 */

/** The names that may hold a secret. */
const SENSITIVE =
  /api.?key|private.?key|mnemonic|seed.?phrase|password|secret|signing.?key/i;

/**
 * Says whether an argument names something that may hold a secret.
 *
 * @param {Object} node - The argument's syntax node
 * @returns {boolean} Whether it does
 */
function isSensitive(node) {
  if (node.type === "Identifier") return SENSITIVE.test(node.name);
  if (node.type === "MemberExpression") return isSensitive(node.property);
  if (node.type === "TemplateLiteral")
    return node.expressions.some(isSensitive);
  if (node.type === "BinaryExpression")
    return isSensitive(node.left) || isSensitive(node.right);
  return false;
}

/**
 * Says whether a call prints: a `console` method, a `write`, or `say`.
 *
 * @param {Object} callee - The call's callee
 * @returns {boolean} Whether it prints
 */
function prints(callee) {
  if (callee.type === "Identifier") return callee.name === "say";
  if (callee.type !== "MemberExpression") return false;
  if (callee.object.type === "Identifier" && callee.object.name === "console")
    return true;
  return ["write", "say"].includes(callee.property.name);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow printing names that may hold a secret",
    },
    schema: [],
    messages: {
      secret:
        'Do not print "{{name}}": it may hold an api key, a password or another secret.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!prints(node.callee)) return;
        for (const argument of node.arguments) {
          if (argument.type === "Literal" || !isSensitive(argument)) continue;
          context.report({
            node: argument,
            messageId: "secret",
            data: { name: context.sourceCode.getText(argument) },
          });
        }
      },
    };
  },
};
