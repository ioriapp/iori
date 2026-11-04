// Check direct marker commands paired with an output wait in the same block.
export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      echo: "待つ印が入力のechoに一致します。terminal/scenario.mjsのsayで印を分割して出力してください。",
    },
  },
  create(context) {
    const names = new Map();
    const inputs = [];
    const waits = [];
    const block = (node) => {
      while (node.parent && node.type !== "BlockStatement") node = node.parent;
      return node;
    };
    return {
      ImportDeclaration(node) {
        if (!node.source.value.endsWith("/terminal/scenario.mjs")) return;
        for (const specifier of node.specifiers)
          if (specifier.type === "ImportSpecifier")
            names.set(specifier.local.name, specifier.imported.name);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier") return;
        const name = names.get(node.callee.name);
        const argument = node.arguments[1];
        if (name === "observed" && argument?.type === "Literal")
          waits.push({ node, marker: argument.value, block: block(node) });
        if (name !== "typeTerminal") return;
        const parts =
          argument?.type === "TemplateLiteral"
            ? argument.quasis.map((part) => part.value.cooked ?? part.value.raw)
            : argument?.type === "Literal" && typeof argument.value === "string"
              ? [argument.value]
              : [];
        for (const part of parts)
          for (const match of part.matchAll(
            /\bWrite-Output\s+(['"])([^'"\r\n]+)\1/giu,
          ))
            inputs.push({ node, marker: match[2], block: block(node) });
      },
      "Program:exit"() {
        for (const input of inputs)
          if (
            waits.some(
              (wait) =>
                wait.block === input.block &&
                wait.marker === input.marker &&
                wait.node.range[0] > input.node.range[0],
            )
          )
            context.report({ node: input.node, messageId: "echo" });
      },
    };
  },
};
