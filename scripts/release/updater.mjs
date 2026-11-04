import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { root, output, version, releaseSource } from "./common.mjs";

// Sign only after collecting the Windows installer on Linux. The private key
// never enters the Windows build environment or a source archive.
export async function writeUpdater(
  directory = output,
  releaseVersion = version,
  signingKey = "/root/.config/iori-release/updater.key",
  platforms = {
    "windows-x86_64": "iori-setup-windows-x64.exe",
    "linux-x86_64-deb": "iori-linux-x64.deb",
    "linux-x86_64-appimage": "iori-linux-x64.AppImage",
  },
) {
  const entries = {};
  for (const [platform, name] of Object.entries(platforms)) {
    await promisify(execFile)(
      process.execPath,
      [
        path.join(root, "apps/client/node_modules/@tauri-apps/cli/tauri.js"),
        "signer",
        "sign",
        "--private-key-path",
        signingKey,
        "--app-version",
        releaseVersion,
        path.join(directory, name),
      ],
      { env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" } },
    );
    const signature = (
      await readFile(path.join(directory, name + ".sig"), "utf8")
    ).trim();
    entries[platform] = {
      signature,
      url: `${releaseSource}/download/v${releaseVersion}/${name}`,
    };
  }
  await writeFile(
    path.join(directory, "updater.json"),
    JSON.stringify(
      {
        version: releaseVersion,
        platforms: entries,
      },
      null,
      2,
    ) + "\n",
  );
}
