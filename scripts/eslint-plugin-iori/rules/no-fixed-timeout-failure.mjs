// Stop: fixed process-command timeouts, AbortSignal.timeout(), a Promise.race
// containing a timeout or failure action, or a timer callback that throws,
// rejects, aborts, or marks failure. Pass: timers used only for ordinary
// scheduling and polling.
const failureCall =
  /^(?:reject|fail|markFailed|setError|setFailure|setFailed)$/iu;
const failingValue = /^(?:failed|failure|error|timeout|timed-out)$/iu;
const childProcessCall = /^(?:execFile|spawn|spawnSync|exec)$/u;

function calleeName(callee) {
  return callee.type === "MemberExpression"
    ? callee.computed
      ? callee.property.value
      : callee.property.name
    : callee.name;
}

function clearsError(node) {
  if (node.arguments.length === 0) return true;
  if (node.arguments.length !== 1) return false;
  const value = node.arguments[0];
  return (
    (value.type === "Literal" && value.value === null) ||
    (value.type === "Identifier" && value.name === "undefined")
  );
}

function isFunction(node) {
  return (
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionExpression"
  );
}

function isFailureAssignment(node) {
  if (node.type !== "AssignmentExpression") return false;
  const left =
    node.left.type === "MemberExpression"
      ? node.left.computed
        ? node.left.property.value
        : node.left.property.name
      : node.left.name;
  const right =
    node.right.type === "Literal" ? String(node.right.value).toLowerCase() : "";
  return (
    (typeof left === "string" &&
      /(?:fail|failure|error|timeout)/iu.test(left)) ||
    (/(?:^|\.)(?:state|status)$/iu.test(String(left)) &&
      failingValue.test(right))
  );
}

function hasFailureAction(node) {
  if (!node) return false;
  if (node.type === "ThrowStatement") return true;
  if (isFailureAssignment(node)) return true;
  if (node.type === "CallExpression") {
    const name = calleeName(node.callee);
    const isErrorClear = name === "setError" && clearsError(node);
    if (
      (typeof name === "string" &&
        ((failureCall.test(name) && !isErrorClear) || name === "abort")) ||
      (node.callee.type === "MemberExpression" &&
        node.callee.object.name === "Promise" &&
        node.callee.property.name === "reject")
    )
      return true;
    if (
      typeof name === "string" &&
      /^set/iu.test(name) &&
      node.arguments.some((argument) => {
        return (
          argument.type === "Literal" &&
          failingValue.test(String(argument.value))
        );
      })
    )
      return true;
  }
  for (const [key, value] of Object.entries(node)) {
    if (["parent", "loc", "range", "tokens", "comments"].includes(key))
      continue;
    if (Array.isArray(value)) {
      if (
        value.some(
          (child) =>
            child && typeof child.type === "string" && hasFailureAction(child),
        )
      )
        return true;
    } else if (
      value &&
      typeof value.type === "string" &&
      hasFailureAction(value)
    )
      return true;
  }
  return false;
}

function hasChildProcessTimeout(node) {
  if (!childProcessCall.test(String(calleeName(node.callee)))) return false;
  return node.arguments.some(
    (argument) =>
      argument.type === "ObjectExpression" &&
      argument.properties.some((property) => {
        if (property.type !== "Property") return false;
        const key = property.computed
          ? property.key.value
          : property.key.type === "Identifier"
            ? property.key.name
            : property.key.value;
        return key === "timeout";
      }),
  );
}

function containsTimeout(node) {
  if (!node) return false;
  if (
    node.type === "CallExpression" &&
    ((node.callee.type === "Identifier" && node.callee.name === "setTimeout") ||
      (node.callee.type === "MemberExpression" &&
        node.callee.object.name === "globalThis" &&
        node.callee.property.name === "setTimeout"))
  )
    return true;
  for (const [key, value] of Object.entries(node)) {
    if (["parent", "loc", "range", "tokens", "comments"].includes(key))
      continue;
    if (Array.isArray(value)) {
      if (
        value.some(
          (child) =>
            child && typeof child.type === "string" && containsTimeout(child),
        )
      )
        return true;
    } else if (
      value &&
      typeof value.type === "string" &&
      containsTimeout(value)
    )
      return true;
  }
  return false;
}

function insidePromiseRace(node) {
  for (let parent = node.parent; parent; parent = parent.parent)
    if (
      parent.type === "CallExpression" &&
      parent.callee.type === "MemberExpression" &&
      parent.callee.object.name === "Promise" &&
      parent.callee.property.name === "race"
    )
      return true;
  return false;
}

function timerCallback(node) {
  return node.arguments[0];
}

export default {
  meta: {
    type: "problem",
    docs: { description: "固定時間切れを通常操作の失敗判定へ使わない" },
    schema: [],
    messages: {
      timeoutFailure:
        "固定時間切れで操作を失敗と判定せず、説明付きeslint-disableは資源上限に限ってください。",
    },
  },
  create(context) {
    const report = (node) =>
      context.report({ node, messageId: "timeoutFailure" });

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (hasChildProcessTimeout(node)) {
          report(node);
          return;
        }

        if (
          callee.type === "MemberExpression" &&
          callee.object.name === "AbortSignal" &&
          callee.property.name === "timeout"
        ) {
          report(node);
          return;
        }

        if (
          callee.type === "MemberExpression" &&
          callee.object.name === "Promise" &&
          callee.property.name === "race" &&
          node.arguments.some(
            (argument) =>
              containsTimeout(argument) || hasFailureAction(argument),
          )
        ) {
          report(node);
          return;
        }

        const isTimer =
          (callee.type === "Identifier" && callee.name === "setTimeout") ||
          (callee.type === "MemberExpression" &&
            callee.object.name === "globalThis" &&
            callee.property.name === "setTimeout");
        if (!isTimer) return;

        const callback = timerCallback(node);
        if (
          !insidePromiseRace(node) &&
          isFunction(callback) &&
          hasFailureAction(callback.body)
        )
          report(node);
        else if (
          !insidePromiseRace(node) &&
          callback?.type === "Identifier" &&
          /^(?:reject|fail|markFailed|setFailure|setError|setFailed)$/iu.test(
            callback.name,
          )
        )
          report(node);
      },
    };
  },
};
