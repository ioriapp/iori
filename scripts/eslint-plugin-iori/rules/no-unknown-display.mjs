// Stop: visible JSX text/expressions, display attributes, or strings in JS/TS
// dictionaries under i18n/locales/translations/dictionaries/messages/strings
// containing missing-state text or a dash-only placeholder. Pass: internal state.
const displayAttributes = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "caption",
  "description",
  "detail",
  "emptylabel",
  "emptymessage",
  "error",
  "fallback",
  "helpertext",
  "label",
  "loadingtext",
  "message",
  "notice",
  "placeholder",
  "prompt",
  "statuslabel",
  "statustext",
  "summary",
  "text",
  "title",
  "tooltip",
]);

const missingStatus =
  /(?:\bunknown\b|\bunavailable\b|\bn\s*\/\s*a\b|未取得|未確認|不明)/iu;
const positionIndependentMissingStatus =
  /(?:\bn\s*\/\s*a\b|未取得|未確認|不明)/iu;
const dashOnly = /^\s*(?:—|–|-)\s*$/u;
const sourceExtension = /\.(?:[cm]?[jt]sx?)$/iu;

function normalizePath(filename) {
  return filename.replaceAll("\\", "/");
}

function isDictionaryFile(filename) {
  const path = normalizePath(filename);
  return /(?:^|\/)(?:i18n|locales?|translations?|dictionaries|messages|strings)(?:\/|\.|$)/iu.test(
    path,
  );
}

function isForbidden(text) {
  return missingStatus.test(text) || dashOnly.test(text);
}

function readStaticText(node, visit) {
  if (!node) return;
  if (node.type === "Literal" && typeof node.value === "string") {
    visit(node, node.value);
    return;
  }
  if (node.type === "TemplateLiteral") {
    for (const part of node.quasis)
      visit(part, part.value.cooked ?? part.value.raw);
    return;
  }
  if (node.type === "JSXExpressionContainer")
    readStaticText(node.expression, visit);
  else if (node.type === "ConditionalExpression") {
    readStaticText(node.consequent, visit);
    readStaticText(node.alternate, visit);
  } else if (node.type === "BinaryExpression" && node.operator === "+") {
    readStaticText(node.left, visit);
    readStaticText(node.right, visit);
  } else if (node.type === "LogicalExpression") {
    readStaticText(node.left, visit);
    readStaticText(node.right, visit);
  }
}

function displayAttribute(name) {
  const normalized = name.toLowerCase();
  return (
    displayAttributes.has(normalized) ||
    (normalized.startsWith("aria-") &&
      /(?:label|description|placeholder|valuetext|roledescription)$/u.test(
        normalized,
      ))
  );
}

function displayFunctionName(node) {
  if (node.id?.type === "Identifier") return node.id.name;
  const declaration = node.parent;
  return declaration?.type === "VariableDeclarator" &&
    declaration.id?.type === "Identifier"
    ? declaration.id.name
    : undefined;
}

function isDisplayFunction(node) {
  const name = displayFunctionName(node);
  return (
    typeof name === "string" &&
    /(?:label|text|message|display|description|title)$/iu.test(name)
  );
}

function isDisplayFunctionReturn(node) {
  let parent = node.parent;
  while (
    parent &&
    !/^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/u.test(
      parent.type,
    )
  )
    parent = parent.parent;
  return parent ? isDisplayFunction(parent) : false;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "利用者向け表示へ状態不明の代替文言を出さない" },
    schema: [],
    messages: {
      unknownDisplay:
        "状態不明を示す代替文言を利用者向け表示へ出さず、確認できた内容を表示してください。",
    },
  },
  create(context) {
    const dictionary = isDictionaryFile(context.filename);
    const sourceFile = sourceExtension.test(context.filename);
    const reported = new WeakSet();
    const report = (node, text) => {
      if (isForbidden(text) && !reported.has(node)) {
        reported.add(node);
        context.report({ node, messageId: "unknownDisplay" });
      }
    };

    return {
      JSXText(node) {
        report(node, node.value);
      },
      JSXExpressionContainer(node) {
        if (
          node.parent?.type === "JSXElement" ||
          node.parent?.type === "JSXFragment"
        )
          readStaticText(node, (sourceNode, text) => report(sourceNode, text));
      },
      JSXAttribute(node) {
        const name = node.name?.name;
        const isInputValue =
          name?.toLowerCase() === "value" &&
          node.parent?.name?.name?.toLowerCase() === "input";
        if (
          typeof name !== "string" ||
          (!displayAttribute(name) && !isInputValue)
        )
          return;
        readStaticText(node.value, (sourceNode, text) =>
          report(sourceNode, text),
        );
      },
      ReturnStatement(node) {
        if (!isDisplayFunctionReturn(node)) return;
        readStaticText(node.argument, (sourceNode, text) =>
          report(sourceNode, text),
        );
      },
      "ArrowFunctionExpression:exit"(node) {
        if (!isDisplayFunction(node) || node.body.type === "BlockStatement")
          return;
        readStaticText(node.body, (sourceNode, text) =>
          report(sourceNode, text),
        );
      },
      ...(sourceFile
        ? {
            Literal(node) {
              if (
                typeof node.value === "string" &&
                (positionIndependentMissingStatus.test(node.value) ||
                  (dictionary && isForbidden(node.value)))
              )
                report(node, node.value);
            },
            TemplateLiteral(node) {
              for (const part of node.quasis)
                if (
                  positionIndependentMissingStatus.test(
                    part.value.cooked ?? part.value.raw,
                  ) ||
                  (dictionary &&
                    isForbidden(part.value.cooked ?? part.value.raw))
                )
                  report(part, part.value.cooked ?? part.value.raw);
            },
          }
        : {}),
    };
  },
};
