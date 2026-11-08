import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import {
  actorCommand,
  registerScriptedCli,
} from "../../verification/host/scripted-definition.mjs";
import { registerResponseCli } from "../../verification/host/response-definition.mjs";

async function repository(root, refFormat) {
  await symlink(
    execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
    join(root, "bin", "git"),
  );
  const path = join(root, "repository");
  await mkdir(path);
  const git = (cwd, ...args) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git(
    path,
    "init",
    "-b",
    "main",
    ...(refFormat ? [`--ref-format=${refFormat}`] : []),
  );
  git(path, "config", "user.name", "Worktree E2E");
  git(path, "config", "user.email", "worktree@localhost");
  await writeFile(join(path, "base.txt"), "base\n");
  git(path, "add", ".");
  git(path, "commit", "-m", "initial");
  return {
    path,
    git,
    add(name) {
      const worktree = join(root, name);
      git(path, "worktree", "add", "-b", name, worktree);
      return worktree;
    },
  };
}

async function commit(git, path, name) {
  await writeFile(join(path, `${name}.txt`), `${name}\n`);
  git(path, "add", ".");
  execFileSync("git", ["-C", path, "commit", "-m", name], {
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
    },
  });
}

const exists = (path) =>
  access(path).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
const create = (client, path, name, baseBranch = "main", setupCommand = "") =>
  client.request("worktrees.create", { path, name, baseBranch, setupCommand });
const remove = (client, preview, paths, branches = []) =>
  client.request("worktrees.remove", {
    previewId: preview.id,
    paths,
    branches,
  });

test("指定したブランチから日本語名のworktreeを作る", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { path, git } = await repository(dataRoot);
    git(path, "branch", "browser");
    await commit(git, path, "main-only");
    stage("指定したブランチから作成する");
    const created = await create(client, path, "作業 feature", "browser");
    assert.equal(created.state, "created");
    assert.equal(created.branch, "作業-feature");
    assert.equal(
      git(created.path, "rev-parse", "HEAD"),
      git(path, "rev-parse", "browser"),
    );
  }));

test("重複した名前のworktreeは上書きしない", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path } = await repository(dataRoot);
    const created = await create(client, path, "作業 feature");
    assert.equal(created.state, "created");
    await writeFile(join(created.path, "keep.txt"), "keep");
    const conflict = await create(client, path, "作業 feature");
    assert.equal(conflict.error, "name_conflict");
    assert.equal(
      await readFile(join(created.path, "keep.txt"), "utf8"),
      "keep",
    );
  }));

test("空欄の名前で作成したworktreeにioriのブランチが付く", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git } = await repository(dataRoot);
    const created = await create(client, path, "");
    assert.equal(created.state, "created");
    assert.match(created.branch, /^iori\/worktree-[0-9a-f]{8}$/u);
    assert.equal(git(created.path, "branch", "--show-current"), created.branch);
  }));

test("作成時の準備コマンドを保存し設定から変更できる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path } = await repository(dataRoot);
    assert.equal(
      (await create(client, path, "task", "main", "echo first")).state,
      "created",
    );
    assert.equal(
      (await client.request("repository.git.settings", { path })).setupCommand,
      "echo first",
    );
    await client.request("repository.git.set", {
      path,
      setupCommand: "echo second",
    });
    assert.equal(
      (await client.request("worktrees.options", { path })).setupCommand,
      "echo second",
    );
  }));

test("準備コマンドが終わってからworktreeでCLIを起動する", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { path } = await repository(dataRoot);
    const cliId = await registerScriptedCli(client, dataRoot);
    const created = await create(
      client,
      path,
      "task",
      "main",
      "printf '%s' \"$IORI_ROOT_PATH\" > .setup-root",
    );
    stage("準備付きでCLIを起動する");
    const { terminal: summary } = await client.request("cli.launch", {
      cliId,
      cwd: created.path,
      setupWorktree: true,
    });
    const terminal = await client.terminal(summary.id);
    await terminal.output("ACTOR_READY");
    assert.equal(
      await readFile(join(created.path, ".setup-root"), "utf8"),
      path,
    );
  }));

test("準備コマンドが終わってからworktreeでチームの親を起動する", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { path } = await repository(dataRoot);
    const created = await create(
      client,
      path,
      "task",
      "main",
      "printf '%s' \"$IORI_ROOT_PATH\" > .setup-root",
    );
    stage("準備付きでチームの親を起動する");
    await teamParent(client, dataRoot, created.path, { setupWorktree: true });
    assert.equal(
      await readFile(join(created.path, ".setup-root"), "utf8"),
      path,
    );
  }));

