import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import { ToolActivity } from "../../apps/host/src/cli/hooks.ts";
import { hooks as piHooks } from "../../apps/host/src/cli/pi/hooks.ts";
import { mobileBoardsScenario } from "./mobile-boards.mjs";
import { sidebarWorktrees } from "./agents-navigation.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { openSidebar, closeSidebar } from "../connection/scenario.mjs";

// Exercise the full Client with the existing Host-response/event fixture seam.
// No model runs: the notification scenario has already created the team/child.
export async function childRunningScenario({
  screen,
  worktree,
  repository,
  request,
  childDisplayFixture,
  record,
  mobile,
  desktop,
  shot,
}) {
  await mobileBoardsScenario({
    screen,
    worktree,
    mobile,
    desktop,
    shot,
    record,
    expectedState: "Waiting",
    expectedDot: "stopped",
  });
  const { children } = await request("teams.children", {});
  const child = children[0];
  const { terminals } = await request("terminal.list", {});
  const terminal = {
    ...terminals.find((entry) => entry.id === child.parentTerminalId),
    id: child.id,
    teamChild: child.id,
    title: child.title,
  };
  const board = await request("teams.board", { cwd: worktree });
  const row = `[data-iori-child-id="${child.id}"]`;
  const boardRow = `[data-iori-board-agent="${child.id}"]`;
  await openWorkspaceView(screen, "board");
  await screen.wait(boardRow);
  assert.equal(
    await screen.text(`${boardRow} .agent-heading strong`),
    "Worker",
  );
  await screen.click('[data-iori-action="board-open-conversation"]');
  await screen.wait(
    `[data-iori-terminal-id="${child.parentTerminalId}"][data-iori-displayed="true"]`,
  );
  assert.equal(
    await screen.evaluate(
      `document.querySelectorAll('[data-iori-terminal-id="${child.parentTerminalId}"]').length`,
    ),
    1,
    "既に開いている親の会話へ移り、タブを重複させない",
  );
  await openWorkspaceView(screen, "board");
  await screen.wait(boardRow);
  for (const [state, label, detail] of [
    ["reported", "Reported", "親の判定待ち"],
    ["question", "Question", "親の回答待ち"],
  ]) {
    for (const cliState of ["active", "done"]) {
      const cliStatus = { state: cliState, since: Date.now() };
      childDisplayFixture(
        { ...child, terminalId: terminal.id, state },
        {
          ...board,
          agents: board.agents.map((agent) =>
            agent.id === child.id ? { ...agent, state, cliStatus } : agent,
          ),
        },
        { ...terminal, cliStatus },
      );
      const shown = cliState === "active" ? "Running" : label;
      await waitFor(
        () => screen.text(`${row} .nav-child-state`),
        (value) => value.startsWith(shown),
        15000,
        `子の行: ${state}/${cliState} → ${shown}`,
      );
      assert.equal(
        await screen.attribute(`${row} [data-status]`, "data-status"),
        cliState === "active"
          ? "active"
          : state === "reported"
            ? "done"
            : "waiting",
      );
      if (cliState === "active")
        assert.match(
          await screen.text(`${row} .nav-child-state`),
          new RegExp(state === "reported" ? "Reported" : "Question", "u"),
        );
      await waitFor(
        () => screen.text(`${boardRow} .agent-current`),
        (value) => value === `${shown} · ${detail}`,
        15000,
        `Board: ${state}/${cliState} → ${shown}`,
      );
      assert.equal(
        await screen.attribute(`${boardRow} [data-status]`, "data-status"),
        cliState === "active"
          ? "active"
          : state === "reported"
            ? "done"
            : "waiting",
      );
      assert.equal(
        await screen.text(`${boardRow} .parent-verdict`),
        "Parent: Pending",
      );
      assert.equal(await screen.visible(".board-turns"), false);
    }
  }
  await shot("pc-board-parent-pending");
  await screen.wait(`[data-iori-terminal-row="${child.parentTerminalId}"]`);
  const noParentStatus = await screen.evaluate(`(()=>{
    const parent = document.querySelector('[data-iori-terminal-row="${child.parentTerminalId}"]');
    const child = document.querySelector('${row} .state-dot');
    return {parentTitle:parent.querySelector('.nav-session-title').getBoundingClientRect().x, childMark:child.getBoundingClientRect().x};
  })()`);
  assert.equal(noParentStatus.childMark, noParentStatus.parentTitle);
  await record(
    `親に状態の印がない行の字下げ: ${JSON.stringify(noParentStatus)}`,
  );
  const showActivity = (
    activity,
    state = "running",
    cliState = "active",
    attention,
  ) => {
    const cliStatus = {
      state: cliState,
      since: Date.now(),
      ...(activity ? { activity } : {}),
      ...(attention ? { attention } : {}),
    };
    childDisplayFixture(
      { ...child, terminalId: terminal.id, state },
      {
        ...board,
        agents: board.agents.map((agent) =>
          agent.id === child.id
            ? { ...agent, terminalId: terminal.id, state, cliStatus }
            : agent,
        ),
      },
      { ...terminal, cliStatus },
    );
  };
  for (const [activity, expected] of [
    [undefined, "Running"],
    [{ kind: "thinking" }, "Thinking"],
    [{ kind: "tool", tool: "Bash", summary: "pnpm test" }, "Bash pnpm test"],
    [{ kind: "tool", tool: "Edit", summary: "src/x.ts" }, "Edit src/x.ts"],
    [{ kind: "thinking" }, "Thinking"],
  ]) {
    showActivity(activity);
    await waitFor(
      () => screen.text(`${boardRow} .agent-current`),
      (value) => value === expected,
    );
    assert.equal(
      await screen.attribute(`${boardRow} .agent-current`, "title"),
      expected,
    );
    assert.equal(
      await screen.attribute(`${boardRow} [data-status]`, "data-status"),
      "active",
    );
  }
  const currentSelector = `${boardRow} .agent-current`;
  // Receipt and DOM changes share the page clock. Only lower bounds are
  // meaningful here; transport or rendering delays never impose an upper bound.
  const nextActivity = (expected) =>
    waitFor(
      () => screen.text(currentSelector),
      (text) => text === expected,
    );
  // Observe receipt and DOM changes through existing APIs. If the browser was
  // suspended between the two deliveries, it was not a short tool for this
  // Client; the pure rule tests still cover that boundary deterministically.
  await screen.evaluate(`(async () => {
    const { native } = await import('/src/native.ts');
    window.shortToolObservation = {labels:[], received:[], events:[]};
    window.stopShortToolEvents = await native.onStream(({json}) => {
      const event = JSON.parse(json);
      if (event.type !== 'terminal.updated' || event.terminal.id !== ${JSON.stringify(terminal.id)}) return;
      const activity = event.terminal.cliStatus?.activity;
      window.shortToolObservation.events.push({at:performance.now(),kind:activity?.kind,tool:activity?.tool,summary:activity?.summary});
      if (activity?.summary === 'ls' || (window.shortToolObservation.received.length === 1 && activity?.kind === 'thinking'))
        window.shortToolObservation.received.push(performance.now());
    });
    const label = document.querySelector(${JSON.stringify(currentSelector)});
    window.shortToolObserver = new MutationObserver(() => window.shortToolObservation.labels.push({at:performance.now(),text:label.textContent}));
    window.shortToolObserver.observe(label, {childList:true,characterData:true,subtree:true});
    return true;
  })()`);
  showActivity({ kind: "tool", tool: "Bash", summary: "ls" });
  showActivity({ kind: "thinking" });
  await waitFor(() =>
    screen.evaluate("window.shortToolObservation.received.length === 2"),
  );
  showActivity({ kind: "tool", tool: "Bash", summary: "sleep 1" });
  await nextActivity("Bash sleep 1");
  showActivity({ kind: "thinking" });
  await nextActivity("Thinking");
  const short = await screen.evaluate(`(() => {
    window.stopShortToolEvents();
    window.shortToolObserver.disconnect();
    return window.shortToolObservation;
  })()`);
  if (short.received[1] - short.received[0] < 500)
    assert.equal(
      short.labels.some((entry) => entry.text === "Bash ls"),
      false,
      "Clientが短い開始・終了を受け取ったツールを表示しない",
    );
  const receivedTool = short.events.find(
    (entry) => entry.summary === "sleep 1",
  );
  const shownTool = short.labels.find((entry) => entry.text === "Bash sleep 1");
  const nextLabel = short.labels.find(
    (entry) => entry.at > shownTool.at && entry.text !== shownTool.text,
  );
  assert.ok(
    shownTool.at - receivedTool.at >= 500,
    "受信から500ms以上のツールを表示する",
  );
  assert.ok(
    nextLabel.at - shownTool.at >= 200,
    "表示したツールを次の変化まで200ms以上保つ",
  );
  await record(`ページ内のツール受信と表示の時刻: ${JSON.stringify(short)}`);

  showActivity({ kind: "tool", tool: "Bash", summary: "needs approval" });
  await nextActivity("Bash needs approval");
  showActivity(undefined, "running", "waiting", {
    kind: "approval",
    tool: "Bash",
    summary: "needs approval",
  });
  await nextActivity("Approval");
  showActivity({ kind: "tool", tool: "Bash", summary: "needs approval" });
  await nextActivity("Bash needs approval");
  showActivity({ kind: "thinking" });
  await nextActivity("Thinking");
  await record(
    "PCのBoard: Thinking→ツール→Thinking、ツール→Approval→同じツール→Thinkingの表示を確認。500ms・200msの境界はClientの時刻を入力する純粋関数の試験で確認（通信fixture）",
  );
  const tools = new ToolActivity();
  for (const [payload, expected] of [
    [
      {
        hook_event_name: "tool_call",
        toolCallId: "first",
        tool_name: "bash",
        tool_input: { command: "pnpm test" },
      },
      "bash pnpm test",
    ],
    [
      {
        hook_event_name: "tool_call",
        toolCallId: "second",
        tool_name: "edit",
        tool_input: { path: "src/x.ts" },
      },
      "edit src/x.ts",
    ],
    [
      { hook_event_name: "tool_execution_end", toolCallId: "first" },
      "edit src/x.ts",
    ],
    [
      { hook_event_name: "tool_execution_end", toolCallId: "second" },
      "Thinking",
    ],
  ]) {
    showActivity(
      tools.update(piHooks.normalize(payload, undefined, worktree)).activity,
    );
    await waitFor(
      () => screen.text(`${boardRow} .agent-current`),
      (value) => value === expected,
    );
  }
  await record(
    "並列ツール: 2件開始後、先のツールだけ終了しても残りのeditを表示し、最後の終了でThinking（Pi normalizeと共通管理を通す通信fixture）",
  );
  const longCommand =
    "pnpm test --filter " + "packages/long-command-target/".repeat(16);
  showActivity({ kind: "tool", tool: "Bash", summary: longCommand });
  await waitFor(
    () => screen.text(`${boardRow} .agent-current`),
    (value) => value === `Bash ${longCommand}`,
  );
  const checkOneLine = async () => {
    const geometry = await screen.evaluate(
      `(()=>{const e=document.querySelector('${boardRow} .agent-current'); const s=getComputedStyle(e); return {width:e.clientWidth, scroll:e.scrollWidth, height:e.clientHeight, line:parseFloat(s.lineHeight), whiteSpace:s.whiteSpace, overflow:s.textOverflow};})()`,
    );
    assert.equal(geometry.whiteSpace, "nowrap");
    assert.equal(geometry.overflow, "ellipsis");
    assert.ok(geometry.scroll > geometry.width);
    assert.ok(geometry.height <= geometry.line + 1);
  };
  await checkOneLine();
  await shot("pc-board-tool-activity");
  await screen.click('button[data-iori-tab-kind="board"]');
  await screen.key("Tab");
  await screen.key("Shift+Tab");
  await shot("pc-board-tab-keyboard-focus");
  await mobile({ width: 390, height: 844 });
  await openSidebar(screen);
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await openSidebar(screen);
  await openWorkspaceView(screen, "board");
  await screen.click('.board-tabs [role="tab"][data-state="inactive"]');
  await screen.wait(
    '.board-grid[data-mobile-section="agents"] .agents-section',
  );
  await closeSidebar(screen);
  await checkOneLine();
  await shot("mobile-board-tool-activity");
  await desktop();
  await record(
    "Boardの操作表示はRunningへfallbackし、500ms以上続いたBash・EditとThinkingが同じ印のまま切り替わる。長いコマンドはPC・スマホとも1行省略と全文title（通信fixture）",
  );
  // Many CLI approvals use the existing Host-response fixture, while layout,
  // scrolling and tab activation go through the full rendered Board.
  const approvals = Array.from({ length: 24 }, (_, index) => ({
    ...board.agents[0],
    id: `board-approval-${index}`,
    title: `確認を待つ作業 ${index + 1}`,
    state: "running",
    cliStatus: {
      state: "waiting",
      since: Date.now(),
      attention: { kind: "approval", tool: "Bash", summary: "pnpm test" },
    },
  }));
  childDisplayFixture(child, {
    ...board,
    agents: approvals,
    conversations: board.conversations.map((conversation) => ({
      ...conversation,
      plan: {
        goal: "報告を確認して作業を進める",
        activity: [],
        tasks: approvals.map((agent, index) => ({
          number: index + 1,
          title: agent.title,
          state: "pending",
          added: false,
          updatedAt: Date.now(),
        })),
      },
    })),
  });
  await mobile({ width: 390, height: 844 });
  await screen.wait('[data-iori-view="workspace"]');
  await openSidebar(screen);
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await openSidebar(screen);
  await openWorkspaceView(screen, "board");
  const boardView = '[data-iori-view="board"]';
  const attention = '[data-iori-board-attention="approval"]';
  await waitFor(
    () => screen.evaluate(`document.querySelectorAll('${attention}').length`),
    (count) => count === approvals.length,
  );
  await screen.scroll(boardView, { top: 0 });
  const geometry = () =>
    screen.evaluate(`(()=>{
    const board=document.querySelector('${boardView}');
    const tabs=board.querySelector('.board-tabs');
    const rows=board.querySelectorAll('${attention}');
    const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}};
    return {board:rect(board),tabs:rect(tabs),first:rect(rows[0]),last:rect(rows[rows.length-1]),scrollTop:board.scrollTop};
  })()`);
  const before = await geometry();
  assert.ok(before.first.top >= before.board.top);
  assert.ok(before.last.bottom > before.board.bottom);
  await shot("mobile-board-attention-before-scroll");
  // Bring the final approval fully into view before continuing to the tabs.
  await screen.scroll(boardView, {
    top: before.last.bottom - before.board.bottom + 20,
  });
  await waitFor(
    geometry,
    (g) => g.last.top >= g.board.top && g.last.bottom <= g.board.bottom,
  );
  await screen.scroll(boardView, {
    top: before.tabs.top - before.board.top,
  });
  await waitFor(geometry, (g) => Math.abs(g.tabs.top - g.board.top) <= 1);
  const agentsTab = '.board-tabs [role="tab"][data-state="inactive"]';
  await screen.click(agentsTab, { scroll: false });
  await screen.wait(
    '.board-grid[data-mobile-section="agents"] .agents-section',
  );
  // Scroll far enough that content passes behind the pinned tabs.
  await screen.scroll(boardView, {
    top: before.tabs.top - before.board.top + 200,
  });
  await waitFor(
    geometry,
    (g) =>
      Math.abs(g.tabs.top - g.board.top) <= 1 && g.first.bottom < g.board.top,
  );
  await shot("mobile-board-attention-after-scroll");
  await screen.click('.board-tabs [role="tab"][data-state="inactive"]', {
    scroll: false,
  });
  await screen.wait('.board-grid[data-mobile-section="plan"] .plan-section');
  await waitFor(geometry, (g) => Math.abs(g.tabs.top - g.board.top) <= 1);
  await screen.click('.board-tabs [role="tab"][data-state="inactive"]', {
    scroll: false,
  });
  await screen.wait(
    '.board-grid[data-mobile-section="agents"] .agents-section',
  );
  await record(
    "スマホのBoardで最後のAttentionまで読み、先頭を画面外へ送り、上端に固定されたPlan/Agentsを往復できる（通信fixture）",
  );
  await desktop();
  await screen.wait(`${row} .nav-child-button`);
  const parent = terminals.find((entry) => entry.id === child.parentTerminalId);
  const showChild = () => {
    const shown = {
      ...child,
      terminalId: terminal.id,
      cli: parent.cli,
      title: "サイドバーの親子関係と長い題名を確認する作業",
      cwd: `${worktree}/feature/sidebar-navigation-long-branch-name`,
      state: "running",
    };
    const cliStatus = { state: "active", since: Date.now() };
    childDisplayFixture(shown, board, {
      ...terminal,
      cli: parent.cli,
      cliStatus,
    });
    // The parent also carries a status mark, as provider CLIs do in daily use.
    childDisplayFixture(shown, board, { ...parent, cliStatus });
  };
  showChild();
  await screen.wait(".nav-children .nav-child-branch");
  childDisplayFixture(undefined, board, {
    ...parent,
    cliStatus: { state: "done", since: Date.now() },
  });
  await screen.wait(
    `[data-iori-terminal-row="${parent.id}"] [data-status="done"]`,
  );
  const dark = await screen.evaluate(
    "document.documentElement.classList.contains('dark')",
  );
  for (const theme of ["dark", "light"]) {
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
    );
    await shot(`pc-sidebar-parent-done-${theme}`);
  }
  await screen.evaluate(
    `document.documentElement.classList.toggle('dark', ${dark})`,
  );
  showChild();
  await sidebarWorktrees({
    screen,
    worktree,
    repository,
    request,
    parent,
    childRow: row,
    showChild,
    mobile,
    shot,
    record,
  });
  await openSidebar(screen);
  await screen.click(
    `.nav-worktree:has(button[data-iori-worktree-path=${JSON.stringify(worktree)}]) [data-iori-action="worktree-toggle"]`,
  );
  for (const theme of ["dark", "light"]) {
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
    );
    await shot(`mobile-sidebar-rows-${theme}`);
  }
  await screen.evaluate(
    `document.documentElement.classList.toggle('dark', ${dark})`,
  );
  await desktop();
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await openWorkspaceView(screen, "files");
  await screen.wait('[data-iori-file="sample.txt"]');
  await screen.click('[data-iori-file="sample.txt"]');
  await screen.wait('[data-iori-tab="sample.txt"][aria-selected="true"]');
  for (const theme of ["dark", "light"]) {
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
    );
    await shot(`pc-files-selected-tab-${theme}`);
  }
  await screen.evaluate(
    `document.documentElement.classList.toggle('dark', ${dark})`,
  );
  await openWorkspaceView(screen, "git");
  for (const theme of ["dark", "light"]) {
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
    );
    await shot(`pc-git-selected-tab-${theme}`);
  }
  await screen.evaluate(
    `document.documentElement.classList.toggle('dark', ${dark})`,
  );
  childDisplayFixture(child, undefined);
  await record(
    "報告・質問後も作業中はサイドバーとBoardがRunningになり、応答終了でReported・Questionへ戻る（通信fixture）",
  );
}
