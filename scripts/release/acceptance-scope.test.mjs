import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptanceScope } from "./acceptance-scope.mjs";

test("デーモンの互換または配布物の境界の変更は全体の受入", () => {
  assert.equal(acceptanceScope([], true).type, "full");
  for (const file of [
    "scripts/release/install.sh",
    "scripts/release/update-windows.mjs",
    "scripts/release/uninstall-linux.mjs",
    "scripts/release/updater.mjs",
    "scripts/release/service.mjs",
    "apps/client/src/updates/controller.ts",
    "apps/client/src-tauri/src/host_setup/ssh/remote.rs",
    "apps/client/src-tauri/src/updates/linux.rs",
    "apps/client/src/connection.ts",
    "apps/host/native/src/lib.rs",
    "apps/host/src/maintenance/manager.ts",
    "crates/iori-iroh-config/src/lib.rs",
  ]) {
    const result = acceptanceScope([file], false);
    assert.equal(result.type, "full", file);
    assert.ok(result.reasons.some((reason) => reason.includes(file)));
  }
});

test("画面・Host 内部・文書だけの変更は範囲の受入", () => {
  assert.deepEqual(
    acceptanceScope(
      [
        "apps/client/src/App.tsx",
        "apps/host/src/teams/manager.ts",
        "apps/host/src/host.ts",
        "apps/client/src-tauri/src/native.rs",
        "docs/product.md",
      ],
      false,
    ),
    { type: "scoped" },
  );
});
