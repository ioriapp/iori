import { local as verificationLocal } from "../native/local.mjs";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, sign } from "node:crypto";
import path from "node:path";
import { lockEntry } from "../native/locks.mjs";
import { gate } from "../native/remote.mjs";
import { createSourceCopy } from "../native/source.mjs";
import { evidence, command, prepareBuild } from "../connection/build.mjs";
import { buildLinuxClient } from "../../scripts/release/linux-client.mjs";
import { DAEMON_PROTOCOL } from "../../apps/host/src/terminal/daemon/protocol.ts";
import {
  prepareTls,
  verificationSource,
  verificationReleaseSource,
  endpoint,
} from "../updates/distribution.mjs";
import { prepareSigning } from "../updates/keys.mjs";

await lockEntry(import.meta.url);
gate({ devices: [verificationLocal.linux.host], requireFreePorts: false });
process.argv.push("--client", "Linux");
const directory = path.join(evidence, "distribution");
const source = path.join(evidence, "source");
await mkdir(path.join(directory, "assets"), { recursive: true });
try {
  await createSourceCopy(process.cwd(), source);
  await prepareTls(directory, "Linux");
  const publicKey = await prepareSigning(directory, "Host");
  const updaterKey = await prepareSigning(
    path.join(directory, "client"),
    "Linux",
  );
  await writeFile(
    path.join(source, "apps/client/src-tauri/src/updates/release.rs"),
    await verificationReleaseSource(process.cwd()),
  );
  await writeFile(
    path.join(source, "release-source.txt"),
    endpoint("Linux").source + "\n",
  );
  await writeFile(
    path.join(source, "release-public-key.txt"),
    publicKey + "\n",
  );
  await writeFile(
    path.join(source, "apps/client/src-tauri/src/updates/mod.rs"),
    await verificationSource(
      process.cwd(),
      await readFile(path.join(directory, "tls/ca.pem"), "utf8"),
    ),
  );
  // Only this source copy downloads from the dedicated signed distribution.
  const installer = path.join(source, "scripts/release/install.sh");
  await writeFile(
    installer,
    (await readFile(installer, "utf8"))
      .replace("__IORI_RELEASE_SOURCE__", endpoint("Linux").source)
      .replace("curl -fSL", 'curl --cacert "$HOME/.iori-ssh-setup-ca.pem" -fSL')
      .replace(
        'wget "$base',
        'wget --ca-certificate="$HOME/.iori-ssh-setup-ca.pem" "$base',
      ),
  );
  const config = JSON.parse(
    await readFile("verification/linux-client/tauri.conf.json", "utf8"),
  );
  config.plugins = { updater: { pubkey: updaterKey } };
  await writeFile(
    path.join(source, "verification/linux-client/tauri.conf.json"),
    JSON.stringify(config),
  );
  execFileSync("git", ["init", "-q"], { cwd: source });
  execFileSync("git", ["add", "--force", "."], { cwd: source });
  await prepareBuild(source);
  const stateFile = path.join(evidence, "build-state.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  state.setupRoot = directory;
  await writeFile(stateFile, JSON.stringify(state, null, 2));
  await command(process.execPath, [
    "scripts/run-bounded-check.mjs",
    process.execPath,
    "verification/connection/prepare-linux.mjs",
  ]);
  const bundle = path.join(state.localRoot, "setup-host-bundle");
  await command(process.execPath, ["scripts/release/host.mjs", bundle], {
    cwd: state.localRoot,
  });
  const asset = "iori-host-linux-x64.tar.gz";
  await command("tar", [
    "-czf",
    path.join(directory, "assets", asset),
    "-C",
    bundle,
    ".",
  ]);
  await rm(bundle, { recursive: true, force: true });
  const bytes = await readFile(path.join(directory, "assets", asset));
  const { version } = JSON.parse(
    await readFile("release-version.json", "utf8"),
  );
  const manifest = Buffer.from(
    JSON.stringify({
      version,
      terminalDaemonProtocol: DAEMON_PROTOCOL,
      assets: [
        {
          name: asset,
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ],
    }),
  );
  await writeFile(path.join(directory, "assets/release.json"), manifest);
  await writeFile(
    path.join(directory, "assets/release.json.sig"),
    sign(
      null,
      manifest,
      await readFile(path.join(directory, "signing/release.pem")),
    ),
  );
  await buildLinuxClient({
    source: state.localRoot,
    directory: path.join(directory, "client"),
    config: "verification/linux-client/tauri.conf.json",
    signingKey: path.join(directory, "client/signing/updater.key"),
  });
  console.log(
    JSON.stringify({ built: true, evidence, distribution: directory }),
  );
} finally {
  await rm(source, { recursive: true, force: true });
}
