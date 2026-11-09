import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { closeSidebar, openSidebar } from "../connection/scenario.mjs";

/** The Host surface returns to the worktree layout that stayed mounted. */
export async function returnToWorktree(screen, worktreePath) {
  const path =
    worktreePath ??
    (await waitFor(() =>
      screen.attribute(
        "[data-iori-current-worktree-path]",
        "data-iori-current-worktree-path",
      ),
    ));
  await screen.click(`button[data-iori-worktree-path=${JSON.stringify(path)}]`);
}
export async function openAgents(screen) {
  await screen.click('[data-iori-action="open-agents-teams"]');
  await screen.click('[data-iori-action="teams-agents"]');
}
/** Move an AI Agents control away from the viewport edge before opening it. */
export async function clickAgentControl(screen, selector) {
  await screen.reveal(selector);
  await screen.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`,
  );
  await screen.click(selector);
}
/** The `id` of the CLI row named `name` on the AI agents screen. */
export function cliRowNamed(screen, name) {
  return waitFor(
    () =>
      screen.evaluate(
        `[...document.querySelectorAll('[data-iori-cli-row]')].find(row=>row.querySelector('.team-agent-name > span')?.textContent===${JSON.stringify(name)})?.dataset.ioriCliRow`,
      ),
    Boolean,
    undefined,
    `AIエージェントの一覧の行: ${name}`,
  );
}
/** Add a CLI with the name and launch command fields of the AI agents
 * screen that is open, and return its `id`. */
export async function addCliByCommand(screen, name, command) {
  await screen.click('[data-iori-action="cli-add-open"]');
  await screen.input('[data-iori-field="cli-name"]', name);
  await screen.input('[data-iori-field="cli-command"]', command);
  await screen.click('[data-iori-action="cli-add-submit"]');
  return cliRowNamed(screen, name);
}

/** Navigate real worktrees and launch local CLI processes through the Client. */
export async function sidebarWorktrees({
  screen,
  worktree,
  repository,
  request,
  parent,
  childRow,
  showChild,
  mobile,
  shot,
  record,
}) {
  const button = (path) =>
    `button[data-iori-worktree-path=${JSON.stringify(path)}]`;
  const group = (path) => `.nav-worktree:has(${button(path)})`;
  const toggle = `${group(worktree)} [data-iori-action="worktree-toggle"]`;
  const summary = `${group(worktree)} .nav-activity-summary`;
  const parentRow = `[data-iori-terminal-row="${parent.id}"]`;
  const collapse = async () => {
    await screen.click(toggle);
    await screen.reveal(summary);
    await waitFor(async () => !(await screen.visible(parentRow)));
  };
  const launcher = '.new-items-popover[data-state="open"]';
  const current = () =>
    screen.attribute(
      "[data-iori-current-worktree-path]",
      "data-iori-current-worktree-path",
    );
  const tabIds = () =>
    screen.evaluate(
      `JSON.stringify([...document.querySelectorAll('button[data-iori-tab-id]')].map(e=>e.getAttribute('data-iori-tab-id')).sort())`,
    );
  // This worktree has no children: older navigation hid its sessions as soon
  // as another worktree was selected, even though child-bearing rows stayed.
  await screen.click(button(repository));
  await screen.click(
    `[data-iori-view="workspace-start"] [data-iori-cli-id="${parent.cli.id}"]`,
  );
  const independent = await waitFor(async () =>
    (await request("terminal.list", {})).terminals.find(
      (terminal) =>
        terminal.cwd === repository && terminal.cli?.id === parent.cli.id,
    ),
  );
  const independentRow = `[data-iori-terminal-row="${independent.id}"]`;
  await screen.reveal(independentRow);
  await screen.click(button(worktree));
  await screen.reveal(parentRow);
  assert.equal(
    await screen.visible(independentRow),
    true,
    "子のいない未選択worktreeにもCLIの行が残る",
  );
  await screen.wait(`button[data-iori-tab-id="terminal:${parent.id}"]`);
  const originalTabs = await tabIds();
  await screen.htmlDrag(independentRow, ".dock-content");
  await waitFor(
    current,
    (path) => path === repository,
    5000,
    "未選択worktreeのCLIを落とすとそのworktreeへ移る",
  );
  await screen.wait(`button[data-iori-tab-id="terminal:${independent.id}"]`);
  await screen.click(button(worktree));
  await screen.reveal(parentRow);
  await screen.wait(`button[data-iori-tab-id="terminal:${parent.id}"]`);
  assert.equal(
    await tabIds(),
    originalTabs,
    "ドラッグ前のworktreeの配置にタブを増やさない",
  );
  await record(
    "子のいないworktreeのCLI行を未選択のままペインへ落とし、正しい配置だけに開く",
  );
  // An external process/Host close can remove the final row while collapsed.
  await screen.click(button(repository));
  const independentToggle = `${group(repository)} [data-iori-action="worktree-toggle"]`;
  await screen.click(independentToggle);
  await waitFor(async () => !(await screen.visible(independentRow)));
  await request("terminal.close", {
    terminalId: independent.id,
    confirm: true,
  });
  assert.equal(await screen.visible(independentToggle), false);
  await screen.click(button(worktree));
  await screen.reveal(parentRow);

  await screen.wait(`button[data-iori-tab-id="terminal:${parent.id}"]`);
  await screen.click('[data-iori-action="workspace-add-tab"]');
  await screen.click(`${launcher} [data-iori-cli-id="${parent.cli.id}"]`);
  await waitFor(
    async () =>
      (await request("terminal.list", {})).terminals.filter(
        (terminal) => terminal.cli?.id === parent.cli.id,
      ).length === 2,
  );
  await screen.reveal(parentRow);
  await screen.click(button(repository));
  assert.equal(
    await screen.visible(parentRow),
    true,
    "別のworktreeを選んでもCLIの行が残る",
  );
  assert.equal(await screen.visible(`${childRow} .nav-child-button`), true);
  await collapse();
  assert.match(await screen.attribute(summary, "aria-label"), /× 3/u);
  assert.equal(await screen.text(`${summary} .nav-activity-visible`), "3");
  await screen.click(button(repository));
  assert.equal(await screen.attribute(toggle, "aria-expanded"), "false");
  await shot("pc-sidebar-collapsed");
  await screen.input(".nav-sidebar input", "サイドバー");
  await screen.reveal(parentRow);
  assert.equal(await screen.attribute(toggle, "aria-expanded"), "true");
  assert.match(await screen.attribute(toggle, "aria-label"), /折りたたむ/u);
  await screen.input(".nav-sidebar input", "");
  await waitFor(async () => !(await screen.visible(parentRow)));
  assert.match(await screen.attribute(toggle, "aria-label"), /展開/u);
  await record(
    "検索中は畳んだworktreeの一致行を見せ、検索を消すと元の開閉へ戻る",
  );
  await screen.click(button(worktree));
  await screen.reveal(parentRow);
  assert.equal(await screen.attribute(toggle, "aria-expanded"), "true");
  const geometry = async () => {
    const value = await screen.evaluate(`(()=>{
      const parent=document.querySelector(${JSON.stringify(parentRow)});
      const child=document.querySelector(${JSON.stringify(`${childRow} .nav-child-button`)});
      const branch=child.closest('.nav-children').querySelector('.nav-child-branch');
      const sidebar=parent.closest('.nav-sidebar');
      return {parentTitle:parent.querySelector('.nav-session-title').getBoundingClientRect().x, childMark:child.querySelector('.state-dot').getBoundingClientRect().x, branchIcon:branch.querySelector('svg').getBoundingClientRect().x, width:sidebar.getBoundingClientRect().width,
        overflow:sidebar.scrollWidth>sidebar.clientWidth,
        lines:[...child.querySelectorAll('.nav-child-title,.nav-child-detail')].map(e=>({width:e.clientWidth,scroll:e.scrollWidth})),
        title:child.querySelector('.nav-child-task').clientWidth};
    })()`);
    assert.equal(value.childMark, value.parentTitle);
    assert.equal(value.branchIcon, value.parentTitle);
    assert.equal(value.overflow, false);
    assert.ok(value.lines.every((line) => line.scroll <= line.width));
    assert.ok(value.title > 0);
    return value;
  };
  await record(
    `PCの子とworktreeの字下げ・2段の描画: ${JSON.stringify(await geometry())}`,
  );
  await shot("pc-sidebar-children-long-title");
  // Additional real CLI kinds exercise the width-dependent +n summary.
  const { clis } = await request("cli.list", {});
  for (const cli of clis.filter((entry) => entry.name.startsWith("Sidebar "))) {
    // More tabs can put the original one outside the strip. Select it through
    // its sidebar row, as a user would, before adding to that pane.
    await screen.click(parentRow);
    await screen.wait(`button[data-iori-tab-id="terminal:${parent.id}"]`);
    await screen.click('[data-iori-action="workspace-add-tab"]');
    await screen.click(`${launcher} [data-iori-cli-id="${cli.id}"]`);
    await screen.reveal(`[data-iori-row-cli="${cli.id}"]`);
  }
  await collapse();
  assert.match(await screen.text(`${summary} .nav-activity-visible`), /\+\d/u);
  await shot("pc-sidebar-summary-overflow");
  await mobile({ width: 390, height: 844 });
  await screen.wait('[data-iori-view="workspace"]');
  await openSidebar(screen);
  await screen.click(button(repository));
  assert.equal(
    await screen.visible('[data-sidebar="sidebar"][data-mobile="true"]'),
    true,
  );
  await screen.reveal(
    `${group(repository)} [data-iori-action="sidebar-open-files"]`,
  );
  await screen.click(button(worktree));
  await screen.reveal(parentRow);
  // Reload reads the real queued child first; then apply the display fixture.
  await screen.reveal(`${childRow} .nav-child-button`);
  showChild();
  await screen.reveal(".nav-children .nav-child-branch");
  await record(
    `Mobileの子とworktreeの字下げ・2段の描画: ${JSON.stringify(await geometry())}`,
  );
  await shot("mobile-sidebar-children-long-title");
  await collapse();
  assert.match(await screen.text(`${summary} .nav-activity-visible`), /\+\d/u);
  await shot("mobile-sidebar-summary-overflow");
  await screen.click(button(worktree));
  await screen.reveal(parentRow);
  await screen.click(button(repository));
  await openWorkspaceView(screen, "files");
  await screen.wait('[data-iori-mobile-view-kind="files"]:not([hidden])');
  await waitFor(
    async () =>
      !(await screen.visible('[data-sidebar="sidebar"][data-mobile="true"]')),
  );
  assert.equal(
    await screen.evaluate(
      `document.querySelectorAll('[data-iori-mobile-view-kind="terminal"]').length`,
    ),
    0,
    "別worktreeのTerminalタブをFilesの配置へ持ち込まない",
  );
  await shot("mobile-sidebar-files");
  await screen.key("Alt+ArrowLeft");
  await screen.wait('[data-iori-view="mobile-home"]');
  await openSidebar(screen);
  await screen.click(button(repository));
  await openWorkspaceView(screen, "files");
  await screen.wait('[data-iori-mobile-view-kind="files"]:not([hidden])');
  await openSidebar(screen);
  await screen.click(button(worktree));
  await screen.click('[data-iori-action="open-agents-teams"]');
  await screen.wait(".team-surface:not([hidden])");
  await screen.key("Alt+ArrowLeft");
  await waitFor(current, (path) => path === repository);
  await screen.wait('[data-iori-mobile-view-kind="files"]:not([hidden])');
  await record("Mobileのドロワーで覗いたworktreeを飛ばしてAI Agentsから戻る");
  await screen.key("Alt+ArrowLeft");
  await screen.wait('[data-iori-view="mobile-home"]');
  // Once the body is actually shown, Back remembers it, but still skips
  // intermediate worktree selections made entirely inside the drawer.
  await openSidebar(screen);
  await screen.click(button(repository));
  await openWorkspaceView(screen, "files");
  await waitFor(
    async () =>
      !(await screen.visible('[data-sidebar="sidebar"][data-mobile="true"]')),
  );
  await openSidebar(screen);
  await screen.click(button(worktree));
  await screen.click(button(repository));
  await screen.click(button(worktree));
  await openWorkspaceView(screen, "files");
  await waitFor(
    async () =>
      !(await screen.visible('[data-sidebar="sidebar"][data-mobile="true"]')),
  );
  await screen.key("Alt+ArrowLeft");
  await waitFor(current, (path) => path === repository);
  await screen.key("Alt+ArrowLeft");
  await screen.wait('[data-iori-view="mobile-home"]');
  await record(
    "Mobileの戻るは本体を見たworktreeだけを履歴に残し、ドロワー内だけの選択を飛ばす",
  );
  // A normal visit: Board -> another worktree's Files -> Back to Board.
  await openSidebar(screen);
  await screen.click(button(worktree));
  await openWorkspaceView(screen, "board");
  await screen.wait('[data-iori-mobile-view-kind="board"]:not([hidden])');
  await waitFor(
    async () =>
      !(await screen.visible('[data-sidebar="sidebar"][data-mobile="true"]')),
  );
  await openSidebar(screen);
  await screen.click(button(repository));
  await openWorkspaceView(screen, "files");
  await screen.wait('[data-iori-mobile-view-kind="files"]:not([hidden])');
  await waitFor(
    async () =>
      !(await screen.visible('[data-sidebar="sidebar"][data-mobile="true"]')),
  );
  await screen.key("Alt+ArrowLeft");
  await waitFor(current, (path) => path === worktree);
  await screen.wait('[data-iori-mobile-view-kind="board"]:not([hidden])');
  await record(
    "MobileでBoardを見て別worktreeのFilesへ移り、戻ると元のBoardを表示",
  );
  await openSidebar(screen);
  await openWorkspaceView(screen, "files");
  await screen.wait('[data-iori-mobile-view-kind="files"]:not([hidden])');
  await openSidebar(screen);
  await openWorkspaceView(screen, "git");
  await screen.wait('[data-iori-mobile-view-kind="git"]:not([hidden])');
  await openSidebar(screen);
  await screen.click(button(repository));
  await screen.click(button(worktree));
  await closeSidebar(screen);
  await screen.key("Alt+ArrowLeft");
  await screen.wait('[data-iori-mobile-view-kind="files"]:not([hidden])');
  await screen.key("Alt+ArrowLeft");
  await screen.wait('[data-iori-mobile-view-kind="board"]:not([hidden])');
  await record("Mobileで別worktreeを覗いた後も元のタブの戻る順を保つ");
  await record(
    "worktree別の開閉・CLI種類と数・要約の省略、Mobileでworktree選択後もドロワーからFilesへ移動",
  );
}

/** Edit the detected CLI through the same form used in daily settings. */
export async function saveStartupArguments(screen, cli, value) {
  await openAgents(screen);
  const row = `[data-iori-cli-row="${cli}"]`;
  const input = `${row} [data-iori-field="cli-arguments"]`;
  if ((await screen.attribute(row, "data-state")) !== "open")
    await clickAgentControl(screen, `${row} .team-agent-toggle`);
  await screen.input(input, value);
  await screen.click(`${row} [data-iori-action="save-cli-settings"]`);
  await waitFor(() =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,'cli.list',{});return r.result.clis.find(c=>c.id===${JSON.stringify(cli)})?.startupArguments===${JSON.stringify(value)};})()`,
    ),
  );
}

/** Keep an already expanded ended group open when other finished children remain. */
export async function showEndedChildren(screen) {
  const selector = '[data-iori-action="children-ended"]';
  await screen.wait(selector);
  if ((await screen.attribute(selector, "aria-expanded")) === "false")
    await screen.click(selector);
}

/** Open the CLI row menu and choose one of its actions (menu is portalled). */
export async function cliMenuAction(screen, id, action) {
  await clickAgentControl(
    screen,
    `[data-iori-cli-row="${id}"] [data-iori-action="cli-actions"]`,
  );
  await screen.click(`[role="menu"] [data-iori-action="${action}"]`);
}
