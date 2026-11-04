import { test } from "node:test";
import assert from "node:assert/strict";
import { filterKittyKeyReleases } from "./kitty-key-release.ts";

test("CLI終了後のkittyの解放だけを取り除き、shellの入力と押下を保つ", () => {
  const release = "\u001b[99;5:3u";
  const press = "\u001b[99;5:1u";
  assert.equal(
    filterKittyKeyReleases(release + "echo hello\r" + press, 0),
    "echo hello\r" + press,
  );
  assert.equal(filterKittyKeyReleases(release, 1), "");
  assert.equal(filterKittyKeyReleases(release, 7), release);
});
