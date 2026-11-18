import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { linkGit } from "../../verification/host/environment.mjs";
import { runHostTest } from "../../verification/host/process.mjs";

test("フォルダーを開いた後のgit initを通知する", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    await linkGit(join(dataRoot, "bin"));
    const path = join(dataRoot, "folder");
    await mkdir(path);
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const opened = await client.request("folders.open", { path });
    assert.equal(opened.folder.kind, "folder");
    const openedEvent = await events.waitFor(
      (event) => event.type === "folders.changed",
    );
    const openedIndex = events.values.indexOf(openedEvent);
    stage("git init後の変更通知を受け取る");
    execFileSync("git", ["init", "-q", path]);
    await events.waitFor(
      (event) =>
        events.values.indexOf(event) > openedIndex &&
        event.type === "folders.changed",
    );
    const history = await client.request("folders.history", {});
    const folder = history.folders.find((item) => item.path === path);
    assert.equal(folder.kind, "git");
    assert.equal(folder.inSidebar, true);
    assert.ok(folder.worktrees.some((worktree) => worktree.path === path));
  }));

test("Host停止中にgit initしたフォルダーを履歴から認識する", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart }) => {
    await linkGit(join(dataRoot, "bin"));
    const path = join(dataRoot, "folder");
    await mkdir(path);
    await client.request("folders.open", { path });
    client = await restart({
      whileStopped: () => execFileSync("git", ["init", "-q", path]),
    });
    const history = await client.request("folders.history", {});
    const folder = history.folders.find((item) => item.path === path);
    assert.equal(folder.kind, "git");
    assert.equal(folder.inSidebar, true);
    assert.ok(folder.worktrees.some((worktree) => worktree.path === path));
  }));
