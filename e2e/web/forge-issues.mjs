import { local as verificationLocal } from "../../verification/native/local.mjs";
import assert from "node:assert/strict";
import { readIssuesExpectation } from "../../verification/web/forge-fixture.mjs";
import { waitFor } from "../../verification/ui.mjs";
import { openFolder, selectWorktree } from "../workspace/scenario.mjs";
import {
  closeSidebar,
  openSidebar,
  openWorkspaceSettings,
} from "../connection/scenario.mjs";

const action = (name) => `[data-iori-action="${name}"]`;
const pane = '[data-iori-view="issues"]:not([hidden])';
const list = `${pane} [data-iori-scroll="issues-list"]`;
const issuesButton = (path) =>
  `${action("repository-issues")}[data-iori-repository-path=${JSON.stringify(path)}]`;
const row = (number) =>
  `${pane} [data-iori-part="issues-rows"] [data-iori-issue="${number}"]`;
const detail = (number) =>
  `${pane} [data-iori-part="issue-detail"][data-iori-issue-detail="${number}"]`;
const activeIssuesTab =
  'button[data-iori-tab-kind="issues"][data-state="active"]';

const rows = (screen) =>
  screen.evaluate(`[...document.querySelectorAll(${JSON.stringify(
    `${pane} [data-iori-part="issues-rows"] [data-iori-issue]`,
  )})].map(e=>({
    number:Number(e.dataset.ioriIssue),
    labels:[...e.querySelectorAll('[data-iori-label]')].map(l=>l.dataset.ioriLabel),
    current:e.getAttribute('aria-current')==='true',
  }))`);
const listTop = (screen) =>
  screen.evaluate(
    `document.querySelector(${JSON.stringify(list)})?.scrollTop ?? -1`,
  );
// The first Issue wholly in view below the list's header.
const visibleRow = (screen) =>
  screen.evaluate(`(()=>{
    const box=document.querySelector(${JSON.stringify(list)});
    const head=box.querySelector('[data-iori-part="issues-head"]').getBoundingClientRect();
    const view=box.getBoundingClientRect();
    const row=[...box.querySelectorAll('[data-iori-part="issues-rows"] [data-iori-issue]')].find(e=>{const r=e.getBoundingClientRect();return r.top>=head.bottom&&r.bottom<=view.bottom;});
    return row?Number(row.dataset.ioriIssue):0;
  })()`);
// Scroll the list away from its top and choose an Issue shown there. The
// place is read before choosing: a phone hides the list behind the Issue.
async function chooseAfterScrolling(screen, choose) {
  await screen.scroll(list, { top: 600 });
  const place = await waitFor(
    () => listTop(screen),
    (top) => top > 0,
    undefined,
    "一覧を先頭から離す",
  );
  const number = await visibleRow(screen);
  assert.ok(number > 0, "スクロールした位置に見えているIssue");
  await choose(row(number));
  await screen.wait(detail(number));
  return { number, place };
}
const currentWorktree = (screen) =>
  screen.attribute(
    "[data-iori-current-worktree-path]",
    "data-iori-current-worktree-path",
  );

async function chooseLabels(screen, names) {
  await screen.click(`${pane} ${action("issues-labels")}`);
  for (const name of names)
    await screen.click(
      `${action("issues-label")}[data-iori-label=${JSON.stringify(name)}]`,
    );
  await screen.key("Escape");
  await waitFor(
    async () => !(await screen.visible('[role="menu"]')),
    Boolean,
    undefined,
    "ラベルの一覧を閉じる",
  );
}

/**
 * The repository row's Issues button opens the Issues of the Owner's public
 * Forgejo repository. The live Issues change, so the steps compare with the
 * Forge's own answers instead of fixed text.
 */
