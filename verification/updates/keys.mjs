import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises";
import path from "node:path";

export async function prepareSigning(root, platform) {
  const directory = path.join(root, "signing");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (platform === "Windows" || platform === "Linux") {
    const key = path.join(directory, "updater.key");
    execFileSync(
      process.execPath,
      [
        "apps/client/node_modules/@tauri-apps/cli/tauri.js",
        "signer",
        "generate",
        "--ci",
        "--password",
        "",
        "--write-keys",
        key,
      ],
      { stdio: "ignore" },
    );
    await chmod(key, 0o600);
    return (await readFile(key + ".pub", "utf8")).trim();
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  await writeFile(
    path.join(directory, "release.pem"),
    privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  );
  return publicKey
    .export({ type: "spki", format: "der" })
    .subarray(-32)
    .toString("base64");
}
