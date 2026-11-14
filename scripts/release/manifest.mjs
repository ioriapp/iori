import { DAEMON_PROTOCOL } from "../../apps/host/src/terminal/daemon/protocol.ts";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, sign } from "node:crypto";
import path from "node:path";
import { output, version, assets } from "./common.mjs";
export async function writeManifest(commit, acceptance) {
  const manifest = {
    version,
    commit,
    terminalDaemonProtocol: DAEMON_PROTOCOL,
    acceptance,
    assets: [],
  };
  for (const name of assets) {
    const bytes = await readFile(path.join(output, name));
    manifest.assets.push({
      name,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(path.join(output, "release.json"), bytes);
  await writeFile(
    path.join(output, "release.json.sig"),
    sign(
      null,
      bytes,
      await readFile("/root/.config/iori-release/signing-key.pem"),
    ),
  );
}
