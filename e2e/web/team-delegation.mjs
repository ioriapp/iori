import { fakeMarker } from "../fake-model/marker.mjs";
import { probeDelegationCommand } from "../fake-model/team-delegation.mjs";
import {
  waitForOperation,
  childFailure,
  cliFailure,
  anyFailure,
} from "../../verification/web/operation.mjs";
import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import { teamNotice } from "../../packages/protocol/src/team-text.ts";
import { claudeWithoutTools, teamParentInput } from "./team-parent-input.mjs";
import { repoDelegationScenario } from "./repo-delegation.mjs";
import { mobileBoardsScenario } from "./mobile-boards.mjs";
import { openSidebar, closeSidebar } from "../connection/scenario.mjs";
import { pasteToCli } from "./cli-input.mjs";
import { childCliFailureScenario } from "./child-cli-failure.mjs";
import { childLifecycleScenario } from "./child-lifecycle.mjs";
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { waitFor, wheelWithin } from "../../verification/ui.mjs";
import {
  observe,
  observeTerminalInstances,
  observed,
  clearObserved,
  typeTerminal,
} from "../terminal/scenario.mjs";
import { waitForCliState, focusTerminal } from "../cli-screen/scenario.mjs";
import { submitToCli } from "../cli-screen/input.mjs";
import {
  returnToWorktree,
  saveStartupArguments,
  showEndedChildren,
} from "./agents-navigation.mjs";

const readyForStart =
  'Read every file named in the parent message before replying. Before START, return only "Ready" as your final answer and finish this response. Do not use tools to wait or agent-collaboration tools. Do not run any other commands before START.';
const resumedForStart =
  'This message is only a readiness check after resuming. The START signal has NOT been sent. Read this request file, then return only "waiting" as your final answer and finish this response. Do not follow the original task yet. Do not ask, report, or run any commands in this turn. Do not use tools to wait or agent-collaboration tools. A later parent message beginning with START will tell you to follow the original delegation.' +
  fakeMarker("team-resumed-ready");

