import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const inputs = [
  ".cargo",
  ".clippy.toml",
  ".rustfmt.toml",
  "Cargo.lock",
  "Cargo.toml",
  "clippy.toml",
  "rust-toolchain",
  "rust-toolchain.toml",
  "rustfmt.toml",
  "crates",
  "apps/host/native",
  "apps/host/terminal-native",
  "apps/client/src-tauri",
  // Tauri reads these files outside its workspace when compiling.
  "release-version.json",
  "release-public-key.txt",
  "release-redirect-hosts.json",
  "release-source.txt",
  "scripts/release/install.sh",
  "scripts/release/install-bundle.ps1",
  // A change to the check commands also invalidates a previous result.
  "scripts/ci.sh",
  "scripts/ci-check.sh",
  "scripts/ci-run-steps.mjs",
  "scripts/ci-rust-hash.mjs",
];
const excludedDirectories = new Set(["target", "gen", "node_modules"]);

export function rustChecksHash(root, environment) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(environment) + "\n");

  function add(relativePath) {
    const file = join(root, relativePath);
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return true;
    if (stat.isDirectory()) {
      return readdirSync(file, { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : a.name === b.name ? 0 : 1))
        .every(
          (entry) =>
            (entry.isDirectory() && excludedDirectories.has(entry.name)) ||
            add(join(relativePath, entry.name)),
        );
    }
    // Do not reuse results when an input can resolve outside this file set.
    if (!stat.isFile()) return false;
    const content = createHash("sha256")
      .update(readFileSync(file))
      .digest("hex");
    hash.update(JSON.stringify([relativePath, content]) + "\n");
    return true;
  }

  return inputs.every(add) ? hash.digest("hex") : undefined;
}
