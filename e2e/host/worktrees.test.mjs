import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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

// Simulates a process surviving in the worktree that writes .local/evidence
// (or leaves a symlink) right after `git worktree remove` deletes the folder,
// before the Host checks what remains.
async function leaveResidualAfterGitRemoval(root, outside) {
  const gitPath = join(root, "bin", "git");
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const mkdir = execFileSync("which", ["mkdir"], { encoding: "utf8" }).trim();
  const ln = execFileSync("which", ["ln"], { encoding: "utf8" }).trim();
  await rm(gitPath);
  await writeFile(
    gitPath,
    `#!/bin/sh\n'${realGit}' "$@"\ncode=$?\nif [ "$code" -eq 0 ]; then\n  case "$*" in\n    *"worktree remove "*)\n      for last; do :; done\n      case "$last" in\n        *residual-link) '${ln}' -s '${outside}' "$last" ;;\n        *) '${mkdir}' -p "$last/.local/evidence" && printf 'record\\n' > "$last/.local/evidence/record.txt" ;;\n      esac\n      ;;\n  esac\nfi\nexit "$code"\n`,
  );
  await chmod(gitPath, 0o755);
}

// Deep paths make the real recursive deletion fail with ENAMETOOLONG, even
// when the Host runs as root. GNU rm can later remove them using relative IO.
async function injectDeepWorktree(root, when) {
  const gitPath = join(root, "bin", "git");
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const realRm = execFileSync("which", ["rm"], { encoding: "utf8" }).trim();
  const makeDeep = `const fs=require("node:fs");const path=require("node:path");fs.mkdirSync(process.argv[1],{recursive:true});process.chdir(process.argv[1]);for(let i=0;i<45;i++){const n=String(i).padStart(2,"0")+"x".repeat(98);fs.mkdirSync(n);process.chdir(n)}fs.writeFileSync("file","x")`;
  const gate = join(root, "writer-ready");
  if (when === "before") execFileSync("mkfifo", [gate]);
  const writer = `const fs=require("node:fs");fs.writeFileSync(process.argv[2],"ready\\n");setInterval(()=>{try{fs.writeFileSync(process.argv[1]+"/writing","x")}catch{}},0)`;
  await rm(gitPath);
  await writeFile(
    gitPath,
    `#!/bin/sh\ncase "$*" in\n  *"worktree remove "*)\n    for last; do :; done\n    ${when === "before" ? `'${process.execPath}' -e '${makeDeep}' "$last/deep"\n    '${process.execPath}' -e '${writer}' "$last" '${gate}' &\n    writer=$!\n    read -r ready < '${gate}'` : ""}\n    '${realGit}' "$@"\n    code=$?\n    ${when === "after" ? `'${process.execPath}' -e '${makeDeep}' "$last/deep"` : `kill "$writer"\n    wait "$writer" 2>/dev/null\n    '${realRm}' -rf "$last/deep"\n    printf '%s' "$code" > '${join(root, "git-removal-code")}'`}\n    exit "$code";;\nesac\nexec '${realGit}' "$@"\n`,
  );
  await chmod(gitPath, 0o755);
}

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
    const cliId = await registerScriptedCli(client, dataRoot, {
      id: "muse-code",
      observeEnvironment: true,
    });
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
    assert.match(
      await terminal.output("ACTOR_LAUNCH_ENV:"),
      /ACTOR_LAUNCH_ENV:present/u,
    );
    assert.equal(
      await readFile(join(created.path, ".setup-root"), "utf8"),
      path,
    );
    stage("最初の指示付きでOpenCodeを起動する");
    const opencodeId = await registerScriptedCli(client, dataRoot, {
      id: "opencode",
      observeEnvironment: true,
    });
    const { terminal: opencodeSummary } = await client.request("cli.launch", {
      cliId: opencodeId,
      cwd: created.path,
      setupWorktree: true,
      instruction: "最初の指示です",
    });
    const opencodeTerminal = await client.terminal(opencodeSummary.id, {
      cols: 500,
    });
    await opencodeTerminal.output("ACTOR_READY");
    const teamFilesOutput = await opencodeTerminal.output(
      "ACTOR_TEAM_FILES_DIRECTORY:",
    );
    const teamFilesDirectory = teamFilesOutput.match(
      /ACTOR_TEAM_FILES_DIRECTORY:(\S+)/u,
    )?.[1];
    assert.ok(teamFilesDirectory);
    const delivered = await readdir(teamFilesDirectory);
    assert.equal(delivered.length, 1);
    assert.equal(
      await readFile(join(teamFilesDirectory, delivered[0]), "utf8"),
      "最初の指示です",
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

test("確認後に増えた変更は再確認し、減っただけなら削除する", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { add } = await repository(dataRoot);
    const worktree = add("recheck");
    const preview = await client.request("worktrees.preview", {
      path: worktree,
    });
    await writeFile(join(worktree, "new.txt"), "new\n");
    const result = await client.request("worktrees.remove", {
      previewId: preview.id,
      paths: [worktree],
      branches: [],
      recheck: true,
    });
    assert.equal(await exists(worktree), true);
    assert.deepEqual(result.outcomes, []);
    assert.equal(result.preview.items[0].changes.files, 1);
    await rm(join(worktree, "new.txt"));
    await writeFile(join(worktree, "replacement.txt"), "replacement\n");
    const replacement = await client.request("worktrees.remove", {
      previewId: result.preview.id,
      paths: [worktree],
      branches: [],
      recheck: true,
    });
    assert.equal(replacement.preview.items[0].changes.files, 1);
    assert.equal(await exists(worktree), true);
    await rm(join(worktree, "replacement.txt"));
    const confirmed = await client.request("worktrees.remove", {
      previewId: replacement.preview.id,
      paths: [worktree],
      branches: [],
      recheck: true,
    });
    assert.equal(confirmed.outcomes[0].removed, true);
    assert.equal(await exists(worktree), false);

    const sameFile = add("same-file");
    await writeFile(join(sameFile, "draft.txt"), "first\n");
    const sameFilePreview = await client.request("worktrees.preview", {
      path: sameFile,
    });
    await writeFile(join(sameFile, "draft.txt"), "first\nsecond\n");
    const sameFileResult = await client.request("worktrees.remove", {
      previewId: sameFilePreview.id,
      paths: [sameFile],
      branches: [],
      recheck: true,
    });
    assert.equal(sameFileResult.outcomes[0].removed, true);
  }));

