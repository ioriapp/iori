import assert from "node:assert/strict";
import test from "node:test";
import { displayRemoteUrl } from "./repository-git-settings.ts";

test("display remote URLs without secrets for every URL scheme", () => {
  for (const scheme of ["http", "https", "git", "ftp", "git+https"]) {
    assert.equal(
      displayRemoteUrl(
        `${scheme}://user:password@example.invalid/owner/repo.git`,
      ),
      `${scheme}://example.invalid/owner/repo.git`,
    );
    assert.equal(
      displayRemoteUrl(`${scheme}://token@example.invalid/owner/repo.git`),
      `${scheme}://example.invalid/owner/repo.git`,
    );
  }
  for (const scheme of ["ssh", "git+ssh", "ssh+git"]) {
    assert.equal(
      displayRemoteUrl(
        `${scheme}://git:password@example.invalid/owner/repo.git`,
      ),
      `${scheme}://git@example.invalid/owner/repo.git`,
    );
    assert.equal(
      displayRemoteUrl(`${scheme}://git@example.invalid/owner/repo.git`),
      `${scheme}://git@example.invalid/owner/repo.git`,
    );
  }
});

test("preserve scp remote URLs and local paths", () => {
  for (const value of [
    "git@example.invalid:owner/repo.git",
    "../repository",
    "/home/user/repository",
    "C:\\repositories\\repo",
    "file:///home/user/repo",
  ]) {
    assert.equal(displayRemoteUrl(value), value);
  }
});