test("準備に失敗するとCLIを待機し、再実行とスキップを選べる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { path } = await repository(dataRoot);
    const cliId = await registerScriptedCli(client, dataRoot);
    const created = await create(
      client,
      path,
      "task",
      "main",
      "printf x >> .attempts; printf 'SETUP_FAILED\\n'; exit 23",
    );
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const { terminal: summary } = await client.request("cli.launch", {
      cliId,
      cwd: created.path,
      setupWorktree: true,
    });
    const terminal = await client.terminal(summary.id);
    stage("終了コードと出力を受け取り、CLIは起動しない");
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === summary.id &&
        event.terminal.setup?.state === "failed" &&
        event.terminal.setup.exitCode === 23,
    );
    await terminal.output("SETUP_FAILED");
    assert.doesNotMatch(terminal.values.at(-1).output, /ACTOR_READY/u);
    stage("同じ場所で再実行し、その後スキップしてCLIを起動する");
    await client.request("terminal.setup", {
      terminalId: summary.id,
      action: "retry",
    });
    await terminal.waitFor(
      ({ output }) => (output.match(/SETUP_FAILED/gu) ?? []).length >= 2,
    );
    assert.equal(await readFile(join(created.path, ".attempts"), "utf8"), "xx");
    await client.request("terminal.setup", {
      terminalId: summary.id,
      action: "skip",
    });
    await terminal.output("ACTOR_READY");
  }));

test("分離HEADの未保存コミットを削除前に知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const detached = add("detached");
    git(detached, "checkout", "--detach");
    await commit(git, detached, "one");
    await commit(git, detached, "two");
    const preview = await client.request("worktrees.preview", {
      path: detached,
    });
    assert.equal(preview.items[0].detachedCommits, 2);
  }));

test("未取り込みの変更とコミットを知らせ、ブランチを残して削除する", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const worktree = add("task");
    await commit(git, worktree, "task");
    await writeFile(join(worktree, "task.txt"), "modified\n");
    await writeFile(join(worktree, "untracked.txt"), "new\n");
    const preview = await client.request("worktrees.preview", {
      path: worktree,
    });
    assert.equal(preview.items[0].commits, 1);
    assert.equal(preview.items[0].changes.files, 2);
    assert.equal(preview.items[0].deleteBranch, false);
    assert.equal(
      (await remove(client, preview, [worktree])).outcomes[0].removed,
      true,
    );
    assert.equal(await exists(worktree), false);
    assert.equal(git(path, "branch", "--list", "task"), "task");
  }));

test("選択した未取り込みブランチをworktreeと一緒に削除する", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const worktree = add("task");
    await commit(git, worktree, "task");
    const preview = await client.request("worktrees.preview", {
      path: worktree,
    });
    assert.equal(preview.items[0].commits, 1);
    assert.equal(
      (await remove(client, preview, [worktree], ["task"])).outcomes[0].removed,
      true,
    );
    assert.equal(git(path, "branch", "--list", "task"), "");
  }));

test("片付けは取り込み済みで変更のないworktreeだけを候補にする", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const merged = add("merged");
    const dirty = add("dirty");
    const unmerged = add("unmerged");
    for (const [worktree, name] of [
      [merged, "merged"],
      [dirty, "dirty"],
      [unmerged, "unmerged"],
    ])
      await commit(git, worktree, name);
    git(path, "merge", "--no-ff", "merged", "-m", "merge");
    git(path, "merge", "--squash", "dirty");
    git(path, "commit", "-m", "squash");
    await writeFile(join(dirty, "dirty.txt"), "staged change\n");
    git(dirty, "add", "dirty.txt");
    await writeFile(join(dirty, "dirty.txt"), "dirty\n");
    const preview = await client.request("worktrees.cleanup", { path });
    assert.deepEqual(
      preview.items.map((item) => item.path),
      [merged],
    );
    assert.equal(
      (await remove(client, preview, [merged])).outcomes[0].removed,
      true,
    );
    assert.equal(git(path, "branch", "--list", "merged"), "");
    assert.equal(await exists(dirty), true);
    assert.equal(await exists(unmerged), true);
  }));

