/**
 * An ESLint rule that refuses a default made with `||`, as LP Ranger's
 * rules ask: `x || fallback` takes the fallback for every falsy value, so
 * it hides a 0, a 0n, an empty string or a false that `x` holds on
 * purpose. A default for a missing value is written with `??`, which takes
 * it for undefined and null alone, or with an explicit check.
 * @module eslint-rules/no-or-default
 *
 * What: the rule reports `a || b` and `a ||= b` whose value is kept, as a
 * default is, unless `b` is a boolean. A boolean here is a comparison
 * (`===`, `<`, `in`, `instanceof` and the rest), a negation, `true` or
 * `false`, a call of a function or method whose name says it answers yes
 * or no (`has`, `includes`, `test`, `some`, `every`, `startsWith`,
 * `endsWith`, `canParse`, or a name that starts with `is`, `has`, `can`,
 * `should`, `was` or `does`), or an `&&` or `||` of booleans. Such an `||` is
 * boolean logic, not a default. An `||` whose value only decides a
 * branch, as the test of an `if`, a loop or a `? :`, under a `!`, or
 * inside another `&&` or `||` that does, is passed too: no value of it is
 * kept.
 *
 * Fit: `eslint.config.js` runs it in `npm run lint`, over the Sheets
 * scripts too; the projects that install this repo run it from here, as
 * `crypto-price-fetchers/eslint-rules/no-or-default`.
 */

/** The operators whose result is a boolean. */
const COMPARISONS = new Set([
  "===",
  "!==",
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "in",
  "instanceof",
]);

/** The names of functions and methods that answer yes or no. */
const ANSWERS_YES_OR_NO =
  /^(?:is|has|can|should|was|does)[A-Z_]|^(?:has|includes|test|some|every|startsWith|endsWith|canParse|hasOwn)$/;

/**
 * The name a call is made by: a function's, or a method's.
 *
 * @param {Object} callee - The call's callee
 * @returns {string} The name, or an empty string for any other callee
 */
function nameOf(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && !callee.computed)
    return callee.property.name;
  return "";
}

/**
 * Whether an expression is a boolean, as the module's header says.
 *
 * @param {Object} node - The expression's syntax node
 * @returns {boolean} Whether it is
 */
function isBoolean(node) {
  switch (node.type) {
    case "BinaryExpression":
      return COMPARISONS.has(node.operator);
    case "UnaryExpression":
      return node.operator === "!";
    case "Literal":
      return typeof node.value === "boolean";
    case "LogicalExpression":
      return (
        node.operator !== "??" && isBoolean(node.left) && isBoolean(node.right)
      );
    case "CallExpression":
      return ANSWERS_YES_OR_NO.test(nameOf(node.callee));
    default:
      return false;
  }
}

/**
 * Whether an expression's value only decides a branch.
 *
 * @param {Object} node - The expression's syntax node
 * @returns {boolean} Whether it does
 */
function decidesOnly(node) {
  const parent = node.parent;
  if (parent === undefined || parent === null) return false;
  const isTestOf = [
    "IfStatement",
    "WhileStatement",
    "DoWhileStatement",
    "ForStatement",
    "ConditionalExpression",
  ].includes(parent.type);
  if (isTestOf) return parent.test === node;
  if (parent.type === "UnaryExpression") return parent.operator === "!";
  if (parent.type === "LogicalExpression" && parent.operator !== "??")
    return decidesOnly(parent);
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow defaults made with ||, which take the fallback for every falsy value",
    },
    schema: [],
    messages: {
      orDefault:
        "Write this default with ?? or an explicit check: || takes {{fallback}} for every falsy value, 0, an empty string and false among them.",
    },
  },
  create(context) {
    /**
     * Reports an `||` or `||=` whose fallback is no boolean.
     *
     * @param {Object} node - The expression
     */
    const report = (node) =>
      context.report({
        node,
        messageId: "orDefault",
        data: { fallback: context.sourceCode.getText(node.right) },
      });
    return {
      LogicalExpression(node) {
        if (node.operator !== "||") return;
        if (isBoolean(node.right) || decidesOnly(node)) return;
        report(node);
      },
      AssignmentExpression(node) {
        if (node.operator === "||=" && !isBoolean(node.right)) report(node);
      },
    };
  },
};