test("確認を記憶していない時は削除せず新しい確認を返す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { add } = await repository(dataRoot);
    const worktree = add("unknown-preview");
    const result = await client.request("worktrees.remove", {
      previewId: "unknown",
      paths: [worktree],
      branches: [],
      recheck: true,
    });
    assert.deepEqual(result.outcomes, []);
    assert.equal(result.preview.items[0].path, worktree);
    assert.equal(await exists(worktree), true);
  }));

test("確認後に始まったCLIの作業は停止せず再確認する", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { add } = await repository(dataRoot);
    const worktree = add("new-work");
    const cliId = await registerScriptedCli(client, dataRoot);
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const { terminal: summary } = await client.request("cli.launch", {
      cliId,
      cwd: worktree,
    });
    const terminal = await client.terminal(summary.id);
    await terminal.output("ACTOR_READY");
    const preview = await client.request("worktrees.preview", {
      path: worktree,
    });
    await terminal.input(
      JSON.stringify({ id: "start", hook: "UserPromptSubmit" }) + "\r",
    );
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === summary.id &&
        event.terminal.cliStatus?.state === "active",
    );
    const result = await client.request("worktrees.remove", {
      previewId: preview.id,
      paths: [worktree],
      branches: [],
      recheck: true,
    });
    assert.equal(
      result.preview.working.some((work) => work.id === summary.id),
      true,
    );
    assert.equal(await exists(worktree), true);
    await terminal.output("ACTOR_HOOK:start");
  }));

