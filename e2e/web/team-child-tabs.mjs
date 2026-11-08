import { typeTerminal } from "../terminal/scenario.mjs";
import assert from "node:assert/strict";
import { prepareTeamWorker } from "./team-worker.mjs";
import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import { waitFor, wheelWithin } from "../../verification/ui.mjs";
import {
  waitForOperation,
  childFailure,
} from "../../verification/web/operation.mjs";
import { observeTerminalInstances } from "../terminal/scenario.mjs";
import { waitForCliState } from "../cli-screen/scenario.mjs";
import { openSidebar } from "../connection/scenario.mjs";
export async function teamChildTabsScenario(options) {
  const {
    child,
    screen,
    client,
    worktree,
    parentId,
    parentCommand,
    teamRecords,
    teamDelivery,
    capture,
    record,
    mobile,
    desktop,
    shot,
    codexExtra,
  } = await prepareTeamWorker({ ...options, workflow: "team-child-tabs" });
  const initial = await teamRecords();
  const parentLaunchCommand = initial.terminals.find(
    (entry) => entry.id === parentId,
  ).value.command;
  const childCommand = initial.terminals.find(
    (entry) => entry.id === child.terminalId,
  ).value.command;
  assert.ok(parentLaunchCommand.includes('--name "Team startup arguments"'));
  assert.ok(childCommand.includes(codexExtra));
  for (const command of [parentLaunchCommand, childCommand])
    assert.equal(command.includes("unused-model"), false);
  assert.equal(childCommand.includes("model_reasoning_effort=high"), false);
  await record("利用者の起動引数を親・子に保ち、役割の設定で実CLIを起動");
  await screen.wait(".nav-child-branch");
  await openWorkspaceView(screen, "files");
  await screen.wait('[data-iori-field="files-worktree"]');
  const filesWorktree = await screen.attribute(
    '[data-iori-field="files-worktree"]',
    "title",
  );
  assert.equal(filesWorktree, worktree);
  await screen.click(".nav-child-branch");
  await screen.wait(
    `[data-iori-field="git-worktree"][title=${JSON.stringify(child.cwd)}]`,
  );
  assert.equal(
    await screen.attribute(
      "[data-iori-current-worktree-path]",
      "data-iori-current-worktree-path",
    ),
    worktree,
  );
  await openWorkspaceView(screen, "files");
  await screen.wait('[data-iori-field="files-worktree"]');
  assert.equal(
    await screen.attribute('[data-iori-field="files-worktree"]', "title"),
    filesWorktree,
  );
  await record("子ブランチからGitを開いても親の選択とFilesの表示対象を保つ");
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await record("親Claude Codeが既定許可の子Codexへnew worktreeで委譲");
  await capture("children-running");
  await observeTerminalInstances(client);
  const childRow = `[data-iori-child-id="${child.id}"]`;
  await screen.wait(childRow);
  assert.equal(
    await screen.evaluate(
      `Boolean(document.querySelector('[data-iori-tab-id="terminal:${child.terminalId}"]'))`,
    ),
    false,
  );
  await screen.click(`${childRow} .nav-child-button`);
  await screen.wait(
    `[data-iori-terminal-id="${child.terminalId}"][data-iori-stream-state="ready"]`,
  );
  assert.equal(
    await screen.attribute(
      "[data-iori-layout-scope]",
      "data-iori-current-worktree-path",
    ),
    worktree,
  );
  // A child in a new worktree stays inside its parent's layout and can reopen.
  await screen.click(
    `.dock-tab-header:has([data-iori-tab-id="terminal:${child.terminalId}"]) [data-iori-action="workspace-close-tab"]`,
  );
  await screen.click(`${childRow} .nav-child-button`);
  await screen.wait(
    `[data-iori-terminal-id="${child.terminalId}"][data-iori-stream-state="ready"]`,
  );
  await waitForOperation(
    "チーム: 子Codexの最初の応答の受信記録",
    teamDelivery,
    (value) => value.codex.initialReply,
    childFailure(teamRecords, (children) => children[0]),
  );
  await waitForCliState(client, child.terminalId, ["idle", "done"]);
  const ready = await teamDelivery();
  assert.deepEqual(ready.codex.policies, [
    {
      sandbox: "workspace-write",
      networkAccess: false,
      approval: "on-request",
    },
  ]);
  await record("子Codexの応答完了と既定sandbox・network無効を実記録で確認");
  const childPane = `[data-iori-terminal-id="${child.terminalId}"]`;
  // Observe xterm's real wheel conversion without injecting terminal data.
  await screen.evaluate(
    `(()=>{const t=document.querySelector('${childPane} .xterm').parentElement.__e2eTerminal;if(t.buffer.active.type!=='alternate')throw new Error('Child CLI must use the alternate screen');window.__childScrollInputs=[];window.__childScrollSubscription=t.onData(data=>window.__childScrollInputs.push(data));return true;})()`,
  );
  const checkUserInput = async (expected) => {
    await screen.click(`[data-iori-terminal-row="${parentId}"]`);
    const result = await parentCommand(["tasks"]);
    assert.equal(
      Boolean(
        result.data.children.find((entry) => entry.child === child.id)
          .userInput,
      ),
      expected,
    );
    await screen.click(`${childRow} .nav-child-button`);
    await screen.wait(`${childPane}[data-iori-stream-state="ready"]`);
  };
  await wheelWithin(client, `${childPane} .xterm-screen`, -0.5);
  await waitFor(
    () => screen.evaluate("window.__childScrollInputs.length"),
    (count) => count > 0,
    10000,
    "子CLIのスクロールがxtermの入力へ変換される",
  );
  await screen.evaluate("window.__childScrollSubscription.dispose()");
  await checkUserInput(false);
  await typeTerminal(client, "x");
  await checkUserInput(true);
  await screen.key("Backspace");
  await record(
    "代替画面のホイールはiori tasksのuserInputを立てず、文字入力は立てる",
  );
  await mobile({ width: 390, height: 844 });
  await openSidebar(screen);
  await screen.wait(childRow);
  await screen.evaluate("document.documentElement.classList.add('dark')");
  await shot("mobile-children-dark");
  await screen.click(`${childRow} .nav-child-button`);
  await screen.wait(
    `[data-iori-terminal-id="${child.terminalId}"][data-iori-displayed="true"]`,
  );
  assert.equal(await screen.visible('[data-slot="sheet-content"]'), false);
  await record("Mobileのドロワーで子を開き、親の配置を保持");
  await desktop();
  await screen.wait(`${childRow} .nav-child-button`);
  await screen.click(`${childRow} .nav-child-button`);
  await screen.wait(
    `[data-iori-terminal-id="${child.terminalId}"][data-iori-stream-state="ready"]`,
  );
  await waitForCliState(client, child.terminalId, ["idle", "done"]);
}
