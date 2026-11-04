import { readFile, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
const read = (file) => readFile(file, "utf8");

const roots = ["src/terminal/daemon/entry.js"];
export async function daemonClosure(bundle) {
  const files = new Set(),
    packages = new Map();
  async function dependency(specifier, from) {
    if (specifier.startsWith("node:")) return;
    if (specifier.startsWith(".")) {
      await source(
        path.posix.normalize(
          path.posix.join(path.posix.dirname(from), specifier),
        ),
      );
      return;
    }
    const name = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    if (packages.has(name)) return;
    const require = createRequire(path.resolve(bundle, from));
    const location = require.resolve
      .paths(name)
      .map((p) => path.join(p, name))
      .find((p) => existsSync(path.join(p, "package.json")));
    const root = await realpath(location);
    const manifest = JSON.parse(await read(path.join(root, "package.json")));
    packages.set(name, manifest.version);
    for (const child of Object.keys(manifest.dependencies ?? {}))
      await dependency(
        child,
        path.posix.join("node_modules", name, "package.json"),
      );
  }
  async function source(file) {
    if (files.has(file)) return;
    files.add(file);
    const js = await read(path.join(bundle, file));
    const ast = ts.createSourceFile(
        file,
        js,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      ),
      imports = [];
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        imports.push(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const callee = node.expression;
        if (
          callee.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(callee) && callee.text === "require") ||
          (ts.isCallExpression(callee) &&
            callee.expression.getText(ast) === "createRequire")
        )
          imports.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    for (const specifier of imports) await dependency(specifier, file);
  }
  for (const root of roots) await source(root);
  return {
    sources: [...files].sort(),
    packages: Object.fromEntries([...packages].sort()),
  };
}