test("削除するブランチのcommitが入れ替わった時は再確認する", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { add, git } = await repository(dataRoot);
    const worktree = add("changed-commit");
    await commit(git, worktree, "first");
    const preview = await client.request("worktrees.preview", {
      path: worktree,
    });
    git(worktree, "reset", "--hard", "HEAD^");
    await commit(git, worktree, "second");
    const result = await client.request("worktrees.remove", {
      previewId: preview.id,
      paths: [worktree],
      branches: ["changed-commit"],
      recheck: true,
    });
    assert.equal(result.preview.items[0].commits, 1);
    assert.equal(await exists(worktree), true);
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

async function teamParent(client, root, cwd, launch = {}, observePids = false) {
  const parentCli = await registerScriptedCli(client, root, { noReady: true });
  const childCli = await registerResponseCli(client, root);
  if (observePids) {
    for (const [id, script, args] of [
      [parentCli, "scripted-cli.mjs", " --no-ready"],
      [childCli, "response-cli.mjs", ""],
    ]) {
      const scriptPath = fileURLToPath(
        new URL(`../../verification/host/${script}`, import.meta.url),
      );
      const command = `printf '%s %s\\n' "$PWD" "$$" >> '${join(root, "cli-pids")}'; exec '${process.execPath}' '${scriptPath}'${args}`;
      await client.request("cli.definition.save", {
        definition: JSON.stringify({
          schema: 1,
          id,
          name: id,
          command: { shell: command },
          ...(id === childCli
            ? {
                hooks: {
                  format: "claude-settings",
                  file: join(root, "response-settings.json"),
                  sessionId: "session_id",
                  rules: [
                    { event: "SessionStart", state: "idle" },
                    { event: "UserPromptSubmit", state: "active" },
                    { event: "Stop", state: "done" },
                  ],
                },
              }
            : {}),
        }),
      });
    }
  }
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

test("worktreeの削除で対象のチームファイルだけを削除する", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { add } = await repository(dataRoot);
    const parentPath = add("parent");
    const keptPath = add("kept");
    const team = await teamParent(client, dataRoot, parentPath);
    const child = await team.delegate("removed-child");
    const borrowed = await team.delegate("borrowed-child", "kept");
    const keptTeam = await teamParent(client, dataRoot, keptPath);
    const keptChild = await keptTeam.delegate("kept-child", "parent");
    const directory = (id) => join(dataRoot, "iori-host", "team-files", id);
    const removedIds = [child.conversation, child.id, borrowed.id];
    const keptIds = [keptChild.conversation, keptChild.id];
    const keptFiles = new Map();
    for (const id of [...removedIds, ...keptIds]) {
      const files = await readdir(directory(id));
      assert.ok(files.length > 0);
      if (keptIds.includes(id))
        for (const file of files) {
          const path = join(directory(id), file);
          keptFiles.set(path, await readFile(path, "utf8"));
        }
    }
    stage("worktreeとその会話のチームファイルを削除する");
    const preview = await client.request("worktrees.preview", {
      path: parentPath,
    });
    assert.equal(
      (await remove(client, preview, [parentPath])).outcomes[0].removed,
      true,
    );
    for (const id of removedIds)
      assert.equal(await exists(directory(id)), false);
    assert.equal(await exists(keptPath), true);
    for (const [path, body] of keptFiles)
      assert.equal(await readFile(path, "utf8"), body);
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

test("同じ作者が同じ秒に同じファイルを変えた別のcommitを取り込みと誤らない", (t) =>
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
    const branch = git(child.cwd, "branch", "--show-current");
    for (const [cwd, line, message] of [
      [child.cwd, 20, "child change"],
      [path, 35, "main change"],
    ]) {
      await writeFile(
        join(cwd, "lines.txt"),
        lines.replace(`line ${line}\n`, `${message}\n`),
      );
      git(cwd, "add", ".");
      execFileSync("git", ["-C", cwd, "commit", "-m", message], {
        stdio: "pipe",
        env: { ...process.env, GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z" },
      });
    }
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
    assert.equal(
      (await remove(client, preview, [parentPath])).outcomes[0].removed,
      true,
    );
    assert.equal(git(path, "branch", "--list", branch), branch);
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
    execFileSync("git", ["-C", parentPath, "commit", "-m", "parent five"], {
      stdio: "pipe",
      env: { ...process.env, GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z" },
    });
    assert.throws(() =>
      git(parentPath, "cherry-pick", git(child.cwd, "rev-parse", "HEAD")),
    );
    await writeFile(
      join(parentPath, "lines.txt"),
      lines.replace("line 5\n", "parent resolved five\n"),
    );
    git(parentPath, "add", ".");
    git(parentPath, "commit", "--no-edit");
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

test("背景削除中の親子を通知と履歴に示し、完了後に消す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { path, add } = await repository(dataRoot);
    const parentPath = add("pending-parent");
    const team = await teamParent(client, dataRoot, parentPath);
    const child = await team.delegate("pending child");
    await client.request("folders.open", { path });
    const preview = await client.request("worktrees.preview", {
      path: parentPath,
    });
    // Both Git removals wait until the gate file exists. A FIFO read by two
    // processes can close between the two writes and fail with EPIPE.
    const gate = join(dataRoot, "removal-gate");
    const gitPath = join(dataRoot, "bin", "git");
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    await rm(gitPath);
    await writeFile(
      gitPath,
      `#!/bin/sh\ncase "$*" in *"worktree remove"*) while [ ! -e '${gate}' ]; do sleep 0.05; done;; esac\nexec '${realGit}' "$@"\n`,
    );
    await chmod(gitPath, 0o755);
    stage("親子の削除中を通知と履歴から読む");
    const removal = remove(client, preview, [parentPath]);
    const pendingEvent = await team.events.waitFor(
      (event) =>
        event.type === "worktrees.changed" &&
        [parentPath, child.cwd].every((p) =>
          event.worktrees.some((item) => item.path === p && item.removing),
        ),
    );
    const history = await client.request("folders.history", {});
    const worktrees = history.folders.find(
      (folder) => folder.path === path,
    ).worktrees;
    assert.ok(
      [parentPath, child.cwd].every((p) =>
        worktrees.some((item) => item.path === p && item.removing),
      ),
    );
    // Each worktree invokes Git separately; release both removals.
    await writeFile(gate, "");
    assert.ok((await removal).outcomes.every((item) => item.removed));
    await team.events.waitFor(
      (event) =>
        team.events.values.indexOf(event) >
          team.events.values.indexOf(pendingEvent) &&
        event.type === "worktrees.changed" &&
        [parentPath, child.cwd].every(
          (p) => !event.worktrees.some((item) => item.path === p),
        ),
    );
    const done = await client.request("folders.history", {});
    assert.ok(
      [parentPath, child.cwd].every(
        (p) =>
          !done.folders
            .find((folder) => folder.path === path)
            .worktrees.some((item) => item.path === p),
      ),
    );
  }));

test("Gitのlock理由と停止したCLIの有無を失敗結果に返す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { path, git, add } = await repository(dataRoot);
    const locked = add("locked-busy");
    const withoutReason = add("locked-no-reason");
    const cliId = await registerScriptedCli(client, dataRoot);
    const { terminal: summary } = await client.request("cli.launch", {
      cliId,
      cwd: locked,
    });
    await (await client.terminal(summary.id)).output("ACTOR_READY");
    git(path, "worktree", "lock", "--reason", "busy", locked);
    git(path, "worktree", "lock", withoutReason);
    await client.request("folders.open", { path });
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    stage("CLIを停止してlockで失敗する");
    const preview = await client.request("worktrees.preview", { path: locked });
    const failed = (await remove(client, preview, [locked])).outcomes[0];
    assert.equal(failed.removed, false);
    assert.deepEqual(failed.locked, { reason: "busy" });
    assert.equal(failed.stopped, true);
    const pendingEvent = await events.waitFor(
      (event) =>
        event.type === "worktrees.changed" &&
        event.worktrees.some((item) => item.path === locked && item.removing),
    );
    await events.waitFor(
      (event) =>
        events.values.indexOf(event) > events.values.indexOf(pendingEvent) &&
        event.type === "worktrees.changed" &&
        event.worktrees.some((item) => item.path === locked && !item.removing),
    );
    const history = await client.request("folders.history", {});
    assert.ok(
      !history.folders
        .find((folder) => folder.path === path)
        .worktrees.find((item) => item.path === locked).removing,
    );
    stage("理由と停止対象のないlockで失敗する");
    const noReasonPreview = await client.request("worktrees.preview", {
      path: withoutReason,
    });
    const noReason = (await remove(client, noReasonPreview, [withoutReason]))
      .outcomes[0];
    assert.equal(noReason.removed, false);
    assert.deepEqual(noReason.locked, {});
    assert.equal(noReason.stopped, undefined);
  }));

test("Gitで消した直後に残ったフォルダーとsymlinkを中身ごと消す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { path, add } = await repository(dataRoot);
    const folder = add("residual-folder");
    const link = add("residual-link");
    const outside = join(dataRoot, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "keep\n");
    await leaveResidualAfterGitRemoval(dataRoot, outside);
    stage("残ったフォルダーを消す");
    const folderPreview = await client.request("worktrees.preview", {
      path: folder,
    });
    assert.equal(
      (await remove(client, folderPreview, [folder])).outcomes[0].removed,
      true,
    );
    assert.equal(await exists(folder), false);
    stage("残ったsymlinkはリンク先を消さずに消す");
    const linkPreview = await client.request("worktrees.preview", {
      path: link,
    });
    assert.equal(
      (await remove(client, linkPreview, [link])).outcomes[0].removed,
      true,
    );
    assert.equal(await exists(link), false);
    assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "keep\n");
    assert.equal(await exists(path), true);
  }));

