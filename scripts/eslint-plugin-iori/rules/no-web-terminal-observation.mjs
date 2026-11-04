const read =
  /(?:\.__e2eTerminal\b|\[\s*["']__e2eTerminal["']\s*\])(?!\s*=(?!=))/u;

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      webOnly:
        "実機でも動く検証でWeb専用の__e2eTerminalを読まないでください。実PTYが受け取った内容を観測してください。",
    },
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    if (
      !/(?:^|\/)(?:e2e|verification)\//u.test(filename) ||
      /\/(?:e2e|verification)\/web\//u.test(filename)
    )
      return {};
    const inspect = (node, source) => {
      if (read.test(source)) context.report({ node, messageId: "webOnly" });
    };
    return {
      MemberExpression(node) {
        const name = node.computed ? node.property.value : node.property.name;
        if (
          name !== "__e2eTerminal" ||
          (node.parent.type === "AssignmentExpression" &&
            node.parent.left === node)
        )
          return;
        context.report({ node, messageId: "webOnly" });
      },
      Literal(node) {
        if (typeof node.value === "string") inspect(node, node.value);
      },
      TemplateElement(node) {
        inspect(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};
