import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { rustChecksHash } from "./ci-rust-hash.mjs";

function snapshot(t) {
  const root = mkdtempSync(join(tmpdir(), "iori-ci-rust-hash-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    hash: (image = "ci-image", rustc = "rustc 1.98.1") =>
      rustChecksHash(root, { image, rustc }),
    write(file, content) {
      const path = join(root, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      return path;
    },
  };
}

test("uses Rust input contents rather than timestamps or generated files", (t) => {
  const { hash, write } = snapshot(t);
  const file = "apps/client/src-tauri/src/lib.rs";
  const source = write(file, "fn original() {}");
  const original = hash();

  utimesSync(source, 1, 1);
  write("apps/client/src-tauri/gen/schemas/generated.json", "{}");
  write("apps/host/native/target/debug/build-info", "generated");
  write("apps/host/terminal-native/node_modules/package/package.json", "{}");
  assert.equal(hash(), original);

  write(file, "fn modified() {}");
  utimesSync(source, 1, 1);
  assert.notEqual(hash(), original);
});

test("invalidates previous results after release inputs, CI checks, or the execution environment changes", (t) => {
  const { hash, write } = snapshot(t);
  write("Cargo.lock", "lock information");
  const original = hash();

  assert.notEqual(hash("rebuilt-image"), original);
  assert.notEqual(hash("ci-image", "rustc 1.99.0"), original);
  write("release-public-key.txt", "update verification key");
  const releaseChange = hash();
  assert.notEqual(releaseChange, original);
  write("scripts/ci-check.sh", "changed verification commands");
  assert.notEqual(hash(), releaseChange);
});