test("finish --worktree removeでGitの直後に残ったフォルダーも消す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { path, add } = await repository(dataRoot);
    const parentPath = add("parent");
    const team = await teamParent(client, dataRoot, parentPath);
    const child = await team.delegate("residual child");
    const outside = join(dataRoot, "outside");
    await mkdir(outside);
    await leaveResidualAfterGitRemoval(dataRoot, outside);
    stage("子のworktreeをfinishで消す");
    await actorCommand(team.parent, "finish", [
      "finish",
      child.id,
      "--decision",
      "accept",
      "--reason",
      "accepted",
      "--worktree",
      "remove",
    ]);
    assert.equal(await exists(child.cwd), false);
    assert.equal(await exists(path), true);
  }));

test("残ったフォルダーの削除失敗後も同じfinishでやり直せる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { path, add } = await repository(dataRoot);
    const team = await teamParent(client, dataRoot, add("parent"));
    const child = await team.delegate("retry residual child");
    await injectDeepWorktree(dataRoot, "after");
    const command = [
      "finish",
      child.id,
      "--decision",
      "accept",
      "--reason",
      "accepted",
      "--worktree",
      "remove",
    ];
    stage("残存フォルダーを削除できずfinishが失敗する");
    await assert.rejects(actorCommand(team.parent, "finish-failed", command));
    assert.equal(await exists(child.cwd), true);
    execFileSync("rm", ["-rf", join(child.cwd, "deep")]);
    stage("原因を取り除き同じfinishを再試行する");
    await actorCommand(team.parent, "finish-retry", command);
    assert.equal(await exists(child.cwd), false);
    await team.events.waitFor(
      (event) =>
        event.type === "teams.child.updated" &&
        event.child.id === child.id &&
        event.child.state === "finished",
    );
    assert.equal(await exists(path), true);
  }));

