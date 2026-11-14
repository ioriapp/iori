import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { assets, root } from "./common.mjs";
import { extractReleaseDownloadNames } from "./download-links.mjs";

test("README と guides のダウンロードリンクは公開する配布物の名前だけを指す", () => {
  const documents = globSync(["README.md", "README.ja.md", "guides/*.md"], {
    cwd: root,
  });
  const names = documents.flatMap((document) =>
    extractReleaseDownloadNames(
      readFileSync(path.join(root, document), "utf8"),
    ),
  );

  assert.ok(names.length > 0, "README と guides にダウンロードリンクがある");
  assert.deepEqual(
    names.filter((name) => !assets.includes(name)),
    [],
    "ダウンロードリンクのファイル名が公開配布物に含まれる",
  );
});
