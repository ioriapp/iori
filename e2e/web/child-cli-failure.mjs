import { fakeMarker } from "../fake-model/marker.mjs";
import {
  waitForOperation,
  cliFailure,
  childFailure,
  unexpectedChildCompletion,
} from "../../verification/web/operation.mjs";
import { showEndedChildren } from "./agents-navigation.mjs";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  childRequestText,
  previousWorkerText,
  teamNotice,
} from "../../packages/protocol/src/team-text.ts";
import { pasteToCli } from "./cli-input.mjs";
import { waitForCliState } from "../cli-screen/scenario.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import { childCliFailureScripts } from "../fake-model/child-cli-failure.mjs";

export async function childCliFailureScenario({
  restartPreservingHost,
  session,
  client,
  teamId,
  definition,
  parentId,
  parentCommand,
  teamRecords,
  teamDelivery,
  record,
}) {
  const screen = client.screen;
  const role = definition.roles[0];
  const invalidModel = "iori-verification-unavailable-model";
  const changed = {
    ...definition,
    roles: [
      {
        ...role,
        candidates: {
          high: [],
          medium: [],
          low: [{ ...role.candidates.low[0], model: invalidModel }],
        },
      },
    ],
  };
  await screen.evaluate(
    `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,'teams.save',${JSON.stringify({ teamId, definition: changed })});if(!r.ok)throw new Error('team save failed');})()`,
  );
  await parentCommand([
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "low",
    "--title",
    "CLI failure",
    "--worktree",
    "parent",
    "--body",
    "Reply briefly and end your turn." + fakeMarker("failure-codex"),
  ]);
  const records = await waitForOperation(
    "child-cli-failure: 失敗検証の子を起動",
    teamRecords,
    (v) => v.children[0]?.terminalId,
    childFailure(teamRecords, (children) => children[0]),
  );
  const child = records.children[0];
  await screen.click(`[data-iori-child-id="${child.id}"] .nav-child-button`);
  await waitForOperation(
    "child-cli-failure: 子の失敗とCLIの理由を表示",
    () => screen.text(`[data-iori-child-id="${child.id}"] .nav-child-state`),
    (text) => text.startsWith("Failed") && text.includes(invalidModel),
    unexpectedChildCompletion(teamRecords, (children) => children[0]),
  );
  const failed = (await teamRecords()).children[0];
  assert.equal(failed.state, "failed");
  assert.match(failed.failure, /iori-verification-unavailable-model/u);
  await openWorkspaceView(screen, "board");
  await screen.wait(`[data-iori-board-agent="${child.id}"]`);
  assert.equal(
    await screen.visible('[data-iori-action="board-finished"]'),
    false,
  );
  assert.equal(
    await screen.visible(`[data-iori-board-agent="${child.id}"]`),
    true,
  );
  assert.ok(
    (await screen.text(`[data-iori-board-agent="${child.id}"]`)).includes(
      failed.failure,
    ),
  );
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await waitFor(
    () => teamDelivery({ line: failed.failure, since: child.createdAt }),
    (v) => v.claude.noticeReceived,
    120000,
    "親CLIが失敗理由を受信",
  );
  await waitForOperation(
    "child-cli-failure: 親が失敗の知らせへの応答を完了",
    teamDelivery,
    (value) => value.claude.pendingNotices === 0,
    cliFailure(screen, parentId),
  );
  await record("Codexのモデルエラーを子の行・Board・親への知らせに表示");
  await screen.click(`[data-iori-child-id="${child.id}"] .nav-child-button`);
  await pasteToCli(
    client,
    "Reply briefly and end your turn." + fakeMarker("failure-codex"),
  );
  await waitFor(
    () => screen.text(`[data-iori-child-id="${child.id}"] .nav-child-state`),
    (value) => value === "Running",
    30000,
    "直接の再入力でRunningに戻る",
  );
  await waitForOperation(
    "child-cli-failure: 再入力のエラーを再び検知",
    teamRecords,
    (value) => value.children[0].state === "failed",
    unexpectedChildCompletion(teamRecords, (children) => children[0]),
  );
  await record("失敗後の子へ直接再入力するとRunningへ戻り、次の失敗も検知");
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  let hostStopped;
  const after = new Promise((resolve) => {
    hostStopped = resolve;
  });
  childCliFailureScripts["failure-codex"][0] = {
    ...childCliFailureScripts["failure-codex"][0],
    after,
  };
  await parentCommand([
    "send",
    child.id,
    "--kind",
    "request",
    "--body",
    "Reply briefly and end your turn." + fakeMarker("failure-codex"),
  ]);
  await waitForCliState(client, child.terminalId, ["active"]);
  const rollout = (await session(child.terminalId)).session.file;
  let completedTask;
  let rolloutEvents = [];
  await restartPreservingHost(async () => {
    hostStopped();
    try {
      await waitForOperation(
        "child-cli-failure: 再起動を挟んだCodexの応答がエラーで終わる",
        async () => {
          const lines = (await readFile(rollout, "utf8")).trim().split("\n");
          const events = lines.flatMap((line) => {
            try {
              const row = JSON.parse(line);
              return row.type === "event_msg" &&
                ["task_started", "task_complete"].includes(row.payload?.type)
                ? [row.payload]
                : [];
            } catch {
              return [];
            }
          });
          rolloutEvents = events.map((event) =>
            event.type === "task_complete" && event.error
              ? "task_complete(error)"
              : event.type,
          );
          completedTask = events.at(-1);
          return completedTask;
        },
        (value) => value?.type === "task_complete" && value.error,
        async () =>
          completedTask?.type === "task_complete" && !completedTask.error
            ? "CLIがエラーなしで応答を完了しました"
            : false,
      );
    } finally {
      await record(
        `Codex rollout event types: ${JSON.stringify(rolloutEvents)}`,
      );
    }
  });
  await waitFor(
    teamRecords,
    (value) => value.children[0].state === "failed",
    120000,
    "Host再起動後に失敗を復元",
  );
  await waitFor(
    () => screen.text(`[data-iori-child-id="${child.id}"] .nav-child-state`),
    (value) => value.includes(failed.failure),
    30000,
    "再起動後も同じ失敗理由を表示",
  );
  await record("親のsendで続行し、Host不在中のCodexの失敗を再起動後に検知");

  // End the live Codex before assigning this one-slot role to Claude Code.
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  assert.equal(
    await screen.visible(
      `[data-iori-child-id="${child.id}"] [data-iori-action="child-menu"]`,
    ),
    true,
  );
  await parentCommand(["stop", child.id]);
  await waitFor(
    teamRecords,
    (value) => value.children[0].state === "stopped",
    30000,
    "親の停止を反映",
  );
  await showEndedChildren(screen);
  assert.equal(
    await screen.text(`[data-iori-child-id="${child.id}"] .nav-child-state`),
    "Stopped · 親の操作",
  );
  const claudeDefinition = {
    ...changed,
    roles: [
      {
        ...changed.roles[0],
        candidates: {
          high: [],
          medium: [],
          low: [
            { ...role.candidates.low[0], cli: "claude", model: invalidModel },
          ],
        },
      },
    ],
  };
  await screen.evaluate(
    `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,'teams.save',${JSON.stringify({ teamId, definition: claudeDefinition })});if(!r.ok)throw new Error('team save failed');})()`,
  );
  await parentCommand([
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "low",
    "--title",
    "Claude CLI failure",
    "--worktree",
    "parent",
    "--body",
    "Reply briefly and end your turn." + fakeMarker("failure-claude"),
  ]);
  const claudeRecords = await waitForOperation(
    "child-cli-failure: Claude Codeのエラー確認用の子を起動",
    teamRecords,
    (value) =>
      value.children.find((c) => c.title === "Claude CLI failure")?.terminalId,
    childFailure(teamRecords, (children) =>
      children.find((c) => c.title === "Claude CLI failure"),
    ),
  );
  const claude = claudeRecords.children.find(
    (c) => c.title === "Claude CLI failure",
  );
  await screen.click(`[data-iori-child-id="${claude.id}"] .nav-child-button`);
  await waitForOperation(
    "child-cli-failure: Claude CodeのStopFailureを受信",
    teamRecords,
    (value) =>
      value.children.find((c) => c.id === claude.id)?.state === "failed",
    unexpectedChildCompletion(teamRecords, (children) =>
      children.find((c) => c.id === claude.id),
    ),
  );
  const claudeFailure = (await teamRecords()).children.find(
    (c) => c.id === claude.id,
  ).failure;
  assert.ok(claudeFailure?.trim());
  await waitFor(
    () => screen.text(`[data-iori-child-id="${claude.id}"] .nav-child-state`),
    (value) => value.includes(claudeFailure),
    30000,
    "Claude Codeの失敗理由を画面へ反映",
  );
  // The failed child remains visible with Finished collapsed.
  const ended = '[data-iori-action="children-ended"]';
  if ((await screen.attribute(ended, "aria-expanded")) === "true")
    await screen.click(ended);
  assert.equal(
    await screen.visible(`[data-iori-child-id="${claude.id}"]`),
    true,
  );
  await openWorkspaceView(screen, "board");
  await screen.wait(
    '[data-iori-action="board-finished"][aria-expanded="false"]',
  );
  assert.equal(
    await screen.visible(`[data-iori-board-agent="${claude.id}"]`),
    true,
  );
  const boardHeight = await screen.evaluate(
    `(()=>{const board=document.querySelector('.board');const contentBottom=Math.max(...Array.from(board.children,child=>child.getBoundingClientRect().bottom));const contentHeight=contentBottom-board.getBoundingClientRect().top+parseFloat(getComputedStyle(board).paddingBottom);return Math.ceil(window.innerHeight-board.clientHeight+contentHeight+1);})()`,
  );
  await client.browser.viewport({ width: 1440, height: boardHeight });
  const boardWidths = `(()=>{const board=document.querySelector('.board');return {clientWidth:board.clientWidth,plan:document.querySelector('.plan-section').getBoundingClientRect().width,agents:document.querySelector('.agents-section').getBoundingClientRect().width,scrolling:board.scrollHeight>board.clientHeight};})()`;
  const beforeFinished = await screen.evaluate(boardWidths);
  if (
    (await screen.attribute(
      '[data-iori-action="board-finished"]',
      "aria-expanded",
    )) === "false"
  )
    await screen.click('[data-iori-action="board-finished"]');
  assert.equal(beforeFinished.scrolling, false, JSON.stringify(beforeFinished));
  const afterFinished = await waitFor(
    () => screen.evaluate(boardWidths),
    (value) => value.scrolling,
  );
  assert.deepEqual(afterFinished, { ...beforeFinished, scrolling: true });
  await client.browser.viewport({ width: 1440, height: 1000 });
  assert.ok(
    (await screen.text(`[data-iori-board-agent="${claude.id}"]`)).includes(
      claudeFailure,
    ),
  );
  assert.equal(
    await screen.text(`[data-iori-board-agent="${child.id}"] .agent-current`),
    "Stopped · 親の操作",
  );
  const failureLayout = await screen.evaluate(
    `(()=>{const e=document.querySelector('[data-iori-board-agent="${claude.id}"] .agent-current');const rect=e.getBoundingClientRect();const panel=e.closest('[data-iori-board-agent]');const bounds=panel.getBoundingClientRect();return {multipleLines:rect.height>=2*parseFloat(getComputedStyle(e).lineHeight),within:e.scrollWidth<=e.clientWidth&&rect.left>=bounds.left&&rect.right<=bounds.right};})()`,
  );
  assert.deepEqual(failureLayout, { multipleLines: true, within: true });
  await waitFor(
    () => teamDelivery({ line: claudeFailure, since: claude.createdAt }),
    (value) => value.claude.noticeReceived,
    120000,
    "親がClaude Codeのエラー理由を受信",
  );
  await waitForOperation(
    "child-cli-failure: 親が失敗の知らせへの応答を完了",
    teamDelivery,
    (value) => value.claude.pendingNotices === 0,
    cliFailure(screen, parentId),
  );
  await record(
    "Claude CodeのStopFailureで失敗理由を子の行・Board・親への知らせに表示",
  );
  await screen.click(`[data-iori-child-id="${claude.id}"] .nav-child-button`);
  await screen.contextMenu(
    `.dock-tab-header:has([data-iori-tab-id="terminal:${claude.terminalId}"])`,
  );
  await screen.click('[data-iori-action="child-tab-stop"]');
  await waitFor(
    teamRecords,
    (value) =>
      value.children.find((c) => c.id === claude.id)?.state === "stopped",
    30000,
    "失敗した子をタブのメニューから停止",
  );
  const opencodeDefinition = {
    ...changed,
    roles: [
      {
        ...role,
        candidates: {
          high: [],
          medium: [],
          low: [
            {
              ...role.candidates.low[0],
              cli: "opencode",
              model: `opencode/${invalidModel}`,
            },
          ],
        },
      },
    ],
  };
  await screen.evaluate(
    `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,'teams.save',${JSON.stringify({ teamId, definition: opencodeDefinition })});if(!r.ok)throw new Error('team save failed');})()`,
  );
  await parentCommand([
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "low",
    "--title",
    "OpenCode CLI failure",
    "--worktree",
    "parent",
    "--body",
    "Reply briefly and end your turn.",
  ]);
  const opencodeRecords = await waitForOperation(
    "child-cli-failure: OpenCodeの子を起動",
    teamRecords,
    (value) =>
      value.children.find((c) => c.title === "OpenCode CLI failure")
        ?.terminalId,
    childFailure(teamRecords, (children) =>
      children.find((c) => c.title === "OpenCode CLI failure"),
    ),
  );
  const opencode = opencodeRecords.children.find(
    (c) => c.title === "OpenCode CLI failure",
  );
  await screen.click(`[data-iori-child-id="${opencode.id}"] .nav-child-button`);
  const opencodeFailed = await waitForOperation(
    "child-cli-failure: 実OpenCodeの子の失敗",
    teamRecords,
    (value) =>
      value.children.find((c) => c.id === opencode.id)?.state === "failed",
    unexpectedChildCompletion(teamRecords, (children) =>
      children.find((c) => c.id === opencode.id),
    ),
  );
  const opencodeFailure = opencodeFailed.children.find(
    (c) => c.id === opencode.id,
  ).failure;
  assert.match(opencodeFailure, /iori-verification-unavailable-model/u);
  await waitFor(
    () => screen.text(`[data-iori-child-id="${opencode.id}"] .nav-child-state`),
    (value) => value.includes(opencodeFailure),
    30000,
    "OpenCodeの失敗理由を画面へ反映",
  );
  await openWorkspaceView(screen, "board");
  await screen.wait(`[data-iori-board-agent="${opencode.id}"]`);
  assert.ok(
    (
      await screen.text(
        `[data-iori-board-agent="${opencode.id}"] .agent-current`,
      )
    ).includes(opencodeFailure),
  );
  await waitFor(
    () => teamDelivery({ line: opencodeFailure, since: opencode.createdAt }),
    (value) => value.claude.noticeReceived,
    120000,
    "親がOpenCodeの失敗理由を受信",
  );
  const opencodeStatus = await screen.evaluate(`(async()=>{
    const {connection}=await import('/src/connection.ts');
    const result=await connection.requestHost(connection.getSnapshot().host.publicKey,'terminal.list',{});
    if(!result.ok)throw new Error('CLI状態を取得できませんでした');
    return result.result.terminals.find(t=>t.id===${JSON.stringify(opencode.terminalId)})?.cliStatus;
  })()`);
  assert.equal(opencodeStatus?.outcome, "failure");
  assert.equal(opencodeStatus?.failure, opencodeFailure);
  await record(
    "実OpenCodeの子: idle時にFailedとモデルエラー理由をサイドバー・Board・親へ表示",
  );

  // Delegating again after a CLI error assigns the next candidate. The short
  // continuation body relies on Host handing over the original request.
  await parentCommand(["stop", opencode.id]);
  const unavailable = {
    id: "handoff-unavailable",
    cli: "claude",
    model: invalidModel,
    tools: [],
    minimum: "",
  };
  const working = { ...role.candidates.low[0], id: "handoff-working" };
  const handoffDefinition = {
    ...changed,
    roles: [
      {
        ...role,
        instruction:
          "Follow the delegated request. Do not ask questions and do not change files.",
        candidates: { high: [], medium: [], low: [unavailable, working] },
      },
    ],
  };
  await screen.evaluate(
    `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,'teams.save',${JSON.stringify({ teamId, definition: handoffDefinition })});if(!r.ok)throw new Error('team save failed');})()`,
  );
  const token = `HANDOFF_${randomUUID().slice(0, 8)}`;
  const original = `Run exactly this one shell command once, then end your turn: iori report --body "${token}". Do not change files.${fakeMarker("failure-handoff")}`;
  const delegate = (body, continuation = []) =>
    parentCommand([
      "delegate",
      "--role",
      "Worker",
      "--difficulty",
      "low",
      "--title",
      "Candidate handoff",
      "--worktree",
      "parent",
      ...continuation,
      "--body",
      body,
    ]);
  const first = (await delegate(original)).data;
  await waitForOperation(
    "child-cli-failure: 1番目の候補の子を起動",
    teamRecords,
    (value) => value.children.find((c) => c.id === first.child)?.terminalId,
    childFailure(teamRecords, (children) =>
      children.find((c) => c.id === first.child),
    ),
  );
  await screen.click(`[data-iori-child-id="${first.child}"] .nav-child-button`);
  const firstFailed = (
    await waitForOperation(
      "child-cli-failure: 1番目の候補がCLIのエラーで失敗",
      teamRecords,
      (value) =>
        value.children.find((c) => c.id === first.child)?.state === "failed",
      unexpectedChildCompletion(teamRecords, (children) =>
        children.find((c) => c.id === first.child),
      ),
    )
  ).children.find((c) => c.id === first.child);
  await waitFor(
    () =>
      teamDelivery({
        line: teamNotice(
          "Worker",
          "Candidate handoff",
          "failed",
          firstFailed.failure,
          first.task,
        ),
        since: firstFailed.createdAt,
      }),
    (value) => value.claude.noticeReceived,
    120000,
    "親が委譲し直しの案内付きの失敗の知らせを受信",
  );
  await waitForOperation(
    "child-cli-failure: 親が失敗の知らせへの応答を完了",
    teamDelivery,
    (value) => value.claude.pendingNotices === 0,
    cliFailure(screen, parentId),
  );
  await record(
    "1番目の候補のCLIのエラーを、委譲し直しの案内付きで親へ知らせる",
  );
  // --continue delivers the same marked request to a different CLI.
  childCliFailureScripts["failure-handoff"] = [
    { tool: "exec_command", input: { cmd: `iori report --body "${token}"` } },
    { text: "Reported." },
  ];
  const continued = (
    await delegate("Continue the task.", ["--continue", first.task])
  ).data;
  assert.equal(continued.task, first.task);
  assert.notEqual(
    continued.state,
    "waiting",
    `失敗した子の枠を待たずに割り当てる: ${JSON.stringify(continued)}`,
  );
  const handedOff = await waitForOperation(
    "child-cli-failure: 委譲し直した子を起動",
    teamRecords,
    (value) => value.children.find((c) => c.id === continued.child)?.terminalId,
    childFailure(teamRecords, (children) =>
      children.find((c) => c.id === continued.child),
    ),
  );
  const next = handedOff.children.find((c) => c.id === continued.child);
  await showEndedChildren(screen);
  await waitFor(
    () => screen.text(`[data-iori-child-id="${first.child}"] .nav-child-state`),
    (text) => text === "Stopped · 親の操作",
    30000,
    "委譲し直しで失敗した子を止める",
  );
  await screen.click(`[data-iori-child-id="${next.id}"] .nav-child-button`);
  await waitFor(
    () => screen.text(`[data-iori-child-id="${next.id}"] .nav-child-model`),
    (text) => text === working.model,
    30000,
    "子の行に次の候補のモデルを表示",
  );
  assert.match(
    await screen.attribute(
      `[data-iori-child-id="${next.id}"] .nav-child-button`,
      "title",
    ),
    /\bCodex\b/u,
  );
  const folder = dirname(next.requestFile);
  const delegation = (await readdir(folder)).find((name) =>
    /^delegation-.+\.md$/u.test(name),
  );
  assert.equal(
    await readFile(join(folder, delegation), "utf8"),
    childRequestText(
      [
        "Continue the task.",
        previousWorkerText({
          cli: "Claude Code",
          model: invalidModel,
          failure: firstFailed.failure,
          request: original,
          worktree: { path: firstFailed.cwd, same: true },
        }),
      ].join("\n\n"),
      "",
    ),
    "依頼書に元の依頼・止まった理由・作業場所の注意を付ける",
  );
  await waitForOperation(
    "child-cli-failure: 委譲し直した子が報告",
    teamRecords,
    (value) => value.children.find((c) => c.id === next.id)?.reportFiles.length,
    childFailure(teamRecords, (children) =>
      children.find((c) => c.id === next.id),
    ),
  );
  // A report can precede the requested command within the same response.
  await waitForCliState(client, next.terminalId, ["idle", "done"]);
  const reports = await Promise.all(
    (await teamRecords()).children
      .find((c) => c.id === next.id)
      .reportFiles.map((file) => readFile(file, "utf8")),
  );
  assert.ok(
    reports.some((report) => report.includes(token)),
    `元の依頼の印が報告にある: ${JSON.stringify(reports.map((report) => report.slice(0, 300)))}`,
  );
  await record(
    "CLIのエラーの後の--continueで次の候補（Codex）へ回し、元の依頼を引き継いで報告",
  );
}
