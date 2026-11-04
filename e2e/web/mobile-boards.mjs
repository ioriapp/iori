import {
  closeSidebar,
  mobileHome,
  mobileSidebarTarget,
  openSidebar,
} from "../connection/scenario.mjs";
import assert from "node:assert/strict";

export async function mobileBoardsScenario({
  screen,
  worktree,
  mobile,
  desktop,
  shot,
  record,
  expectedState,
  expectedDot,
  finished = 0,
}) {
  await mobile({ width: 390, height: 844 });
  await screen.wait('[data-iori-view="mobile-home"]');
  const homeTarget = await mobileSidebarTarget(screen);
  await openSidebar(screen);
  assert.equal(
    await screen.attribute('[data-iori-action="mobile-home"]', "aria-current"),
    "page",
  );
  await closeSidebar(screen);
  const homeBoard = `[data-iori-board-worktree=${JSON.stringify(worktree)}]`;
  await screen.wait(homeBoard);
  const boardContext = await screen.evaluate(
    `(async()=>{const {connection}=await import('/src/connection.ts');const host=connection.getSnapshot().host;const response=await connection.requestHost(host.publicKey,'teams.board',{cwd:${JSON.stringify(worktree)}});const folder=await connection.requestHost(host.publicKey,'folders.history',{});return {hostName:host.hostName,board:response.result,folders:folder.result.folders};})()`,
  );
  assert.equal(
    await screen.text(`${homeBoard} strong`),
    worktree.split(/[\\/]/u).at(-1),
  );
  const homeFolder = boardContext.folders.find((folder) =>
    folder.worktrees?.some((entry) => entry.path === worktree),
  );
  const homeWorktree = homeFolder.worktrees.find(
    (entry) => entry.path === worktree,
  );
  assert.equal(
    await screen.text(`${homeBoard} .mobile-board-location`),
    [
      boardContext.hostName,
      homeFolder.workspacePath.split(/[\\/]/u).at(-1),
      homeWorktree.branch,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  assert.equal(
    await screen.text(`${homeBoard} .mobile-board-conversation`),
    boardContext.board.conversations.find(
      (conversation) =>
        conversation.id === boardContext.board.defaultConversation,
    ).name,
  );
  assert.deepEqual(
    await screen.evaluate(
      `Array.from(document.querySelectorAll(${JSON.stringify(`${homeBoard} .mobile-board-state`)}), entry => entry.textContent.trim())`,
    ),
    [`${expectedState} 1`, ...(finished ? [`Finished ${finished}`] : [])],
  );
  assert.equal(
    await screen.attribute(`${homeBoard} [data-status]`, "data-status"),
    expectedDot,
  );
  for (const theme of ["light", "dark"]) {
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark',${theme === "dark"})`,
    );
    await shot(`mobile-boards-${theme}`);
  }
  await screen.click(homeBoard);
  await screen.wait(
    '[data-iori-mobile-view-kind="board"]:not([hidden]) [data-iori-view="board"]',
  );
  assert.equal(
    await screen.attribute(
      "[data-iori-current-worktree-path]",
      "data-iori-current-worktree-path",
    ),
    worktree,
  );
  assert.deepEqual(await mobileSidebarTarget(screen), homeTarget);
  await shot("mobile-board-workspace");
  const conversation = boardContext.board.conversations.find(
    (entry) => entry.id === boardContext.board.defaultConversation,
  );
  await screen.click('[data-iori-action="board-open-conversation"]');
  await screen.wait(
    `[data-iori-mobile-view-kind="terminal"]:not([hidden]) [data-iori-terminal-id="${conversation.terminalId}"][data-iori-displayed="true"]`,
  );
  await screen.key("Alt+ArrowLeft");
  await screen.wait(
    '[data-iori-mobile-view-kind="board"]:not([hidden]) [data-iori-view="board"]',
  );
  await shot("mobile-board-open-conversation");
  await screen.key("Alt+ArrowLeft");
  await screen.wait('[data-iori-view="mobile-home"]');
  await screen.wait(homeBoard);
  await screen.click(homeBoard);
  await screen.wait(
    '[data-iori-mobile-view-kind="board"]:not([hidden]) [data-iori-view="board"]',
  );
  await openSidebar(screen);
  assert.notEqual(
    await screen.attribute('[data-iori-action="mobile-home"]', "aria-current"),
    "page",
  );
  await shot("mobile-home-drawer");
  await mobileHome(screen);
  await screen.wait('[data-iori-view="mobile-home"]');
  await screen.wait(homeBoard);
  await record(
    `MobileのBoardsにworktree・場所・親の題名・${expectedState} 1を表示し、親の会話から戻るとBoard、さらに戻ると最初の画面。Boardからドロワーのホームでも最初の画面へ戻る`,
  );
  await desktop();
}
