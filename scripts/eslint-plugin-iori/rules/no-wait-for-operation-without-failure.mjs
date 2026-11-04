export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      failure:
        "waitForOperationには4つ目の引数として失敗の観測（failed）を渡してください。渡し忘れると実機の操作列がその場で止まります。",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const name =
          node.callee.type === "Identifier"
            ? node.callee.name
            : node.callee.type === "MemberExpression"
              ? node.callee.property.name
              : undefined;
        if (name !== "waitForOperation") return;
        if (
          node.arguments.some((argument) => argument.type === "SpreadElement")
        )
          return;
        if (node.arguments.length < 4)
          context.report({ node, messageId: "failure" });
      },
    };
  },
};