test("Gitの削除が失敗しても管理情報が無ければフォルダーを残さない", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { path, add } = await repository(dataRoot);
    const sidebar = add("git-fails");
    const team = await teamParent(client, dataRoot, add("parent"));
    const child = await team.delegate("git fails child");
    await injectDeepWorktree(dataRoot, "before");
    stage("Gitが削除中に失敗するサイドバーのworktreeを消す");
    const preview = await client.request("worktrees.preview", {
      path: sidebar,
    });
    assert.equal(
      (await remove(client, preview, [sidebar])).outcomes[0].removed,
      true,
    );
    assert.notEqual(
      await readFile(join(dataRoot, "git-removal-code"), "utf8"),
      "0",
    );
    assert.equal(await exists(sidebar), false);
    await rm(join(dataRoot, "git-removal-code"));
    stage("Gitが削除中に失敗する子のworktreeをfinishで消す");
    await actorCommand(team.parent, "finish-git-fails", [
      "finish",
      child.id,
      "--decision",
      "accept",
      "--reason",
      "accepted",
      "--worktree",
      "remove",
      "--discard",
    ]);
    assert.notEqual(
      await readFile(join(dataRoot, "git-removal-code"), "utf8"),
      "0",
    );
    assert.equal(await exists(child.cwd), false);
    assert.equal(await exists(path), true);
  }));

