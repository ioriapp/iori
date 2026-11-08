import { test } from "node:test";
import assert from "node:assert/strict";
import {
  highestPublishedVersion,
  isNewerThanPublished,
} from "./publication-checks.mjs";

test("published prereleases participate in version ordering, drafts and source releases do not", () => {
  const releases = [
    { tag_name: "v0.1.9", draft: false },
    { tag_name: "v0.1.11", draft: false, prerelease: true },
    { tag_name: "v0.1.99", draft: true },
    { tag_name: "appimage-sources", draft: false, prerelease: true },
    { tag_name: "v0.1.10", draft: false },
  ];
  assert.equal(highestPublishedVersion(releases), "0.1.11");
  assert.equal(isNewerThanPublished("0.1.10", releases), false);
  assert.equal(isNewerThanPublished("0.1.12", releases), true);
  assert.equal(highestPublishedVersion([]), undefined);
  assert.equal(
    highestPublishedVersion([
      { tag_name: "v1.0.0-rc.2" },
      { tag_name: "v1.0.0-rc.10" },
    ]),
    "1.0.0-rc.10",
  );
});