test("fetch失敗や削除できない候補があっても他の片付けを続ける", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const locked = add("locked");
    const clean = add("clean");
    const prunable = add("prunable");
    for (const [worktree, name] of [
      [locked, "locked"],
      [clean, "clean"],
    ]) {
      await commit(git, worktree, name);
      git(path, "merge", "--no-ff", name, "-m", `merge ${name}`);
    }
    await rm(prunable, { recursive: true });
    git(path, "remote", "add", "origin", join(dataRoot, "missing.git"));
    git(path, "worktree", "lock", "--reason", "independent lock", locked);
    const preview = await client.request("worktrees.cleanup", { path });
    assert.equal(preview.fetchFailed, true);
    assert.deepEqual(
      preview.items.map((item) => item.path).sort(),
      [locked, clean].sort(),
    );
    const result = await remove(client, preview, [locked, clean]);
    assert.equal(
      result.outcomes.find((item) => item.path === clean).removed,
      true,
    );
    const failed = result.outcomes.find((item) => item.path === locked);
    assert.equal(failed.removed, false);
    assert.match(failed.error, /independent lock/u);
    assert.equal(await exists(locked), true);
  }));

test("cherry-pick後に同じ行を編集しても取り込み済みとして片付ける", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const worktree = add("picked");
    await commit(git, worktree, "picked");
    git(path, "cherry-pick", git(worktree, "rev-parse", "HEAD"));
    await writeFile(join(path, "picked.txt"), "main edited the line\n");
    git(path, "add", ".");
    git(path, "commit", "-m", "edit after cherry-pick");
    const preview = await client.request("worktrees.preview", {
      path: worktree,
    });
    assert.equal(preview.items[0].merged, true);
    assert.equal(preview.items[0].deleteBranch, true);
    assert.equal(
      (await remove(client, preview, [worktree])).outcomes[0].removed,
      true,
    );
    assert.equal(git(path, "branch", "--list", "picked"), "");
  }));

test("mainをmergeした枝もcherry-pick後に同じ行を編集していれば取り込み済みとする", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const worktree = add("merge-main");
    await commit(git, worktree, "picked");
    const picked = git(worktree, "rev-parse", "HEAD");
    await commit(git, path, "main-before-merge");
    git(worktree, "merge", "--no-ff", "main", "-m", "merge main");
    git(path, "cherry-pick", picked);
    await writeFile(join(path, "picked.txt"), "main edited the line\n");
    git(path, "add", ".");
    git(path, "commit", "-m", "edit after cherry-pick");
    const preview = await client.request("worktrees.preview", {
      path: worktree,
    });
    assert.equal(preview.items[0].merged, true);
    assert.equal(preview.items[0].deleteBranch, true);
  }));

test("mergeコミットだけの新しい内容は未取り込みとして知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const worktree = add("merge-extra");
    await commit(git, worktree, "picked");
    const picked = git(worktree, "rev-parse", "HEAD");
    await commit(git, path, "main-before-merge");
    git(worktree, "merge", "--no-ff", "--no-commit", "main");
    await commit(git, worktree, "merge-only");
    git(path, "cherry-pick", picked);
    const preview = await client.request("worktrees.preview", {
      path: worktree,
    });
    assert.equal(preview.items[0].merged, false);
    assert.equal(preview.items[0].deleteBranch, false);
  }));

async function teamParent(client, root, cwd, launch = {}) {
  const parentCli = await registerScriptedCli(client, root, { noReady: true });
  const childCli = await registerResponseCli(client, root);
  const candidate = {
    id: "candidate",
    cli: childCli,
    model: "",
    tools: [],
    minimum: "",
  };
  const team = await client.request("teams.create", {
    definition: {
      name: "Worktree removal",
      description: "",
      instruction: "",
      parent: { ...candidate, id: "parent", cli: parentCli },
      roles: [
        {
          id: "worker",
          name: "Worker",
          when: "",
          limit: "",
          reuse: false,
          split: false,
          instruction: "",
          request: "",
          report: "",
          candidates: { high: [], medium: [candidate], low: [] },
        },
      ],
    },
  });
  await client.request("teams.settings", {
    enabled: true,
    defaultTeam: team.saved.id,
    limits: {},
  });
  const events = await client.events();
  await events.waitFor((event) => event.type === "snapshot");
  const { terminal: summary } = await client.request("team.launch", {
    teamId: team.saved.id,
    cwd,
    ...launch,
  });
  const parent = await client.terminal(summary.id);
  await parent.output("NO_READY_SCREEN");
  await parent.output("INITIAL_REQUEST_RECEIVED:");
  return {
    parent,
    events,
    async delegate(title, worktree = "new") {
      const result = await actorCommand(parent, title, [
        "delegate",
        "--role",
        "Worker",
        "--difficulty",
        "low",
        "--title",
        title,
        "--worktree",
        worktree,
        "--body",
        "AUTO_REPORT_COMPLETED",
      ]);
      const child = (
        await events.waitFor(
          (event) =>
            event.type === "teams.child.updated" &&
            event.child.id === result.data.child &&
            event.child.terminalId,
        )
      ).child;
      const terminal = await client.terminal(child.terminalId);
      await terminal.output("RESPONSE_TURN_DONE:1");
      await events.waitFor(
        (event) =>
          event.type === "teams.child.updated" &&
          event.child.id === child.id &&
          event.child.state === "reported",
      );
      return child;
    },
  };
}

