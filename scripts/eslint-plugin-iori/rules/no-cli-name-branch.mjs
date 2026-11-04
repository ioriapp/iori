// Stop: a known CLI name is compared, switched, included, or used as a static
// key outside apps/host/src/cli/<adapter>/. Pass: merely declaring/displaying
// a CLI name, ordinary IDs, and non-CLI settings.
const cliNames = new Set([
  "antigravity",
  "claude",
  "claude-code",
  "codex",
  "cursor",
  "opencode",
  "pi",
]);
const comparisonOperators = new Set(["==", "===", "!=", "!==", "in"]);
const settingIdName = /setting[-_]?id/iu;

function unwrap(node) {
  while (
    node &&
    [
      "ChainExpression",
      "TSAsExpression",
      "TSNonNullExpression",
      "TSTypeAssertion",
    ].includes(node.type)
  )
    node = node.expression;
  return node;
}

function staticString(node) {
  node = unwrap(node);
  return node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : undefined;
}

function memberName(node) {
  node = unwrap(node);
  if (node?.type !== "MemberExpression") return undefined;
  return node.computed ? staticString(node.property) : node.property?.name;
}

function identifierName(node) {
  node = unwrap(node);
  return node?.type === "Identifier" ? node.name : undefined;
}

function isSettingId(node) {
  const name = identifierName(node) ?? memberName(node);
  return typeof name === "string" && settingIdName.test(name);
}

function isCliName(node) {
  const value = staticString(node);
  return typeof value === "string" && cliNames.has(value.toLowerCase());
}

function isProviderSettings(node) {
  node = unwrap(node);
  if (!node) return false;
  if (node.type === "Identifier") return node.name === "providerSettings";
  if (node.type === "MemberExpression")
    return (
      memberName(node) === "providerSettings" || isProviderSettings(node.object)
    );
  return false;
}

function propertyKey(property) {
  return property.computed
    ? staticString(property.key)
    : (staticString(property.key) ?? property.key?.name);
}

function hasCliNamedProperty(node) {
  return node.properties.some((property) => {
    if (property.type !== "Property") return false;
    const key = propertyKey(property);
    if (typeof key !== "string") return false;
    const name = key.toLowerCase();
    return name !== "cursor" && name !== "pi" && cliNames.has(name);
  });
}

function isMapWithCliKey(node) {
  if (
    node.callee?.type !== "Identifier" ||
    node.callee.name !== "Map" ||
    node.arguments[0]?.type !== "ArrayExpression"
  )
    return false;
  return node.arguments[0].elements.some(
    (entry) =>
      entry?.type === "ArrayExpression" && isCliName(entry.elements[0]),
  );
}

function isAdapterFile(filename) {
  const path = filename.replaceAll("\\", "/");
  return /(?:^|\/)apps\/host\/src\/cli\/[^/]+\//u.test(path);
}

function containsCliString(node) {
  node = unwrap(node);
  if (cliNames.has(String(staticString(node) ?? "").toLowerCase())) return true;
  if (node?.type === "ArrayExpression")
    return node.elements.some(containsCliString);
  if (node?.type === "ConditionalExpression")
    return (
      containsCliString(node.consequent) || containsCliString(node.alternate)
    );
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "CLI固有の分岐を共通層へ置かない" },
    schema: [],
    messages: {
      cliBranch:
        "CLI名やProvider設定IDによる分岐はapps/host/src/cli/<adapter>/へ置いてください。",
    },
  },
  create(context) {
    if (isAdapterFile(context.filename)) return {};
    const report = (node) => context.report({ node, messageId: "cliBranch" });

    return {
      BinaryExpression(node) {
        if (!comparisonOperators.has(node.operator)) return;
        const leftString = staticString(node.left);
        const rightString = staticString(node.right);
        const comparesCliName =
          node.operator !== "in" &&
          (isCliName(node.left) ||
            isCliName(node.right) ||
            (isSettingId(node.left) && rightString !== undefined) ||
            (isSettingId(node.right) && leftString !== undefined));
        const looksUpCliKey =
          node.operator === "in" &&
          (isCliName(node.left) ||
            (isSettingId(node.left) && isProviderSettings(node.right)));
        if (comparesCliName || looksUpCliKey) report(node);
      },
      SwitchCase(node) {
        const value = staticString(node.test);
        const discriminant = node.parent?.discriminant;
        if (
          value !== undefined &&
          (cliNames.has(value.toLowerCase()) || isSettingId(discriminant))
        )
          report(node);
      },
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (
          callee?.type !== "MemberExpression" ||
          ![
            "includes",
            "indexOf",
            "lastIndexOf",
            "startsWith",
            "endsWith",
          ].includes(memberName(callee))
        )
          return;
        const array = unwrap(callee.object);
        if (
          (containsCliString(array) && node.arguments.length > 0) ||
          node.arguments.some(containsCliString)
        )
          report(node);
      },
      MemberExpression(node) {
        if (
          (isProviderSettings(node.object) &&
            (!node.computed || staticString(node.property) !== undefined)) ||
          (node.computed && isCliName(node.property))
        )
          report(node);
      },
      ObjectExpression(node) {
        if (hasCliNamedProperty(node)) report(node);
      },
      NewExpression(node) {
        if (isMapWithCliKey(node)) report(node);
      },
      Property(node) {
        if (node.parent?.type !== "ObjectExpression") return;
        const key = propertyKey(node);
        const parentKey =
          node.parent.parent?.type === "Property"
            ? node.parent.parent.computed
              ? staticString(node.parent.parent.key)
              : node.parent.parent.key?.name
            : undefined;
        if (
          (key === "settingId" && containsCliString(node.value)) ||
          (parentKey === "providerSettings" && !node.computed)
        )
          report(node);
      },
    };
  },
};
