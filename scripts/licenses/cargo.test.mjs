import { test } from "node:test";
import assert from "node:assert/strict";
import { withoutWindowsTauri } from "./cargo.mjs";

test("remove only the Windows tauri dependency regardless of its version", () => {
  const manifest = `[dependencies]\ntauri = { version = "2.13.0", features = [] }\n\n[target.'cfg(windows)'.dependencies]\ntauri = { version = "2.13.0", features = ["tray-icon"] }\nother = "1"\n\n[target.'cfg(target_os = "linux")'.dependencies]\ntauri = "2"\n`;
  assert.equal(
    withoutWindowsTauri(manifest),
    manifest.replace(
      'tauri = { version = "2.13.0", features = ["tray-icon"] }\n',
      "",
    ),
  );
});
