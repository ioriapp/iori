// Stop: verification code creates a link or a copy of Claude Code's credential
// file or of its whole settings directory, e.g. to share the Owner's login with
// a test home.
// Pass: reading, checking that the file is absent, and every other path.
const credentialsFile = /\.credentials\.json/u;
// `.claude` as a path component, but not a `.claude.json`-like file name.
const settingsDirectory = /\.claude(?![.\w-])/u;
const linkOrCopyCall = new Set([
  "symlink",
  "symlinkSync",
  "link",
  "linkSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
]);
const linkOrCopyCommand = [
  /\bNew-Item\b[^\r\n;]*-ItemType\s+(?:HardLink|SymbolicLink|Junction)\b/iu,
  /\bCopy-Item\b/iu,
  /(?:^|[;&|(]|\s)(?:cp|ln)\s/u,
];

const mentionsClaudeState = (text) =>
  credentialsFile.test(text) || settingsDirectory.test(text);

/** Every string an argument can carry, so `join(original, ".claude")` counts. */
function textOf(node, depth = 0) {
  if (!node || depth > 8) return "";
  switch (node.type) {
    case "Literal":
      return typeof node.value === "string" ? node.value : "";
    case "TemplateLiteral":
      return node.quasis
        .map((part) => part.value.cooked ?? part.value.raw)
        .join("\u0000");
    case "CallExpression":
      return node.arguments
        .map((item) => textOf(item, depth + 1))
        .join("\u0000");
    case "ArrayExpression":
      return node.elements
        .map((item) => textOf(item, depth + 1))
        .join("\u0000");
    case "ObjectExpression":
      return node.properties
        .map((item) =>
          item.type === "Property" ? textOf(item.value, depth + 1) : "",
        )
        .join("\u0000");
    case "BinaryExpression":
      return (
        textOf(node.left, depth + 1) + "\u0000" + textOf(node.right, depth + 1)
      );
    case "ConditionalExpression":
      return (
        textOf(node.consequent, depth + 1) +
        "\u0000" +
        textOf(node.alternate, depth + 1)
      );
    case "LogicalExpression":
      return (
        textOf(node.left, depth + 1) + "\u0000" + textOf(node.right, depth + 1)
      );
    case "SpreadElement":
      return textOf(node.argument, depth + 1);
    default:
      return "";
  }
}

function calleeName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && !callee.computed)
    return callee.property.name;
  return undefined;
}

/** A shell script is a list of statements: a link elsewhere in the script does
 * not make a settings-directory creation a link of that directory. */
const statements = (text) => text.split(/[;\r\n]+/u);

/** The template as it reaches the shell, with interpolated values in place. */
function templateText(node) {
  let text = "";
  node.quasis.forEach((part, index) => {
    text += part.value.cooked ?? part.value.raw;
    if (index < node.expressions.length)
      text += textOf(node.expressions[index]);
  });
  return text;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Claude Codeの認証ファイルと設定フォルダーを試験へリンク・コピーしない",
    },
    schema: [],
    messages: {
      linkedCredentials:
        "Claude Codeは認証ファイルをrenameで置き換えるため、symlink・リンク・コピーでは新しいrefresh tokenを試験側へ書き、元のログインが使えなくなります。試験は `claude setup-token` のトークンを `/root/.config/claude-token` から読み、CLIへは環境変数 `CLAUDE_CODE_OAUTH_TOKEN` だけで渡してください（verification/cli/claude-token.mjs）。",
    },
  },
  create(context) {
    const report = (node) =>
      context.report({ node, messageId: "linkedCredentials" });
    const checkScript = (node, text) => {
      if (
        statements(text).some(
          (line) =>
            mentionsClaudeState(line) &&
            linkOrCopyCommand.some((pattern) => pattern.test(line)),
        )
      )
        report(node);
    };
    return {
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (!linkOrCopyCall.has(name)) return;
        const text = node.arguments.map((item) => textOf(item)).join("\u0000");
        if (mentionsClaudeState(text)) report(node);
      },
      TemplateLiteral(node) {
        checkScript(node, templateText(node));
      },
      Literal(node) {
        if (typeof node.value === "string") checkScript(node, node.value);
      },
    };
  },
};
