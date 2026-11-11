import assert from "node:assert/strict";
import { readCiExpectation } from "../../verification/web/forge-fixture.mjs";
import { openSidebar } from "../connection/scenario.mjs";
import { waitFor } from "../../verification/ui.mjs";

const action = (name) => `[data-iori-action="${name}"]`;
const row = (path) => `button[data-iori-worktree-path=${JSON.stringify(path)}]`;
const ciMark = (path) =>
  `${row(path)} ~ .nav-worktree-controls [data-iori-forge="ci"]`;
const pane = (path) =>
  `[data-iori-view="ci"][data-iori-ci-path=${JSON.stringify(path)}]`;
const loaded = (path) => `${pane(path)}[data-iori-state="loaded"]`;
// Forgejo's run and job states, as the CI View groups them.
const states = {
  success: "passed",
  failure: "failed",
  cancelled: "cancelled",
  skipped: "skipped",
  running: "running",
  waiting: "waiting",
  blocked: "blocked",
};
const failureLine = "⚙️ [runner]: exitcode '1': failure";

async function openedUrl(screen, selector, press = screen.click) {
  // Capture the ordinary external URL boundary, without navigating away from iori.
  await screen.evaluate(
    "window.__ioriOpenedUrls=[];window.open=(url)=>{window.__ioriOpenedUrls.push(url);return null;}",
  );
  await press(selector);
  return waitFor(
    () => screen.evaluate("window.__ioriOpenedUrls[0]"),
    Boolean,
    undefined,
    "ブラウザーで開くURL",
  );
}

async function themes(screen, shot, name) {
  for (const theme of ["light", "dark"]) {
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
    );
    await shot(`${name}-${theme}`);
  }
}

/** Where a log line is, against the log's own scrolling area. */
async function logLine(screen, path, text) {
  return screen.evaluate(`(()=>{
    const scroller=document.querySelector(${JSON.stringify(`${pane(path)} [data-iori-scroll="ci-log"]`)});
    if(!scroller)return undefined;
    const area=scroller.getBoundingClientRect();
    const line=[...scroller.querySelectorAll('.ci-log-line')].find(e=>e.textContent===${JSON.stringify(text)});
    if(!line)return {shown:false,scrollTop:scroller.scrollTop};
    const r=line.getBoundingClientRect();
    return {shown:r.top>=area.top-1&&r.bottom<=area.bottom+1,scrollTop:scroller.scrollTop};
  })()`);
}

// The CI tab follows the sidebar's CI mark; a worktree that is not a child of
// the open one is not among the tab's own choices (files-view.md).
async function chooseWorktree(screen, path, press = screen.click) {
  await openSidebar(screen);
  await screen.reveal(ciMark(path));
  await press(ciMark(path));
  await waitFor(
    () => screen.visible(pane(path)),
    Boolean,
    undefined,
    "CIのタブの切替",
  );
}

