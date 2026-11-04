// Workspace entries differ between PC tabs and the Mobile drawer.
export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      entrance:
        "Files・Git・Boardの入口はopenWorkspaceViewを使ってください。PCはタブまたは＋、Mobileはドロワーから開きます。新しいTerminalはterminal/scenario.mjsのcreateを使ってください。",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type !== "MemberExpression" ||
          !["click", "tap"].includes(node.callee.property.name) ||
          !node.arguments[0]
        )
          return;
        if (
          context.sourceCode
            .getText(node.arguments[0])
            .includes("sidebar-open-")
        )
          context.report({ node, messageId: "entrance" });
      },
    };
  },
};
