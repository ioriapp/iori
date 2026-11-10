import { fakeMarker } from "../fake-model/marker.mjs";
import { probeDelegationCommand } from "../fake-model/team-messages.mjs";
import {
  waitForOperation,
  childFailure,
  cliFailure,
  anyFailure,
} from "../../verification/web/operation.mjs";
import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import { claudeWithoutTools, teamParentInput } from "./team-parent-input.mjs";
import { repoDelegationScenario } from "./repo-delegation.mjs";
import { openSidebar, closeSidebar } from "../connection/scenario.mjs";
import { childCliFailureScenario } from "./child-cli-failure.mjs";
import { pasteToCli } from "./cli-input.mjs";
import { childLifecycleScenario } from "./child-lifecycle.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { waitFor } from "../../verification/ui.mjs";
import {
  observe,
  observed,
  clearObserved,
  typeTerminal,
} from "../terminal/scenario.mjs";
import { waitForCliState, focusTerminal } from "../cli-screen/scenario.mjs";
import { submitToCli } from "../cli-screen/input.mjs";
import {
  returnToWorktree,
  saveStartupArguments,
} from "./agents-navigation.mjs";

const readyForStart =
  'Read every file named in the parent message before replying. Before START, return only "Ready" as your final answer and finish this response. Do not use tools to wait or agent-collaboration tools. Do not run any other commands before START.';