/** forge.md「CIの詳細」 through the sidebar's CI mark, with the public repository's real CI. */
export async function forgeCiScenario({
  client,
  fixture,
  mobile,
  desktop,
  shot,
  record,
}) {
  const screen = client.screen;
  const current = await readCiExpectation(fixture, fixture.sha);
  await screen.click(ciMark(fixture.repository));
  await screen.wait(loaded(fixture.repository));
  await screen.click('[data-iori-field="ci-worktree"]');
  const choices = await screen.evaluate(
    "Array.from(document.querySelectorAll('[data-iori-worktree-choice]'),row=>row.getAttribute('data-iori-worktree-choice')).sort()",
  );
  assert.deepEqual(
    choices,
    [fixture.repository].sort(),
    "CIの候補も表示中の親だけで、兄弟worktreeを含まない",
  );
  await themes(screen, shot, "pc-ci-worktree-menu");
  await screen.key("Escape");
  for (const run of current.runs) {
    const runRow = `${pane(fixture.repository)} [data-iori-ci-run="${run.id}"]`;
    await screen.wait(runRow);
    for (const job of run.jobs)
      await screen.wait(
        `${runRow} [data-iori-ci-id="${job.id}"][data-iori-ci-status="${states[job.status]}"]`,
      );
  }
  assert.equal(
    await openedUrl(
      screen,
      `${pane(fixture.repository)} ${action("ci-open-browser")}`,
    ),
    current.browserUrl,
  );
  await record(
    "CIのアイコンでCIのタブが開き、実APIと同じ実行とjobが並び、ブラウザーで開く先が実APIに一致",
    { sha: fixture.sha, runs: current.runs.map((run) => run.id) },
  );

  const failed = await readCiExpectation(fixture, fixture.failedSha);
  const [run] = failed.runs;
  const [job] = run.jobs;
  await chooseWorktree(screen, fixture.ciFailed);
  await screen.wait(loaded(fixture.ciFailed));
  await screen.wait(
    `${pane(fixture.ciFailed)} [data-iori-ci-id="${job.id}"][aria-current="true"]`,
  );
  const opened = await waitFor(
    () => logLine(screen, fixture.ciFailed, failureLine),
    (value) => value?.shown,
    undefined,
    "失敗したstepの終わり",
  );
  assert.ok(
    opened.scrollTop > 0,
    "ログは先頭ではなく失敗したstepの終わりで開く",
  );
  assert.equal(
    (await logLine(screen, fixture.ciFailed, failed.lastLine)).shown,
    false,
    "ログの末尾より前の失敗したstepの終わりを見せる",
  );
  assert.equal(
    await openedUrl(
      screen,
      `${pane(fixture.ciFailed)} ${action("ci-open-browser")}`,
    ),
    run.html_url,
  );
  assert.equal(
    await openedUrl(
      screen,
      `${pane(fixture.ciFailed)} ${action("ci-job-open-browser")}`,
    ),
    `${run.html_url}/jobs/0`,
  );
  await themes(screen, shot, "pc-ci-failed");
  await client.browser.viewport({ width: 2560, height: 1440 });
  await themes(screen, shot, "wqhd-ci-failed");
  await client.browser.viewport({ width: 1440, height: 1000 });
  // Scrolling up reads to the first line; long lines scroll sideways inside the log.
  const log = `${pane(fixture.ciFailed)} [data-iori-scroll="ci-log"]`;
  const top = await waitFor(
    async () => {
      // Each earlier part keeps the rows in place, so the reader scrolls up again.
      await screen.scroll(log, { top: 0 });
      return screen.evaluate(`(()=>{
        const e=document.querySelector(${JSON.stringify(log)});
        const view=e?.closest('[data-iori-view="ci-log"]');
        const first=e?.querySelector('[data-iori-log-line="0"]');
        return view?.dataset.ioriLogStart==="0"&&first&&{first:first.textContent,wide:e.scrollWidth>e.clientWidth,page:document.documentElement.scrollWidth<=innerWidth};
      })()`);
    },
    Boolean,
    undefined,
    "ログの先頭",
  );
  assert.equal(top.first, failed.firstLine);
  assert.equal(top.wide, true, "長い行はログの中で横に読める");
  assert.equal(top.page, true, "画面全体は横に広がらない");
  await themes(screen, shot, "pc-ci-failed-log-top");
  await record(
    "失敗した実行のjobを選んで開き、ログは失敗したstepの終わりを見せ、上へ読むと先頭まで読め、長い行はログの中で横に読める",
    { run: run.id, job: job.id },
  );

  await openSidebar(screen);
  await screen.reveal(ciMark(fixture.repository));
  await screen.click(ciMark(fixture.repository));
  await screen.wait(loaded(fixture.repository));
  assert.equal(
    await screen.evaluate(
      "document.querySelectorAll('[data-iori-tab-kind=\"ci\"]').length",
    ),
    1,
  );
  await record("CIのタブがある時は同じタブへ移り、押した行のworktreeへ替える");

  await mobile({ width: 390, height: 844 });
  await openSidebar(screen);
  await screen.reveal(ciMark(fixture.ciFailed));
  await screen.tap(ciMark(fixture.ciFailed));
  const mobilePane = `[data-iori-mobile-view-kind="ci"]:not([hidden]) ${pane(fixture.ciFailed)}`;
  await screen.wait(`${mobilePane}[data-iori-state="loaded"]`);
  await screen.tap('[data-iori-field="ci-worktree"]');
  await themes(screen, shot, "mobile-ci-worktree-menu");
  await screen.key("Escape");
  await screen.wait(
    `${mobilePane} [data-iori-ci-id="${job.id}"][aria-current="true"]`,
  );
  assert.equal(
    await screen.visible(`${mobilePane} [data-iori-part="ci-detail"]`),
    false,
  );
  await themes(screen, shot, "phone-ci-list");
  await screen.tap(`${mobilePane} [data-iori-ci-id="${job.id}"]`);
  await waitFor(
    () => logLine(screen, fixture.ciFailed, failureLine),
    (value) => value?.shown,
    undefined,
    "スマホの失敗したstepの終わり",
  );
  // The log was read behind the list; it still opens at the failed step's end.
  assert.equal(
    (await logLine(screen, fixture.ciFailed, failed.lastLine)).shown,
    false,
    "スマホでもログの末尾より前の失敗したstepの終わりを見せる",
  );
  await themes(screen, shot, "phone-ci-log");
  await screen.tap(`${mobilePane} ${action("ci-log-wrap")}`);
  await screen.wait(
    `${mobilePane} [data-iori-view="ci-log"][data-wrap="true"]`,
  );
  await themes(screen, shot, "phone-ci-log-wrapped");
  await screen.key("Alt+ArrowLeft");
  await screen.wait(`${mobilePane} [data-iori-part="ci-list"]`);
  assert.equal(
    await screen.visible(`${mobilePane} [data-iori-part="ci-detail"]`),
    false,
  );
  await record(
    "スマホではドロワーの印から失敗したjobを選んだ一覧を全画面で開き、詳細と行き来し、長い行を折り返せ、戻る操作で一覧へ戻る",
  );
  await desktop();
}
