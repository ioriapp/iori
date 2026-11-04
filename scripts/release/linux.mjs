import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { output, command, root, releaseSource } from "./common.mjs";
import { buildHost } from "./host.mjs";
import { refreshSourceMtimes } from "../../verification/native/source.mjs";
import { localCache } from "../../verification/native/cache.mjs";
await mkdir(output, { recursive: true });
const env = {
  ...process.env,
  CI: "true",
  PATH: "/root/.cargo/bin:" + process.env.PATH,
  CARGO_HOME: path.join(localCache, "linux-host/cargo-home"),
  CARGO_TARGET_DIR: path.join(localCache, "linux-host/cargo-target"),
};
await refreshSourceMtimes(root);
await command("pnpm", ["--filter", "@iori/host", "build:native"], { env });
const host = path.join(output, "linux-host");
await buildHost(host);
await command("tar", [
  "-czf",
  path.join(output, "iori-host-linux-x64.tar.gz"),
  "-C",
  host,
  ".",
]);
await writeFile(
  path.join(output, "install.sh"),
  (
    await readFile(path.join(root, "scripts/release/install.sh"), "utf8")
  ).replace("__IORI_RELEASE_SOURCE__", () => releaseSource),
);
await rm(host, { recursive: true, force: true });