test("親の削除では専用の子worktreeを削除し、既存のworktreeは残す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { path, git, add } = await repository(dataRoot);
    const parentPath = add("parent");
    const existing = add("existing");
    const team = await teamParent(client, dataRoot, parentPath);
    stage("専用と既存のworktreeへ子を委譲する");
    const owned = await team.delegate("owned");
    const borrowed = await team.delegate("borrowed", "existing");
    const preview = await client.request("worktrees.preview", {
      path: parentPath,
    });
    const item = preview.items[0];
    assert.equal(
      item.children.find((child) => child.id === owned.id).remove,
      true,
    );
    assert.equal(
      item.children.find((child) => child.id === borrowed.id).remove,
      false,
    );
    stage("親と専用の子を削除し、既存のworktreeを残す");
    assert.equal(
      (await remove(client, preview, [parentPath])).outcomes[0].removed,
      true,
    );
    assert.equal(await exists(owned.cwd), false);
    assert.equal(await exists(existing), true);
    assert.equal(
      git(path, "rev-parse", "--verify", "refs/heads/existing"),
      git(existing, "rev-parse", "HEAD"),
    );
  }));

test("受け入れただけで未取り込みの子のブランチは削除せずに残す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { path, git, add } = await repository(dataRoot);
    const parentPath = add("parent");
    const team = await teamParent(client, dataRoot, parentPath);
    const child = await team.delegate("child");
    await commit(git, child.cwd, "child");
    await commit(git, path, "main-moved");
    const branch = git(child.cwd, "branch", "--show-current");
    await actorCommand(team.parent, "finish", [
      "finish",
      child.id,
      "--decision",
      "accept",
      "--reason",
      "accepted",
      "--worktree",
      "keep",
    ]);
    stage("子の未取り込みを知らせ、ブランチを保持する");
    const preview = await client.request("worktrees.preview", {
      path: parentPath,
    });
    const childItem = preview.items[0].worktrees.find(
      (item) => item.path === child.cwd,
    );
    assert.equal(childItem.merged, false);
    assert.equal(childItem.deleteBranch, false);
    assert.equal(
      (await remove(client, preview, [parentPath])).outcomes[0].removed,
      true,
    );
    assert.equal(await exists(child.cwd), false);
    assert.equal(git(path, "branch", "--list", branch), branch);
  }));

test("外部Gitのworktree追加と削除を接続中のClientへ知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { path, git, add } = await repository(dataRoot);
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    await client.request("folders.open", { path });
    stage("外部からの追加を受け取る");
    const worktree = add("external");
    const added = await events.waitFor(
      (event) =>
        event.type === "worktrees.changed" &&
        event.repositoryPath === path &&
        event.worktrees.some((item) => item.path === worktree),
    );
    const addedIndex = events.values.indexOf(added);
    stage("外部からの削除を受け取る");
    git(path, "worktree", "remove", worktree);
    await events.waitFor(
      (event) =>
        events.values.indexOf(event) > addedIndex &&
        event.type === "worktrees.changed" &&
        event.repositoryPath === path &&
        !event.worktrees.some((item) => item.path === worktree),
    );
  }));