// A deletion request must never turn an ordinary repository folder into a worktree.
test("未登録のサブフォルダーを削除要求に渡してもファイルを残す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, add } = await repository(dataRoot);
    for (const root of [path, add("registered")]) {
      const folder = join(root, "ordinary");
      await mkdir(folder);
      await writeFile(join(folder, "keep.txt"), "keep\n");
      const preview = await client
        .request("worktrees.preview", { path: folder })
        .catch(() => undefined);
      if (preview) await remove(client, preview, [folder]);
      assert.equal(await readFile(join(folder, "keep.txt"), "utf8"), "keep\n");
      assert.equal(preview, undefined);
    }
  }));

test("子のTerminalがコマンド実行中なら残し入力待ちなら親と削除する", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { add } = await repository(dataRoot);
    const parentPath = add("parent");
    const team = await teamParent(client, dataRoot, parentPath);
    const child = await team.delegate("owned");
    const { terminal } = await client.request("terminal.create", {
      cwd: child.cwd,
    });
    const view = await client.terminal(terminal.id);
    await view.input(
      "node -e \"console.log('BUSY_' + 'CHILD');setInterval(()=>{},1000)\"\r",
    );
    await view.output("BUSY_CHILD");
    const busy = await client.request("worktrees.preview", {
      path: parentPath,
    });
    assert.equal(
      busy.items[0].children.find((item) => item.id === child.id).remove,
      false,
    );
    await view.input("\u0003");
    await view.input("printf '%s%s\\n' 'IDLE_' 'CHILD'\r");
    await view.output("IDLE_CHILD");
    const idle = await client.request("worktrees.preview", {
      path: parentPath,
    });
    assert.equal(
      idle.items[0].children.find((item) => item.id === child.id).remove,
      true,
    );
    assert.equal(
      (await remove(client, idle, [parentPath])).outcomes[0].removed,
      true,
    );
    assert.equal(await exists(child.cwd), false);
    assert.equal(
      (await client.request("terminal.list")).terminals.some(
        (item) => item.id === terminal.id,
      ),
      false,
    );
  }));

test("squash済みで変更のないworktreeを片付ける", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const worktree = add("squashed");
    await commit(git, worktree, "squashed");
    git(path, "merge", "--squash", "squashed");
    git(path, "commit", "-m", "squash");
    const preview = await client.request("worktrees.cleanup", { path });
    assert.deepEqual(
      preview.items.map((item) => item.path),
      [worktree],
    );
    assert.equal(preview.items[0].merged, true);
    assert.equal(
      (await remove(client, preview, [worktree])).outcomes[0].removed,
      true,
    );
    assert.equal(await exists(worktree), false);
    assert.equal(git(path, "branch", "--list", "squashed"), "");
  }));

test("rebaseの途中で作ったcommitと元のブランチを知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const worktree = add("rebasing");
    await commit(git, worktree, "first");
    await writeFile(join(worktree, "base.txt"), "branch\n");
    git(worktree, "add", ".");
    git(worktree, "commit", "-m", "conflict");
    await writeFile(join(path, "base.txt"), "main\n");
    git(path, "add", ".");
    git(path, "commit", "-m", "main conflict");
    assert.throws(() => git(worktree, "rebase", "main"));
    const preview = await client.request("worktrees.preview", {
      path: worktree,
    });
    assert.equal(preview.items[0].rebasingBranch, "rebasing");
    assert.equal(preview.items[0].detachedCommits, 1);
  }));

