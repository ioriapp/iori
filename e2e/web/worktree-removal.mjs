import {
  waitForOperation,
  operationFailure,
} from "../../verification/web/operation.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { focusTerminal } from "../cli-screen/scenario.mjs";
import { waitFor } from "../../verification/ui.mjs";
import { openFolder } from "../workspace/scenario.mjs";
import { openSidebar } from "../connection/scenario.mjs";
import { observe, create, typeTerminal } from "../terminal/scenario.mjs";

export async function worktreeRemoval({
  client,
  scenario,
  createPlainFolder,
  desktop,
  mobile,
  phone,
  record,
  repository: original,
  notificationCommand,
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
  const { paths, remote } = await prepareRepository();
  const row = (path) =>
    `button[data-iori-worktree-path=${JSON.stringify(path)}]`;
  const action = (name) => `[data-iori-action="${name}"]`;
  const dialog = '[data-iori-view="worktree-removal"]';
  const description = `${dialog} [data-slot="dialog-description"]`;
  const failureToast = '[data-iori-removal-failure="true"]';
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

  let request, teamSettings, custom, team, launchParent, delegate;
  await desktop();
  await openFolder(screen, root, false);
  await openFolder(screen, repository, false);
  await openSidebar(screen);
  for (const name of Object.keys(paths)) await screen.wait(row(paths[name]));
  if (scenario === "removal-indicators") {
    await sidebarIndicators();
    await rebaseWarning();
    await detachedWarning();
    await emptyConfirmation();
    await previewFailure();
  } else if (scenario === "removal-single") {
    await dirtyDeletion();
    await checkedBranchDeletion();
  } else if (scenario === "removal-cleanup") {
    await cleanupRetry();
  } else if (scenario === "removal-mobile") {
    const mainTabs = await screen.evaluate(
      `([...document.querySelectorAll('[data-iori-tab-id]')].map(e=>e.getAttribute('data-iori-tab-id'))).sort()`,
    );
    await otherClientDeletion(mainTabs);
    await mobileRetry();
    await desktop();
  } else if (scenario === "removal-parent-child") {
    for (const name of ["merged", "squashed"])
      git(repository, "worktree", "remove", paths[name]);
    ({ request, teamSettings, custom, team, launchParent, delegate } =
      await prepareTeamFixture());
    await retryParentDeletion();
    await parentChildDeletion();
    await groupedCleanup();
    await cleanupTeamFixture();
  }
  await openFolder(screen, original, false);

  async function prepareRepository() {
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
    return { paths, remote };
  }

  async function sidebarIndicators() {
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
    await record("Mergedの表示とmainに削除メニューがないことを確認");
  }

  async function rebaseWarning() {
    // A rebase can have one rewritten commit before a later conflict.
    const rebasing = join(root, "rebasing");
    git(repository, "worktree", "add", "-b", "rebasing", rebasing);
    await writeFile(join(rebasing, "rebased.txt"), "first\n");
    git(rebasing, "add", ".");
    git(rebasing, "commit", "-m", "first");
    await writeFile(join(rebasing, "base.txt"), "branch\n");
    git(rebasing, "add", ".");
    git(rebasing, "commit", "-m", "conflict");
    await writeFile(join(repository, "base.txt"), "main\n");
    git(repository, "add", ".");
    git(repository, "commit", "-m", "main conflict");
    assert.throws(() => git(rebasing, "rebase", "main"));
    await screen.wait(row(rebasing));
    await screen.contextMenu(row(rebasing));
    await screen.click(action("worktree-delete"));
    const rebaseSection = `${dialog} [data-iori-removal-rebasing]`;
    await screen.wait(rebaseSection);
    assert.match(
      await screen.text(rebaseSection),
      /rebaseの途中で作ったコミットは失われます/u,
    );
    assert.match(
      await screen.text(rebaseSection),
      /元のコミットはrebasingに残ります/u,
    );
    await screen.key("Escape");
    await record(
      "衝突で止まったrebaseの削除確認に元のブランチと専用の節を表示する",
    );
  }

  async function detachedWarning() {
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
    await screen.click(action("worktree-removal-confirm"));
    await waitForOperation(
      "worktree-removal: detached worktreeの削除",
      () => screen.visible(dialog),
      (visible) => !visible,
      operationFailure(screen, `${dialog} [role="alert"]`),
    );

    assert.match(detachedWarning, /どのブランチにもないcommitは削除されます/u);
    assert.match(detachedWarning, /detached/u);
    assert.match(detachedWarning, /2件のcommit/u);
    await record("分離HEADの2コミットの警告を表示する");
  }

  async function emptyConfirmation() {
    const picked = join(root, "picked");
    git(repository, "worktree", "add", "-b", "picked", picked);
    await screen.wait(row(picked));
    await screen.contextMenu(row(picked));
    await screen.click(action("worktree-delete"));
    await screen.wait(description);
    // Nothing is lost: the confirmation is the one line naming the worktree.
    assert.equal(
      await screen.text(`${dialog} [data-slot="dialog-title"]`),
      "worktreeを削除しますか？",
    );
    assert.equal(await screen.text(description), "pickedを削除します。");
    assert.equal(await screen.visible(changedSection), false);
    assert.equal(await screen.visible(workingSection), false);
    assert.equal(await screen.visible(branchSection), false);
    await screen.click(action("worktree-removal-confirm"));
    await waitForOperation(
      "worktree-removal: 削除確認が閉じる",
      () => screen.visible(dialog),
      (v) => !v,
      operationFailure(screen, `${dialog} [role="alert"]`),
    );
    await record("失うものが無い時は名前の1行だけを出す");
  }

  async function cleanupRetry() {
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
    git(
      repository,
      "worktree",
      "lock",
      "--reason",
      "second independent lock",
      paths.squashed,
    );
    await screen.contextMenu(
      `.nav-repository-button[title=${JSON.stringify(repository)}]`,
    );
    await screen.click(action("worktree-cleanup"));
    assert.doesNotMatch(
      await screen.evaluate(
        `document.querySelector(${JSON.stringify(`${dialog} [data-slot="dialog-description"]`)})?.textContent ?? ""`,
      ),
      /^0件のworktreeを削除/u,
    );
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

    await screen.click(action("worktree-removal-confirm"));
    await screen.wait(failureToast);
    assert.equal(await screen.visible(dialog), false);
    assert.match(await screen.text(failureToast), /independent lock/u);
    await waitFor(() => screen.visible(row(paths.merged)));

    await record("片付け候補とfetch失敗、lockによる削除失敗を表示する");
    git(repository, "worktree", "unlock", paths.merged);
    git(repository, "worktree", "unlock", paths.squashed);
    git(repository, "remote", "set-url", "origin", remote);
    // Keep both failed deletions visible even when their previews cannot load.
    const previewFailure = await client.faults.fail("worktrees.preview");
    await screen.click(action("worktree-removal-retry"));
    const previewAlert = `${dialog} p[role="alert"]`;
    await screen.wait(previewAlert);
    assert.ok(previewFailure.count > 0);
    assert.deepEqual(
      await screen.evaluate(
        `[...document.querySelectorAll('${dialog} .removal-merged-item')].map(e=>e.querySelector('[data-iori-full-name]')?.getAttribute('data-iori-full-name')).sort()`,
      ),
      ["merged", "squashed"],
      "previewが失敗しても削除に失敗した対象を一覧に残す",
    );
    await previewFailure.clear();
    await screen.click(
      `${dialog} .section-body:has(> p[role="alert"]) > button`,
    );
    await screen.wait("[data-iori-removal-select]");
    assert.equal(await screen.visible(previewAlert), false);
    assert.deepEqual(
      await screen.evaluate(
        `[...document.querySelectorAll('[data-iori-removal-select]')].map(e=>e.getAttribute('data-iori-removal-select')).sort()`,
      ),
      [paths.merged, paths.squashed].sort(),
    );
    await record(
      "複数worktreeの削除失敗から再試行してpreviewが失敗しても対象を一覧に残し、再試行で候補を表示する",
    );
    await screen.wait(`${dialog} .removal-previous`);
    assert.match(
      await screen.text(dialog),
      /前回は削除できませんでした。.*independent lock/u,
    );

    await screen.click(action("worktree-removal-confirm"));
    await waitForOperation(
      "worktree-removal: 削除確認が閉じる",
      () => screen.visible(dialog),
      (visible) => !visible,
      operationFailure(screen, `${dialog} [role="alert"]`),
    );
    for (const name of ["merged", "squashed"]) {
      await waitFor(
        () => screen.visible(row(paths[name])),
        (visible) => !visible,
      );
    }
    await record("片付けの確定後にサイドバーから行が消える");
  }

  async function dirtyDeletion() {
    const mainTabs = await screen.evaluate(
      `([...document.querySelectorAll('[data-iori-tab-id]')].map(e=>e.getAttribute('data-iori-tab-id'))).sort()`,
    );
    await screen.click(row(paths.unmerged));
    await observe(
      client,
      "(await import('/src/native-platform-web.ts')).listen",
    );
    const terminal = await create(client);
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

    await writeFile(join(paths.unmerged, "after-preview.txt"), "new\n");
    await screen.click(action("worktree-removal-confirm"));
    await waitFor(
      async () =>
        (await screen.visible(changedSection)) &&
        /3ファイル/u.test(await screen.text(changedSection)),
    );
    assert.equal(await screen.visible(row(paths.unmerged)), true);

    // Observe the transient removal state even when Git completes quickly.
    await screen.evaluate(
      `(()=>{const states=[];const observer=new MutationObserver(()=>{const row=document.querySelector(${JSON.stringify(row(paths.unmerged))});if(row?.closest('[data-iori-worktree-removing="true"]'))states.push(true)});observer.observe(document.querySelector('.nav-sidebar'),{subtree:true,attributes:true,childList:true});window.__ioriRemoving={states,observer}})()`,
    );
    await screen.click(action("worktree-removal-confirm"));
    assert.equal(await screen.visible(dialog), false);

    await waitFor(() =>
      screen.evaluate(
        `!!document.querySelector(${JSON.stringify(row(repository) + ".is-selected")})`,
      ),
    );
    await waitFor(
      () =>
        screen.evaluate(
          `([...document.querySelectorAll('[data-iori-tab-id]')].map(e=>e.getAttribute('data-iori-tab-id'))).sort()`,
        ),
      (tabs) => JSON.stringify(tabs) === JSON.stringify(mainTabs),
    );
    await waitFor(
      () => screen.visible(row(paths.unmerged)),
      (visible) => !visible,
    );
    assert.equal(
      await screen.evaluate(
        `(()=>{const {states,observer}=window.__ioriRemoving;observer.disconnect();delete window.__ioriRemoving;return states.length>0})()`,
      ),
      true,
    );
    assert.equal(await screen.visible(failureToast), false);
    assert.equal(
      await screen.visible(`[data-iori-terminal-row="${terminal}"]`),
      false,
    );
    await record(
      "未取り込みと未コミットの警告を表示し、削除後にTerminalの行が消える",
    );
    return mainTabs;
  }

  async function otherClientDeletion(mainTabs) {
    // A separate Client starts deletion: the observing Client follows the
    // Host's removing event and restores both worktrees' own layouts.
    const remoteLocked = join(root, "remote-$&");
    git(repository, "worktree", "add", "-b", "remote-$&", remoteLocked);
    git(
      repository,
      "worktree",
      "lock",
      "--reason",
      "remote lock",
      remoteLocked,
    );
    await screen.wait(row(remoteLocked));
    await screen.click(row(remoteLocked));
    const readTabs = () =>
      screen.evaluate(
        `([...document.querySelectorAll('[data-iori-tab-id]')].map(e=>e.getAttribute('data-iori-tab-id'))).sort()`,
      );
    const remoteTabs = await waitFor(
      readTabs,
      (tabs) =>
        tabs.length > 0 && JSON.stringify(tabs) !== JSON.stringify(mainTabs),
    );
    const other = await phone();
    await other.screen.wait('[data-iori-view="workspace"]');
    await openSidebar(other.screen);
    await other.screen.longPress(row(remoteLocked));
    await other.screen.click(action("worktree-delete"));
    await other.screen.wait(action("worktree-removal-confirm"));
    await other.screen.click(action("worktree-removal-confirm"));
    await other.screen.wait(failureToast);
    assert.match(
      await other.screen.text(failureToast),
      /remote-\$&を削除できませんでした/u,
    );
    assert.match(await other.screen.text(failureToast), /remote lock/u);
    await waitFor(() =>
      screen.evaluate(
        `!!document.querySelector(${JSON.stringify(row(repository) + ".is-selected")})`,
      ),
    );
    await waitFor(
      readTabs,
      (tabs) => JSON.stringify(tabs) === JSON.stringify(mainTabs),
    );
    await screen.click(row(remoteLocked));
    await waitFor(
      readTabs,
      (tabs) => JSON.stringify(tabs) === JSON.stringify(remoteTabs),
    );
    await other.browser.call("Page.close");
    git(repository, "worktree", "unlock", remoteLocked);
    await screen.click(row(repository));
    await record(
      "別のClientの削除開始でmainの配置へ移り、失敗後は元のworktreeの配置を再び開く",
    );
  }

  async function mobileRetry() {
    git(
      repository,
      "worktree",
      "lock",
      "--reason",
      "verification $& lock",
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

    await screen.click(action("worktree-removal-confirm"));
    await screen.wait(failureToast);
    assert.equal(await screen.visible(dialog), false);
    assert.match(await screen.text(failureToast), /verification \$& lock/u);
    await waitFor(() => screen.visible(row(paths.empty)));

    git(repository, "worktree", "unlock", paths.empty);
    await screen.click(action("worktree-removal-retry"));
    await screen.wait(action("worktree-removal-confirm"));
    assert.match(
      await screen.text(dialog),
      /前回は削除できませんでした。.*verification \$& lock/u,
    );
    await screen.click(action("worktree-removal-confirm"));
    await waitFor(
      () => screen.visible(dialog),
      (visible) => !visible,
    );
    await waitFor(
      () => screen.visible(row(paths.empty)),
      (visible) => !visible,
    );
    await record(
      "スマホの長押しから削除し、lockの理由を表示して再試行すると行が消える",
    );
  }

  async function prepareTeamFixture() {
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
            candidates: {
              low: [],
              medium: [candidate("worker-cli")],
              high: [],
            },
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
    return { request, teamSettings, custom, team, launchParent, delegate };
  }

  async function retryParentDeletion() {
    // A failed parent deletion must keep selection and warnings aligned with the
    // whole tree that the Host would remove on retry.
    const retryParent = await launchParent("retry-parent");
    const retryChild = await delegate(retryParent, "retry locked child");
    await delegate(retryParent, "retry later child");
    git(
      repository,
      "worktree",
      "lock",
      "--reason",
      "retry lock",
      retryChild.cwd,
    );
    await screen.contextMenu(row(retryParent.path));
    await screen.click(action("worktree-delete"));
    await screen.wait(action("worktree-removal-confirm"));
    await screen.click(action("worktree-removal-confirm"));
    await screen.wait(failureToast);
    assert.match(await screen.text(failureToast), /retry lock/u);
    await writeFile(join(retryParent.path, "parent-draft.txt"), "draft\n");
    await writeFile(join(retryChild.cwd, "child-draft.txt"), "draft\n");
    await screen.click(action("worktree-removal-retry"));
    const select = (path) =>
      `${dialog} [data-iori-removal-select=${JSON.stringify(path)}]`;
    await screen.wait(select(retryParent.path));
    assert.equal(
      await screen.text(`${dialog} [data-slot="dialog-title"]`),
      "worktreeを削除しますか？",
    );
    assert.equal(await screen.visible(changedSection), false);
    await screen.click(select(retryParent.path));
    assert.equal(
      await screen.evaluate(
        `document.querySelector(${JSON.stringify(select(retryChild.cwd))}).disabled`,
      ),
      true,
    );
    assert.equal(
      await screen.evaluate(
        `document.querySelector(${JSON.stringify(select(retryChild.cwd))}).dataset.state`,
      ),
      "checked",
    );
    assert.match(await screen.text(description), /3件/u);
    assert.deepEqual(
      await screen.evaluate(
        `[...document.querySelectorAll('[data-iori-removal-changed]')].map(e=>e.getAttribute('data-iori-removal-changed')).sort()`,
      ),
      [retryParent.path, retryChild.cwd].sort(),
    );
    await screen.click(select(retryParent.path));
    assert.equal(
      await screen.evaluate(
        `document.querySelector(${JSON.stringify(select(retryChild.cwd))}).disabled`,
      ),
      false,
    );
    assert.equal(
      await screen.evaluate(
        `document.querySelector(${JSON.stringify(select(retryChild.cwd))}).dataset.state`,
      ),
      "checked",
    );
    await screen.click(select(retryChild.cwd));
    await screen.click(select(retryChild.cwd));
    assert.match(await screen.text(description), /1件/u);
    assert.deepEqual(
      await screen.evaluate(
        `[...document.querySelectorAll('[data-iori-removal-changed]')].map(e=>e.getAttribute('data-iori-removal-changed'))`,
      ),
      [retryChild.cwd],
    );
    git(repository, "worktree", "unlock", retryChild.cwd);
    await screen.click(action("worktree-removal-confirm"));
    await waitFor(
      () => screen.visible(dialog),
      (visible) => !visible,
    );
    await record("親子の再試行で選択と警告を削除範囲に揃える");
  }

  async function parentChildDeletion() {
    const single = await launchParent("single-parent");
    const owned = await delegate(single, "owned child");
    const shared = await delegate(single, "shared child");
    const sharer = await delegate(
      single,
      "sharing child",
      basename(shared.cwd),
    );
    const existing = join(root, "existing-child");
    git(repository, "worktree", "add", "-b", "existing-child", existing);
    const borrowed = await delegate(single, "existing child", "existing-child");
    // Uncommitted work in the parent and in the child it brought along, plus one
    // commit that main does not have.
    await writeFile(join(single.path, "parent-work.txt"), "parent work\n");
    git(single.path, "add", ".");
    git(single.path, "commit", "-m", "parent work");
    await writeFile(join(single.path, "parent-draft.txt"), "draft\n");
    await writeFile(join(owned.cwd, "child-work.txt"), "child work\n");
    git(owned.cwd, "add", ".");
    git(owned.cwd, "commit", "-m", "child work");
    await writeFile(join(owned.cwd, "child-draft.txt"), "draft\n");
    await screen.contextMenu(row(single.path));
    await screen.click(action("worktree-delete"));
    await screen.wait(description);
    assert.equal(await screen.text(description), "single-parentを削除します。");
    // Check the order of all three sections in the confirmation.
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
      [owned.id, shared.id, sharer.id, borrowed.id],
      "作業中の節は状態ごと、その中は作成の順",
    );
    assert.match(
      await screen.text(workingSection),
      /実行中の作業を停止します/u,
    );
    assert.match(await screen.text(workingSection), /Running/u);
    assert.match(
      await screen.text(branchSection),
      /にないcommitがあるブランチ/u,
    );
    assert.match(await screen.text(branchSection), /1件のcommit/u);
    assert.ok(
      (await screen.text(branchSection)).includes(
        git(owned.cwd, "branch", "--show-current"),
      ),
      "取り込んでいない子のブランチを確認画面に表示する",
    );
    assert.equal(await screen.visible(branchLoss), false);
    await screen.scroll(`${dialog} [data-slot="dialog-body"]`, {
      top: 0,
    });
    // The count of commits that disappear appears only once the branch is marked.
    await screen.reveal(branchSection);
    await screen.click(branchSelect("single-parent"));
    await screen.reveal(branchLoss);
    assert.match(await screen.text(branchLoss), /1件のcommitが削除されます。/u);
    await screen.reveal(branchSection);
    await screen.click(branchSelect("single-parent"));
    await screen.evaluate(
      `(()=>{const seen=[];const observer=new MutationObserver(()=>{const p=document.querySelector(${JSON.stringify(row(single.path))})?.closest('[data-iori-worktree-removing="true"]');const c=[...document.querySelectorAll('[data-iori-worktree-removing="true"] .nav-child-branch')].some(e=>e.textContent.includes(${JSON.stringify(git(owned.cwd, "branch", "--show-current"))}));if(p&&c)seen.push(true)});observer.observe(document.querySelector('.nav-sidebar'),{subtree:true,attributes:true,childList:true});window.__ioriParentChild={seen,observer}})()`,
    );
    await screen.click(action("worktree-removal-confirm"));
    assert.equal(await screen.visible(dialog), false);

    await waitForOperation(
      "worktree-removal: 削除確認が閉じる",
      () => screen.visible(dialog),
      (v) => !v,
      operationFailure(screen, `${dialog} [role="alert"]`),
    );
    await waitFor(
      () => screen.visible(row(single.path)),
      (visible) => !visible,
    );
    assert.equal(
      await screen.evaluate(
        `(()=>{const {seen,observer}=window.__ioriParentChild;observer.disconnect();delete window.__ioriParentChild;return seen.length>0})()`,
      ),
      true,
    );
    await record(
      "3つの節・並び順・警告のアイコン・チェックで消えるコミット数と親子の行の削除中表示を確認",
    );
  }

  async function groupedCleanup() {
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
      "worktree-removal: 削除確認が閉じる",
      () => screen.visible(dialog),
      (v) => !v,
      operationFailure(screen, `${dialog} [role="alert"]`),
    );
    await waitFor(
      () => screen.visible(row(grouped.path)),
      (visible) => !visible,
    );
    await waitFor(
      () => screen.visible(row(plainPath)),
      (visible) => !visible,
    );
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
      "複数候補から開いたままのCLIを含む項目を選び、1行の候補のままチェックを保って削除。片付けの間に子のworktreeが通常の行へ現れないことを確認",
    );
  }

  async function checkedBranchDeletion() {
    // Marking the branch deletes it with the worktree.
    const checkedParent = { path: join(root, "checked-parent") };
    git(
      repository,
      "worktree",
      "add",
      "-b",
      "checked-parent",
      checkedParent.path,
    );
    await screen.wait(row(checkedParent.path));
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
      "worktree-removal: 削除確認が閉じる",
      () => screen.visible(dialog),
      (v) => !v,
      operationFailure(screen, `${dialog} [role="alert"]`),
    );
    await waitFor(
      () => screen.visible(row(checkedParent.path)),
      (visible) => !visible,
    );
    // The checkbox's choice reaches the request only through this dialog.
    assert.equal(git(repository, "branch", "--list", "checked-parent"), "");
    await record(
      "ブランチも削除するをチェックすると消えるコミット数を示し、削除でそのブランチも消える",
    );
  }

  async function previewFailure() {
    // Reading the preview fails while the worktree is still listed.
    const broken = join(root, "broken");
    git(repository, "worktree", "add", "-b", "broken", broken);
    await screen.wait(row(broken));
    const loadFailure = await client.faults.fail("worktrees.preview");
    await screen.contextMenu(row(broken));
    await screen.click(action("worktree-delete"));
    await screen.wait(`${dialog} [role="alert"]`);
    assert.match(await screen.text(dialog), /worktreeを読み込めませんでした/u);
    assert.ok(loadFailure.count > 0);
    await screen.key("Escape");
    await waitFor(
      () => screen.visible(dialog),
      (v) => !v,
    );
    await loadFailure.clear();
  }

  async function cleanupTeamFixture() {
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
  }
}