// reftable needs Git 2.45 or later; older Git in CI cannot create one.
const hasReftable = (() => {
  const path = mkdtempSync(join(tmpdir(), "iori-reftable-"));
  try {
    execFileSync("git", ["init", "-q", "--ref-format=reftable", path], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
})();

test(
  "reftableの参照変更で取り込み済みの表示を更新する",
  { skip: !hasReftable },
  (t) =>
    runHostTest(t, async ({ client, dataRoot, stage }) => {
      const { path, git, add } = await repository(dataRoot, "reftable");
      const base = git(path, "rev-parse", "HEAD");
      const worktree = add("task");
      await writeFile(
        join(path, ".git", "worktrees", "task", "iori-base-commit"),
        base,
      );
      await commit(git, worktree, "task");
      const events = await client.events();
      await events.waitFor((event) => event.type === "snapshot");
      const opened = await client.request("folders.open", { path });
      assert.equal(
        opened.folder.worktrees.find((item) => item.path === worktree).merged,
        false,
      );
      stage("監視を始めて外部のworktree追加を受け取る");
      const marker = add("marker");
      const added = await events.waitFor(
        (event) =>
          event.type === "worktrees.changed" &&
          event.worktrees.some((item) => item.path === marker),
      );
      const addedIndex = events.values.indexOf(added);
      stage("参照だけの更新で取り込み済みになる");
      git(path, "cherry-pick", git(worktree, "rev-parse", "HEAD"));
      await events.waitFor(
        (event) =>
          events.values.indexOf(event) > addedIndex &&
          event.type === "worktrees.changed" &&
          event.worktrees.some((item) => item.path === worktree && item.merged),
      );
    }),
);

test("サイドバーから外した履歴を読む時にGitを起動しない", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path } = await repository(dataRoot);
    await client.request("folders.open", { path });
    await client.request("folders.sidebar.remove", { path });
    const executable = execFileSync("which", ["git"], {
      encoding: "utf8",
    }).trim();
    const log = join(dataRoot, "git-invocations");
    const gitPath = join(dataRoot, "bin", "git");
    await rm(gitPath);
    await writeFile(
      gitPath,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${executable}' "$@"\n`,
    );
    await chmod(gitPath, 0o755);
    const history = await client.request("folders.history", {});
    assert.equal(
      history.folders.find((folder) => folder.path === path).inSidebar,
      false,
    );
    assert.equal(
      await readFile(log, "utf8").catch((error) =>
        error.code === "ENOENT" ? "" : Promise.reject(error),
      ),
      "",
    );
  }));

test("worktreeの削除でその場所のTerminalを閉じる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { add } = await repository(dataRoot);
    const worktree = add("task");
    const { terminal } = await client.request("terminal.create", {
      cwd: worktree,
    });
    const view = await client.terminal(terminal.id);
    await view.input("printf '%s%s\\n' 'BEFORE_' 'REMOVAL'\r");
    await view.output("BEFORE_REMOVAL");
    const preview = await client.request("worktrees.preview", {
      path: worktree,
    });
    assert.ok(
      preview.items[0].terminals.some((item) => item.id === terminal.id),
    );
    assert.equal(
      (await remove(client, preview, [worktree])).outcomes[0].removed,
      true,
    );
    assert.ok(
      !(await client.request("terminal.list")).terminals.some(
        (item) => item.id === terminal.id,
      ),
    );
  }));

test("複数の子が使うworktreeは親を削除しても残す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { add } = await repository(dataRoot);
    const parentPath = add("parent");
    const team = await teamParent(client, dataRoot, parentPath);
    const first = await team.delegate("first");
    const second = await team.delegate("second", basename(first.cwd));
    assert.equal(second.cwd, first.cwd);
    const preview = await client.request("worktrees.preview", {
      path: parentPath,
    });
    assert.equal(
      preview.items[0].children.find((child) => child.id === first.id).remove,
      false,
    );
    assert.equal(
      (await remove(client, preview, [parentPath])).outcomes[0].removed,
      true,
    );
    assert.equal(await exists(first.cwd), true);
  }));

test("子のコミットをcherry-pickして編集した後は子のブランチも片付ける", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const parentPath = add("parent");
    const team = await teamParent(client, dataRoot, parentPath);
    const child = await team.delegate("child");
    await commit(git, child.cwd, "child");
    const branch = git(child.cwd, "branch", "--show-current");
    git(path, "cherry-pick", git(child.cwd, "rev-parse", "HEAD"));
    await writeFile(join(path, "child.txt"), "main edited the line\n");
    git(path, "add", ".");
    git(path, "commit", "-m", "edit after cherry-pick");
    const preview = await client.request("worktrees.preview", {
      path: parentPath,
    });
    const item = preview.items[0].worktrees.find(
      (entry) => entry.path === child.cwd,
    );
    assert.equal(item.merged, true);
    assert.equal(item.deleteBranch, true);
    assert.equal(
      (await remove(client, preview, [parentPath])).outcomes[0].removed,
      true,
    );
    assert.equal(await exists(child.cwd), false);
    assert.equal(git(path, "branch", "--list", branch), "");
  }));

