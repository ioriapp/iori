// Stop: two revision/generation/offset/size/hash-like values are compared and
// their mismatch throws, rejects, returns failure, or sets failure state.
// Pass: ingress shape/range checks and comparisons without a failure branch.
const trackedName =
  /(?:revision|generation|offset|byteLength|epoch|seq(?:uence)?|hash|size|version)/iu;
const comparisonOperators = new Set(["==", "===", "!=", "!=="]);
const failureName =
  /^(?:reject|fail|throw|assert|ensure|invariant|mismatch|invalid)$/iu;

function comparisonName(node) {
  if (!node) return "";
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") {
    const property = node.computed ? node.property.value : node.property.name;
    return `${comparisonName(node.object)}.${String(property ?? "")}`;
  }
  if (node.type === "CallExpression" && node.callee.type === "Identifier")
    return node.callee.name;
  return "";
}

function isTrackedComparison(node) {
  return (
    node.type === "BinaryExpression" &&
    comparisonOperators.has(node.operator) &&
    trackedName.test(comparisonName(node.left)) &&
    trackedName.test(comparisonName(node.right))
  );
}

function unwrap(node) {
  return node?.type === "ChainExpression" || node?.type === "TSAsExpression"
    ? unwrap(node.expression)
    : node;
}

function hasFalseField(node) {
  node = unwrap(node);
  if (!node) return false;
  if (node.type === "ObjectExpression")
    return node.properties.some((property) => {
      if (property.type !== "Property") return false;
      const key = property.computed
        ? property.key.value
        : property.key.type === "Literal"
          ? property.key.value
          : property.key.name;
      const value = unwrap(property.value);
      return (
        /^(?:error|reason)$/iu.test(String(key)) ||
        (/^(?:ok|valid|success|accepted|matched)$/iu.test(String(key)) &&
          isFalseFieldValue(value)) ||
        (key === "status" &&
          value?.type === "Literal" &&
          /^(?:failed|failure|error|invalid|rejected)$/iu.test(
            String(value.value),
          ))
      );
    });
  return false;
}

function isFalseFieldValue(node) {
  node = unwrap(node);
  return (
    (node?.type === "Literal" && node.value === false) || hasFalseField(node)
  );
}

function isFailureCall(node) {
  if (node?.type !== "CallExpression") return false;
  const name =
    node.callee.type === "MemberExpression"
      ? node.callee.property.name
      : node.callee.name;
  return typeof name === "string" && failureName.test(name);
}

function isFailureResult(node) {
  node = unwrap(node);
  return (
    hasFalseField(node) ||
    isFailureCall(node) ||
    (node?.type === "ConditionalExpression" &&
      (isFailureResult(node.consequent) || isFailureResult(node.alternate)))
  );
}

function failureAction(node) {
  if (!node) return false;
  if (hasFalseField(node)) return true;
  if (node.type === "ThrowStatement") return true;
  if (node.type === "ReturnStatement") return isFailureResult(node.argument);
  if (node.type === "CallExpression") return isFailureCall(node);
  if (node.type === "ConditionalExpression")
    return isFailureResult(node.consequent) || isFailureResult(node.alternate);
  if (node.type === "AssignmentExpression") {
    const target = comparisonName(node.left);
    return (
      /(?:failed|failure|error|status|state)/iu.test(target) &&
      (hasFalseField(node.right) ||
        (node.right.type === "Literal" &&
          /^(?:failed|failure|error|invalid|rejected)$/iu.test(
            String(node.right.value),
          )))
    );
  }
  if (node.type === "BlockStatement") return node.body.some(failureAction);
  if (node.type === "ExpressionStatement")
    return failureAction(node.expression);
  return false;
}

function contains(node, target) {
  for (let current = target; current; current = current.parent)
    if (current === node) return true;
  return false;
}

function isMismatchSide(test, comparison, mismatchOnTrue = true) {
  test = unwrap(test);
  if (test === comparison) {
    const equality =
      comparison.operator === "===" || comparison.operator === "==";
    return equality ? !mismatchOnTrue : mismatchOnTrue;
  }
  if (test.type === "UnaryExpression" && test.operator === "!")
    return isMismatchSide(test.argument, comparison, !mismatchOnTrue);
  return undefined;
}

function failsOnMismatch(comparison) {
  for (let parent = comparison.parent; parent; parent = parent.parent) {
    if (parent.type === "IfStatement" && contains(parent.test, comparison)) {
      const mismatchOnTrue = isMismatchSide(parent.test, comparison);
      if (mismatchOnTrue === true && failureAction(parent.consequent))
        return true;
      if (mismatchOnTrue === false && failureAction(parent.alternate))
        return true;
      if (
        mismatchOnTrue === undefined &&
        (failureAction(parent.consequent) || failureAction(parent.alternate))
      )
        return true;
      return false;
    }
    if (
      parent.type === "ConditionalExpression" &&
      contains(parent.test, comparison)
    ) {
      const mismatchOnTrue = isMismatchSide(parent.test, comparison);
      if (mismatchOnTrue === true && failureAction(parent.consequent))
        return true;
      if (mismatchOnTrue === false && failureAction(parent.alternate))
        return true;
      if (
        mismatchOnTrue === undefined &&
        (failureAction(parent.consequent) || failureAction(parent.alternate))
      )
        return true;
      return false;
    }
    if (
      parent.type === "CallExpression" &&
      parent.arguments.includes(comparison) &&
      parent.callee.type === "Identifier" &&
      failureName.test(parent.callee.name)
    )
      return true;
    if (
      [
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression",
      ].includes(parent.type)
    )
      return false;
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "iori自身の値同士の不一致で正常読取を拒まない" },
    schema: [],
    messages: {
      storedValueMismatch:
        "保存済み・送出済み値の意味照合で読取を拒まず、外部入力の入口検査に限定してください。",
    },
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (isTrackedComparison(node) && failsOnMismatch(node))
          context.report({ node, messageId: "storedValueMismatch" });
      },
    };
  },
};