test("commitのないブランチをworktreeと一緒に削除する", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const worktree = add("empty");
    const preview = await client.request("worktrees.preview", {
      path: worktree,
    });
    assert.equal(preview.items[0].deleteBranch, true);
    assert.equal(
      (await remove(client, preview, [worktree])).outcomes[0].removed,
      true,
    );
    assert.equal(await exists(worktree), false);
    assert.equal(git(path, "branch", "--list", "empty"), "");
  }));

test("親子の削除失敗後に子だけを選び、親と他の子を残す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const parentPath = add("retry-parent");
    const team = await teamParent(client, dataRoot, parentPath);
    const locked = await team.delegate("locked child");
    const other = await team.delegate("other child");
    git(path, "worktree", "lock", "--reason", "retry lock", locked.cwd);
    const preview = await client.request("worktrees.preview", {
      path: parentPath,
    });
    const failed = await remove(client, preview, [parentPath]);
    assert.ok(failed.outcomes.some((item) => !item.removed));
    assert.equal(await exists(parentPath), true);
    assert.equal(await exists(locked.cwd), true);
    assert.equal(await exists(other.cwd), true);
    git(path, "worktree", "unlock", locked.cwd);
    const retry = await client.request("worktrees.preview", {
      path: locked.cwd,
    });
    assert.equal(
      (await remove(client, retry, [locked.cwd])).outcomes[0].removed,
      true,
    );
    assert.equal(await exists(locked.cwd), false);
    assert.equal(await exists(parentPath), true);
    assert.equal(await exists(other.cwd), true);
  }));

test("取り込み済みの親子を一つの候補にまとめ、空の子も削除する", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { path, git, add } = await repository(dataRoot);
    const parentPath = add("group-parent");
    const team = await teamParent(client, dataRoot, parentPath);
    const child = await team.delegate("merged child");
    const empty = await team.delegate("empty child");
    await commit(git, child.cwd, "child");
    git(
      parentPath,
      "merge",
      "--no-ff",
      git(child.cwd, "branch", "--show-current"),
      "-m",
      "merge child",
    );
    git(path, "merge", "--no-ff", "group-parent", "-m", "merge parent");
    const preview = await client.request("worktrees.cleanup", { path });
    assert.deepEqual(
      preview.items.map((item) => item.path),
      [parentPath],
    );
    assert.deepEqual(
      preview.items[0].worktrees.map((item) => item.path).sort(),
      [child.cwd, empty.cwd].sort(),
    );
    assert.equal(
      (await remove(client, preview, [parentPath])).outcomes[0].removed,
      true,
    );
    for (const target of [parentPath, child.cwd, empty.cwd])
      assert.equal(await exists(target), false);
  }));

test("親のworktree削除で親子のCLIプロセスを停止する", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { add } = await repository(dataRoot);
    const parentPath = add("process-parent");
    const existing = add("process-existing");
    const team = await teamParent(client, dataRoot, parentPath, {}, true);
    const child = await team.delegate("process child");
    await team.delegate("shared child", basename(child.cwd));
    await team.delegate("existing child", "process-existing");
    const entries = (await readFile(join(dataRoot, "cli-pids"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const separator = line.lastIndexOf(" ");
        return [line.slice(0, separator), Number(line.slice(separator + 1))];
      });
    const pids = entries
      .filter(([cwd]) => [parentPath, child.cwd, existing].includes(cwd))
      .map(([, pid]) => pid);
    assert.equal(pids.length, 4);
    for (const pid of pids) {
      assert.ok(pid);
      process.kill(pid, 0);
    }
    const preview = await client.request("worktrees.preview", {
      path: parentPath,
    });
    assert.equal(
      (await remove(client, preview, [parentPath])).outcomes[0].removed,
      true,
    );
    for (const pid of pids)
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    assert.equal(await exists(existing), true);
  }));
