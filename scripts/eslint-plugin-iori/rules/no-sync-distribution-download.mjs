export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      asyncDownload:
        "同じNodeで配布元を動かすrunnerのcurl/wgetは、verification/connection/build.mjsの非同期command helperを使ってください。同期SSHは配布サーバーを停止させます。",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const name = node.callee.name;
        const source = context.sourceCode.getText(node);
        if (
          (name === "linux" ||
            (name === "execFileSync" && node.arguments[0]?.value === "ssh")) &&
          /\b(?:curl|wget)\b/.test(source)
        )
          context.report({ node, messageId: "asyncDownload" });
      },
    };
  },
};