export const delegationUserRequest = `Run exactly this one shell command: ${probeDelegationCommand}. Then end your turn.${fakeMarker("team-parent-delegate")}`;
export async function prepareTeamScenario({
  fakeModelRequests,
  client,
  worktree,
  teamRecords,
  teamDelivery,
  teamCommand,
  restartHostLosingTerminals,
  reload,
  record,
  shot,
  desktop,
  mobile,
  phone,
  workflow,
  lifecycleOnly = false,
  lifecycleWorkflow,
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
  if (workflow === "team-child-tabs") {
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
  if (workflow === "team-command-route") {
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
  if (workflow === "team-child-tabs" || opencodeOnly) {
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
  }
  const checkStartupArguments = workflow === "team-child-tabs";
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
  if (workflow !== "team-command-route" && !activityOnly)
    await saveStartupArguments(
      screen,
      "claude",
      workflow === "team-child-tabs"
        ? `${claudeWithoutTools} --name "Team startup arguments"`
        : claudeWithoutTools,
    );
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
      // The resumed CLI runs in a shell, so its tab stays after exit.
      await screen.click('button[data-iori-tab-kind="start"]');
    }
  }
  if (workflow === "team-child-tabs") {
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
  }
  await screen.click(`[data-iori-team-id="${teamId}"]`);
  await screen.wait('[data-iori-tab-cli="claude"]');
  await screen.wait('button[data-iori-tab-kind="board"]');
  if (workflow === "team-child-tabs") {
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
      await screen.attribute(
        'button[data-iori-tab-kind="board"]',
        "data-state",
      ),
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
  }
  const parentId = (
    await screen.attribute('[data-iori-tab-cli="claude"]', "data-iori-tab-id")
  ).replace(/^terminal:/u, "");
  await screen.wait(
    `[data-iori-terminal-id="${parentId}"][data-iori-stream-state="ready"]`,
  );
  await waitForCliState(client, parentId, ["idle", "done"]);
  await record("＋のチームから親Claude Codeを起動し、開始hookを確認");
  if (workflow !== "team-command-route" && !activityOnly) {
    await saveStartupArguments(screen, "claude", "");
    await returnToWorktree(screen, worktree);
    await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  }
  const candidatesInDelegateResponse = new Set();
  const parentInput = teamParentInput({
    client,
    parentId,
    teamRecords,
    teamDelivery,
    candidatesInDelegateResponse,
  });
  const parentCommand = async (args, options) => {
    const result = await teamCommand(parentId, args, options);
    if (args[0] === "delegate" && result.data?.waiting === "candidates") {
      candidatesInDelegateResponse.add(result.data.child);
    }
    return result;
  };
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
      reload,
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
      "チーム: 操作表示を確かめる子を委譲",
      teamRecords,
      (value) => value.children.length === 1 && value.children[0].terminalId,
      childFailure(teamRecords, (children) => children[0]),
    );
    const child = initial.children[0];
    await screen.click(`[data-iori-child-id="${child.id}"] .nav-child-button`);
    await waitForOperation(
      "チーム: 対象の子の初回応答の記録と完了hook",
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
      "チーム: 操作後に子が報告",
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
      parentCommand,
      teamDelivery,
      record,
      capture,
      phone,
      lifecycleWorkflow,
    });
    return;
  }
  if (opencodeOnly) {
    const answerReportApproval = async (status, answered, reportText) => {
      if (status?.attention?.kind !== "approval" || answered.has(status.since))
        return false;
      const { tool, summary = "" } = status.attention;
      assert.equal(tool, opencodeV2 ? "shell" : "bash");
      const report = new RegExp(
        `^(?:[\\w./-]*/)?iori\\s+report\\s+--body\\s+(["']?)${reportText}\\1\\s*$`,
        "u",
      ).test(summary);
      const discovery =
        ["command -v iori", "which iori", "type iori", "iori --help"].includes(
          summary.trim(),
        ) ||
        /^command -v iori; iori --help 2>&1 \| head -\d+$/u.test(
          summary.trim(),
        );
      assert.ok(report || discovery, `unexpected approval: ${summary}`);
      await typeTerminal(client, "");
      await observed(client, "Permission required");
      answered.add(status.since);
      // OpenCode 1.19.2 selects Allow once first in its permission prompt.
      await screen.key("Enter");
      return report;
    };
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
      "チーム: 操作表示を確かめる子を委譲",
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
      "チーム: OpenCodeの初回の未報告の応答終了が親の実入力へ一度届く",
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
    let reportApproved = false;
    const result = await waitForOperation(
      "チーム: OpenCodeの報告",
      async () => {
        const value = await teamRecords();
        if (["reported", "failed"].includes(value.children[0].state))
          return value;
        const status = await screen.evaluate(
          `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,'terminal.list',{});return r.result.terminals.find(t=>t.id===${JSON.stringify(child.terminalId)})?.cliStatus})()`,
        );
        reportApproved =
          (await answerReportApproval(
            status,
            answered,
            "OPENCODE_REPORT_OK",
          )) || reportApproved;
        return value;
      },
      (value) => ["reported", "failed"].includes(value.children[0].state),
      childFailure(teamRecords, (children) => children[0]),
    );
    assert.equal(result.children[0].state, "reported");
    assert.ok(reportApproved, "報告のシェルの承認に答えて完了する");
    assert.match(
      await readFile(result.children[0].reportFiles.at(-1), "utf8"),
      /OPENCODE_REPORT_OK/u,
    );
    await screen.wait('[data-iori-child-state="reported"]');
    await record(
      `無料OpenCodeは依頼書を外部フォルダー承認なしで読み取り、探索・報告のシェル承認${answered.size}回に答えて完了`,
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
    reportApproved = false;
    const resumedReport = await waitForOperation(
      "チーム: 停止したOpenCodeへsendした依頼が同じ子へ届き報告する",
      async () => {
        const value = await teamRecords();
        const status = await screen.evaluate(
          `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,'terminal.list',{});return r.result.terminals.find(t=>t.id===${JSON.stringify(child.terminalId)})?.cliStatus})()`,
        );
        reportApproved =
          (await answerReportApproval(
            status,
            answered,
            "OPENCODE_RESUMED_REPORT_OK",
          )) || reportApproved;
        return value;
      },
      (value) => value.children[0].reportFiles.length > reportsBeforeResume,
      childFailure(teamRecords, (children) => children[0]),
    );
    assert.ok(reportApproved, "再開後の報告のシェルの承認に答える");
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
    await waitForOperation(
      "チーム: Auto-approveのOpenCodeの子を起動",
      teamRecords,
      (value) =>
        value.children.some(
          (entry) => entry.id === auto.data.child && entry.terminalId,
        ),
      childFailure(teamRecords, (children) =>
        children.find((entry) => entry.id === auto.data.child),
      ),
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
  return {
    client,
    screen,
    worktree,
    teamId,
    savedTeam,
    parentId,
    parentInput,
    parentCommand,
    teamRecords,
    teamDelivery,
    record,
    shot,
    desktop,
    mobile,
    phone,
    capture,
    codexExtra,
  };
}
