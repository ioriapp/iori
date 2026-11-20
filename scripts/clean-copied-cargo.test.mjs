import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("seeded Cargo builds can regenerate path-dependent output and reuse portable output", (t) => {
  const temp = mkdtempSync(join(tmpdir(), "iori-clean-copied-cargo-"));
  t.after(() => rmSync(temp, { force: true, recursive: true }));
  const donor = join(temp, "cargo-target", "a".repeat(64));
  const seeded = join(temp, "cargo-target", "b".repeat(64));
  const project = join(temp, "project");
  const profiles = ["dev", "release"];
  mkdirSync(project);

  // Reproduce Tauri's path to a generated list that itself stores an absolute path.
  writeFileSync(
    join(project, "Cargo.toml"),
    '[workspace]\nmembers = ["permissions", "portable"]\nresolver = "2"\n',
  );
  for (const name of ["permissions", "portable"]) {
    const crate = join(project, name);
    mkdirSync(join(crate, "src"), { recursive: true });
    writeFileSync(
      join(crate, "Cargo.toml"),
      `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\n`,
    );
  }
  writeFileSync(
    join(project, "permissions", "build.rs"),
    `fn main() {
    let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let permission = out.join("permission.toml");
    let list = out.join("permission-files");
    std::fs::write(&permission, "allow").unwrap();
    std::fs::write(&list, permission.to_str().unwrap()).unwrap();
    println!("cargo:rustc-env=PERMISSION_FILES_PATH={}", list.display());
    println!("cargo:rerun-if-changed=build.rs");
}`,
  );
  writeFileSync(
    join(project, "permissions", "src", "lib.rs"),
    `#[test]
fn permission_file_exists() {
    let path = include_str!(env!("PERMISSION_FILES_PATH"));
    assert_eq!(std::fs::read_to_string(path).unwrap(), "allow");
}`,
  );
  writeFileSync(
    join(project, "portable", "build.rs"),
    'fn main() { println!("cargo:rerun-if-changed=build.rs"); }',
  );
  writeFileSync(join(project, "portable", "src", "lib.rs"), "");

  function cargo(target, args) {
    execFileSync("cargo", [...args, "--offline"], {
      cwd: project,
      encoding: "utf8",
      env: { ...process.env, CARGO_TARGET_DIR: target },
      stdio: "pipe",
    });
  }
  function build(target) {
    for (const profile of profiles) {
      cargo(target, ["test", "--locked", "--profile", profile]);
    }
  }
  cargo(donor, ["generate-lockfile"]);
  build(donor);
  cpSync(donor, seeded, { recursive: true, preserveTimestamps: true });
  rmSync(donor, { recursive: true });

  const portableOutputs = globSync("{debug,release}/build/portable-*/output", {
    cwd: seeded,
  });
  assert.equal(portableOutputs.length, profiles.length);
  const portableTimes = portableOutputs.map(
    (path) => statSync(join(seeded, path)).mtimeMs,
  );

  const cleanScript = fileURLToPath(
    new URL("./clean-copied-cargo.mjs", import.meta.url),
  );
  execFileSync(process.execPath, [cleanScript], {
    cwd: project,
    env: { ...process.env, CARGO_TARGET_DIR: seeded },
    stdio: "pipe",
  });

  build(seeded);
  assert.deepEqual(
    portableOutputs.map((path) => statSync(join(seeded, path)).mtimeMs),
    portableTimes,
  );
  const buildOutputs = globSync(
    "{debug,release}/build/*/{root-output,output}",
    { cwd: seeded },
  );
  for (const path of buildOutputs) {
    assert.ok(!readFileSync(join(seeded, path), "utf8").includes(donor), path);
  }
});
