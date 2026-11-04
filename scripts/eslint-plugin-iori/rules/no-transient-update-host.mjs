export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      persistent:
        "Hostの更新検証は、停止しても定義が残るunitファイルを使ってください。systemd-runの一時unitはstop後にstartできません。",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        // This rule is enabled only for update verification. Terminal daemon
        // helpers and production updater workers legitimately use transient units.
        const command = node.arguments[0];
        if (command?.type !== "Literal" || command.value !== "systemd-run")
          return;
        const source = context.sourceCode.getText(node);
        if (source.includes("Type=notify"))
          context.report({ node, messageId: "persistent" });
      },
    };
  },
};