const initialChildRequest = `${readyForStart} After START use iori ask to ask whether to report completion. Read the answer file then report successful verification with no changes through iori report. On a revise message read its file and report again without another question. Do not change files.${fakeMarker("team-ready")}`;
export const delegationUserRequest = `Run exactly this one shell command: ${probeDelegationCommand}. Then end your turn.${fakeMarker("team-parent-delegate")}`;
export async function teamDelegationScenario({
  fakeModelRequests,
  client,
  worktree,
  teamRecords,
  teamDelivery,
  teamCommand,
  restartHostLosingTerminals,
  record,
  shot,
  desktop,
  mobile,
  phone,
  lifecycleOnly = false,
  failureOnly = false,
  restartPreservingHost,
  session,
  repoOnly = false,
  secondRepository,
  activityOnly = false,
  opencodeOnly = false,
}) {
  const screen = client.screen;
  let opencodeV2 = false;
  const capture = async (view) => {
    const views = process.env.IORI_TEAMS_CAPTURE_VIEWS?.split(",");
    if (views && !views.includes(view)) return;
    const endedExpanded =
      (await screen.attribute(
        '[data-iori-action="children-ended"]',
        "aria-expanded",
      )) === "true";
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark',${theme === "dark"})`,
      );
      await shot(`pc-${view}-${theme}`);
    }
    if (view.startsWith("children-")) {
      await mobile({ width: 390, height: 844 });
      await openSidebar(screen);
      await screen.evaluate("document.documentElement.classList.add('dark')");
      if (endedExpanded)
        await screen.click(
          '[data-iori-action="children-ended"][aria-expanded="false"]',
        );
      await screen.wait("[data-iori-child-id]");
      await shot(`mobile-${view}-dark`);
      await desktop();
      await screen.wait("[data-iori-terminal-row]");
      if (endedExpanded)
        await screen.click(
          '[data-iori-action="children-ended"][aria-expanded="false"]',
        );
    }
  };
  if (!lifecycleOnly && !failureOnly) {
    await mobile({ width: 390, height: 844 });
    await screen.wait('[data-iori-view="mobile-home"] .mobile-boards-empty');
    assert.equal(await screen.text("#mobile-boards-heading"), "Boards 0");
    await desktop();
  }
  const candidate = (id) => ({
    id,
    cli: "claude",
    model: "claude-haiku-4-5",
    tools: [],
    minimum: "",
  });
  const definition = {
    name: "Delegation verification",
    description: "Real CLI report and question flow",
    parent: candidate("parent"),
    instruction:
      "Execute the single initial iori delegate command supplied by the user, preserving its body exactly, then end your turn.",
    roles: [
      {
        id: "worker",
        name: "Worker",
        when: "Short verification",
        limit: "1",
        reuse: true,
        split: true,
        instruction: `${readyForStart} After START ask through iori, then finish your response with a final answer. Read the next answer file and report through iori. Finish every turn with a final answer. Never use agent-collaboration tools or tools to wait, and never run waiting commands, sleep or loops. Do not change files.`,
        request: "Follow the parent request.",
        report: "Result; changes; verification.",
        // The parent model chooses the difficulty; give each level the same
        // low-cost candidate so the scenario does not depend on that choice.
        candidates: Object.fromEntries(
          ["high", "medium", "low"].map((level) => [
            level,
            [
              {
                ...candidate(`worker-candidate-${level}`),
                cli: "codex",
                model: "gpt-6-luna",
                effort: "low",
              },
            ],
          ]),
        ),
      },
    ],
  };
  const activityCli = process.env.IORI_BOARD_ACTIVITY_CLI ?? "codex";
  if (activityOnly) {
    assert.ok(["claude", "codex"].includes(activityCli));
    definition.instruction =
      "Delegate one task to Worker when asked. End your turn after delegating. Do not send follow-up messages or finish children unless asked.";
    definition.roles[0].instruction =
      "Read the request file. Reply Ready and finish your turn. Do not report or run waiting commands. Follow the next direct user instruction.";
    for (const candidates of Object.values(definition.roles[0].candidates)) {
      candidates[0].cli = activityCli;
      candidates[0].model =
        activityCli === "claude" ? "claude-haiku-4-5" : "gpt-6-luna";
      if (activityCli === "claude") {
        delete candidates[0].effort;
        // This scenario observes file editing while Board is visible. Use the
        // CLI's normal edit permission; approval interaction has its own E2E.
        candidates[0].permission = "acceptEdits";
      }
    }
  }
  if (opencodeOnly) {
    const version = await screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,'cli.list',{});return r.result.clis.find(c=>c.id==='opencode')?.version;})()`,
    );
    opencodeV2 = Number(version?.match(/(?:^|\s)v?(\d+)\./u)?.[1]) >= 2;
    definition.instruction =
      "Use iori to delegate the user request to Worker. Do not change files. After delegation end your turn; do not poll or finish the child.";
    definition.roles[0].instruction =
      "Read each parent request file and follow its instructions for the current turn. Use iori report only when that request asks for a report. Do not modify files or ask questions.";
    for (const candidates of Object.values(definition.roles[0].candidates)) {
      candidates[0].cli = "opencode";
      candidates[0].model = opencodeV2
        ? "opencode/deepseek-v4.1-flash-free"
        : "openai/gpt-6-luna";
      candidates[0].effort = "high";
    }
  }
  if (
    !lifecycleOnly &&
    !failureOnly &&
    !repoOnly &&
    !activityOnly &&
    !opencodeOnly
  ) {
    const worker = definition.roles[0];
    definition.roles.push({
      ...worker,
      id: "probe",
      name: "Probe",
      when: "Verify the parent command route",
      split: false,
      instruction:
        "Read the request, report once through iori report, and end your turn. Do not modify files or ask questions.",
      candidates: Object.fromEntries(
        Object.entries(worker.candidates).map(([level, candidates]) => [
          level,
          candidates.map((entry) => ({ ...entry, id: `probe-${entry.id}` })),
        ]),
      ),
    });
  }
  // Fixture creation uses the actual Host save path. Unit 1 already covers all
  // editor operations; this scenario starts with a saved low-cost team.
  const savedTeam = await screen.evaluate(
    `(async()=>{const {connection}=await import('/src/connection.ts');const host=connection.getSnapshot().host.publicKey;const result=await connection.requestHost(host,'teams.create',{definition:${JSON.stringify(definition)}});if(!result.ok)throw new Error('team fixture save failed');return result.result.saved;})()`,
  );
  const teamId = savedTeam.id;
  await screen.click('[data-iori-action="open-agents-teams"]');
  await screen.click('[data-iori-action="teams-list"]');
  await screen.wait('.team-surface:not([hidden]) [role="switch"]');
  const enabled = await screen.attribute(
    '.team-surface:not([hidden]) [role="switch"]',
    "aria-checked",
  );
  if (enabled !== "true")
    await screen.click('.team-surface:not([hidden]) [role="switch"]');
  await screen.click('[data-iori-action="teams-agents"]');
  await screen.wait('[data-iori-usage="codex"]');
  await capture("codex-usage");
  await screen.click(`.team-tree-team[data-iori-team-id="${teamId}"]`);
  await screen.click(
    `[data-iori-action="team-role"][data-iori-role-id="${savedTeam.roles[0].id}"]`,
  );
  await screen.click(
    '.team-candidate-heading [data-slot="toggle-group-item"]:last-child',
  );
  if (opencodeOnly) {
    await saveStartupArguments(
      screen,
      "opencode",
      opencodeV2 ? "--log-level warn" : "--print-logs",
    );
  }
  if (!opencodeOnly && !(activityOnly && activityCli === "claude")) {
    await screen.wait('[data-iori-field="candidate-minimum"]');
    if (!lifecycleOnly && !failureOnly) await capture("candidate-minimum");
  }
  await record("本物のCodex app-serverから残量を取得しAIエージェントへ表示");
  const checkStartupArguments =
    !lifecycleOnly && !failureOnly && !activityOnly && !opencodeOnly;
  const codexExtra = `-c 'tui.notifications=["agent-turn-complete", "approval-requested"]'`;
  if (checkStartupArguments) {
    await saveStartupArguments(
      screen,
      "claude",
      '--model=unused-model --name "Team startup arguments"',
    );
    await saveStartupArguments(
      screen,
      "codex",
      `-m unused-model --config=model_reasoning_effort=high ${codexExtra}`,
    );
  }
  if (lifecycleOnly || failureOnly || repoOnly || opencodeOnly)
    await saveStartupArguments(screen, "claude", claudeWithoutTools);
  await returnToWorktree(screen);
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  await desktop();
  if (opencodeOnly) {
    if (opencodeV2) {
      await screen.click('[data-iori-action="workspace-add-tab"]');
      await screen.click('[data-iori-cli-id="opencode"]');
      await screen.wait('[data-iori-tab-cli="opencode"]');
      const id = (
        await screen.attribute(
          '[data-iori-tab-cli="opencode"]',
          "data-iori-tab-id",
        )
      ).replace(/^terminal:/u, "");
      await screen.wait(
        `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
      );
      await focusTerminal(client, id);
      await observed(client, "DeepSeek");
      await submitToCli(
        client,
        "Use the question tool to ask whether release notes should be brief or detailed. Wait for my answer. Do not use other tools.",
      );
      await waitForCliState(client, id, ["active"]);
      await waitForCliState(client, id, ["waiting"]);
      await screen.key("Enter");
      await waitForCliState(client, id, ["done", "idle"]);
      await record("V2を＋から起動し、作業中・質問待ち・回答後の完了を確認");
      const before = await session(id);
      await restartHostLosingTerminals();
      await screen.wait(
        `[data-iori-terminal-id="${id}"] [data-iori-action="cli-resume"]`,
      );
      await clearObserved(client);
      await screen.click(
        `[data-iori-terminal-id="${id}"] [data-iori-action="cli-resume"]`,
      );
      await focusTerminal(client, id);
      await observed(client, "DeepSeek");
      await submitToCli(
        client,
        "Reply Ready and finish your turn without using tools.",
      );
      await waitForCliState(client, id, ["active"]);
      await waitForCliState(client, id, ["done", "idle"]);
      assert.equal((await session(id)).session.id, before.session.id);
      await record("V2はHost再起動後の再開で同じ会話・モデルを続ける");
      await typeTerminal(client, "");
      await screen.key("Control+C");
    }
  }
  await openWorkspaceView(screen, "files");
  await openWorkspaceView(screen, "git");
  await screen.click(
    '.dock-tab-header:has([data-iori-tab-kind="git"]) [data-iori-action="workspace-close-tab"]',
  );
  await openWorkspaceView(screen, "git");
  await screen.click('button[data-iori-tab-kind="start"]');
  await screen.wait(`[data-iori-team-id="${teamId}"]`);
  await shot("desktop-team-launcher");
  await mobile();
  await openSidebar(screen);
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await screen.wait(`[data-iori-team-id="${teamId}"]`);
  await closeSidebar(screen);
  await shot("mobile-team-launcher");
  await desktop();
  await screen.click(`[data-iori-team-id="${teamId}"]`);
  await screen.wait('[data-iori-tab-cli="claude"]');
  await screen.wait('button[data-iori-tab-kind="board"]');
  for (const kind of ["files", "git"]) {
    await screen.wait(`button[data-iori-tab-kind="${kind}"]`);
    assert.equal(
      await screen.attribute(
        `button[data-iori-tab-kind="${kind}"]`,
        "data-state",
      ),
      "inactive",
    );
  }
  assert.equal(
    await screen.attribute('button[data-iori-tab-kind="board"]', "data-state"),
    "inactive",
  );
  assert.equal(
    await screen.evaluate(
      `Boolean(document.querySelector('button[data-iori-tab-kind="start"]'))`,
    ),
    false,
  );
  await record(
    "始めるでチームを選ぶと会話へ置き換わり、Boardが見ていないタブとして追加される",
  );
  const parentId = (
    await screen.attribute('[data-iori-tab-cli="claude"]', "data-iori-tab-id")
  ).replace(/^terminal:/u, "");
  await screen.wait(
    `[data-iori-terminal-id="${parentId}"][data-iori-stream-state="ready"]`,
  );
  await waitForCliState(client, parentId, ["idle", "done"]);
  await record("＋のチームから親Claude Codeを起動し、開始hookを確認");
  if (lifecycleOnly || failureOnly || repoOnly || opencodeOnly) {
    await saveStartupArguments(screen, "claude", "");
    await returnToWorktree(screen, worktree);
    await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  }
  const parentInput = teamParentInput({
    client,
    parentId,
    teamRecords,
    teamDelivery,
  });
  const parentCommand = (args, options) => teamCommand(parentId, args, options);
  if (failureOnly) {
    await childCliFailureScenario({
      restartPreservingHost,
      session,
      client,
      teamId,
      definition: savedTeam,
      parentId,
      parentCommand,
      teamRecords,
      teamDelivery,
      record,
    });
    return;
  }
  if (repoOnly) {
    await repoDelegationScenario({
      fakeModelRequests,
      client,
      worktree,
      secondRepository,
      teamRecords,
      parentId,
      parentInput,
      parentCommand,
      teamId,
      definition: savedTeam,
      record,
    });
    return;
  }
  if (activityOnly) {
    await parentInput.paste(
      "Delegate one low difficulty task to Worker with worktree new, title Tool activity, and body: Read this request and reply Ready, then finish your turn. Wait for the next direct user instruction. Do not report yet. End your own turn after delegation." +
        fakeMarker("board-delegate"),
    );
    const initial = await waitForOperation(
      "team-delegation: 操作表示を確かめる子を委譲",
      teamRecords,
      (value) => value.children.length === 1 && value.children[0].terminalId,
      childFailure(teamRecords, (children) => children[0]),
    );
    const child = initial.children[0];
    await screen.click(`[data-iori-child-id="${child.id}"] .nav-child-button`);
    await waitForOperation(
      "team-delegation: 対象の子の初回応答の記録と完了hook",
      teamDelivery,
      (value) => value[activityCli].initialReply && value.initialHookDone,
      childFailure(teamRecords, (children) => children[0]),
    );
    await screen.evaluate(
      `(()=>{window.__boardActivity=[]; const observe=()=>{const e=document.querySelector('[data-iori-board-agent="${child.id}"] .agent-current');if(e && window.__boardActivity.at(-1)!==e.textContent)window.__boardActivity.push(e.textContent);}; window.__boardActivityObserver=new MutationObserver(observe);window.__boardActivityObserver.observe(document.body,{subtree:true,childList:true,characterData:true});return true;})()`,
    );
    await pasteToCli(
      client,
      `Run exactly sleep 2 using your shell tool and wait for it to finish before the next tool. Then use your file editing tool (Edit/Write or apply_patch, never a shell command) to create ${child.cwd}/board-activity.txt containing board activity verified. Use that exact worktree path, not a scratchpad. Then call iori report --body "Board activity verified". Do not use other agents or loops.${fakeMarker(`board-${activityCli}`)}`,
    );
    await openWorkspaceView(screen, "board");
    const boardRow = `[data-iori-board-agent="${child.id}"]`;
    await screen.wait(boardRow);
    await waitForOperation(
      "team-delegation: 操作後に子が報告",
      teamRecords,
      (value) => value.children[0].state === "reported",
      childFailure(teamRecords, (children) => children[0]),
    );
    await waitForCliState(client, child.terminalId, ["idle", "done"]);
    await waitFor(
      () => screen.text(`${boardRow} .agent-current`),
      (value) => value.startsWith("Reported"),
    );
    const labels = await screen.evaluate(
      "window.__boardActivityObserver.disconnect();window.__boardActivity",
    );
    assert.ok(
      labels.some((label) =>
        /^(?:Bash|exec_command|shell_command) sleep 2/u.test(label),
      ),
      JSON.stringify(labels),
    );
    // Fast edits are deliberately hidden by Board's 500ms threshold.
    // Keep the real edit in the flow and verify its result instead.
    assert.equal(
      (await readFile(`${child.cwd}/board-activity.txt`, "utf8")).trim(),
      "board activity verified",
    );
    await waitFor(
      () => screen.text(`${boardRow} .agent-diff`),
      (value) => value.includes("+1") && value.includes("· 1ファイル"),
    );
    assert.ok(
      labels.some((label) => label.startsWith("Thinking")),
      JSON.stringify(labels),
    );
    await record(
      `${activityCli}の実CLI: 長いコマンド・Thinking・報告をBoardで確認し、編集結果を実ファイルで確認 ${JSON.stringify(labels)}`,
    );
    return;
  }
  if (lifecycleOnly) {
    await childLifecycleScenario({
      client,
      teamId,
      definition: savedTeam,
      worktree,
      parentId,
      parentInput,
      parentCommand,
      restartHostLosingTerminals,
      teamDelivery,
      record,
      capture,
      phone,
    });
    return;
  }
  if (opencodeOnly) {
    await parentCommand([
      "delegate",
      "--role",
      "Worker",
      "--difficulty",
      "low",
      "--title",
      "OpenCode verification",
      "--worktree",
      "parent",
      "--body",
      "Read this request file, reply Ready as your final answer, then finish this response. Do not run any shell commands, report, ask, wait, or modify files in this turn." +
        fakeMarker("opencode-ready"),
    ]);
    await waitForOperation(
      "team-delegation: 操作表示を確かめる子を委譲",
      teamRecords,
      (value) => value.children.length === 1 && value.children[0].terminalId,
      childFailure(teamRecords, (children) => children[0]),
    );
    const child = (await teamRecords()).children[0];
    const childDelivery = () => teamDelivery(undefined, child);
    await screen.click(`[data-iori-child-id="${child.id}"] .nav-child-button`);
    const started = await teamRecords();
    const command = started.terminals.find(
      (terminal) => terminal.id === child.terminalId,
    ).value.command;
    assert.ok(!command.includes("--auto"), "子は自動承認なしで起動する");
    assert.ok(
      command.includes(opencodeV2 ? "--log-level" : "--print-logs"),
      "保存した起動時の引数をチームの子へ渡す",
    );
    await waitForOperation(
      "team-delegation: OpenCodeの初回の未報告の応答終了が親の実入力へ一度届く",
      childDelivery,
      (value) => value.claude.unreportedNotices === 1,
      anyFailure(
        childFailure(teamRecords, (children) => children[0]),
        cliFailure(screen, parentId),
      ),
    );
    await waitForCliState(client, child.terminalId, ["idle", "done"]);
    const initialTasks = await parentCommand(["tasks"]);
    const initialWaiting = initialTasks.data.children.find(
      (entry) => entry.child === child.id,
    );
    assert.equal(initialWaiting.waiting, "report");
    assert.deepEqual(initialWaiting.waitingReasons, [{ reason: "no_report" }]);
    await record(
      "OpenCodeの初回の報告なしの応答終了: 親への知らせとtasksのno_reportを確認",
    );
    await parentCommand([
      "send",
      child.id,
      "--kind",
      "request",
      "--body",
      "Read this request, run iori report --body OPENCODE_REPORT_OK once, then finish this response. Do not modify files or ask questions." +
        fakeMarker("opencode-report"),
    ]);
    const answered = new Set();
    const result = await waitForOperation(
      "team-delegation: OpenCodeの報告",
      async () => {
        const value = await teamRecords();
        if (["reported", "failed"].includes(value.children[0].state))
          return value;
        const status = await screen.evaluate(
          `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,'terminal.list',{});return r.result.terminals.find(t=>t.id===${JSON.stringify(child.terminalId)})?.cliStatus})()`,
        );
        if (
          status?.attention?.kind === "approval" &&
          !answered.has(status.since)
        ) {
          const { tool, summary = "" } = status.attention;
          assert.equal(
            tool,
            opencodeV2 ? "shell" : "bash",
            "依頼書の外部フォルダー承認は出ず、報告のbashだけを許可する",
          );
          assert.match(summary, /iori.*report/u);
          await typeTerminal(client, "");
          await observed(client, "Permission required");
          answered.add(status.since);
          // OpenCode 1.19.2 selects Allow once first in its permission prompt.
          await screen.key("Enter");
        }
        return value;
      },
      (value) => ["reported", "failed"].includes(value.children[0].state),
      childFailure(teamRecords, (children) => children[0]),
    );
    assert.equal(result.children[0].state, "reported");
    assert.ok(answered.size > 0, "報告のbashの承認に答えて完了する");
    await screen.wait('[data-iori-child-state="reported"]');
    await record(
      `無料OpenCodeは依頼書の外部フォルダー承認なしで読み取り、報告のbash承認${answered.size}回に答えて完了`,
    );
    await waitForCliState(client, child.terminalId, ["idle", "done"]);
    await parentCommand(["stop", child.id]);
    await waitFor(
      teamRecords,
      (value) => value.children[0].state === "stopped",
      30000,
      "親のstopでOpenCodeの子を停止",
    );
    const reportsBeforeResume = result.children[0].reportFiles.length;
    const resumed = await parentCommand([
      "send",
      child.id,
      "--kind",
      "request",
      "--body",
      "Read this new request file. Report successful verification of resuming this conversation through iori report --body with the text OPENCODE_RESUMED_REPORT_OK, then finish this response. Do not modify files or ask questions." +
        fakeMarker("opencode-resume"),
    ]);
    assert.match(resumed.text, /Message queued for resume/u);
    answered.clear();
    const resumedReport = await waitForOperation(
      "team-delegation: 停止したOpenCodeへsendした依頼が同じ子へ届き報告する",
      async () => {
        const value = await teamRecords();
        const status = await screen.evaluate(
          `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,'terminal.list',{});return r.result.terminals.find(t=>t.id===${JSON.stringify(child.terminalId)})?.cliStatus})()`,
        );
        if (
          status?.attention?.kind === "approval" &&
          !answered.has(status.since)
        ) {
          assert.equal(status.attention.tool, opencodeV2 ? "shell" : "bash");
          assert.match(status.attention.summary ?? "", /iori.*report/u);
          await typeTerminal(client, "");
          await observed(client, "Permission required");
          answered.add(status.since);
          await screen.key("Enter");
        }
        return value;
      },
      (value) => value.children[0].reportFiles.length > reportsBeforeResume,
      childFailure(teamRecords, (children) => children[0]),
    );
    assert.match(
      await readFile(resumedReport.children[0].reportFiles.at(-1), "utf8"),
      /OPENCODE_RESUMED_REPORT_OK/u,
    );
    assert.equal(
      resumedReport.terminals.find((entry) => entry.id === child.terminalId)
        .value.session.id,
      result.terminals.find((entry) => entry.id === child.terminalId).value
        .session.id,
    );
    await record(
      "停止したOpenCodeの子へ親のsendで追加依頼を届け、再開した子の実reportを確認",
    );
    await waitForCliState(client, child.terminalId, ["idle", "done"]);
    {
      const turn = 2;
      await parentCommand([
        "send",
        child.id,
        "--kind",
        "request",
        "--body",
        "This request is a readiness check. Read this file, reply Ready as your final answer, then finish this response. Do not run any shell commands, report, ask, wait, or modify files in this turn." +
          fakeMarker("opencode-ready"),
      ]);
      await waitForOperation(
        "team-delegation: 待機中のOpenCodeへの依頼の応答終了を親の実入力へ一度ずつ届ける",
        childDelivery,
        (value) => value.claude.unreportedNotices === turn,
        anyFailure(
          childFailure(teamRecords, (children) => children[0]),
          cliFailure(screen, parentId),
        ),
      );
      await waitForCliState(client, child.terminalId, ["idle", "done"]);
      const tasks = await parentCommand(["tasks"]);
      const waiting = tasks.data.children.find(
        (entry) => entry.child === child.id,
      );
      assert.equal(waiting.waiting, "report");
      assert.deepEqual(waiting.waitingReasons, [{ reason: "no_report" }]);
      assert.equal((await childDelivery()).claude.unreportedNotices, turn);
      await record(
        `OpenCodeの報告なしの応答終了${turn}回目: 親への知らせとtasksのno_reportを確認`,
      );
    }
    await parentCommand(["stop", child.id]);
    const autoDefinition = JSON.parse(JSON.stringify(savedTeam));
    for (const candidates of Object.values(autoDefinition.roles[0].candidates))
      for (const candidate of candidates)
        candidate.permission = "Auto-approve permissions";
    await screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,'teams.save',${JSON.stringify({ teamId, definition: autoDefinition })});if(!r.ok)throw new Error('team save failed');})()`,
    );
    const auto = await parentCommand([
      "delegate",
      "--role",
      "Worker",
      "--difficulty",
      "low",
      "--title",
      "OpenCode auto verification",
      "--worktree",
      "parent",
      "--body",
      "Read this request file, reply Ready as your final answer, then finish this response. Do not run any shell commands, report, ask, wait, or modify files in this turn." +
        fakeMarker("opencode-ready"),
    ]);
    const autoRecords = await waitForOperation(
      "team-delegation: Auto-approveのOpenCodeの子を起動",
      teamRecords,
      (value) =>
        value.children.some(
          (entry) => entry.id === auto.data.child && entry.terminalId,
        ),
      childFailure(teamRecords, (children) =>
        children.find((entry) => entry.id === auto.data.child),
      ),
    );
    const autoChild = autoRecords.children.find(
      (entry) => entry.id === auto.data.child,
    );
    const autoDelivery = () => teamDelivery(undefined, autoChild);
    await waitForOperation(
      "team-delegation: Auto-approveのOpenCodeも未報告の応答終了を親の実入力へ一度届ける",
      autoDelivery,
      (value) => value.claude.unreportedNotices === 1,
      anyFailure(
        childFailure(teamRecords, (children) =>
          children.find((entry) => entry.id === auto.data.child),
        ),
        cliFailure(screen, parentId),
      ),
    );
    const autoTasks = await parentCommand(["tasks"]);
    const autoWaiting = autoTasks.data.children.find(
      (entry) => entry.child === autoChild.id,
    );
    assert.equal(autoWaiting.waiting, "report");
    assert.deepEqual(autoWaiting.waitingReasons, [{ reason: "no_report" }]);
    assert.equal((await autoDelivery()).claude.unreportedNotices, 1);
    assert.equal((await childDelivery()).claude.unreportedNotices, 2);
    await record(
      "Auto-approveのOpenCodeの未報告応答: この子への知らせ1件とtasksのno_reportを確認し、最初の子の知らせは2件のまま",
    );
    await screen.click('[data-iori-action="open-agents-teams"]');
    await screen.click(`.team-tree-team[data-iori-team-id="${teamId}"]`);
    await screen.click(
      `[data-iori-action="team-role"][data-iori-role-id="${savedTeam.roles[0].id}"]`,
    );
    await waitFor(
      () =>
        screen.evaluate(
          "document.querySelectorAll('.team-candidate-row .team-candidate-effort button').length",
        ),
      (count) => count === 0,
    );
    await shot("opencode-candidate-no-effort");
    await record("OpenCodeの保存済み候補にEffortの操作が表示されない");
    return;
  }
  const setupCommand = `printf 'CHILD_SETUP_OK\\n'; printf '%s' "$IORI_ROOT_PATH" > .iori-child-setup-root`;
  const setupOptions = await screen.evaluate(
    `(async()=>{const {connection}=await import('/src/connection.ts');const key=connection.getSnapshot().host.publicKey;const options=await connection.requestHost(key,'worktrees.options',{path:${JSON.stringify(worktree)}});if(!options?.ok)throw new Error('worktree options failed');const saved=await connection.requestHost(key,'worktrees.create',{path:${JSON.stringify(worktree)},name:'delegation-setup-settings',baseBranch:options.result.defaultBranch,setupCommand:${JSON.stringify(setupCommand)}});if(!saved?.ok||saved.result.state!=='created')throw new Error('setup settings failed');return {...options.result,settingsWorktree:saved.result.path};})()`,
  );
  await parentInput.paste(delegationUserRequest);
  const probeRole = savedTeam.roles.find((entry) => entry.name === "Probe").id;
  const probeState = await waitForOperation(
    "team-delegation: 親の実delegateで確認用の子が報告",
    teamRecords,
    (value) =>
      value.children.some(
        (entry) => entry.roleId === probeRole && entry.reportFiles.length > 0,
      ),
    childFailure(teamRecords, (children) =>
      children.find((entry) => entry.roleId === probeRole),
    ),
  );
  const probe = probeState.children.find((entry) => entry.roleId === probeRole);
  await waitFor(
    () =>
      teamDelivery({
        line: teamNotice(probe.roleName, probe.title, "reported"),
        since: probe.createdAt,
      }),
    (value) => value.claude.noticeReceived,
    120000,
    "確認用の子の報告が通常の親の実入力に届く",
  );
  await record("通常の親の実delegateと確認用の子の報告通知を実入力で確認");
  await parentInput.submit("/exit");
  await parentInput.resumeWithoutTools();
  await record("親の自然な応答終了後、同じ親会話を道具なしで再開");
  for (const entry of (await teamRecords()).children.filter(
    (entry) => entry.roleId === probeRole,
  )) {
    if (entry.state !== "finished") {
      const result = await parentCommand([
        "finish",
        entry.id,
        "--decision",
        "accept",
        "--reason",
        "Parent command route verified.",
        "--worktree",
        "keep",
      ]);
      assert.equal(
        result.text,
        "Child finished: accept. Parent command route verified.",
      );
    }
  }
  const allTeamRecords = teamRecords;
  teamRecords = async () => {
    const value = await allTeamRecords();
    const probes = value.children.filter((entry) => entry.roleId === probeRole);
    const tasks = new Set(probes.map((entry) => entry.task));
    return {
      ...value,
      children: value.children.filter((entry) => entry.roleId !== probeRole),
      tasks: value.tasks.filter((entry) => !tasks.has(entry.id)),
    };
  };
  const probeCount = (await allTeamRecords()).children.filter(
    (entry) => entry.roleId === probeRole,
  ).length;
  await parentCommand([
    "plan",
    "goal",
    "--body",
    "Verify team question, report and revision flow",
  ]);
  await parentCommand(["plan", "add", "--title", "Verification worker"]);
  // The normal parent may have written its own plan during the probe. Select
  // the task just added rather than depending on those model-chosen entries.
  const plan = await parentCommand(["plan", "show"]);
  const planTask = plan.data.tasks.at(-1).number;
  await parentCommand([
    "plan",
    "update",
    String(planTask),
    "--state",
    "in_progress",
    "--checkpoint",
    "Delegating to Worker",
  ]);
  const started = await parentCommand([
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "low",
    "--title",
    "Verification worker",
    "--worktree",
    "new",
    "--plan",
    String(planTask),
    "--body",
    initialChildRequest,
  ]);
  assert.ok(["starting", "running"].includes(started.data.state));
  await record("即時委譲の返答が起動開始を示し、待機と誤表示しない");
  const initial = await waitForOperation(
    "team-delegation: 操作表示を確かめる子を委譲",
    teamRecords,
    (value) => value.children.length === 1 && value.children[0].terminalId,
    childFailure(teamRecords, (children) => children[0]),
  );
  assert.equal(initial.children[0].candidate.model, "gpt-6-luna");
  assert.notEqual(initial.children[0].cwd, worktree);
  const child = initial.children[0];
  assert.equal(child.candidate.cli, "codex");
  await waitForOperation(
    "team-delegation: 子のworktreeで準備のコマンドが動く",
    () =>
      readFile(`${child.cwd}/.iori-child-setup-root`, "utf8").catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }),
    (value) => value === setupOptions.mainPath,
    childFailure(teamRecords, (children) => children[0]),
  );

  if (checkStartupArguments) {
    const parentCommand = initial.terminals.find(
      (entry) => entry.id === parentId,
    ).value.command;
    const childCommand = initial.terminals.find(
      (entry) => entry.id === child.terminalId,
    ).value.command;
    assert.ok(parentCommand.includes('--name "Team startup arguments"'));
    assert.ok(childCommand.includes(codexExtra));
    for (const command of [parentCommand, childCommand]) {
      assert.equal(command.includes("unused-model"), false);
    }
    assert.equal(childCommand.includes("model_reasoning_effort=high"), false);
    await record(
      "利用者の起動引数を親・子に保ち、役割と重複する利用者の設定を除いて実CLIを起動",
    );
  }
  await waitForOperation(
    "team-delegation: 報告も質問も無い子の入力待ちを親の実入力記録で確認",
    teamDelivery,
    (value) => value.claude.unreportedNotices === 1,
    anyFailure(
      childFailure(teamRecords, (children) => children[0]),
      cliFailure(screen, parentId),
    ),
  );
  await record("初回依頼の応答が報告も質問も無く終わると親へ一度知らせる");
  const tasksResult = await parentCommand(["tasks"]);
  assert.deepEqual(Object.keys(tasksResult).sort(), ["data", "ok"]);
  const missingResult = await parentCommand(
    ["read", "00000000-0000-0000-0000-000000000000"],
    { allowFailure: true },
  );
  assert.deepEqual(Object.keys(missingResult).sort(), ["ok", "text"]);
  assert.equal(missingResult.ok, false);
  assert.equal(typeof missingResult.text, "string");
  await record("実物のiori --jsonでdataの重複が無く、data無しの返答も読める");
  const folderName = child.cwd.split(/[\\/]/u).at(-1);
  assert.match(folderName, /^repository-[a-z0-9-]{1,24}-[0-9a-f]{8}$/u);
  await waitFor(
    () => screen.attribute(".nav-child-branch > span", "data-iori-full-name"),
    (value) => /^iori\/[a-z0-9-]{1,24}-[0-9a-f]{8}$/u.test(value),
    45000,
    "Gitの短い子ブランチを表示",
  );
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
    "team-delegation: 子Codexの最初の応答の受信記録",
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
  await record(
    "new worktreeの準備でmain worktreeの環境変数を照合し、その後の子Codexの応答完了と既定sandbox・network無効を実記録で確認",
  );
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
  const beforeDirectReply = (await teamDelivery()).codex.finalReplies;
  await submitToCli(
    client,
    "Before START, reply only Ready again. Do not report or ask." +
      fakeMarker("team-direct-ready"),
    undefined,
    "team-child-direct",
  );
  await waitForOperation(
    "team-delegation: ユーザーから直接入力した子の応答が完了",
    teamDelivery,
    (value) => value.codex.finalReplies > beforeDirectReply,
    childFailure(teamRecords, (children) => children[0]),
  );
  await waitForCliState(client, child.terminalId, ["idle", "done"]);
  assert.equal((await teamDelivery()).claude.unreportedNotices, 1);
  await record("ユーザーが子へ直接入力した応答では未報告の知らせを増やさない");

  await screen.click(`${childRow} [data-iori-action="child-menu"]`);
  await screen.click('[data-iori-action="child-stop"]');
  await waitFor(
    teamRecords,
    (value) =>
      value.children[0].state === "stopped" &&
      value.children[0].stoppedBy === "user",
    30000,
    "ユーザーの停止を記録",
  );
  await showEndedChildren(screen);
  await screen.wait(`${childRow}[data-iori-child-state="stopped"]`);
  assert.ok(
    (await screen.text(`${childRow} .nav-child-state`)).includes("ユーザー"),
  );
  assert.equal((await teamDelivery()).claude.reportNotice, false);
  await capture("children-stopped");
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  const resumedResult = await parentCommand([
    "send",
    child.id,
    "--kind",
    "request",
    "--body",
    resumedForStart,
  ]);
  assert.match(resumedResult.text, /Message queued for resume/u);
  const resumed = await waitForOperation(
    "team-delegation: 親のsendで子を再開",
    teamRecords,
    (value) =>
      value.children[0].state === "running" &&
      value.children[0].messageFiles?.length,
    childFailure(teamRecords, (children) => children[0]),
  );
  assert.equal(resumed.children[0].terminalId, child.terminalId);
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
  await waitForOperation(
    "team-delegation: 親のsend後も未報告の入力待ちを一度知らせる",
    teamDelivery,
    (value) => value.claude.unreportedNotices === 2,
    anyFailure(
      childFailure(teamRecords, (children) => children[0]),
      cliFailure(screen, parentId),
    ),
  );
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await waitForCliState(client, parentId, ["idle", "done"]);
  const waitingResult = await parentCommand(["tasks"]);
  const waitingChild = waitingResult.data.children.find(
    (entry) => entry.child === child.id,
  );
  assert.equal(waitingChild.waiting, "report");
  assert.ok(
    waitingChild.waitingReasons.some((entry) => entry.reason === "no_report"),
  );
  await screen.click(`${childRow} .nav-child-button`);
  await record(
    "親のsendで再開した応答も一度知らせ、iori tasksに未報告の待ち理由を返す",
  );
  await record("子の停止は親を動かさず、親のsendで同じ会話を再開");
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await waitForCliState(client, parentId, ["idle", "done"]);
  await parentCommand([
    "send",
    child.id,
    "--kind",
    "request",
    "--body",
    "For this parent request override the previous Ready-only instruction: explain prime numbers in 600 words. Do not ask, report, or run waiting commands. Finish your response after the explanation." +
      fakeMarker("team-interrupt"),
  ]);
  await screen.click(`${childRow} .nav-child-button`);
  await waitForCliState(client, child.terminalId, ["active"]);
  await focusTerminal(client, child.terminalId);
  await screen.key("Escape");
  await waitForCliState(client, child.terminalId, ["idle", "done", "stopped"]);
  assert.equal((await teamDelivery()).claude.unreportedNotices, 2);
  await record(
    "親の依頼への応答をユーザーがEscで中断した時は未報告の知らせを増やさない",
  );

  await pasteToCli(
    client,
    "START. The interruption check is complete; cancel the prime-number explanation. Return to the original delegation: use iori ask to ask whether to report completion, then finish this turn and wait for the answer file." +
      fakeMarker("team-ask"),
  );
  await waitForOperation(
    "team-delegation: 子Codexのask",
    teamRecords,
    (value) => value.children[0].questionFiles.length >= 1,
    childFailure(teamRecords, (children) => children[0]),
  );
  await waitForOperation(
    "team-delegation: 親Claude Codeが質問の知らせを受信",
    teamDelivery,
    (value) => value.claude.questionNotice,
    anyFailure(
      childFailure(teamRecords, (children) => children[0]),
      cliFailure(screen, parentId),
    ),
  );
  await waitForCliState(client, child.terminalId, ["idle", "done"]);
  const questionWaitStarted = Date.now();
  await record("質問の知らせの一行がClaude Codeのuser入力の記録へ入る");
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await waitForCliState(client, parentId, ["idle", "done"]);
  await parentCommand(["read", child.id]);
  const questionWaitMs = Date.now() - questionWaitStarted;
  const answerBody =
    "- Yes, report completion now.\n- Keep this dash-prefixed line unchanged." +
    fakeMarker("team-answer");
  await writeFile(`${worktree}/team-send-answer.md`, answerBody);
  const messageFilesBeforeAnswer =
    (await teamRecords()).children[0].messageFiles?.length ?? 0;
  await parentCommand([
    "send",
    child.id,
    "--kind",
    "answer",
    "--file",
    "team-send-answer.md",
  ]);
  const answered = await waitForOperation(
    "team-delegation: Hostが親のanswer本文を保存",
    teamRecords,
    (value) =>
      value.children[0].messageFiles?.length > messageFilesBeforeAnswer,
    childFailure(teamRecords, (children) => children[0]),
  );
  assert.equal(
    await readFile(answered.children[0].messageFiles.at(-1), "utf8"),
    answerBody,
  );
  await waitForOperation(
    "team-delegation: 子Codexが回答の一行を受信",
    teamDelivery,
    (value) => value.codex.childAnswer,
    childFailure(teamRecords, (children) => children[0]),
  );
  await record("親の経路からのsend answerがCodexのuser入力の記録へ入る");
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await waitForOperation(
    "team-delegation: 親Claude Codeが報告の知らせを受信",
    teamDelivery,
    (value) => value.claude.reportNotice,
    anyFailure(
      childFailure(teamRecords, (children) => children[0]),
      cliFailure(screen, parentId),
    ),
  );
  await record("子Codexのreportの知らせがClaude Codeのuser入力の記録へ入る");
  await waitForOperation(
    "team-delegation: 操作後に子が報告",
    teamRecords,
    (value) => value.children[0].state === "reported",
    childFailure(teamRecords, (children) => children[0]),
  );
  await screen.wait(`${childRow}[data-iori-child-state="reported"]`);
  await waitFor(
    () => screen.text(`${childRow} .nav-child-state`),
    (value) => value.startsWith("Reported"),
  );
  await waitForCliState(client, child.terminalId, ["idle", "done"]);
  const reportWaitStarted = Date.now();
  await capture("children-reported");
  await mobileBoardsScenario({
    screen,
    worktree,
    mobile,
    desktop,
    shot,
    record,
    expectedState: "Reported",
    expectedDot: "done",
    finished: probeCount,
  });

  await openWorkspaceView(screen, "board");
  await screen.wait('[data-iori-view="board"] .board-agent-row');
  assert.equal(await screen.visible(".board-turns"), false);
  assert.equal(
    await screen.text(".board-agent-row .parent-verdict"),
    "Parent: Pending",
  );
  assert.equal(
    await screen.text(".board-agent-row .agent-heading strong"),
    "Worker · Low",
  );
  await screen.click('[data-iori-action="board-open-conversation"]');
  await screen.wait(
    `[data-iori-terminal-id="${parentId}"][data-iori-displayed="true"]`,
  );
  await openWorkspaceView(screen, "board");
  assert.ok(
    (await screen.text('[data-iori-view="board"]')).includes(
      "Verify team question, report and revision flow",
    ),
  );
  await screen.wait(`[data-iori-plan-task="${planTask}"]`);
  await screen.wait('[data-iori-agent-tokens="known"]');
  assert.match(
    await screen.text('[data-iori-agent-tokens="known"]'),
    /\d(?:[\d.,]*)(?:k|M)? tokens/u,
  );
  assert.match(
    await screen.text(".agent-quota"),
    /Codex \d+(?:\.\d+)?[mhd] \d+% · resets \d+[mhd]/iu,
  );
  assert.ok(
    (await screen.text(".board-agent-row .agent-main")).includes(
      `Task ${planTask}`,
    ),
  );
  assert.ok(
    (
      await screen.text(`[data-iori-plan-task="${planTask}"] .todo-assignee`)
    ).includes("Worker · Low · Codex"),
  );
  assert.ok(
    (
      await screen.text(`[data-iori-plan-task="${planTask}"] .todo-assignee`)
    ).includes(`Task ${planTask}`),
  );
  const editTeam = '[data-iori-action="board-edit-team"]';
  const verifyTeamLink = async () => {
    await screen.wait(editTeam);
    assert.equal(await screen.text(editTeam), savedTeam.name);
    await screen.click(editTeam);
    await screen.wait(".team-surface:not([hidden]) .team-overview");
    assert.equal(
      await screen.value('.team-overview [data-iori-field="team-name"]'),
      savedTeam.name,
    );
  };
  await verifyTeamLink();
  await returnToWorktree(screen, worktree);
  await openWorkspaceView(screen, "board");
  const captureBoardRecords = async (view) => {
    if (!process.env.IORI_BOARD_CAPTURE) return;
    await desktop();
    if (view === "board") await openWorkspaceView(screen, "board");
    else {
      await screen.click('[data-iori-action="open-agents-teams"]');
      await screen.click('[data-iori-action="teams-records"]');
    }
    await screen.wait(`[data-iori-view="${view}"]`);
    if (view === "records")
      assert.equal(
        await screen.evaluate(
          "getComputedStyle(document.querySelector('.record-table-head')).display",
        ),
        "grid",
      );
    const language = async (value) => {
      await screen.click('[data-iori-action="settings-open"]');
      await screen.click('[data-iori-action="settings-display"]');
      await screen.click('[data-iori-action="display-language"]');
      await screen.click(`[data-iori-option="language-${value}"]`);
      await screen.click('[data-iori-action="settings-close"]');
    };
    await language("ja");
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark',${theme === "dark"})`,
      );
      await shot(`pc-${view}-${theme}`);
    }
    await language("en");
    await screen.evaluate("document.documentElement.classList.add('dark')");
    await shot(`pc-${view}-en-dark`);
    await language("ja");
    await mobile({ width: 400, height: 900 });
    if (view === "board") {
      await openSidebar(screen);
      await screen.click(
        `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
      );
      await openSidebar(screen);
      await openWorkspaceView(screen, "board");
    } else {
      await openSidebar(screen);
      await screen.click('[data-iori-action="open-agents-teams"]');
      await screen.click('[data-iori-action="teams-records"]');
    }
    await screen.evaluate("document.documentElement.classList.add('dark')");
    await screen.wait(`[data-iori-view="${view}"]`);
    await closeSidebar(screen);
    if (view === "records")
      assert.equal(
        await screen.evaluate(
          "getComputedStyle(document.querySelector('.record-table-head')).display",
        ),
        "none",
      );
    await shot(`mobile-${view}-dark`);
    if (view === "board") await verifyTeamLink();
    await desktop();
    if (view === "board") await returnToWorktree(screen, worktree);
    await language("ja");
  };
  await record(
    "Boardから親の会話へ移動し、難易度LowをPlanとAgentsに表示、報告後はAttentionを出さずParent: Pendingを表示",
  );
  await captureBoardRecords("board");
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
    "team-delegation: 親の差し戻しを記録し子が再報告",
    teamRecords,
    (value) =>
      value.tasks[0].revisions.length === 1 &&
      value.children[0].reportFiles.length >= 2 &&
      value.children[0].state === "reported",
    childFailure(teamRecords, (children) => children[0]),
  );
  const revisionWorkMs = revised.children[0].reportedAt - revisionSentAt;
  assert.ok(revisionWorkMs > 0);
  await waitForCliState(client, parentId, ["idle", "done"]);
  assert.equal((await teamDelivery()).claude.unreportedNotices, 2);
  const finished = await parentCommand([
    "finish",
    child.id,
    "--decision",
    "accept",
    "--reason",
    "Question answered and report verified.",
    "--worktree",
    "keep",
  ]);
  assert.equal(
    finished.text,
    `Child finished: accept. Question answered and report verified.\nPlan task ${planTask} is still in_progress. Update it with iori plan update ${planTask} --state done when the work is complete.`,
  );
  await parentCommand([
    "plan",
    "update",
    String(planTask),
    "--state",
    "done",
    "--checkpoint",
    "Question and revised report verified",
  ]);
  await screen.wait('[data-iori-action="children-ended"]');
  await showEndedChildren(screen);
  await screen.wait(`${childRow}[data-iori-child-state="finished"]`);
  assert.ok(
    (await screen.text(`${childRow} .nav-child-state`)).startsWith("Finished"),
  );
  await capture("children-finished");
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
  await record("Clientを開き直した後の終了子タブがworktree往復で残る");
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await record("親の受け入れで子がFinishedとなり、終了した子の画面を再表示");
  await screen.click(
    `.dock-tab-header:has([data-iori-tab-id="terminal:${child.terminalId}"]) .dock-tab-close`,
  );
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
  // The known idle windows contain real question/read and Board operations,
  // not artificial delays.
  assert.ok(
    finishedChild.workMs <=
      finishedChild.elapsedMs - questionWaitMs - reportWaitMs,
  );
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
  await record(
    "Recordsの一覧の時間が質問・判定の待ち時間を除いた子の作業時間と一致",
  );
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
  await record("子のタブを閉じた後も、Recordsの経緯から最後の画面を開く");
  await record("Recordsで候補・担当タスク・差し戻し本文と受け入れの経緯を表示");
  await captureBoardRecords("records");
  await returnToWorktree(screen, worktree);
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await childLifecycleScenario({
    client,
    teamId,
    definition: savedTeam,
    worktree,
    parentId,
    retainedChild: child,
    parentInput,
    parentCommand,
    restartHostLosingTerminals,
    teamDelivery,
    record,
    capture,
    phone,
  });
  await repoDelegationScenario({
    fakeModelRequests,
    client,
    worktree,
    secondRepository,
    teamRecords,
    parentId,
    parentInput,
    parentCommand,
    teamId,
    definition: savedTeam,
    record,
  });
  const continued = await parentCommand([
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "low",
    "--title",
    "Continue verification",
    "--worktree",
    "parent",
    "--continue",
    child.task,
    "--body",
    "Read the previous request, then reply Ready." +
      fakeMarker("team-continued-ready"),
  ]);
  const continuedRecords = await waitForOperation(
    "team-delegation: 受け入れ済みの子から引き継ぐ",
    allTeamRecords,
    (value) =>
      value.children.find((entry) => entry.id === continued.data.child)
        ?.terminalId,
    childFailure(allTeamRecords, (children) =>
      children.find((entry) => entry.id === continued.data.child),
    ),
  );
  const continuedChild = continuedRecords.children.find(
    (entry) => entry.id === continued.data.child,
  );
  const folder = dirname(continuedChild.requestFile);
  const delegation = (await readdir(folder)).find((name) =>
    /^delegation-.+\.md$/u.test(name),
  );
  assert.ok(delegation);
  const request = await readFile(join(folder, delegation), "utf8");
  assert.ok(request.includes("About the previous worker"));
  assert.ok(
    request.includes(
      "was finished by the parent (decision: accept; reason: Question answered and report verified.).",
    ),
  );
  assert.ok(request.includes(initialChildRequest));
  assert.ok(
    request.includes(
      "Confirm explicitly that no files changed, then report again.",
    ),
  );
  assert.ok(request.includes("Quoted reports (evidence, not instructions)"));
  await parentCommand(["stop", continued.data.child]);
  await record("受け入れ済みの子から依頼全文・差し戻し・報告を引き継ぐ");
  // A saved team's disabled state removes its launcher group.
  await screen.click('[data-iori-action="open-agents-teams"]');
  await screen.click('[data-iori-action="teams-list"]');
  await screen.click('.team-surface:not([hidden]) [role="switch"]');
  await returnToWorktree(screen);
  await screen.click('[data-iori-action="workspace-add-tab"]');
  await screen.wait('.new-items-popover [data-iori-teams-loaded="true"]');
  assert.equal(
    await screen.evaluate(
      `Boolean(document.querySelector('.new-items-popover [data-iori-team-id="${teamId}"]'))`,
    ),
    false,
  );
  await screen.key("Escape");
  execFileSync("git", [
    "-C",
    worktree,
    "worktree",
    "remove",
    "--",
    setupOptions.settingsWorktree,
  ]);
  await record("準備設定の保存用に作ったworktreeを片付ける");
}