test("受け入れた子とmainが似た別の変更をしても取り込み済みにしない", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const lines = Array.from(
      { length: 40 },
      (_, index) => `line ${index + 1}\n`,
    ).join("");
    await writeFile(join(path, "lines.txt"), lines);
    git(path, "add", ".");
    git(path, "commit", "-m", "lines");
    const parentPath = add("parent");
    const team = await teamParent(client, dataRoot, parentPath);
    const child = await team.delegate("child");
    await writeFile(
      join(child.cwd, "lines.txt"),
      lines.replace("line 20\n", "child twenty\n"),
    );
    git(child.cwd, "add", ".");
    git(
      child.cwd,
      "commit",
      "--author=Child <child@localhost>",
      "-m",
      "change twenty",
    );
    await writeFile(
      join(path, "lines.txt"),
      lines.replace("line 20\n", "main twenty\n"),
    );
    git(path, "add", ".");
    git(path, "commit", "-m", "change twenty");
    await actorCommand(team.parent, "finish", [
      "finish",
      child.id,
      "--decision",
      "accept",
      "--reason",
      "accepted",
      "--worktree",
      "keep",
    ]);
    const preview = await client.request("worktrees.preview", {
      path: parentPath,
    });
    const item = preview.items[0].worktrees.find(
      (entry) => entry.path === child.cwd,
    );
    assert.equal(item.merged, false);
    assert.equal(item.deleteBranch, false);
    const cleanup = await client.request("worktrees.cleanup", { path });
    assert.equal(
      cleanup.items.some((entry) => entry.path === child.cwd),
      false,
    );
  }));

test("受け入れた子をcherry-pickすると取り込み済みになる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const parentPath = add("parent");
    const team = await teamParent(client, dataRoot, parentPath);
    const child = await team.delegate("child");
    await commit(git, child.cwd, "child");
    git(path, "cherry-pick", git(child.cwd, "rev-parse", "HEAD"));
    await actorCommand(team.parent, "finish", [
      "finish",
      child.id,
      "--decision",
      "accept",
      "--reason",
      "accepted",
      "--worktree",
      "keep",
    ]);
    const preview = await client.request("worktrees.preview", {
      path: parentPath,
    });
    const item = preview.items[0].worktrees.find(
      (entry) => entry.path === child.cwd,
    );
    assert.equal(item.merged, true);
    assert.equal(item.deleteBranch, true);
  }));

test("親が競合を解決して取り込み受け入れた子も片付ける", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const lines = Array.from(
      { length: 10 },
      (_, index) => `line ${index + 1}\n`,
    ).join("");
    await writeFile(join(path, "lines.txt"), lines);
    git(path, "add", ".");
    git(path, "commit", "-m", "lines");
    const parentPath = add("parent");
    const team = await teamParent(client, dataRoot, parentPath);
    const child = await team.delegate("child");
    const branch = git(child.cwd, "branch", "--show-current");
    await writeFile(
      join(child.cwd, "lines.txt"),
      lines.replace("line 5\n", "child five\n"),
    );
    git(child.cwd, "add", ".");
    git(child.cwd, "commit", "-m", "child five");
    await writeFile(
      join(parentPath, "lines.txt"),
      lines.replace("line 5\n", "parent five\n"),
    );
    git(parentPath, "add", ".");
    git(parentPath, "commit", "-m", "parent five");
    assert.throws(() =>
      git(parentPath, "cherry-pick", git(child.cwd, "rev-parse", "HEAD")),
    );
    await writeFile(
      join(parentPath, "lines.txt"),
      lines.replace("line 5\n", "parent resolved five\n"),
    );
    git(parentPath, "add", ".");
    git(parentPath, "commit", "-m", "take in child");
    git(path, "merge", "--no-ff", "parent", "-m", "merge parent");
    await actorCommand(team.parent, "finish", [
      "finish",
      child.id,
      "--decision",
      "accept",
      "--reason",
      "accepted",
      "--worktree",
      "keep",
    ]);
    const preview = await client.request("worktrees.preview", {
      path: parentPath,
    });
    const item = preview.items[0].worktrees.find(
      (entry) => entry.path === child.cwd,
    );
    assert.equal(item.merged, true);
    assert.equal(item.deleteBranch, true);
    assert.equal(
      (await remove(client, preview, [parentPath])).outcomes[0].removed,
      true,
    );
    assert.equal(await exists(child.cwd), false);
    assert.equal(git(path, "branch", "--list", branch), "");
  }));
