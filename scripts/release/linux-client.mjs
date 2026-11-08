import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  cp,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { root, output, command } from "./common.mjs";
import { createSourceCopy } from "../../verification/native/source.mjs";
import { sh } from "../../verification/native/remote.mjs";
import { withoutWindowsTauri } from "../licenses/cargo.mjs";

const docker = (args) =>
  command("docker", ["--config", "/tmp/iori-linux-client-docker", ...args]);

export async function linuxClientImage() {
  const dockerfile = path.join(root, "scripts/release/linux-client.Dockerfile");
  const hash = createHash("sha256")
    .update(await readFile(dockerfile))
    .digest("hex")
    .slice(0, 16);
  const image = `iori-linux-client:ubuntu22.04-${hash}`;
  await docker(["build", "-f", dockerfile, "-t", image, root]);
  return image;
}

export async function buildLinuxClient({
  source,
  directory = output,
  config,
} = {}) {
  const image = await linuxClientImage();
  await mkdir(path.join(root, ".local"), { recursive: true });
  const scratch = !source
    ? await mkdtemp(path.join(root, ".local/linux-client-source-"))
    : undefined;
  if (scratch) {
    await createSourceCopy(root, scratch);
    source = scratch;
  }
  // Tauri's Linux bundler inspects Windows-only dependency features too and
  // otherwise asks for appindicator. The Linux-only snapshot has no tray;
  // leave the actual Windows manifest and build unchanged.
  const manifestPath = path.join(source, "apps/client/src-tauri/Cargo.toml");
  const manifest = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, withoutWindowsTauri(manifest));
  await mkdir(directory, { recursive: true });
  // Separate the Ubuntu target from native LXC builds. Artifacts are signed
  // after collection, so the build container does not receive the signing key.
  const container = `iori-linux-client-${process.pid}`;
  const previousReleases =
    process.env.IORI_APPIMAGE_PREVIOUS_RELEASES ??
    path.join(root, ".local/release");
  await mkdir(previousReleases, { recursive: true });
  try {
    await docker([
      "run",
      "--name",
      container,
      "--rm",
      "--init",
      "--memory",
      "4g",
      "--cpus",
      "4",
      "-v",
      `${source}:/source`,
      "-v",
      "iori-linux-client-cargo:/opt/cargo/registry",
      "-v",
      "iori-linux-client-target:/target",
      "-v",
      "iori-linux-client-pnpm:/pnpm-store",
      // Tauri downloads linuxdeploy and its AppImage plugin from GitHub into
      // ~/.cache/tauri; keep them so a slow download is paid once (#251).
      "-v",
      "iori-linux-client-tauri-tools:/root/.cache/tauri",
      "-v",
      "iori-linux-client-appimage-sources:/opt/iori-appimage-sources",
      "-v",
      `${previousReleases}:/previous-releases:ro`,
      "-e",
      "CARGO_TARGET_DIR=/target",
      "-e",
      "APPIMAGE_EXTRACT_AND_RUN=1",
      "-e",
      "LDAI_RUNTIME_FILE=/opt/appimage-runtime",
      "-e",
      "IORI_APPIMAGE_SOURCE_CACHE=/opt/iori-appimage-sources",
      "-e",
      "IORI_APPIMAGE_PREVIOUS_RELEASES=/previous-releases",
      "-e",
      "CI=true",
      "-e",
      `IORI_RELEASE_BUILD=${process.env.IORI_RELEASE_BUILD ?? ""}`,
      image,
      "flock",
      "/target/.build.lock",
      "bash",
      "-ec",
      `apt-get update && apt-get -y upgrade
node --input-type=module -e 'import { refreshSourceMtimes } from "/source/verification/native/source.mjs"; await refreshSourceMtimes("/source");'
pnpm install --frozen-lockfile --store-dir /pnpm-store
rm -rf /target/release/bundle /source/.local/linux-client-bundle
pnpm tauri build${config ? ` --config ${sh("/source/" + config)}` : ""}
IORI_APPIMAGE_SOURCE_DIR=/source/.local/linux-client-sources node /source/scripts/licenses/linux-libraries.mjs /target/release/bundle/appimage/*.AppDir
appimage=(/target/release/bundle/appimage/*.AppImage)
LDAI_OUTPUT="/target/release/bundle/appimage/with-notices.AppImage" /root/.cache/tauri/linuxdeploy-plugin-appimage.AppImage --appdir /target/release/bundle/appimage/*.AppDir
mv /target/release/bundle/appimage/with-notices.AppImage "\${appimage[0]}"
mkdir -p /source/.local/linux-client-bundle
cp /target/release/bundle/deb/*.deb* /target/release/bundle/appimage/*.AppImage* /source/.local/linux-client-bundle/`,
    ]);
    if (process.env.IORI_RELEASE_BUILD === "1") {
      const sources = path.join(directory, "appimage-sources");
      await rm(sources, { recursive: true, force: true });
      await cp(path.join(source, ".local/linux-client-sources"), sources, {
        recursive: true,
      });
    }
    const bundle = path.join(source, ".local/linux-client-bundle");
    for (const [extension, name] of [
      [".deb", "iori-linux-x64.deb"],
      [".AppImage", "iori-linux-x64.AppImage"],
    ]) {
      const artifact = (await readdir(bundle)).find((file) =>
        file.endsWith(extension),
      );
      if (!artifact)
        throw new Error(`Linux Client bundle missing: ${extension}`);
      await cp(path.join(bundle, artifact), path.join(directory, name));
    }
  } finally {
    // Also remove a build container when an outer bounded run interrupts it.
    await docker(["rm", "-f", container]).catch(() => {});
    await writeFile(manifestPath, manifest);
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === import.meta.filename) {
  process.env.IORI_RELEASE_BUILD = "1";
  await buildLinuxClient();
}
