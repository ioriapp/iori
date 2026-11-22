import { readFile, glob } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
const read = (file) => readFile(file, "utf8");

const roots = ["src/terminal/daemon/entry.js"];
// Native filenames are selected from the package's own load locations. Keep
// the platform-independent recipe in the fingerprint along with its build inputs.
export const nativeAssets = {
  "@iori/terminal-native": ["iori_terminal_native.node", "iori{,.exe}"],
  "node-pty": [
    "{build/Release,prebuilds/PLATFORM-ARCH}/{pty.node,spawn-helper,conpty.node,conpty_console_list.node,winpty.dll,winpty-agent.exe,conpty/conpty.dll,conpty/OpenConsole.exe}",
  ],
};
export async function daemonClosure(bundle) {
  const files = new Set(["package.json"]),
    packages = new Map(),
    nativeFiles = new Set([
      process.platform === "win32" ? "runtime/node.exe" : "runtime/node",
    ]);
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
    const prefix = `node_modules/${name}`;
    const root = path.join(bundle, prefix);
    const manifest = JSON.parse(await read(path.join(root, "package.json")));
    files.add(`${prefix}/package.json`);
    packages.set(name, manifest.version ?? "workspace");
    const require = createRequire(path.resolve(bundle, from));
    const entry = path
      .relative(bundle, require.resolve(specifier))
      .split(path.sep)
      .join("/");
    if (name === "@iori/protocol") {
      // Follow only the standalone snapshot restore helper.
      await source(entry);
      return;
    }
    files.add(entry);
    if (name === "node-pty") {
      for await (const js of glob("lib/**/*.js", {
        cwd: root,
        exclude: ["**/*.test.js"],
      }))
        files.add(`${prefix}/${js.split(path.sep).join("/")}`);
    } else if (!(name in nativeAssets) && !name.startsWith("@xterm/")) {
      throw new Error(`No terminal daemon runtime file selection for ${name}`);
    }
    for (const pattern of nativeAssets[name] ?? []) {
      const target = pattern.replace(
        "PLATFORM-ARCH",
        `${process.platform}-${process.arch}`,
      );
      for await (const file of glob(target, { cwd: root }))
        nativeFiles.add(`${prefix}/${file.split(path.sep).join("/")}`);
    }
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
    files: [...files].sort(),
    nativeFiles: [...nativeFiles].sort(),
    packages: Object.fromEntries([...packages].sort()),
  };
}
