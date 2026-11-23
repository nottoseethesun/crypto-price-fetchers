/**
 * An ESLint rule that refuses output given a name that may hold a secret:
 * an api key, a password, a private key, a mnemonic or seed phrase, a
 * secret or a signing key. LP Ranger's rule of the same name, with api
 * keys added, and with every way the four repos print: `console` and
 * Apps Script's `Logger`, a stream's `write`, and `say`, `tell` and
 * `logv`, whether called alone or as a method.
 * @module eslint-rules/no-secret-logging
 *
 * A string literal passes, since it holds no secret's value. The rule
 * looks at the names, of variables and of a member's object and
 * property, in an argument and in these parts of it: the expressions of
 * a template literal, either side of `+`, `??`, `||` and `&&`, either
 * result of `?:`, a call and its arguments, an object's values, an
 * array's elements, a spread, an `await` and an optional chain. The
 * security pass, `eslint-security.config.js`, runs it.
 *
 * pulsechain-analytics, pulsechain-validator-analytics and
 * x1-validator-analytics run it too, from this repo:
 * `crypto-price-fetchers/eslint-rules/no-secret-logging`.
 */

/** The names that may hold a secret. */
const SENSITIVE =
  /api.?key|private.?key|mnemonic|seed.?phrase|password|secret|signing.?key/i;

/**
 * The parts of a syntax node in which a name that may hold a secret is
 * looked for, by the node's type.
 */
const PARTS = {
  MemberExpression: (node) => [node.property, node.object],
  TemplateLiteral: (node) => node.expressions,
  BinaryExpression: (node) => [node.left, node.right],
  LogicalExpression: (node) => [node.left, node.right],
  ConditionalExpression: (node) => [node.consequent, node.alternate],
  CallExpression: (node) => [node.callee, ...node.arguments],
  ObjectExpression: (node) =>
    node.properties.map((part) =>
      part.type === "SpreadElement" ? part : part.value,
    ),
  ArrayExpression: (node) => node.elements,
  SpreadElement: (node) => [node.argument],
  AwaitExpression: (node) => [node.argument],
  ChainExpression: (node) => [node.expression],
};

/**
 * Says whether an argument names something that may hold a secret, in
 * itself or in the parts of it `PARTS` names.
 *
 * @param {?Object} node - The argument's syntax node, or a part of it
 * @returns {boolean} Whether it does
 */
function isSensitive(node) {
  if (node?.type === "Identifier") return SENSITIVE.test(node.name);
  if (!Object.hasOwn(PARTS, node?.type ?? "")) return false;
  return PARTS[node.type](node).some(isSensitive);
}

/** The objects whose every method prints. */
const PRINTING_OBJECTS = ["console", "Logger"];

/** The functions, and methods, that print. */
const PRINTING_NAMES = ["say", "tell", "logv"];

/**
 * Says whether a call prints: a method of `console` or of Apps Script's
 * `Logger`, a `write`, or `say`, `tell` or `logv`.
 *
 * @param {Object} callee - The call's callee
 * @returns {boolean} Whether it prints
 */
function prints(callee) {
  if (callee.type === "Identifier") return PRINTING_NAMES.includes(callee.name);
  if (callee.type !== "MemberExpression") return false;
  if (
    callee.object.type === "Identifier" &&
    PRINTING_OBJECTS.includes(callee.object.name)
  )
    return true;
  return ["write", ...PRINTING_NAMES].includes(callee.property.name);
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
