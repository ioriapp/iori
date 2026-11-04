import { execFileSync, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
export const root = path.resolve(import.meta.dirname, "../..");
export const releaseSource = (
  await readFile(path.join(root, "release-source.txt"), "utf8")
).trim();
export const version = JSON.parse(
  await readFile(path.join(root, "release-version.json"), "utf8"),
).version;
export const output = path.join(root, ".local/release", version);
export const assets = [
  "iori-host-linux-x64.tar.gz",
  "iori-host-windows-x64.zip",
  "iori-setup-windows-x64.exe",
  "iori-linux-x64.deb",
  "iori-linux-x64.AppImage",
  "iori-android-arm64.apk",
  "install.sh",
  "install.ps1",
  "iori-setup-windows-x64.exe.sig",
  "iori-linux-x64.deb.sig",
  "iori-linux-x64.AppImage.sig",
  "updater.json",
];
function childEnvironment(environment = process.env) {
  const env = { ...environment };
  delete env.FORGEJO_TOKEN;
  return env;
}
export function git(...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: childEnvironment(),
  }).trim();
}
export async function command(file, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: "inherit",
      cwd: root,
      ...options,
      env: childEnvironment(options.env),
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${file} exit ${signal ?? code}`)),
    );
  });
}
