import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
  chmod,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { daemonClosure } from "../terminal-daemon-files.mjs";
import { installedPackages, npmNotice } from "../licenses/npm.mjs";
import { cargoNotice } from "../licenses/cargo.mjs";

export async function buildHost(destination, runtime = process.execPath) {
  const nodeVersion = (await readFile(".node-version", "utf8")).trim();
  if (runtime && process.versions.node !== nodeVersion)
    throw new Error(`Node ${nodeVersion}で配布物を作ってください`);
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.join(destination, "runtime"), { recursive: true });
  if (runtime)
    await cp(
      runtime,
      path.join(
        destination,
        "runtime",
        process.platform === "win32" ? "node.exe" : "node",
      ),
    );
  await cp("LICENSE", path.join(destination, "LICENSE"));
  if (runtime) {
    try {
      await cp(
        path.join("scripts/licenses/sources/node", nodeVersion, "LICENSE"),
        path.join(destination, "NODE-LICENSE.txt"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      throw new Error(
        `Node.js ${nodeVersion}: missing license text; run node scripts/licenses/update-node.mjs`,
      );
    }
  }
  const { version } = JSON.parse(
    await readFile("release-version.json", "utf8"),
  );
  await writeFile(
    path.join(destination, "release-version.json"),
    JSON.stringify({ version }) + "\n",
  );
  await writeFile(
    path.join(destination, "package.json"),
    JSON.stringify({ type: "module", version }) + "\n",
  );
  async function source(from, to) {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      if (
        ["node_modules", "target", ".local"].includes(entry.name) ||
        /\.(test|integration\.test)\./.test(entry.name) ||
        entry.name.endsWith(".d.ts")
      )
        continue;
      const input = path.join(from, entry.name);
      const output = path.join(to, entry.name.replace(/\.ts$/, ".js"));
      if (entry.isDirectory()) await source(input, output);
      else if (entry.name.endsWith(".ts")) {
        const compiled = ts.transpileModule(await readFile(input, "utf8"), {
          fileName: input,
          compilerOptions: {
            target: ts.ScriptTarget.ES2024,
            module: ts.ModuleKind.ESNext,
            rewriteRelativeImportExtensions: true,
          },
        });
        await writeFile(output, compiled.outputText);
      } else await cp(input, output);
    }
  }
  await source("apps/host/src", path.join(destination, "src"));
  const copied = new Set();
  async function dependency(name, from, optional = false) {
    const require = createRequire(path.resolve(from, "package.json"));
    const location = require.resolve
      .paths(name)
      .map((root) => path.join(root, name))
      .find((root) => existsSync(path.join(root, "package.json")));
    // The package manager installs only this OS's optional native package.
    if (!location && optional) return;
    const root = await realpath(location);
    if (copied.has(root)) return;
    copied.add(root);
    const target = path.join(destination, "node_modules", name);
    const manifest = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    );
    if (name === "@iori/protocol") {
      await source(path.join(root, "src"), path.join(target, "src"));
      manifest.exports["."] = "./src/index.js";
      await writeFile(
        path.join(target, "package.json"),
        JSON.stringify(manifest),
      );
    } else {
      await cp(root, target, {
        recursive: true,
        filter: (file) =>
          file === root ||
          (!["node_modules", "target", "test", "tests", "coverage"].includes(
            path.basename(file),
          ) &&
            !/\.(pdb|map)$/.test(file) &&
            (!path.relative(root, file).startsWith(`prebuilds${path.sep}`) ||
              path.relative(root, file).split(path.sep)[1] ===
                `${process.platform}-${process.arch}`)),
      });
    }
    for (const child of Object.keys(manifest.dependencies ?? {}))
      await dependency(child, root);
    for (const child of Object.keys(manifest.optionalDependencies ?? {}))
      await dependency(child, root, true);
  }
  const host = JSON.parse(await readFile("apps/host/package.json", "utf8"));
  for (const name of Object.keys(host.dependencies))
    await dependency(name, "apps/host");
  const npm = await npmNotice(
    await installedPackages(path.join(destination, "node_modules")),
  );
  await writeFile(path.join(destination, "THIRD-PARTY-NPM.txt"), npm.text);
  console.log(`Host npm licenses: ${npm.count}`);
  const cargo = await cargoNotice(
    process.platform === "win32" ? "host-windows" : "host-linux",
  );
  await writeFile(path.join(destination, "THIRD-PARTY-RUST.txt"), cargo.text);
  console.log(`Host Rust licenses: ${cargo.count}`);
  if (process.platform === "win32") {
    const { checkWindowsNodePty } =
      await import("../../verification/native/node-pty.mjs");
    await checkWindowsNodePty(destination);
  }
  const closure = await daemonClosure(destination);
  await writeFile(
    path.join(destination, "terminal-daemon-files.json"),
    JSON.stringify({
      sources: closure.sources,
      packages: Object.keys(closure.packages),
    }) + "\n",
  );
  for (const name of [
    "release-source.txt",
    "release-public-key.txt",
    "release-redirect-hosts.json",
  ])
    await cp(name, path.join(destination, name));
  for (const name of [
    "install-bundle.ps1",
    "update.mjs",
    "uninstall-linux.mjs",
    "uninstall-windows.mjs",
    "update-linux.mjs",
    "update-windows.mjs",
    "stop-windows.mjs",
    "move-bundle.mjs",
    "cli.mjs",
    "service.mjs",
    "stop.mjs",
    "terminal-daemon.mjs",
  ])
    await cp(path.join("scripts/release", name), path.join(destination, name));
  if (process.platform === "win32") {
    await writeFile(
      path.join(destination, "iori-host.cmd"),
      '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"%~dp0runtime\\node.exe" "%~dp0cli.mjs" %*\r\n',
    );
  } else {
    await writeFile(
      path.join(destination, "iori-host"),
      '#!/bin/sh\nroot=$(CDPATH= cd -- "$(dirname -- "$(readlink -f -- "$0")")" && pwd)\nexec "$root/runtime/node" "$root/cli.mjs" "$@"\n',
    );
    await chmod(path.join(destination, "iori-host"), 0o755);
  }
}
if (process.argv[1] === import.meta.filename)
  await buildHost(path.resolve(process.argv[2]));
