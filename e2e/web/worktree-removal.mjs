import {
  waitForOperation,
  operationFailure,
} from "../../verification/web/operation.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, access, readFile, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { focusTerminal } from "../cli-screen/scenario.mjs";
import { waitFor } from "../../verification/ui.mjs";
import { openFolder } from "../workspace/scenario.mjs";
import { openSidebar } from "../connection/scenario.mjs";
import {
  observe,
  create,
  typeTerminal,
  observed,
} from "../terminal/scenario.mjs";

export async function worktreeRemoval({
  client,
  createPlainFolder,
  desktop,
  mobile,
  shot,
  record,
  repository: original,
  notificationCommand,
  notificationPids,
}) {
  const screen = client.screen;
  const root = await createPlainFolder();
  const repository = join(root, "cleanup-repository");
  await mkdir(repository);
  const git = (cwd, ...args) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  // A cherry-pick only creates its own commit when the committer date differs;
  // this fixture commits with an old date so main never gets the same object.
  const gitOldCommit = (cwd, ...args) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
      },
    }).trim();
  git(repository, "init", "-b", "main");
  git(repository, "config", "user.name", "Worktree E2E");
  git(repository, "config", "user.email", "worktree@localhost");
  await writeFile(join(repository, "base.txt"), "base\n");
  git(repository, "add", ".");
  git(repository, "commit", "-m", "Initial commit");
  const paths = Object.fromEntries(
    ["empty", "merged", "squashed", "unmerged"].map((name) => [
      name,
      join(root, name),
    ]),
  );
  for (const [name, path] of Object.entries(paths))
    git(repository, "worktree", "add", "-b", name, path);
  for (const name of ["merged", "squashed", "unmerged"]) {
    await writeFile(join(paths[name], `${name}.txt`), `${name}\n`);
    git(paths[name], "add", ".");
    git(paths[name], "commit", "-m", name);
  }
  git(repository, "merge", "--no-ff", "merged", "-m", "Merge task");
  git(repository, "merge", "--squash", "squashed");
  git(repository, "commit", "-m", "Squash task");
  const remote = join(root, "origin.git");
  git(repository, "clone", "--bare", repository, remote);
  git(repository, "remote", "add", "origin", remote);
  git(repository, "fetch");
  await writeFile(
    join(paths.unmerged, "unmerged.txt"),
    "unmerged\nnot committed\n",
  );
  await writeFile(join(paths.unmerged, "untracked.txt"), "untracked\n");
  const row = (path) =>
    `button[data-iori-worktree-path=${JSON.stringify(path)}]`;
  const action = (name) => `[data-iori-action="${name}"]`;
  const dialog = '[data-iori-view="worktree-removal"]';
  const description = `${dialog} [data-slot="dialog-description"]`;
  const changedSection = `${dialog} [data-iori-removal-changes]`;
  const workingSection = `${dialog} [data-iori-removal-working]`;
  const branchSection = `${dialog} [data-iori-removal-branches]`;
  const branchLoss = `${dialog} [data-iori-removal-branch-loss]`;
  const branchSelect = (branch) =>
    `${dialog} [data-iori-removal-branch-select=${JSON.stringify(branch)}]`;
  const workRows = () =>
    screen.evaluate(
      `[...document.querySelectorAll('[data-iori-removal-work]')].map(e=>e.getAttribute('data-iori-removal-work'))`,
    );
  // The same screen at PC, WQHD and phone width in both themes, when the
  // pictures are asked for. `reveal` keeps one part of a scrolling dialog in
  // view at every width.
  const pictures = async (
    name,
    {
      reveal,
      devices = ["pc", "wqhd", "mobile"],
      themes = ["light", "dark"],
    } = {},
  ) => {
    if (process.env.IORI_WORKTREE_REMOVAL_CAPTURE !== "1") return;
    const dark = await screen.evaluate(
      "document.documentElement.classList.contains('dark')",
    );
    for (const [device, width, height] of [
      ["pc", 1440, 1000],
      ["wqhd", 2560, 1440],
      ["mobile", 390, 844],
    ]) {
      if (!devices.includes(device)) continue;
      await client.browser.viewport({ width, height });
      if (reveal) await screen.reveal(reveal);
      for (const theme of themes) {
        await screen.evaluate(
          `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
        );
        await shot(`${device}-${name}-${theme}`);
      }
    }
    await client.browser.viewport({ width: 1440, height: 1000 });
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${dark})`,
    );
  };
  await desktop();
  await openFolder(screen, root, false);
  await openFolder(screen, repository, false);
  await openSidebar(screen);
  for (const name of Object.keys(paths)) await screen.wait(row(paths[name]));
  await pictures("sidebar-rows", { devices: ["pc"] });
  await waitFor(() =>
    screen.evaluate(
      `document.querySelectorAll(${JSON.stringify(row(paths.merged) + " [data-iori-worktree-merged]")}).length === 1`,
    ),
  );
  for (const [name, path] of Object.entries(paths))
    assert.equal(
      await screen.evaluate(
        `!!document.querySelector(${JSON.stringify(row(path) + " [data-iori-worktree-merged]")})`,
      ),
      ["merged", "squashed"].includes(name),
    );
  await screen.contextMenu(row(repository));
  assert.equal(await screen.visible(action("worktree-delete")), false);
  await screen.key("Escape");
  await record(
    "作成のみ・merge・squash・未取り込みの実Gitを用意し、merge/squashだけMerged、mainには削除メニューなしを確認",
  );
  // A detached HEAD can contain commits that no branch or other ref keeps.
  const detached = join(root, "detached");
  git(repository, "worktree", "add", "-b", "detached", detached);
  git(detached, "checkout", "--detach");
  for (const n of [1, 2]) {
    await writeFile(join(detached, `detached-${n}.txt`), `${n}\n`);
    git(detached, "add", ".");
    git(detached, "commit", "-m", `detached ${n}`);
  }
  await screen.wait(row(detached));
  await screen.contextMenu(row(detached));
  await screen.click(action("worktree-delete"));
  await waitFor(() =>
    screen.evaluate(
      `!!document.querySelector(${JSON.stringify(action("worktree-removal-confirm"))}) && !document.querySelector(${JSON.stringify(action("worktree-removal-confirm"))}).disabled`,
    ),
  );
  const detachedWarning = await screen.evaluate(
    `document.querySelector('[data-iori-removal-detached]')?.textContent ?? ''`,
  );
  await pictures("detached-commits", { devices: ["pc"] });
  await screen.click(action("worktree-removal-confirm"));
  await waitForOperation(
    "worktree-removal: detached worktreeの削除",
    () => screen.visible(dialog),
    (visible) => !visible,
    operationFailure(screen, `${dialog} [role="alert"]`),
  );

  // All ordinary patches were cherry-picked, but the merge adds a new file.
  const mergeExtra = join(root, "merge-extra");
  git(repository, "worktree", "add", "-b", "merge-extra", mergeExtra);
  const mergeBase = git(mergeExtra, "rev-parse", "HEAD");
  await writeFile(join(mergeExtra, "picked-for-merge.txt"), "picked\n");
  git(mergeExtra, "add", ".");
  gitOldCommit(mergeExtra, "commit", "-m", "picked for merge");
  const pickedForMerge = git(mergeExtra, "rev-parse", "HEAD");
  await writeFile(join(repository, "main-before-merge.txt"), "main\n");
  git(repository, "add", ".");
  git(repository, "commit", "-m", "main before merge");
  git(mergeExtra, "merge", "--no-ff", "--no-commit", "main");
  await writeFile(join(mergeExtra, "merge-only.txt"), "new in merge\n");
  git(mergeExtra, "add", ".");
  git(mergeExtra, "commit", "-m", "merge with new content");
  git(repository, "cherry-pick", pickedForMerge);
  assert.match(
    git(repository, "cherry", "main", "merge-extra", mergeBase),
    /^- [0-9a-f]+$/u,
  );
  await screen.wait(row(mergeExtra));
  await screen.contextMenu(row(mergeExtra));
  await screen.click(action("worktree-delete"));
  await waitFor(() =>
    screen.evaluate(
      `!!document.querySelector(${JSON.stringify(action("worktree-removal-confirm"))}) && !document.querySelector(${JSON.stringify(action("worktree-removal-confirm"))}).disabled`,
    ),
  );
  const mergeMarked = await screen.visible(
    row(mergeExtra) + " [data-iori-worktree-merged]",
  );
  const mergeBranch = await screen.evaluate(
    `document.querySelector(${JSON.stringify(branchSection)})?.textContent ?? ''`,
  );
  await screen.key("Escape");
  const regressions = [];
  if (
    !/どのブランチにもないcommitは削除されます/u.test(detachedWarning) ||
    !/detached/u.test(detachedWarning) ||
    !/2件のcommit/u.test(detachedWarning)
  )
    regressions.push(`detached warning: ${detachedWarning}`);
  if (mergeMarked || !/merge-extra/u.test(mergeBranch))
    regressions.push(
      `merge content: marked=${mergeMarked}, branch=${mergeBranch}`,
    );
  assert.deepEqual(regressions, []);
  await record(
    "分離HEADの2コミットの警告と、merge commitだけの新しい内容が未取り込みとして残ることを確認",
  );
  // A cherry-pick keeps the patch, and main then edits the same line again.
  const picked = join(root, "picked");
  git(repository, "worktree", "add", "-b", "picked", picked);
  await writeFile(join(picked, "picked.txt"), "picked\n");
  git(picked, "add", ".");
  gitOldCommit(picked, "commit", "-m", "picked");
  git(repository, "cherry-pick", git(picked, "rev-parse", "HEAD"));
  await writeFile(
    join(repository, "picked.txt"),
    "main edited the same line\n",
  );
  git(repository, "add", ".");
  git(repository, "commit", "-m", "main edits the same line");
  await screen.wait(row(picked));
  await waitFor(() =>
    screen.evaluate(
      `document.querySelectorAll(${JSON.stringify(row(picked) + " [data-iori-worktree-merged]")}).length === 1`,
    ),
  );
  await record(
    "cherry-pickの後にmainが同じ行を変えても、取り込み済みのworktreeにMergedが出る",
  );
  await screen.contextMenu(row(picked));
  await screen.click(action("worktree-delete"));
  await screen.wait(description);
  // Nothing is lost: the confirmation is the one line naming the worktree.
  assert.equal(await screen.text(description), "pickedを削除します。");
  assert.equal(await screen.visible(changedSection), false);
  assert.equal(await screen.visible(workingSection), false);
  assert.equal(await screen.visible(branchSection), false);
  await pictures("one-line");
  await screen.click(action("worktree-removal-confirm"));
  await waitForOperation(
    "worktree-removal: 削除が終わりダイアログが閉じる",
    () => screen.visible(dialog),
    (v) => !v,
    operationFailure(screen, `${dialog} [role="alert"]`),
  );
  assert.equal(git(repository, "branch", "--list", "picked"), "");
  await record(
    "失うものが無い時は名前の1行だけを出し、取り込み済みのブランチも一緒に消える",
  );
  // A staged edit reverted only on disk is still uncommitted work.
  await writeFile(join(paths.merged, "merged.txt"), "staged edit\n");
  git(paths.merged, "add", "merged.txt");
  await writeFile(join(paths.merged, "merged.txt"), "merged\n");
  await screen.contextMenu(
    `.nav-repository-button[title=${JSON.stringify(repository)}]`,
  );
  await screen.click(action("worktree-cleanup"));
  const loadingDescription = await screen.evaluate(
    `document.querySelector(${JSON.stringify(`${dialog} [data-slot="dialog-description"]`)})?.textContent ?? ""`,
  );
  assert.doesNotMatch(loadingDescription, /^0件のworktreeを削除/u);
  await screen.wait("[data-iori-removal-select]");
  assert.deepEqual(
    await screen.evaluate(
      `[...document.querySelectorAll('[data-iori-removal-select]')].map(e=>e.getAttribute('data-iori-removal-select'))`,
    ),
    [paths.squashed],
  );
  await screen.key("Escape");
  git(paths.merged, "reset", "HEAD", "--", "merged.txt");
  await record(
    "作業ファイルを元に戻してもステージに変更が残るworktreeは片付け候補に出ない",
  );
  const prunable = join(root, "prunable");
  git(repository, "worktree", "add", "-b", "prunable", prunable);
  await rm(prunable, { recursive: true });
  git(
    repository,
    "remote",
    "set-url",
    "origin",
    join(root, "missing-origin.git"),
  );
  git(
    repository,
    "worktree",
    "lock",
    "--reason",
    "independent lock",
    paths.merged,
  );
  await screen.contextMenu(
    `.nav-repository-button[title=${JSON.stringify(repository)}]`,
  );
  await screen.click(action("worktree-cleanup"));
  await screen.wait("[data-iori-removal-select]");
  await screen.wait("[data-iori-fetch-warning]");
  const candidates = await screen.evaluate(
    `[...document.querySelectorAll('[data-iori-removal-select]')].map(e=>e.getAttribute('data-iori-removal-select')).sort()`,
  );
  assert.deepEqual(candidates, [paths.merged, paths.squashed].sort());
  assert.deepEqual(
    await screen.evaluate(
      `[...document.querySelectorAll('[data-iori-removal-name]')].map(e=>e.textContent.trim()).sort()`,
    ),
    ["merged", "squashed"],
  );
  assert.deepEqual(
    await screen.evaluate(
      `[...document.querySelectorAll('[data-iori-removal-select][data-state="checked"]')].map(e=>e.getAttribute('data-iori-removal-select')).sort()`,
    ),
    [paths.merged, paths.squashed].sort(),
  );
  // Each candidate is one line: its checkbox and its name.
  assert.deepEqual(
    await screen.evaluate(
      `[...document.querySelectorAll('[data-iori-removal-candidate]')].map(e=>[e.getAttribute('data-iori-removal-candidate'),e.textContent.trim()]).sort()`,
    ),
    [
      [paths.merged, "merged"],
      [paths.squashed, "squashed"],
    ].sort(),
  );
  await shot("pc-worktree-cleanup");
  await screen.click(action("worktree-removal-confirm"));
  await waitForOperation(
    "worktree-removal: ロック中の削除の失敗を表示",
    () => screen.visible(`${dialog} [role="alert"]`),
    Boolean,
    async () =>
      !(await screen.visible(dialog)) &&
      "削除の失敗を表示せずダイアログが閉じました",
  );
  assert.match(await screen.text(dialog), /independent lock/u);
  await access(paths.merged);
  assert.equal(
    await access(paths.squashed).then(
      () => true,
      () => false,
    ),
    false,
  );
  await record(
    "prunableを除外しfetch失敗を知らせても候補を表示。独立した1件がlockで失敗しても他の候補は削除",
  );
  git(repository, "worktree", "unlock", paths.merged);
  git(repository, "remote", "set-url", "origin", remote);
  await screen.click(action("worktree-removal-retry"));
  await screen.wait(action("worktree-removal-confirm"));
  await screen.click(action("worktree-removal-confirm"));
  await waitForOperation(
    "worktree-removal: 削除が終わりダイアログが閉じる",
    () => screen.visible(dialog),
    (visible) => !visible,
    operationFailure(screen, `${dialog} [role="alert"]`),
  );
  for (const name of ["merged", "squashed"]) {
    assert.equal(
      await access(paths[name]).then(
        () => true,
        () => false,
      ),
      false,
    );
    assert.equal(git(repository, "branch", "--list", name), "");
    await waitFor(
      () => screen.visible(row(paths[name])),
      (visible) => !visible,
    );
  }
  await record(
    "片付け候補がmerge/squashのみで、確定後に実フォルダー・ブランチ・サイドバーが消えたことを確認",
  );
  await screen.click(row(paths.unmerged));
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  const terminal = await create(client);
  const pidFile = join(root, "shell.pid");
  await typeTerminal(
    client,
    `echo $$ > '${pidFile}'; echo WORKTREE_'REMOVAL_READY'\r`,
  );
  await observed(client, "WORKTREE_REMOVAL_READY");
  const pid = Number((await readFile(pidFile, "utf8")).trim());
  process.kill(pid, 0);
  await openSidebar(screen);
  await screen.contextMenu(row(paths.unmerged));
  await screen.click(action("worktree-delete"));
  await screen.wait(description);
  assert.equal(await screen.text(description), "unmergedを削除します。");
  await screen.wait(changedSection);
  assert.match(
    await screen.text(changedSection),
    /未commitの変更は削除されます/u,
  );
  assert.match(await screen.text(changedSection), /2ファイル/u);
  assert.equal(
    await screen.evaluate(
      `!!document.querySelector(${JSON.stringify(changedSection + " .worktree-removal-warning-heading svg")})`,
    ),
    true,
    "警告の節の見出しに赤の印を置く",
  );
  // A Terminal with no work of its own is stopped without losing anything, so
  // the confirmation does not name it.
  assert.equal(await screen.visible(workingSection), false);
  await screen.wait(branchSection);
  assert.match(await screen.text(branchSection), /1件のcommit/u);
  assert.match(await screen.text(branchSection), /ブランチも削除する/u);
  assert.equal(await screen.visible(branchLoss), false);
  assert.equal(
    await screen.attribute(branchSelect("unmerged"), "data-state"),
    "unchecked",
  );
  assert.equal((await screen.text(dialog)).includes(paths.unmerged), false);
  await shot("pc-worktree-delete");
  // Record every state the pressed button takes while the Host deletes, so a
  // fast reply cannot hide the waiting state from the check.
  await screen.evaluate(
    `(()=>{const b=document.querySelector(${JSON.stringify(action("worktree-removal-confirm"))});const box=()=>{const r=b.getBoundingClientRect();return [r.left,r.width]};window.__ioriPressed={box:box(),name:b.textContent.trim(),busy:[]};new MutationObserver(()=>{if(b.getAttribute('aria-busy')==='true')window.__ioriPressed.busy.push({box:box(),disabled:b.disabled,spinner:!!b.querySelector('[data-slot="spinner"]'),name:b.textContent.trim()})}).observe(b,{attributes:true,attributeFilter:['aria-busy']})})()`,
  );
  await screen.click(action("worktree-removal-confirm"));
  if (await screen.visible(`${action("worktree-removal-confirm")}[aria-busy]`))
    await shot("pc-worktree-delete-pending");
  const pressed = await screen.evaluate("window.__ioriPressed");
  assert.equal(pressed.busy.length > 0, true);
  // The label keeps its place and name: the button neither moves nor resizes.
  assert.deepEqual(pressed.busy[0], {
    box: pressed.box,
    disabled: true,
    spinner: true,
    name: pressed.name,
  });
  await waitForOperation(
    "worktree-removal: 削除が終わりダイアログが閉じる",
    () => screen.visible(dialog),
    (visible) => !visible,
    operationFailure(screen, `${dialog} [role="alert"]`),
  );
  assert.equal(
    await access(paths.unmerged).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.ok(git(repository, "branch", "--list", "unmerged"));
  await waitFor(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      if (error.code === "ESRCH") return true;
      throw error;
    }
  });
  assert.equal(
    await screen.visible(`[data-iori-terminal-row="${terminal}"]`),
    false,
  );
  await record(
    "未取り込み1コミット・未コミット/未追跡2ファイルとTerminalの表示を確認し、削除後はフォルダーと実PTYが消え、ブランチは残る",
  );
  git(
    repository,
    "worktree",
    "lock",
    "--reason",
    "verification lock",
    paths.empty,
  );
  await mobile();
  await openSidebar(screen);
  await screen.longPress(row(paths.empty));
  await screen.click(action("worktree-delete"));
  await screen.wait(description);
  assert.equal(await screen.text(description), "emptyを削除します。");
  assert.equal(await screen.visible(changedSection), false);
  assert.equal(await screen.visible(workingSection), false);
  assert.equal(await screen.visible(branchSection), false);
  await shot("mobile-worktree-delete");
  await screen.click(action("worktree-removal-confirm"));
  await waitForOperation(
    "worktree-removal: ロック中の削除の失敗を表示",
    () => screen.visible(`${dialog} [role="alert"]`),
    Boolean,
    async () =>
      !(await screen.visible(dialog)) &&
      "削除の失敗を表示せずダイアログが閉じました",
  );
  assert.match(await screen.text(dialog), /verification lock/u);
  assert.equal(
    await access(paths.empty).then(
      () => true,
      () => false,
    ),
    true,
  );
  git(repository, "worktree", "unlock", paths.empty);
  await screen.click(action("worktree-removal-retry"));
  await screen.wait(action("worktree-removal-confirm"));
  await screen.click(action("worktree-removal-confirm"));
  await waitFor(
    () => screen.visible(dialog),
    (visible) => !visible,
  );
  assert.equal(
    await access(paths.empty).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.equal(git(repository, "branch", "--list", "empty"), "");
  await record(
    "スマホの実タッチ長押しで削除、Gitのlock拒否理由と実体の保持、手動でlock解除後の再試行でフォルダーとブランチ削除を確認",
  );
  await desktop();
  const request = (method, params) =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,${JSON.stringify(method)},${JSON.stringify(params)});if(!r?.ok)throw new Error('delegation fixture failed: '+${JSON.stringify(method)});return r.result;})()`,
    );
  const teamSettings = await request("teams.list", {});
  const custom = await request("cli.definition.simple", {
    simple: {
      name: "Removal fixture",
      command: notificationCommand,
      modelArgument: "",
    },
  });
  const candidate = (id) => ({
    id,
    cli: custom.cliId,
    model: "",
    tools: [],
    minimum: "",
  });
  const team = await request("teams.create", {
    definition: {
      name: "Removal team",
      description: "Model-free delegation",
      parent: candidate("parent"),
      instruction: "",
      roles: [
        {
          id: "worker",
          name: "Worker",
          when: "Verification",
          limit: "",
          reuse: false,
          split: false,
          instruction: "",
          request: "",
          report: "",
          candidates: { low: [], medium: [candidate("worker-cli")], high: [] },
        },
      ],
    },
  });
  await request("teams.settings", {
    enabled: true,
    defaultTeam: team.saved.id,
    limits: {},
  });
  const launchParent = async (name) => {
    const path = join(root, name);
    git(repository, "worktree", "add", "-b", name, path);
    await screen.wait(row(path));
    await screen.click(row(path));
    const launcher = `[data-iori-team-id="${team.saved.id}"]`;
    await screen.wait(launcher);
    await screen.click(launcher);
    const terminal = await waitFor(async () =>
      (await request("terminal.list", {})).terminals.find(
        (t) => t.cwd === path && t.cli?.id === custom.cliId,
      ),
    );
    await focusTerminal(client, terminal.id);
    return { path, id: terminal.id };
  };
  const delegate = async (parent, title, worktree = "new") => {
    await screen.click(row(parent.path));
    await screen.click(`[data-iori-terminal-row="${parent.id}"]`);
    await focusTerminal(client, parent.id);
    await typeTerminal(
      client,
      `DELEGATE ${JSON.stringify({ title, worktree })}\r`,
    );
    return waitFor(async () =>
      (await request("teams.children", { cwd: parent.path })).children.find(
        (c) => c.title === title && c.state === "running" && c.terminalId,
      ),
    );
  };
  // The real iori finish, run with the delegated parent's own environment (a
  // Linux verification host reads the live process environment).
  const finishChild = async (parent, childId) => {
    const records = (await readFile(notificationPids, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const record = records.find((entry) => entry.cwd === parent.path);
    assert.ok(record, "委譲した親の実プロセスがある");
    const environment = Object.fromEntries(
      (await readFile(`/proc/${record.pid}/environ`))
        .toString()
        .split("\0")
        .filter(Boolean)
        .map((entry) => {
          const index = entry.indexOf("=");
          return [entry.slice(0, index), entry.slice(index + 1)];
        }),
    );
    const answer = execFileSync(
      "iori",
      [
        "finish",
        childId,
        "--decision",
        "accept",
        "--reason",
        "accepted",
        "--worktree",
        "keep",
        "--json",
      ],
      { cwd: parent.path, env: environment, encoding: "utf8" },
    );
    return JSON.parse(answer);
  };
  const single = await launchParent("single-parent");
  const owned = await delegate(single, "owned child");
  const shared = await delegate(single, "shared child");
  const sharer = await delegate(single, "sharing child", basename(shared.cwd));
  const existing = join(root, "existing-child");
  git(repository, "worktree", "add", "-b", "existing-child", existing);
  const borrowed = await delegate(single, "existing child", "existing-child");
  // Enough children that the confirmation is longer than the window and only
  // its body scrolls.
  const extras = [];
  for (const title of [
    "extra child 1",
    "extra child 2",
    "extra child 3",
    "extra child 4",
    "extra child 5",
    "extra child 6",
    "extra child 7",
    "extra child 8",
    "extra child 9",
    "extra child 10",
  ])
    extras.push(await delegate(single, title));
  const live = [single, owned, shared, sharer, borrowed, ...extras];
  const processes = await waitFor(
    async () => {
      const records = (await readFile(notificationPids, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      return records.filter((r) =>
        live.some((c) => (c.cwd ?? c.path) === r.cwd),
      );
    },
    (values) => values.length >= live.length,
  );
  for (const { pid } of processes) process.kill(pid, 0);
  // Uncommitted work in the parent and in the child it brought along, plus one
  // commit that main does not have.
  await writeFile(join(single.path, "parent-work.txt"), "parent work\n");
  git(single.path, "add", ".");
  git(single.path, "commit", "-m", "parent work");
  await writeFile(join(single.path, "parent-draft.txt"), "draft\n");
  await writeFile(join(owned.cwd, "child-draft.txt"), "draft\n");
  await screen.contextMenu(row(single.path));
  await screen.click(action("worktree-delete"));
  await screen.wait(description);
  assert.equal(await screen.text(description), "single-parentを削除します。");
  // All three sections, in the order the dialog shows them. The list is longer
  // than the window, so wait for the end of it in the document, not the screen.
  for (const section of [changedSection, workingSection, branchSection])
    await waitFor(() =>
      screen.evaluate(`!!document.querySelector(${JSON.stringify(section)})`),
    );
  assert.deepEqual(
    await screen.evaluate(
      `[...document.querySelectorAll('[data-iori-view="worktree-removal"] [data-iori-removal-changes], [data-iori-view="worktree-removal"] [data-iori-removal-branches], [data-iori-view="worktree-removal"] [data-iori-removal-working]')].map(e=>e.hasAttribute('data-iori-removal-changes')?'changes':e.hasAttribute('data-iori-removal-branches')?'branches':'working')`,
    ),
    ["changes", "branches", "working"],
    "消えるものを先に、止めるものを後に並べる",
  );
  assert.deepEqual(
    await screen.evaluate(
      `[...document.querySelectorAll('[data-iori-removal-changed]')].map(e=>e.getAttribute('data-iori-removal-changed'))`,
    ),
    [single.path, owned.cwd],
    "未コミットの節はこのworktreeから子を委譲した順",
  );
  assert.match(await screen.text(changedSection), /1ファイル/u);
  assert.equal(await screen.visible(`${workingSection} svg`), false);
  assert.deepEqual(
    await workRows(),
    [
      owned.id,
      shared.id,
      sharer.id,
      borrowed.id,
      ...extras.map((child) => child.id),
    ],
    "作業中の節は状態ごと、その中は作成の順",
  );
  assert.match(await screen.text(workingSection), /実行中の作業を停止します/u);
  assert.match(await screen.text(workingSection), /Running/u);
  assert.match(await screen.text(branchSection), /にないcommitがあるブランチ/u);
  assert.match(await screen.text(branchSection), /1件のcommit/u);
  assert.equal(await screen.visible(branchLoss), false);
  await screen.scroll(`${dialog} [data-slot="scroll-area-viewport"]`, {
    top: 0,
  });
  await pictures("three-sections");
  // The count of commits that disappear appears only once the branch is marked.
  await screen.reveal(branchSection);
  await screen.click(branchSelect("single-parent"));
  await screen.reveal(branchLoss);
  assert.match(await screen.text(branchLoss), /1件のcommitが削除されます。/u);
  await screen.reveal(branchSection);
  await pictures("branch-checked", { reveal: branchSection });
  await screen.click(branchSelect("single-parent"));
  await screen.click(action("worktree-removal-confirm"));
  await waitForOperation(
    "worktree-removal: 削除が終わりダイアログが閉じる",
    () => screen.visible(dialog),
    (v) => !v,
    operationFailure(screen, `${dialog} [role="alert"]`),
  );
  for (const p of [single.path, owned.cwd])
    assert.equal(
      await access(p).then(
        () => true,
        () => false,
      ),
      false,
    );
  await access(shared.cwd);
  await access(existing);
  await waitFor(() =>
    processes.every(({ pid }) => {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        if (error.code === "ESRCH") return true;
        throw error;
      }
    }),
  );
  assert.ok(
    git(repository, "branch", "--list", "single-parent"),
    "チェックしていないブランチは残る",
  );
  await record(
    "3つの節・並び順・警告の印・チェックで消えるコミット数を見せ、チェックしないで削除するとブランチを残し、子は親とだけで共有・既存worktreeは保持。実プロセス停止も確認（モデル呼出しなし）",
  );

  const grouped = await launchParent("group-parent");
  const committed = await delegate(grouped, "merged child");
  const emptyChild = await delegate(grouped, "empty child");
  for (const child of [committed, emptyChild])
    await request("teams.child.stop", { childId: child.id });
  await writeFile(join(committed.cwd, "child.txt"), "child\n");
  git(committed.cwd, "add", ".");
  git(committed.cwd, "commit", "-m", "child");
  git(
    grouped.path,
    "merge",
    "--no-ff",
    git(committed.cwd, "branch", "--show-current"),
    "-m",
    "merge child",
  );
  git(repository, "merge", "--no-ff", "group-parent", "-m", "merge parent");
  const plainPath = join(root, "cleanup-plain");
  git(repository, "worktree", "add", "-b", "cleanup-plain", plainPath);
  await writeFile(join(plainPath, "plain.txt"), "plain\n");
  git(plainPath, "add", ".");
  git(plainPath, "commit", "-m", "plain cleanup candidate");
  git(repository, "merge", "--no-ff", "cleanup-plain", "-m", "merge plain");
  git(repository, "push", "origin", "main");
  await screen.contextMenu(
    `.nav-repository-button[title=${JSON.stringify(repository)}]`,
  );
  await screen.click(action("worktree-cleanup"));
  await screen.wait("[data-iori-removal-select]");
  assert.deepEqual(
    await screen.evaluate(
      `[...document.querySelectorAll('[data-iori-removal-select]')].map(e=>e.getAttribute('data-iori-removal-select'))`,
    ),
    [grouped.path, plainPath].sort(),
  );
  assert.deepEqual(
    await screen.evaluate(
      `[...document.querySelectorAll('[data-iori-removal-name]')].map(e=>e.textContent.trim()).sort()`,
    ),
    ["cleanup-plain", "group-parent"],
  );
  const groupedCandidate = `${dialog} [data-iori-removal-candidate=${JSON.stringify(grouped.path)}]`;
  assert.equal(await screen.text(groupedCandidate), "group-parent");
  assert.equal(await screen.visible(`${dialog} details`), false);
  assert.equal(
    await screen.visible(`${dialog} [data-iori-removal-path]`),
    false,
  );
  await pictures("cleanup");
  const checkedCandidatePaths = await screen.evaluate(
    `([...document.querySelectorAll('[data-iori-removal-select][data-state="checked"]')].map(e=>e.getAttribute('data-iori-removal-select'))).sort()`,
  );
  assert.deepEqual(checkedCandidatePaths, [grouped.path, plainPath].sort());
  const cleanupDescription = await screen.text(
    `${dialog} [data-slot="dialog-description"]`,
  );
  const cleanupCount = cleanupDescription.match(/^(\d+)件のworktreeを削除/u);
  assert.ok(cleanupCount, "片付けの見出しに候補行数を表示");
  assert.equal(Number(cleanupCount[1]), checkedCandidatePaths.length);
  assert.equal(
    await screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');return (await connection.requestHost(connection.getSnapshot().host.publicKey,'terminal.list',{})).result.terminals.some(t=>t.id===${JSON.stringify(grouped.id)}&&t.cli?.id===${JSON.stringify(custom.cliId)})})()`,
    ),
    true,
  );
  const groupedPid = await waitFor(async () => {
    const records = (await readFile(notificationPids, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    return records.find((record) => record.cwd === grouped.path)?.pid;
  });
  process.kill(groupedPid, 0);
  await shot("pc-worktree-cleanup-open-cli");
  assert.deepEqual(
    await screen.evaluate(
      `([...document.querySelectorAll('[data-iori-removal-select][data-state="checked"]')].map(e=>e.getAttribute('data-iori-removal-select'))).sort()`,
    ),
    [grouped.path, plainPath].sort(),
  );
  // Observe every DOM change, including rows that appear and disappear between
  // two runner reads, while the real cleanup request removes parent and children.
  await screen.evaluate(`(()=>{
    const children=${JSON.stringify([committed.cwd, emptyChild.cwd])};
    const appeared=[];
    const inspect=()=>{for(const path of children)if(document.querySelector('button[data-iori-worktree-path='+JSON.stringify(path)+']')&&!appeared.includes(path))appeared.push(path)};
    const observer=new MutationObserver(inspect);
    observer.observe(document.querySelector('.nav-sidebar'),{subtree:true,childList:true});
    window.__ioriCleanupRows={appeared,observer};
    inspect();
  })()`);
  await screen.click(action("worktree-removal-confirm"));
  await waitForOperation(
    "worktree-removal: 削除が終わりダイアログが閉じる",
    () => screen.visible(dialog),
    (v) => !v,
    operationFailure(screen, `${dialog} [role="alert"]`),
  );
  for (const p of [grouped.path, committed.cwd, emptyChild.cwd])
    assert.equal(
      await access(p).then(
        () => true,
        () => false,
      ),
      false,
    );
  assert.equal(
    await access(plainPath).then(
      () => true,
      () => false,
    ),
    false,
  );
  await waitFor(() => {
    try {
      process.kill(groupedPid, 0);
      return false;
    } catch (error) {
      if (error.code === "ESRCH") return true;
      throw error;
    }
  });
  assert.equal(git(repository, "branch", "--list", "cleanup-plain"), "");
  const appeared = await screen.evaluate(`(()=>{
    const {appeared,observer}=window.__ioriCleanupRows;
    observer.disconnect();delete window.__ioriCleanupRows;return appeared;
  })()`);
  assert.deepEqual(
    appeared,
    [],
    "片付けの間、子のworktreeが通常の行として新しく現れない",
  );
  await record(
    "複数候補から開いたままのCLIを含む項目を選び、1行の候補のままチェックを保って削除。片付けの間に子のworktreeが通常の行へ現れず、実プロセスとworktreeが消えることを確認",
  );

  // A child's commit is cherry-picked into main, and main then edits the same
  // line again. The patch is in main, so the child's worktree is merged.
  const pickedParent = await launchParent("picked-parent");
  const pickedChild = await delegate(pickedParent, "picked child");
  await writeFile(join(pickedChild.cwd, "child.txt"), "child line\n");
  git(pickedChild.cwd, "add", ".");
  gitOldCommit(pickedChild.cwd, "commit", "-m", "child commit");
  const pickedBranch = git(pickedChild.cwd, "branch", "--show-current");
  git(repository, "cherry-pick", git(pickedChild.cwd, "rev-parse", "HEAD"));
  await writeFile(
    join(repository, "child.txt"),
    "main edited the child line\n",
  );
  git(repository, "add", ".");
  git(repository, "commit", "-m", "main edits the child line");
  await screen.contextMenu(row(pickedParent.path));
  await screen.click(action("worktree-delete"));
  await screen.wait(description);
  assert.equal(await screen.visible(changedSection), false);
  assert.equal(await screen.visible(branchSection), false);
  await screen.click(action("worktree-removal-confirm"));
  await waitForOperation(
    "worktree-removal: 削除が終わりダイアログが閉じる",
    () => screen.visible(dialog),
    (v) => !v,
    operationFailure(screen, `${dialog} [role="alert"]`),
  );
  assert.equal(
    await access(pickedChild.cwd).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.equal(git(repository, "branch", "--list", pickedBranch), "");
  await record(
    "子のコミットをmainへcherry-pickした後にmainが同じ行を変えても、子は取り込み済みになり、親の確認に警告が出ず、子のブランチも消える",
  );

  // The parent takes the child's commit in with a conflict it resolves to
  // other content, main takes the parent's branch in, and only then does the
  // parent accept: the child's commit has a counterpart in main, so the child
  // worktree counts as merged. The file has several lines so the resolved
  // content still pairs with the child's commit in the Host's range-diff.
  await writeFile(
    join(repository, "lines.txt"),
    Array.from({ length: 10 }, (_, index) => `line ${index + 1}\n`).join(""),
  );
  git(repository, "add", ".");
  git(repository, "commit", "-m", "lines");
  const acceptParent = await launchParent("accept-parent");
  const acceptChild = await delegate(acceptParent, "accept child");
  const acceptBranch = git(acceptChild.cwd, "branch", "--show-current");
  const resolved = async (path, line) => {
    const file = join(path, "lines.txt");
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace("line 5\n", `${line}\n`));
  };
  await resolved(acceptChild.cwd, "child five");
  git(acceptChild.cwd, "add", ".");
  gitOldCommit(acceptChild.cwd, "commit", "-m", "child five");
  await resolved(acceptParent.path, "parent five");
  git(acceptParent.path, "add", ".");
  git(acceptParent.path, "commit", "-m", "parent five");
  assert.throws(() =>
    git(
      acceptParent.path,
      "cherry-pick",
      git(acceptChild.cwd, "rev-parse", "HEAD"),
    ),
  );
  await resolved(acceptParent.path, "parent resolved five");
  git(acceptParent.path, "add", ".");
  git(acceptParent.path, "commit", "-m", "take in the child and resolve");
  git(
    repository,
    "merge",
    "--no-ff",
    "accept-parent",
    "-m",
    "merge accept parent",
  );
  assert.equal((await finishChild(acceptParent, acceptChild.id)).ok, true);
  await screen.contextMenu(row(acceptParent.path));
  await screen.click(action("worktree-delete"));
  await screen.wait(description);
  assert.equal(await screen.visible(changedSection), false);
  assert.equal((await screen.text(dialog)).includes(acceptBranch), false);
  await screen.click(action("worktree-removal-confirm"));
  await waitForOperation(
    "worktree-removal: 削除が終わりダイアログが閉じる",
    () => screen.visible(dialog),
    (v) => !v,
    operationFailure(screen, `${dialog} [role="alert"]`),
  );
  assert.equal(
    await access(acceptChild.cwd).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.equal(git(repository, "branch", "--list", acceptBranch), "");
  await record(
    "親がぶつかりを直して中身を変えて受け入れた子も取り込み済みになり、親の確認に警告が出ず、子のブランチも消える",
  );

  // Accepted but not taken into main yet: the child's branch is still listed,
  // and deleting without marking the branch keeps it.
  const acceptOnlyParent = await launchParent("accept-only-parent");
  const acceptOnlyChild = await delegate(acceptOnlyParent, "accept only child");
  const acceptOnlyBranch = git(acceptOnlyChild.cwd, "branch", "--show-current");
  await writeFile(join(acceptOnlyChild.cwd, "only.txt"), "only\n");
  git(acceptOnlyChild.cwd, "add", ".");
  git(acceptOnlyChild.cwd, "commit", "-m", "accept only");
  assert.equal(
    (await finishChild(acceptOnlyParent, acceptOnlyChild.id)).ok,
    true,
  );
  await screen.contextMenu(row(acceptOnlyParent.path));
  await screen.click(action("worktree-delete"));
  await screen.wait(description);
  await screen.wait(branchSection);
  assert.equal(
    (await screen.text(branchSection)).includes(acceptOnlyBranch),
    true,
    "受け入れたがまだ取り込んでいない子のブランチを出す",
  );
  assert.equal(await screen.visible(branchLoss), false);
  await screen.click(action("worktree-removal-confirm"));
  await waitForOperation(
    "worktree-removal: 削除が終わりダイアログが閉じる",
    () => screen.visible(dialog),
    (v) => !v,
    operationFailure(screen, `${dialog} [role="alert"]`),
  );
  assert.equal(
    await access(acceptOnlyChild.cwd).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.ok(
    git(repository, "branch", "--list", acceptOnlyBranch),
    "チェックしていないブランチは残る",
  );
  await record(
    "受け入れただけで取り込んでいない子は取り込み済みにせず、ブランチの節に出して、チェックしない削除ではブランチを残す",
  );

  // Marking the branch deletes it with the worktree.
  const checkedParent = await launchParent("checked-parent");
  const checkedChild = await delegate(checkedParent, "checked child");
  await writeFile(join(checkedParent.path, "checked.txt"), "checked\n");
  git(checkedParent.path, "add", ".");
  git(checkedParent.path, "commit", "-m", "checked work");
  await screen.contextMenu(row(checkedParent.path));
  await screen.click(action("worktree-delete"));
  await screen.wait(branchSection);
  await screen.click(branchSelect("checked-parent"));
  await screen.wait(branchLoss);
  await screen.click(action("worktree-removal-confirm"));
  await waitForOperation(
    "worktree-removal: 削除が終わりダイアログが閉じる",
    () => screen.visible(dialog),
    (v) => !v,
    operationFailure(screen, `${dialog} [role="alert"]`),
  );
  assert.equal(git(repository, "branch", "--list", "checked-parent"), "");
  assert.equal(
    await access(checkedChild.cwd).then(
      () => true,
      () => false,
    ),
    false,
  );
  await record(
    "ブランチも削除するをチェックすると消えるコミット数を示し、削除でそのブランチも消える",
  );

  // Long names stay on one line and end with an ellipsis.
  const longName = "worktree-with-a-very-long-name-0123456789ab";
  const longParent = await launchParent(longName);
  const longChild = await delegate(
    longParent,
    "a child task with a very long title 0123456789",
  );
  await writeFile(join(longParent.path, "long-work.txt"), "work\n");
  git(longParent.path, "add", "long-work.txt");
  git(longParent.path, "commit", "-m", "long work");
  await writeFile(join(longParent.path, "long-parent.txt"), "draft\n");
  await writeFile(join(longChild.cwd, "long-child.txt"), "draft\n");
  await screen.contextMenu(row(longParent.path));
  await screen.click(action("worktree-delete"));
  await screen.wait(description);
  await screen.wait(branchSection);
  await screen.scroll(`${dialog} [data-slot="scroll-area-viewport"]`, {
    top: 0,
  });
  await pictures("long-names", {
    devices: ["pc", "mobile"],
    themes: ["light"],
  });
  await screen.click(action("worktree-removal-confirm"));
  await waitForOperation(
    "worktree-removal: 削除が終わりダイアログが閉じる",
    () => screen.visible(dialog),
    (v) => !v,
    operationFailure(screen, `${dialog} [role="alert"]`),
  );
  assert.equal(
    await access(longChild.cwd).then(
      () => true,
      () => false,
    ),
    false,
  );
  await record(
    "長い名前の確認をPCとスマホのライトで撮り、削除で子のworktreeが消える",
  );

  // Reading the preview fails while the worktree is still listed.
  const broken = join(root, "broken");
  git(repository, "worktree", "add", "-b", "broken", broken);
  await screen.wait(row(broken));
  await rm(join(broken, ".git"), { recursive: true });
  await screen.contextMenu(row(broken));
  await screen.click(action("worktree-delete"));
  await screen.wait(`${dialog} [role="alert"]`);
  assert.match(await screen.text(dialog), /worktreeを読み込めませんでした/u);
  await pictures("load-failure");
  await screen.key("Escape");
  await waitFor(
    () => screen.visible(dialog),
    (v) => !v,
  );
  await rm(broken, { recursive: true });
  git(repository, "worktree", "prune");
  // Later scenarios create their own teams; leave no default on this fixture.
  await request("teams.delete", { teamId: team.saved.id });
  await request("teams.settings", {
    enabled: teamSettings.enabled,
    defaultTeam: teamSettings.defaultTeam,
    limits: teamSettings.limits,
  });
  // This CLI has no bundled brand icon. Remove the definition owned by this
  // fixture before later launcher scenarios inspect installed CLIs.
  await request("cli.definition.remove", { cliId: custom.cliId });
  await openFolder(screen, original, false);
}
