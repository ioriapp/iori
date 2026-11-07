import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../..");
const client = resolve(root, "apps/client");
const requireClient = createRequire(resolve(client, "package.json"));
const { createServer } = await import(
  pathToFileURL(requireClient.resolve("vite"))
);
const { default: react } = await import(
  pathToFileURL(requireClient.resolve("@vitejs/plugin-react"))
);
const { default: tailwind } = await import(
  pathToFileURL(requireClient.resolve("@tailwindcss/vite"))
);
export const defaultCatalog =
  "/root/projects/iori/.local/ui-sample/v16-host-setup/src/host-setup-states.ts";

export async function readCatalog(path = defaultCatalog) {
  const code = ts.transpileModule(await readFile(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  }).outputText;
  return (
    await import(
      `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
    )
  ).allStates;
}

// 製品を編集せず、開発サーバー内だけで非公開の初期状態を渡す。
// この入口は状態の描画用。処理の実行や状態遷移の試験には使わない。
function stateDataPlugin(catalog) {
  const stateFiles = new Set(
    [
      "host-setup/HostSetupDialog.tsx",
      "ClientInitialization.tsx",
      "IntegrationsSettings.tsx",
      "GitSettings.tsx",
      "host-setup/SshSetup.tsx",
      "components/flow/Progress.tsx",
      "components/flow/Notice.tsx",
    ].map((path) => resolve(client, "src", path)),
  );
  const adapters = new Set(
    ["native.ts", "connection.ts", "updates/host-controller.ts"].map((path) =>
      resolve(client, "src", path),
    ),
  );
  return {
    name: "iori-ui-state-data",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "virtual:ui-state-catalog") return "\0ui-state-catalog";
      if (
        adapters.has(source) ||
        (importer &&
          source.startsWith(".") &&
          [source, `${source}.ts`].some((path) =>
            adapters.has(resolve(importer.split("?")[0], "..", path)),
          ))
      )
        return resolve(import.meta.dirname, "adapters.ts");
    },
    async load(id) {
      if (id === "\0ui-state-catalog")
        return `export const allStates = ${JSON.stringify(await readCatalog(catalog))};`;
    },
    transform(code, id) {
      if (!stateFiles.has(id)) return;
      const file = ts.createSourceFile(
        id,
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const module = basename(id, ".tsx");
      const edits = [];
      const visit = (node) => {
        if (
          ts.isVariableDeclaration(node) &&
          node.initializer &&
          ts.isCallExpression(node.initializer)
        ) {
          const call = node.initializer;
          if (["useState", "useRef"].includes(call.expression.getText(file))) {
            const name = ts.isArrayBindingPattern(node.name)
              ? node.name.elements[0].getText(file)
              : node.name.getText(file);
            const value = call.arguments[0];
            const start = value ? value.getStart(file) : call.end - 1;
            const end = value ? value.end : start;
            edits.push({
              start,
              end,
              text: `__uiInitial(${JSON.stringify(module)}, ${JSON.stringify(name)}, ${value ? value.getText(file) : "undefined"})`,
            });
          }
        }
        if (
          [
            "HostSetupDialog",
            "SshSetup",
            "IntegrationsSettings",
            "GitSettings",
          ].includes(module) &&
          ts.isCallExpression(node) &&
          node.expression.getText(file) === "useEffect"
        )
          edits.push({
            start: node.expression.getStart(file),
            end: node.expression.end,
            text: "__uiEffect",
          });
        ts.forEachChild(node, visit);
      };
      visit(file);
      for (const edit of edits.sort((a, b) => b.start - a.start))
        code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
      return {
        code: `import { initialValue as __uiInitial, staticEffect as __uiEffect } from ${JSON.stringify(`/@fs/${resolve(import.meta.dirname, "runtime.ts")}`)};\n${code}`,
        map: null,
      };
    },
  };
}

export async function createStateServer({
  catalog = defaultCatalog,
  port = 0,
} = {}) {
  const server = await createServer({
    configFile: false,
    root: import.meta.dirname,
    plugins: [stateDataPlugin(catalog), react(), tailwind()],
    resolve: {
      alias: {
        "@": resolve(client, "src"),
        react: resolve(client, "node_modules/react"),
        "react-dom": resolve(client, "node_modules/react-dom"),
        "lucide-react": resolve(client, "node_modules/lucide-react"),
      },
      dedupe: ["react", "react-dom"],
    },
    server: { host: "127.0.0.1", port, fs: { allow: [root] } },
  });
  await server.listen();
  return server;
}

if (process.argv[1] === import.meta.filename) {
  const server = await createStateServer({
    port: Number(process.env.PORT ?? 5194),
    catalog: process.env.IORI_UI_STATE_CATALOG,
  });
  server.printUrls();
}