export async function forgeIssuesScenario({
  client,
  fixture,
  mobile,
  desktop,
  reload,
  shot,
  record,
}) {
  const screen = client.screen;
  const capture = async (name) => {
    if (process.env.IORI_ISSUES_CAPTURE !== "1") return;
    const dark = await screen.evaluate(
      "document.documentElement.classList.contains('dark')",
    );
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      // Colors move with transitions; take the picture once they settle.
      await waitFor(() =>
        screen.evaluate(
          "document.getAnimations().every(a=>!(a instanceof CSSTransition)||a.playState!=='running')",
        ),
      );
      await shot(`${name}-${theme}`);
    }
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${dark})`,
    );
  };
  // The same View at WQHD, then back to the PC width.
  const wide = async (name) => {
    if (process.env.IORI_ISSUES_CAPTURE !== "1") return;
    await client.browser.viewport({ width: 2560, height: 1440 });
    await capture(name);
    await client.browser.viewport({ width: 1440, height: 1000 });
  };
  const expected = await readIssuesExpectation(fixture);
  await openFolder(screen, fixture.plainWorkspace, false);
  await openFolder(screen, fixture.githubRepository, false);
  await openFolder(screen, fixture.repository, false);
  // The remote names an SSH alias; the workspace's Git settings give its site.
  await openWorkspaceSettings(screen, fixture.repository);
  const mapping = `[data-iori-forge-host=${JSON.stringify(fixture.remoteHost)}] [data-iori-field="forge-web-url"]`;
  await screen.wait(mapping);
  await screen.input(mapping, fixture.origin);
  await screen.key("Enter");
  await screen.wait(
    `[data-iori-forge-host=${JSON.stringify(fixture.remoteHost)}] [data-iori-state="saved"]`,
  );
  await screen.key("Escape");

  // Viewing another target, the button opens the main worktree's layout.
  await selectWorktree(screen, fixture.plainWorkspace, false);
  await openSidebar(screen);
  // Earlier steps can fill the sidebar; scroll to each row as the user would.
  await screen.reveal(issuesButton(fixture.githubRepository));
  await screen.reveal(issuesButton(fixture.repository));
  assert.equal(
    await screen.evaluate(
      `Boolean(document.querySelector(${JSON.stringify(issuesButton(fixture.plainWorkspace))}))`,
    ),
    false,
  );
  await capture("pc-sidebar");
  await screen.click(issuesButton(fixture.repository));
  await waitFor(
    () => currentWorktree(screen),
    (path) => path === fixture.repository,
    undefined,
    "main worktreeの配置へ移る",
  );
  await screen.wait(activeIssuesTab);
  await screen.wait(row(expected.newest));
  assert.equal(
    await screen.text(`${pane} [data-iori-part="issues-repository"]`),
    verificationLocal.forge.repository,
  );
  const first = await rows(screen);
  assert.equal(first[0].number, expected.newest);
  assert.ok(
    first.every(
      (item, index) => !index || item.number < first[index - 1].number,
    ),
    "作成の新しい順",
  );
  await record(
    "別のフォルダーを見ている時にリポジトリの行のIssuesからmain worktreeの配置にIssuesのタブが開き、実Forgejoの新しい順の一覧が出る",
    { newest: expected.newest, total: expected.total },
  );

  // Reading on as the list scrolls.
  const loaded = await waitFor(
    async () => {
      await screen.scroll(list, { top: "end" });
      return rows(screen);
    },
    (items) => items.length > Math.min(50, expected.total - 1),
    undefined,
    "スクロールで続きのIssueを読む",
  );
  assert.equal(
    new Set(loaded.map((item) => item.number)).size,
    loaded.length,
    "同じIssueを二度並べない",
  );
  await screen.scroll(list, { top: 0 });
  await record("一覧の終わりへスクロールすると続きのページを読む", {
    rows: loaded.length,
  });

  await chooseLabels(screen, [expected.label]);
  await waitFor(
    () => rows(screen),
    (items) =>
      items.length > 0 &&
      items[0].number === expected.labelledNewest &&
      items.every((item) => item.labels.includes(expected.label)),
    undefined,
    "ラベルで絞る",
  );
  await capture("pc-issues-label-filter");
  await wide("wqhd-issues-label-filter");
  if (expected.pair) {
    await chooseLabels(screen, [expected.pair.labels[1]]);
    if (expected.pair.total === 0) {
      await screen.wait(`${pane} [data-iori-state="issues-empty"]`);
      await capture("pc-issues-empty");
      await screen.click(`${pane} ${action("issues-clear-labels")}`);
    } else {
      await waitFor(
        () => rows(screen),
        (items) =>
          items.length > 0 &&
          items.every((item) =>
            expected.pair.labels.every((name) => item.labels.includes(name)),
          ),
        undefined,
        "選んだラベルを全て持つIssueに絞る",
      );
      await chooseLabels(screen, expected.pair.labels);
    }
  } else await chooseLabels(screen, [expected.label]);
  await waitFor(
    () => rows(screen),
    (items) => items[0]?.number === expected.newest,
    undefined,
    "絞り込みを外す",
  );
  await record("ラベルで絞り、全てを持つIssueに絞り、絞り込みを外す", {
    label: expected.label,
    pair: expected.pair,
  });

  // The chosen Issue's body and comments, beside the list.
  await screen.reveal(row(expected.discussed.number));
  await screen.click(row(expected.discussed.number), { scroll: false });
  await screen.wait(detail(expected.discussed.number));
  await waitFor(
    () =>
      screen.evaluate(
        `document.querySelectorAll(${JSON.stringify(`${detail(expected.discussed.number)} [data-iori-part="issue-comment"]`)}).length`,
      ),
    (count) => count === expected.discussed.comments,
    undefined,
    "コメントを全て読む",
  );
  assert.equal(
    await screen.visible(
      `${detail(expected.discussed.number)} [data-iori-part="issue-body"]`,
    ),
    expected.discussed.body,
  );
  // The title, its facts and its actions each take their own line, the title
  // keeps the whole width and the first action starts under the title.
  const layout = await screen.evaluate(
    `(()=>{const d=document.querySelector(${JSON.stringify(detail(expected.discussed.number))});const r=s=>d.querySelector(s).getBoundingClientRect();const t=r('.issues-detail-header h1'),m=r('.issues-detail-meta'),a=r('.page-actions'),b=r('.page-actions button'),h=d.querySelector('.issues-detail-header').getBoundingClientRect();return {separateRows:t.bottom<=m.top&&m.bottom<=a.top,titleFullWidth:Math.abs(t.width-h.width)<=1,actionsLeft:Math.abs(b.left-t.left)<=1};})()`,
  );
  assert.deepEqual(
    layout,
    { separateRows: true, titleFullWidth: true, actionsLeft: true },
    "題名・状態と作成の行・操作の行が別の行に並び、操作が左にそろう",
  );
  await capture("pc-issues");
  await wide("wqhd-issue-detail-top");
  await screen.evaluate(
    `document.querySelector(${JSON.stringify(`${pane} [data-iori-part="issue-detail"]`)}).scrollTo({top:document.querySelector(${JSON.stringify(`${pane} [data-iori-part="issue-detail"]`)}).scrollHeight})`,
  );
  await capture("pc-issue-detail-lower");
  if (process.env.IORI_ISSUES_CAPTURE === "1") {
    await client.browser.viewport({ width: 2560, height: 1440 });
    await capture("wqhd-issues");
    await client.browser.viewport({ width: 1440, height: 1000 });
  }
  // Another tab and back keeps the list, its place and the choice.
  const chosen = await chooseAfterScrolling(screen, (selector) =>
    screen.click(selector, { scroll: false }),
  );
  await screen.click('button[data-iori-tab-kind="files"]');
  await screen.click('button[data-iori-tab-kind="issues"]');
  await screen.wait(detail(chosen.number));
  await waitFor(
    () => listTop(screen),
    (top) => Math.abs(top - chosen.place) <= 1,
    undefined,
    "一覧の位置を保つ",
  );
  assert.ok(
    (await rows(screen)).find((item) => item.number === chosen.number)?.current,
  );
  await record(
    "Issueを選ぶと本文と全てのコメントが読め、別のタブから戻っても一覧の位置と選択を保つ",
    expected.discussed,
  );

  // The tab and its choices are kept with the layout.
  await chooseLabels(screen, [expected.label]);
  await waitFor(
    () => rows(screen),
    (items) => items[0]?.number === expected.labelledNewest,
  );
  await reload();
  await screen.wait(activeIssuesTab);
  await screen.wait(detail(chosen.number));
  await waitFor(
    () => rows(screen),
    (items) =>
      items[0]?.number === expected.labelledNewest &&
      items.every((item) => item.labels.includes(expected.label)),
    undefined,
    "再読込の後も同じ絞り込みを読む",
  );
  await chooseLabels(screen, [expected.label]);
  await record("再読込の後もIssuesのタブ・絞り込み・選択を戻す");

  // In another worktree of the repository, its own layout opens Issues.
  await selectWorktree(screen, fixture.longPath, false);
  await openSidebar(screen);
  await screen.click(issuesButton(fixture.repository));
  await screen.wait(activeIssuesTab);
  assert.equal(await currentWorktree(screen), fixture.longPath);
  await screen.wait(row(expected.newest));
  await record(
    "同じリポジトリの別のworktreeを見ている時はその配置でIssuesを開く",
  );

  // Without gh's sign-in on this Host, GitHub's Issues cannot be read: the
  // reason, gh auth login, and Integrations, where that sign-in shows.
  await openSidebar(screen);
  await screen.click(issuesButton(fixture.githubRepository));
  const signedOut = `${pane} [data-iori-state="issues-failure"][data-iori-forge-failure="token-missing"]`;
  await screen.wait(signedOut);
  assert.equal(
    await screen.text(`${signedOut} [data-iori-part="forge-failure"]`),
    "このHostのghはGitHubにログインしていません。このHostのTerminalでgh auth loginを実行してください。",
  );
  await capture("pc-issues-failure");
  await wide("wqhd-issues-failure");
  await screen.click(`${signedOut} ${action("forge-open-integrations")}`);
  await screen.wait(
    '[data-iori-view="github-settings"] [data-iori-state="github-signed-out"]',
  );
  await screen.key("Escape");
  await record(
    "ghにログインしていないHostでは、GitHubのIssuesの場所にその理由とgh auth loginの案内を出し、「連携を開く」で連携へ移れる",
  );

  await mobile({ width: 390, height: 844 });
  await openSidebar(screen);
  await capture("phone-drawer");
  await screen.tap(issuesButton(fixture.repository));
  await closeSidebar(screen);
  // The Issue chosen on the wide screen is shown first; going back lists them.
  await screen.wait(detail(chosen.number));
  assert.equal(await screen.visible(list), false);
  await screen.key("Alt+ArrowLeft");
  await screen.wait(row(expected.newest));
  await capture("phone-issues");
  const tapped = await chooseAfterScrolling(screen, (selector) =>
    screen.tap(selector),
  );
  assert.equal(await screen.visible(list), false);
  await capture("phone-issue-detail");
  // The Issue's own top row goes back to the list, as the CI log's does.
  await screen.tap(`${pane} ${action("issues-back")}`);
  await screen.wait(list);
  await waitFor(
    () => listTop(screen),
    (top) => Math.abs(top - tapped.place) <= 1,
    undefined,
    "詳細から戻ると同じ位置に戻る",
  );
  assert.ok(
    (await rows(screen)).find((item) => item.number === tapped.number)?.current,
  );
  await record(
    "スマホの幅ではドロワーのIssuesから一覧を開き、詳細へ進んで戻る操作で同じ位置と選択の一覧へ戻る",
  );
  if (process.env.IORI_ISSUES_CAPTURE === "1") {
    await chooseLabels(screen, expected.pair ? expected.pair.labels : []);
    await capture("phone-issues-filtered");
    await chooseLabels(screen, expected.pair ? expected.pair.labels : []);
    await openSidebar(screen);
    await screen.tap(issuesButton(fixture.githubRepository));
    await screen.wait(`${pane} [data-iori-state="issues-failure"]`);
    await capture("phone-issues-failure");
  }
  await desktop();
}
