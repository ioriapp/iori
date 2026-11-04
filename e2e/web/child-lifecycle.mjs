import { fakeMarker } from "../fake-model/marker.mjs";
import {
  waitForOperation,
  cliFailure,
} from "../../verification/web/operation.mjs";
import { pasteToCli } from "./cli-input.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { focusTerminal, waitForCliState } from "../cli-screen/scenario.mjs";
import { pressCliKey, submitToCli } from "../cli-screen/input.mjs";
import { openSidebar } from "../connection/scenario.mjs";
import { observeTerminalInstances } from "../terminal/scenario.mjs";

export async function childLifecycleScenario({
  client,
  teamId,
  definition,
  worktree,
  parentId,
  retainedChild,
  parentInput,
  parentCommand,
  teamDelivery,
  restartHostLosingTerminals,
  record,
  capture,
  phone,
}) {
  const screen = client.screen;
  const request = (method, params) =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const host=connection.getSnapshot().host.publicKey;const result=await connection.requestHost(host,${JSON.stringify(method)},${JSON.stringify(params)});if(!result.ok)throw new Error('Host fixture request failed');return result.result;})()`,
    );
  const rows = () =>
    screen.evaluate(
      `(()=>[...document.querySelectorAll('[data-iori-child-id]')].map(row=>({id:row.dataset.ioriChildId,state:row.dataset.ioriChildState,label:row.querySelector('.nav-child-state')?.textContent,role:row.querySelector('.nav-child-role')?.textContent})))()`,
    );
  const label = (id, text) =>
    waitFor(
      () => screen.text(`[data-iori-child-id="${id}"] .nav-child-state`),
      (value) => [text].flat().includes(value),
      30000,
      `子の状態の表示: ${[text].flat().join(" / ")}`,
    );
  const showEnded = async () => {
    // The stop request completes asynchronously; wait for the group to exist
    // before deciding whether the user needs to expand it.
    await screen.wait('[data-iori-action="children-ended"]');
    if (
      (await screen.attribute(
        '[data-iori-action="children-ended"]',
        "aria-expanded",
      )) === "false"
    )
      await screen.click('[data-iori-action="children-ended"]');
  };
  const keepFinalTab = async () => {
    if (!retainedChild) return;
    assert.equal(
      await screen.evaluate(
        `Boolean(document.querySelector('[data-iori-tab-id="terminal:${retainedChild.terminalId}"]'))`,
      ),
      true,
    );
  };
  const inspectTasks = async (childId, expected) => {
    await waitFor(
      async () =>
        (await parentCommand(["tasks"])).data.children.find(
          (entry) => entry.child === childId,
        ),
      (child) =>
        Object.entries(expected).every(
          ([key, value]) =>
            (child[key] ?? (key === "pendingMessages" ? 0 : false)) === value,
        ),
      120000,
      "親のtasksに保留入力と通知の状態を反映",
    );
  };
  const base = definition.roles[0];
  const approval = {
    ...base,
    id: "approval",
    name: "Approval",
    split: false,
    instruction:
      "Return a short reply as your final answer and finish this response. Communicate with the parent only through the iori shell commands. Never use agent-collaboration tools or tools to wait, and never run waiting commands, sleep or loops. Never report without being asked.",
    candidates: {
      high: [],
      low: [],
      medium: [
        {
          ...base.candidates.low[0],
          id: "approval-candidate",
          sandbox: "read-only",
          permission: "on-request",
        },
      ],
    },
  };
  const unavailable = {
    ...base,
    id: "unavailable",
    name: "Unavailable",
    split: false,
    candidates: {
      high: [],
      low: [],
      medium: [
        {
          id: "absent",
          cli: "absent-verification-cli",
          model: "",
          tools: [],
          minimum: "",
        },
      ],
    },
  };
  const readOnly = {
    ...approval,
    id: "read-only",
    name: "Read only",
    candidates: {
      high: [],
      low: [],
      medium: [
        {
          ...base.candidates.low[0],
          id: "read-only-candidate",
          cli: "codex",
          model: "gpt-6-luna",
          sandbox: "read-only",
          permission: "never",
        },
      ],
    },
  };
  await request("teams.save", {
    teamId,
    definition: {
      ...definition,
      roles: [...definition.roles, approval, unavailable, readOnly],
    },
  });
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await waitForCliState(client, parentId, ["idle", "done"]);
  const parentCols = Number(
    await screen.attribute(
      `[data-iori-terminal-id="${parentId}"]`,
      "data-iori-cols",
    ),
  );
  await parentCommand([
    "delegate",
    "--role",
    "Read only",
    "--difficulty",
    "medium",
    "--title",
    "Read-only report",
    "--worktree",
    "parent",
    "--body",
    'Run iori report --body "Read-only report received." exactly once, then end your turn.' +
      fakeMarker("team-read-only"),
  ]);
  const readOnlyStarted = await waitForOperation(
    "child-lifecycle: read-onlyの子のTerminalが起動",
    async () =>
      (await request("teams.children", {})).children.find(
        (entry) => entry.title === "Read-only report",
      ),
    (entry) => Boolean(entry?.terminalId),
    async () => {
      const entry = (await request("teams.children", {})).children.find(
        (child) => child.title === "Read-only report",
      );
      return entry?.state === "failed" && (entry.failure ?? "子が失敗しました");
    },
  );
  const readOnlyChild = await waitForOperation(
    "child-lifecycle: read-onlyの子の報告",
    async () =>
      (await parentCommand(["tasks"])).data.children.find(
        (entry) => entry.title === "Read-only report",
      ),
    (entry) => entry?.state === "reported",
    async () => {
      const entry = (await parentCommand(["tasks"])).data.children.find(
        (child) => child.title === "Read-only report",
      );
      return entry?.state === "failed" || entry?.waiting === "report"
        ? `子が報告できませんでした: ${JSON.stringify(entry)}`
        : false;
    },
  );
  assert.match(
    JSON.stringify(await parentCommand(["read", readOnlyChild.child])),
    /Read-only report received\./u,
  );
  await parentCommand([
    "finish",
    readOnlyChild.child,
    "--decision",
    "accept",
    "--reason",
    "Verified",
    "--worktree",
    "keep",
  ]);
  await showEnded();
  await screen.click(
    `[data-iori-child-id="${readOnlyStarted.id}"] .nav-child-button`,
  );
  const childPane = `[data-iori-terminal-id="${readOnlyStarted.terminalId}"]`;
  await screen.wait(`${childPane}[data-iori-stream-state="ended"]`);
  const snapshotCols = await waitFor(() =>
    screen.evaluate(`(()=>{
    return window.__terminalObservation.screenFrames.find(({frame})=>
      frame.kind==='terminal.snapshot' && frame.terminal.id===${JSON.stringify(readOnlyStarted.terminalId)})?.frame.snapshot.cols;
  })()`),
  );
  await record(
    `開かずに終了した子: 親 ${parentCols}列、保存画面 ${snapshotCols}列`,
  );
  assert.equal(
    snapshotCols,
    parentCols,
    "開かずに終了した子の保存画面は親のPC幅",
  );
  const mobile = await phone();
  await mobile.browser.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await mobile.screen.wait('[data-iori-view="workspace"]');
  await observeTerminalInstances(mobile);
  await openSidebar(mobile.screen);
  await mobile.screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await openSidebar(mobile.screen);
  await mobile.screen.wait('[data-iori-action="children-ended"]');
  if (
    (await mobile.screen.attribute(
      '[data-iori-action="children-ended"]',
      "aria-expanded",
    )) === "false"
  )
    await mobile.screen.click('[data-iori-action="children-ended"]');
  await mobile.screen.click(
    `[data-iori-child-id="${readOnlyStarted.id}"] .nav-child-button`,
  );
  await mobile.screen.wait(`${childPane}[data-iori-stream-state="ended"]`);
  const mobileSize = await waitFor(() =>
    mobile.screen.evaluate(`(async()=>{
    const e=document.querySelector(${JSON.stringify(childPane)});
    const source=await (await fetch('/src/terminal/TerminalPane.tsx')).text();
    const url=/from "([^"]*@xterm_addon-fit[^"]*)"/.exec(source)[1];
    const {FitAddon}=await import(url);
    const fit=new FitAddon();
    fit.activate(e.querySelector('[data-iori-part="terminal-screen"]').__e2eTerminal);
    const cols=Number(e.dataset.ioriCols), proposed=fit.proposeDimensions()?.cols;
    return cols===proposed ? {cols,proposed} : undefined;
  })()`),
  );
  assert.ok(mobileSize.cols < parentCols);
  await record(`終了した子をスマホで表示: ${JSON.stringify(mobileSize)}`);
  await mobile.browser.call("Page.close");
  await record("read-onlyのCodexの子が依頼書を読み、承認なしで報告");
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await waitForCliState(client, parentId, ["idle", "done"]);
  await parentCommand([
    "delegate",
    "--role",
    "Approval",
    "--difficulty",
    "medium",
    "--title",
    "Approval check",
    "--worktree",
    "parent",
    "--body",
    "On your first attempt, request user approval for escalated permissions to run this shell command outside the sandbox: node -e 'console.log(42)'. Do not try it inside the sandbox first or wait for a failed attempt before requesting approval. After it succeeds, reply briefly and end your turn. Do not report, wait, sleep or loop." +
      fakeMarker("team-approval"),
  ]);
  const started = await waitFor(
    rows,
    (values) => values.find((entry) => entry.role === "Approval"),
    120000,
    "承認待ちの子の行を表示",
  );
  const childId = started.find((entry) => entry.role === "Approval").id;
  // IDs select the screen; the verdict below is its visible state and CLI output.
  const child = await waitForOperation(
    "child-lifecycle: 承認待ちの子のTerminalが起動",
    async () =>
      (await request("teams.children", {})).children.find(
        (entry) => entry.id === childId,
      ),
    (entry) => Boolean(entry?.terminalId),
    async () => {
      const entry = (await request("teams.children", {})).children.find(
        (c) => c.id === childId,
      );
      return entry?.state === "failed" && (entry.failure ?? "子が失敗しました");
    },
  );
  await keepFinalTab();
  const row = `[data-iori-child-id="${child.id}"]`;
  await screen.click(`${row} .nav-child-button`);
  await screen.wait(
    `[data-iori-terminal-id="${child.terminalId}"][data-iori-stream-state="ready"]`,
  );
  await waitForCliState(client, child.terminalId, ["waiting"]);
  await screen.wait('[data-iori-action="attention-open"]:not([disabled])');
  await capture("children-approval");
  await record("子CLIの実際の承認待ちをサイドバーとAttentionへ表示");
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await waitForCliState(client, parentId, ["idle", "done"]);
  const queued = await parentCommand([
    "send",
    child.id,
    "--kind",
    "answer",
    "--body",
    "Cancel execution, reply briefly and end your turn. Do not wait, sleep or loop." +
      fakeMarker("team-cancel"),
  ]);
  assert.match(queued.text, /not delivered yet/u);
  await waitForCliState(client, parentId, ["idle", "done"]);
  await screen.click(`${row} .nav-child-button`);
  await screen.contextMenu(
    `.dock-tab-header:has([data-iori-tab-id="terminal:${child.terminalId}"])`,
  );
  await screen.click('[data-iori-action="child-tab-stop"]');
  await showEnded();
  await label(child.id, "Stopped · ユーザーの操作");
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await waitForCliState(client, parentId, ["idle", "done"]);
  await inspectTasks(child.id, { pendingMessages: 1 });
  await waitForCliState(client, parentId, ["idle", "done"]);
  await parentCommand([
    "send",
    child.id,
    "--kind",
    "answer",
    "--body",
    "Cancel the previous execution, read the answer, reply briefly and end your turn. Do not wait, sleep or loop." +
      fakeMarker("team-cancel"),
  ]);
  await label(child.id, "Running");
  await waitForCliState(client, parentId, ["idle", "done"]);
  await inspectTasks(child.id, { pendingMessages: 0 });
  await record("承認待ちの未配送回答を停止後も残し、再開時に順番に配送");
  await waitForCliState(client, parentId, ["idle", "done"]);
  // This setup verifies cancellation, not the model's shell parallelization.
  for (const [role, title] of [
    ["Approval", "Waiting approval"],
    ["Unavailable", "Candidate check"],
  ])
    await parentCommand([
      "delegate",
      "--role",
      role,
      "--difficulty",
      "medium",
      "--title",
      title,
      "--worktree",
      "parent",
      "--body",
      "Reply Ready and end your turn without commands, file changes, waiting or loops.",
    ]);
  const waiting = await waitFor(
    rows,
    (values) =>
      values.some((entry) => entry.label === "Waiting · 上限の空き待ち") &&
      values.some(
        (entry) => entry.label === "Waiting · 使える候補がありません",
      ) &&
      values,
    120000,
    "上限待ちと候補なしの子を表示",
  );
  const pendingIds = waiting
    .filter((entry) => entry.state === "waiting")
    .map((entry) => entry.id);
  await keepFinalTab();
  await capture("children-waiting");
  await waitForCliState(client, parentId, ["idle", "done"]);
  await parentInput.submit("/exit");
  // Stopped rows move into the user's expandable ended group.
  await showEnded();
  for (const id of pendingIds) await label(id, "Stopped · 親の終了");
  // Codex may ask again for the command cancelled before the resume. A
  // read-only child can also report without approval and keep running.
  await label(child.id, ["Running", "Approval", "Reported"]);
  await record("親の終了で未起動の委譲だけを取消し、動いている子は継続");
  await screen.click(`${row} .nav-child-button`);
  // Keys go to the focused element; clicking the row leaves focus in the sidebar.
  await focusTerminal(client, child.terminalId);
  await pressCliKey(client, "Escape");
  await waitForCliState(client, child.terminalId, ["idle", "done", "stopped"]);
  // The Board carries each child's last report time.
  const reportedAt = async () => {
    const entry = (await request("teams.children", {})).children.find(
      (item) => item.id === child.id,
    );
    return (await request("teams.board", { cwd: entry.parentCwd })).agents.find(
      (agent) => agent.id === child.id,
    )?.reportedAt;
  };
  const reportedBefore = await reportedAt();
  if ((await screen.text(`${row} .nav-child-state`)) === "Reported")
    assert.equal(typeof reportedBefore, "number");
  await pasteToCli(
    client,
    'On your first attempt, request user approval for escalated permissions to run this shell command outside the sandbox: "$IORI_COMMAND_BIN/iori" report --body "Parent exited; report retained.". Do not try it inside the sandbox first or wait for a failed attempt before requesting approval. After it succeeds, end your turn.' +
      fakeMarker("team-retained-report"),
  );
  for (;;) {
    const state = await waitForOperation(
      "child-lifecycle: 報告またはCLIの承認待ち",
      async () => {
        // The child may have reported earlier; wait for this report.
        if ((await reportedAt()) !== reportedBefore) return "reported";
        const list = await request("terminal.list", {});
        return list.terminals.find(
          (terminal) => terminal.id === child.terminalId,
        )?.cliStatus?.state === "waiting"
          ? "approval"
          : undefined;
      },
      Boolean,
      cliFailure(screen, child.terminalId),
    );
    if (state === "reported") break;
    await pressCliKey(client, "Enter");
    await waitForCliState(client, child.terminalId, ["active", "done", "idle"]);
  }
  await record("親の終了後に子が報告でき、親への知らせは未配送で保持");
  await parentInput.resumeWithoutTools();
  await inspectTasks(child.id, { parentNoticePending: true });
  await waitForCliState(client, parentId, ["done", "idle"]);
  const retainedReport = await parentCommand(["read", child.id]);
  assert.match(
    JSON.stringify(retainedReport),
    /Parent exited; report retained\./u,
  );
  await parentCommand([
    "delegate",
    "--role",
    "Unavailable",
    "--difficulty",
    "medium",
    "--title",
    "Resume check",
    "--worktree",
    "parent",
    "--body",
    "Reply Ready.",
  ]);
  await waitFor(
    rows,
    (values) =>
      values.some(
        (entry) =>
          !pendingIds.includes(entry.id) &&
          entry.label === "Waiting · 使える候補がありません",
      ),
    120000,
    "親の再開後の新しい委譲を表示",
  );
  await inspectTasks(child.id, { parentNoticePending: false });
  await waitForCliState(client, parentId, ["idle", "done"]);
  await record(
    "親終了後も動く子の報告を保持し、親のCLI再開後にtasks/readと新しい委譲を実行",
  );
  // Exit directly from the child's own screen. The preceding PTY input is the
  // evidence of user action; no elapsed-time heuristic or automatic reply.
  await screen.click(`${row} .nav-child-button`);
  await waitForCliState(client, child.terminalId, ["done", "idle", "waiting"]);
  // Cancel any CLI-owned approval with a user Escape before the slash command.
  const current = await request("terminal.list", {});
  if (
    current.terminals.find((terminal) => terminal.id === child.terminalId)
      ?.cliStatus?.state === "waiting"
  )
    await screen.key("Escape");
  await submitToCli(client, "/exit", undefined, "child-user-exit");
  await showEnded();
  await label(child.id, "Stopped · ユーザーの操作");
  await keepFinalTab();
  await record("子の/exitを失敗にせずユーザー停止として扱う");
  const resumeStarted = Date.now();
  const claudeWorker = {
    ...base,
    instruction:
      "Follow the delegated request. Read the files named by the parent and use iori report when requested. End your turn after reporting. Use background commands only when requested; never poll or loop.",
    candidates: {
      high: [],
      medium: [],
      low: [
        {
          id: "claude-resume",
          cli: "claude",
          model: "claude-haiku-4-5",
          permission: "default",
          tools: [],
          minimum: "",
        },
      ],
    },
  };
  await request("teams.save", {
    teamId,
    definition: { ...definition, roles: [claudeWorker, approval, unavailable] },
  });
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  const initialReportStarted = Date.now();
  await parentCommand([
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "low",
    "--title",
    "Resume-path",
    "--worktree",
    "parent",
    "--body",
    'Use Bash to run exactly "sleep 45; echo background-complete" with run_in_background: true and description "Wait for background verification". Immediately end your response after launching it, without reporting or using any more tools. The CLI will notify you when the background command completes. Only after that completion notification, run iori report --body "The initial request is complete." exactly once, then end your turn. Never poll, read task output, run another waiting command, or change files.' +
      fakeMarker("team-background"),
  ]);
  const claudeChild = await waitForOperation(
    "child-lifecycle: Claude Codeの再開を確認する子",
    async () =>
      (await request("teams.children", {})).children.find(
        (entry) => entry.title === "Resume-path" && entry.terminalId,
      ),
    Boolean,
    async () => {
      const entry = (await request("teams.children", {})).children.find(
        (c) => c.title === "Resume-path",
      );
      return entry?.state === "failed" && (entry.failure ?? "子が失敗しました");
    },
  );
  const backgroundDelivery = () =>
    teamDelivery(undefined, {
      ...claudeChild,
      roleName: claudeChild.role,
    });
  const background = await waitFor(
    async () =>
      (await parentCommand(["tasks"])).data.children.find(
        (entry) => entry.child === claudeChild.id,
      ),
    (entry) => Boolean(entry?.backgroundTasks?.length),
    120000,
    "応答を終えて待つClaude Codeのバックグラウンド処理をtasksに表示",
  );
  await waitForCliState(client, claudeChild.terminalId, ["done"]);
  // Check actual consumed parent input throughout the wait before asserting
  // task fields, so removing only notice suppression fails on the false notice.
  await waitForOperation(
    "child-lifecycle: バックグラウンド処理完了後の報告が親の実入力へ届く",
    async () => {
      const delivery = await backgroundDelivery();
      assert.equal(
        delivery.claude.unreportedNotices,
        0,
        "バックグラウンド処理を待つ間に親へ未報告の知らせが届かない",
      );
      return delivery.claude.reportNotice;
    },
    Boolean,
    cliFailure(screen, claudeChild.terminalId),
  );
  assert.equal(background.state, "running");
  assert.equal(background.waiting, undefined);
  assert.deepEqual(background.backgroundTasks, [
    {
      command: "sleep 45; echo background-complete",
      description: "Wait for background verification",
    },
  ]);
  await label(claudeChild.id, "Reported");
  await record(
    `Claude Codeのバックグラウンド待ち: CLIの応答はdone、処理完了後の報告が届くまで親への未報告通知0。待っている間のiori tasks: ${JSON.stringify({ state: background.state, backgroundTasks: background.backgroundTasks })}`,
  );
  const completedBackground = (
    await parentCommand(["tasks"])
  ).data.children.find((entry) => entry.child === claudeChild.id);
  assert.equal(completedBackground.backgroundTasks, undefined);
  await record(
    `Claude Codeの再開確認用の子の初回報告（${((Date.now() - initialReportStarted) / 1000).toFixed(3)}秒）`,
  );
  assert.match(
    JSON.stringify(await parentCommand(["read", claudeChild.id])),
    /The initial request is complete\./u,
  );
  await screen.click(
    `[data-iori-child-id="${claudeChild.id}"] .nav-child-button`,
  );
  await screen.contextMenu(
    `.dock-tab-header:has([data-iori-tab-id="terminal:${claudeChild.terminalId}"])`,
  );
  await screen.click('[data-iori-action="child-tab-stop"]');
  await showEnded();
  await label(claudeChild.id, "Stopped · ユーザーの操作");
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await parentCommand([
    "send",
    claudeChild.id,
    "--kind",
    "request",
    "--body",
    'Run iori report --body "The resumed request is complete." exactly once, then end your turn.' +
      fakeMarker("team-claude-resumed"),
  ]);
  await label(claudeChild.id, "Reported");
  assert.match(
    JSON.stringify(await parentCommand(["read", claudeChild.id])),
    /The resumed request is complete\./u,
  );
  await record(
    `Claude Codeの子を停止して親のsendで同じ会話を再開し、再報告まで確認（${((Date.now() - resumeStarted) / 1000).toFixed(3)}秒）`,
  );
  const restartStarted = Date.now();
  await restartHostLosingTerminals();
  await parentInput.resumeWithoutTools();
  assert.equal((await parentCommand(["tasks"])).ok, true);
  await record(
    `Hostと係の再起動後にClaude Codeの親を開き直して同じチームのコマンドを実行（${((Date.now() - restartStarted) / 1000).toFixed(3)}秒）`,
  );
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
}
