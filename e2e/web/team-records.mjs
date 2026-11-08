import { returnToWorktree, showEndedChildren } from "./agents-navigation.mjs";
import assert from "node:assert/strict";
import { prepareTeamWorker } from "./team-worker.mjs";
import { fakeMarker } from "../fake-model/marker.mjs";
import {
  waitForOperation,
  childFailure,
} from "../../verification/web/operation.mjs";
import { waitFor } from "../../verification/ui.mjs";
import { waitForCliState } from "../cli-screen/scenario.mjs";
export async function teamRecordsScenario(options) {
  const {
    screen,
    client,
    child,
    childRow,
    desktop,
    worktree,
    teamId,
    savedTeam,
    parentId,
    parentCommand,
    teamRecords,
    record,
  } = await prepareTeamWorker(options, { report: true });
  const reportWaitStarted = Date.now();
  const renamedTeamName = `${savedTeam.name} renamed after delegation`;
  await screen.click('[data-iori-action="open-agents-teams"]');
  await screen.click('[data-iori-action="teams-list"]');
  await screen.click(`.team-list [data-iori-team-id="${teamId}"]`);
  await screen.click(
    `[data-iori-action="team-overview"][data-iori-team-id="${teamId}"]`,
  );
  const teamVersion = `.team-save-header[data-iori-team-id="${teamId}"] [data-iori-team-version]`;
  const versionBeforeRename = await screen.attribute(
    teamVersion,
    "data-iori-team-version",
  );
  await screen.input('[data-iori-field="team-name"]', renamedTeamName);
  await screen.click('[data-iori-action="team-save"]');
  await waitFor(
    () => screen.attribute(teamVersion, "data-iori-team-version"),
    (value) => value !== versionBeforeRename,
    undefined,
    "委譲後のチーム名を保存",
  );
  assert.equal(
    await screen.value('[data-iori-field="team-name"]'),
    renamedTeamName,
  );
  await screen.click('[data-iori-action="open-agents-teams"]');
  await screen.click('[data-iori-action="teams-records"]');
  const period = '.record-period [data-slot="select-trigger"]';
  const startDate = '.record-date-fields input[type="date"]';
  const dates = await screen.evaluate(`(() => {
    const today = new Date();
    const format = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return [format(today), format(tomorrow)];
  })()`);
  await screen.click(period);
  await screen.click('[data-slot="select-item"]:last-child');
  await screen.input(startDate, dates[1]);
  await screen.wait(".record-empty button");
  await screen.input(startDate, dates[0]);
  await screen.wait(".record-row");
  await screen.input(startDate, dates[1]);
  await screen.wait(".record-empty button");
  await screen.click('[data-iori-action="teams-agents"]');
  await screen.click('[data-iori-action="teams-records"]');
  assert.equal(await screen.value(startDate), dates[1]);
  await screen.wait(".record-empty button");
  await screen.click(".record-empty button");
  assert.equal(
    await screen.evaluate(
      'document.querySelectorAll(".record-date-fields input").length',
    ),
    0,
  );
  await screen.wait(".record-row");
  await record(
    "Recordsの日付指定で今日からの記録を表示、明日からは0件、開き直して条件を保持し、解除で全期間に戻る",
  );
  await screen.click('[data-iori-view="records"] [aria-label="Team"]');
  const teamOptions = await screen.evaluate(
    '[...document.querySelectorAll("[data-slot=select-item]")].map(item=>item.textContent.trim())',
  );
  assert.ok(teamOptions.includes(renamedTeamName));
  assert.ok(!teamOptions.includes(savedTeam.name));
  await screen.key("Escape");
  await record("RecordsのTeam絞り込みに変更後のチーム名を表示");
  await returnToWorktree(screen, worktree);
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await waitForCliState(client, parentId, ["idle", "done"]);
  await parentCommand(["read", child.id]);
  const reportWaitMs = Date.now() - reportWaitStarted;
  await parentCommand([
    "send",
    child.id,
    "--kind",
    "revise",
    "--body",
    "Confirm explicitly that no files changed, then report again." +
      fakeMarker("team-revise"),
  ]);
  const revisionSentAt = Date.now();
  const revised = await waitForOperation(
    "チーム: 親の差し戻しを記録し子が再報告",
    teamRecords,
    (value) =>
      value.tasks[0].revisions.length === 1 &&
      value.children[0].reportFiles.length >= 2 &&
      value.children[0].state === "reported",
    childFailure(teamRecords, (children) => children[0]),
  );
  const revisionWorkMs = revised.children[0].reportedAt - revisionSentAt;
  await waitForCliState(client, parentId, ["idle", "done"]);
  await parentCommand([
    "finish",
    child.id,
    "--decision",
    "accept",
    "--reason",
    "Question answered and report verified.",
    "--worktree",
    "keep",
  ]);
  await screen.wait('[data-iori-action="children-ended"]');
  await showEndedChildren(screen);
  await screen.wait(`${childRow}[data-iori-child-state="finished"]`);
  assert.ok(
    (await screen.text(`${childRow} .nav-child-state`)).startsWith("Finished"),
  );

  await screen.click(`${childRow} .nav-child-button`);
  await screen.wait(
    `[data-iori-terminal-id="${child.terminalId}"][data-iori-stream-state="ended"]`,
  );
  assert.equal(
    await screen.attribute(
      `[data-iori-terminal-id="${child.terminalId}"]`,
      "data-iori-state",
    ),
    "error",
  );
  await record("終了した子の最後の画面をHostから再表示");
  await desktop();
  await screen.wait(`[data-iori-terminal-row="${parentId}"]`);
  await showEndedChildren(screen);
  await screen.click(`${childRow} .nav-child-button`);
  await screen.wait(
    `[data-iori-terminal-id="${child.terminalId}"][data-iori-stream-state="ended"]`,
  );
  const otherWorktree = await screen.evaluate(
    `([...document.querySelectorAll('button[data-iori-worktree-path]')].find(button=>button.dataset.ioriWorktreePath!==${JSON.stringify(worktree)}))?.dataset.ioriWorktreePath`,
  );
  assert.ok(otherWorktree);
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(otherWorktree)}]`,
  );
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await screen.wait(`[data-iori-tab-id="terminal:${child.terminalId}"]`);
  await record("終了子タブがworktree往復で残る");
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await record("親の受け入れで子がFinishedとなり、終了した子の画面を再表示");
  await screen.click(
    `.dock-tab-header:has([data-iori-tab-id="terminal:${child.terminalId}"]) .dock-tab-close`,
  );
  await screen.click('[data-iori-action="open-agents-teams"]');
  await screen.click('[data-iori-action="teams-records"]');
  await screen.wait(".record-row");
  const roleNames = () =>
    screen.evaluate(
      "[...document.querySelectorAll('.record-role h2')].map(el => el.textContent.trim())",
    );
  const allRoles = await roleNames();
  const expectedRoles = savedTeam.roles
    .map((role) => role.name)
    .filter((name) => allRoles.includes(name));
  assert.deepEqual(allRoles, expectedRoles, "Records follows team role order");
  const workerCandidate = await waitFor(() =>
    screen.evaluate(
      `(()=>{const roles=[...document.querySelectorAll('[data-iori-view="records"] .record-role')];const index=roles.findIndex(role=>role.querySelector('h2')?.textContent.trim()===${JSON.stringify(savedTeam.roles[0].name)});return index<0?null:'.record-role:nth-of-type('+(index+1)+') [data-iori-record-candidate="codex"]';})()`,
    ),
  );
  const measurements = await screen.evaluate(
    `(()=>{const cells=document.querySelector(${JSON.stringify(workerCandidate)}).querySelectorAll('.record-cell');return [cells[6].textContent,cells[8].textContent];})()`,
  );
  assert.match(measurements[0], /Input\s*\d/);
  assert.match(measurements[1], /Cache hit\s*\d+%/);
  await screen.click(
    '.record-filters > .record-filter:last-child [data-slot="select-trigger"]',
  );
  await screen.click('[data-slot="select-item"]:nth-child(2)');
  assert.equal(
    await screen.text(
      '.record-filters > .record-filter:last-child [data-slot="select-trigger"]',
    ),
    "Tokens",
  );
  const candidateNumber = await screen.text(
    `${workerCandidate} .record-candidate-number`,
  );
  const pointSelector = workerCandidate.replace(
    '[data-iori-record-candidate="codex"]',
    '[data-iori-record-point="codex"]',
  );
  assert.ok(
    (
      await screen.text(
        `[id=${JSON.stringify(await screen.attribute(pointSelector, "aria-describedby"))}]`,
      )
    )
      .split("·")
      .includes(candidateNumber),
  );
  await screen.click(pointSelector);
  await screen.wait('[data-iori-view="record-task-list"]');
  const taskRecord = `[data-iori-record-task="${child.task}"]`;
  await screen.wait(taskRecord);
  const taskRecordText = await screen.text(taskRecord);
  assert.ok(taskRecordText.includes(`${renamedTeamName} · Version`));
  assert.ok(!taskRecordText.includes(`${savedTeam.name} · Version`));
  await record(
    "RecordsのInputとCache hitの数値を確認し、Tokens軸の点から担当タスクを開く",
  );
  const finishedChild = (await teamRecords()).children.find(
    (entry) => entry.id === child.id,
  );
  assert.ok(finishedChild.workMs >= revisionWorkMs);
  // The idle window contains the real Records filtering and report reading.
  assert.ok(finishedChild.workMs <= finishedChild.elapsedMs - reportWaitMs);
  const workSeconds = Math.floor(finishedChild.workMs / 1000);
  const displayedWorkTime =
    workSeconds < 60
      ? `${workSeconds}s`
      : workSeconds < 3600
        ? `${Math.floor(workSeconds / 60)}m`
        : `${Math.floor(workSeconds / 3600)}h ${Math.floor((workSeconds % 3600) / 60)}m`;
  assert.ok(
    (await screen.text(`[data-iori-record-task="${child.task}"]`)).includes(
      `${displayedWorkTime} ·`,
    ),
  );
  await record("Recordsの一覧の時間が判定の待ち時間を除いた子の作業時間と一致");
  await screen.click(`[data-iori-record-task="${child.task}"]`);
  await screen.wait('[data-iori-view="task-history"] .task-timeline li');
  const history = await screen.text('[data-iori-view="task-history"]');
  assert.ok(history.includes("Revise"));
  assert.ok(history.includes("Accepted"));
  assert.ok(history.includes("Confirm explicitly that no files changed"));
  await screen.click('[data-iori-view="task-history"] .history-links button');
  await screen.wait(
    `[data-iori-terminal-id="${child.terminalId}"][data-iori-stream-state="ended"]`,
  );

  await record("Recordsで候補・担当タスク・差し戻し本文と受け入れの経緯を表示");
}
