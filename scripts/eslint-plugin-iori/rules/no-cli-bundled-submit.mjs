function variable(context, node) {
  for (
    let scope = context.sourceCode.getScope(node);
    scope;
    scope = scope.upper
  ) {
    const value = scope.set.get(node.name);
    if (value) return value;
  }
}
function fragments(context, node, seen = new Set()) {
  if (!node || seen.has(node)) return [];
  seen.add(node);
  if (node.type === "Literal" && typeof node.value === "string")
    return [node.value];
  if (node.type === "TemplateLiteral")
    return node.quasis.map((part) => part.value.cooked ?? part.value.raw);
  if (node.type === "BinaryExpression" && node.operator === "+")
    return [
      ...fragments(context, node.left, seen),
      ...fragments(context, node.right, seen),
    ];
  if (node.type === "Identifier")
    return fragments(
      context,
      variable(context, node)?.defs.find((def) => def.type === "Variable")?.node
        .init,
      seen,
    );
  return [];
}
function expression(context, node, seen = new Set()) {
  if (!node || seen.has(node)) return node;
  seen.add(node);
  if (node.type !== "Identifier") return node;
  return expression(
    context,
    variable(context, node)?.defs.find((def) => def.type === "Variable")?.node
      .init,
    seen,
  );
}
export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      bundled: "CLIの文字入力と送信キーは submitToCli で分けて送ってください。",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "Identifier") return;
        const imported = variable(context, callee)?.defs.find(
          (def) => def.type === "ImportBinding",
        )?.node.imported?.name;
        const name = imported ?? callee.name;
        if (!["typeTerminal", "submitToCli"].includes(name)) return;
        const input = node.arguments[1];
        const resolved = expression(context, input);
        const parts = fragments(context, input);
        if (!parts.some((part) => /[\r\n]/u.test(part))) return;
        if (
          name === "submitToCli" ||
          parts.some((part) => /[^\r\n]/u.test(part)) ||
          resolved?.type === "BinaryExpression" ||
          (resolved?.type === "TemplateLiteral" && resolved.expressions.length)
        )
          context.report({ node: input, messageId: "bundled" });
      },
    };
  },
};
