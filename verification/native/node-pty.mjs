import { local as verificationLocal } from "./local.mjs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { windowsPnpm } from "./remote.mjs";

export async function checkWindowsNodePty(root) {
  const require = createRequire(path.resolve(root, "package.json"));
  const utilities = require.resolve("node-pty/lib/utils");
  // Use node-pty's own loader so the check follows its build/prebuild priority.
  const loaded = require(utilities).loadNativeModule("conpty");
  const native = createRequire(utilities).resolve(loaded.dir + "/conpty.node");
  const exports = Object.keys(loaded.module);
  const missing = [
    "terminateJob",
    "listJobProcessIds",
    "assignCurrentProcessToJob",
  ].filter((name) => typeof loaded.module[name] !== "function");
  if (missing.length)
    throw new Error(
      `Windows node-ptyの静的検査に失敗しました: ${native} にpatchのexportsがありません: ${missing.join(", ")}`,
    );
  const consoleList = require(utilities).loadNativeModule(
    "conpty_console_list",
  );
  const consoleListNative = createRequire(utilities).resolve(
    consoleList.dir + "/conpty_console_list.node",
  );
  if (typeof consoleList.module.getConsoleProcessList !== "function")
    throw new Error(
      `Windows node-ptyの静的検査に失敗しました: ${consoleListNative} にgetConsoleProcessListがありません`,
    );
  const result = {
    native,
    exports,
    sha256: createHash("sha256")
      .update(await readFile(native))
      .digest("hex"),
  };
  console.log(JSON.stringify({ nodePty: result }));
  return result;
}

async function rebuildWindowsNodePty() {
  const python =
    verificationLocal.windows.home +
    "\\iori-e0\\tools\\python-3.14.10\\tools\\python.exe";
  if (!existsSync(python))
    throw new Error(
      `${verificationLocal.windows.host} に node-gyp 用の Python がありません: ${python}`,
    );
  // Explicit rebuild reruns the lifecycle even if pnpm restored a side-effects
  // cache. prebuild.js removes upstream prebuilds with this environment setting;
  // node-gyp rebuild and post-install.js then build and arrange patched sources.
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [windowsPnpm, "--filter", "@iori/host", "rebuild", "node-pty"],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          npm_config_build_from_source: "true",
          npm_config_python: python,
        },
      },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`Windows node-ptyのsource buildが失敗しました: ${code}`),
          ),
    );
  });
  await checkWindowsNodePty("apps/host");
}

if (process.argv[1] === import.meta.filename) await rebuildWindowsNodePty();
