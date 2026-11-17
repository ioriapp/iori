const command = /(?:^|[\s;&|/])monkey(?=$|[\s;&|])/u;

export default {
  meta: {
    type: "problem",
    docs: { description: "Androidの起動にmonkeyを使わない" },
    schema: [],
    messages: { monkey: "Androidの起動には am start を使ってください。" },
  },
  create(context) {
    const check = (node, value) => {
      if (command.test(value)) context.report({ node, messageId: "monkey" });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};
