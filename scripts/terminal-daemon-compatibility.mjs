import {
  readFile,
  writeFile,
  readdir,
  mkdtemp,
  mkdir,
  rm,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { nativeAssets } from "./terminal-daemon-files.mjs";

const recordPath = "apps/host/terminal-daemon-compatibility.json";
const read = (file) => readFile(file, "utf8");
async function fingerprint() {
  await mkdir(".local", { recursive: true });
  const temporary = await mkdtemp(".local/daemon-compatibility-");
  try {
    const { buildHost } = await import("./release/host.mjs");
    const bundle = path.join(temporary, "host");
    // Inspect built assets; Node itself is represented by its pinned version.
    const closure = await buildHost(bundle, null);
    async function walk(directory, add) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(file, add);
        else add(file);
      }
    }
    const hash = createHash("sha256");
    hash.update(JSON.stringify(nativeAssets));
    for (const file of closure.files) {
      let bytes = await readFile(path.join(bundle, file));
      if (file === "package.json") {
        const { version: _releaseVersion, ...metadata } = JSON.parse(
          bytes.toString("utf8"),
        );
        bytes = Buffer.from(JSON.stringify(metadata));
      }
      hash
        .update(file + "\0")
        .update(bytes)
        .update("\0");
    }
    const nativeInputs = new Set([
      ".node-version",
      "rust-toolchain.toml",
      "apps/host/terminal-native/Cargo.toml",
      "apps/host/terminal-native/build.rs",
    ]);
    await walk("apps/host/terminal-native/src", (file) =>
      nativeInputs.add(file.split(path.sep).join("/")),
    );
    const workspace = await read("Cargo.toml");
    // These workspace settings affect the small addon; iroh/tokio do not.
    hash.update(
      workspace.match(/\[workspace.package\]([\s\S]*?)(?=\n\[|$)/u)?.[0] ?? "",
    );
    const lock = await read("Cargo.lock");
    const blocks = lock.split("[[package]]").slice(1);
    // Cargo.lock also includes optional dependencies enabled by other addons.
    const tree = execFileSync(
      "cargo",
      [
        "tree",
        "-p",
        "iori-terminal-native",
        "-e",
        "normal,build",
        "--target",
        "all",
        "--locked",
        "--prefix",
        "none",
      ],
      { encoding: "utf8" },
    );
    const visited = new Set(
      [...tree.matchAll(/^(\S+) v(\S+)/gmu)].map(
        ([, name, version]) => `${name} ${version}`,
      ),
    );
    for (const block of blocks) {
      const name = block.match(/^name = "([^"\n]+)"/mu)?.[1];
      const version = block.match(/^version = "([^"\n]+)"/mu)?.[1];
      if (visited.has(`${name} ${version}`)) hash.update(block);
    }
    const pnpmLock = await read("pnpm-lock.yaml");
    const sections = pnpmLock.split(/(?=^packages:|^snapshots:)/mu).slice(1);
    for (const [name, version] of Object.entries(closure.packages)) {
      if (name.startsWith("@iori/")) continue;
      for (const section of sections)
        for (const block of section.split(/(?=^  [^ ].*:\n)/mu)) {
          const header = block
            .split("\n")[0]
            .trim()
            .replace(/^'|'?:$/gu, "");
          if (
            header === `${name}@${version}` ||
            header.startsWith(`${name}@${version}(`)
          )
            hash.update(block);
        }
      const patch = `apps/host/patches/${name.replace("/", "__")}@${version}.patch`;
      if (existsSync(patch)) nativeInputs.add(patch);
    }
    for (const file of [...nativeInputs].sort())
      hash.update(file + "\0" + (await read(file)) + "\0");
    const version = Number(
      (await read("apps/host/src/terminal/daemon/protocol.ts")).match(
        /DAEMON_PROTOCOL\s*=\s*(\d+)/u,
      )[1],
    );
    return {
      version,
      sha256: hash.digest("hex"),
      packages: closure.packages,
      hashedFiles: closure.files,
      nativeAssets: Object.entries(nativeAssets).flatMap(([name, patterns]) =>
        patterns.map((pattern) => `node_modules/${name}/${pattern}`),
      ),
      nativeInputs: [...nativeInputs].sort(),
      nativePackages: [...visited].sort(),
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
export async function checkDaemonCompatibility(update = false) {
  const current = await fingerprint();
  let record;
  try {
    record = JSON.parse(await read(recordPath));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const instruction =
    "Terminalデーモンの実行ファイルが変わりました。DAEMON_PROTOCOLを上げて node scripts/terminal-daemon-compatibility.mjs --update を実行してください。バージョンの変更は動作中のTerminalとAgentを止め、再開経路へ戻します。";
  if (update) {
    if (record && current.version <= record.version)
      throw new Error(instruction);
    await writeFile(recordPath, JSON.stringify(current, null, 2) + "\n");
    return current;
  }
  if (
    !record ||
    record.version !== current.version ||
    record.sha256 !== current.sha256
  )
    throw new Error(instruction);
  // Also reject rewriting the record under the same version, including after a commit.
  for (const ref of ["HEAD", "HEAD^"]) {
    let previous;
    try {
      previous = JSON.parse(
        execFileSync("git", ["show", `${ref}:${recordPath}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
    } catch {
      continue;
    }
    if (previous.sha256 !== record.sha256 && record.version <= previous.version)
      throw new Error(instruction);
  }
  return current;
}
if (process.argv[1] === import.meta.filename) {
  await checkDaemonCompatibility(process.argv.includes("--update"));
  process.stdout.write("Terminal daemon compatibility: OK\n");
}
