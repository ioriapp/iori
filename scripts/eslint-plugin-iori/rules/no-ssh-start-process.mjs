export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      persistent:
        "SSH終了後も動くWindowsプロセスはnative/processes.mjsのstartWindowsProcessを使ってください。Start-ProcessはSSH session終了時に止まります。同期の-Waitは使用できます。",
    },
  },
  create(context) {
    const remoteCalls = new Set();
    return {
      ImportDeclaration(node) {
        if (!node.source.value.endsWith("/remote.mjs")) return;
        for (const specifier of node.specifiers)
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.name === "windows"
          )
            remoteCalls.add(specifier.local.name);
      },
      CallExpression(node) {
        if (
          node.callee.type !== "Identifier" ||
          !remoteCalls.has(node.callee.name)
        )
          return;
        const argument = node.arguments[0];
        const command =
          argument?.type === "TemplateLiteral"
            ? argument.quasis
                .map((part) => part.value.cooked ?? part.value.raw)
                .join(" ")
            : argument?.type === "Literal" && typeof argument.value === "string"
              ? argument.value
              : "";
        // Only SSH commands are checked: Terminal input and desktop-session launchers have different lifetimes.
        for (const match of command.matchAll(/\bStart-Process\b([^;\r\n]*)/giu))
          if (!/\s-Wait\b/iu.test(match[1])) {
            context.report({ node, messageId: "persistent" });
            return;
          }
      },
    };
  },
};
