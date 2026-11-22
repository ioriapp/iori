import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HostStore } from "./store.ts";
import { WorkspaceService } from "./workspace.ts";

test("a failed ref watcher rescans and resumes reporting Git changes", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "iori-ref-watch-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args]);
  git("init", "-q", "-b", "main");
  git(
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "initial",
  );
  const observe = t.mock.method(fs, "watch");
  syncBuiltinESMExports();
  t.after(() => {
    observe.mock.restore();
    syncBuiltinESMExports();
  });
  const store = new HostStore(":memory:");
  let renamed = false;
  let gitChanges = 0;
  const service = new WorkspaceService(
    store,
    (event) => {
      if (
        event.type === "worktrees.changed" &&
        event.worktrees.some((tree) => tree.branch === "renamed")
      )
        renamed = true;
    },
    () => {
      gitChanges++;
    },
  );
  try {
    const opened = await service.open(
      { clientPublicKey: "device", operationId: crypto.randomUUID() },
      root,
    );
    assert.ok(opened.response.ok);
    git("branch", "-m", "renamed");
    await t.waitFor(() => assert.ok(renamed));
    const watchingRefs = () =>
      observe.mock.calls.filter(
        (call) => call.arguments[0] === join(root, ".git", "refs", "heads"),
      );
    const original = watchingRefs().at(-1)?.result;
    assert.ok(original);
    original.emit("error", new Error("watch interrupted"));
    await t.waitFor(() =>
      assert.notEqual(watchingRefs().at(-1)?.result, original),
    );
    const previous = gitChanges;
    git("branch", "new-branch");
    await t.waitFor(() => assert.ok(gitChanges > previous));
  } finally {
    service.close();
    store.close();
  }
});
