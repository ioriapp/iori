import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { waitFor } from "../../verification/ui.mjs";
import { pngBytes } from "../../verification/reading/png.mjs";
import { openSidebar } from "../connection/scenario.mjs";
import { groupAction, selectWorktree } from "../workspace/scenario.mjs";

export async function readingWorktrees({
  client,
  screen,
  repository,
  worktree,
  desktop,
  mobile,
  shot,
  record,
}) {
  const longWorktree = join(repository, "..", "reading-long-worktree");
  execFileSync(
    "git",
    [
      "worktree",
      "add",
      "-b",
      "iori/reading-worktree-with-a-long-branch-name-546ac589",
      longWorktree,
    ],
    { cwd: repository },
  );
  execFileSync(
    "git",
    [
      "worktree",
      "add",
      "-b",
      "iori/reading-worktree-with-a-long-branch-name-abcdef12",
      join(repository, "..", "reading-long-worktree-second"),
    ],
    { cwd: repository },
  );
  await selectWorktree(screen, worktree, false);
  const current = () =>
    screen.attribute(
      "[data-iori-current-worktree-path]",
      "data-iori-current-worktree-path",
    );
  await waitFor(current, (path) => path === worktree);
  for (const kind of ["files", "git"]) {
    await openWorkspaceView(screen, kind);
    if (kind === "files") {
      await screen.click('[data-iori-file="sample.txt"]');
      await waitFor(async () =>
        (await screen.text('[data-iori-view="files"] .reading-body')).includes(
          "ブラウザーからファイルを読む",
        ),
      );
    }
    await screen.click(`[data-iori-field="${kind}-worktree"]`);
    await screen.wait(
      `[data-iori-worktree-choice=${JSON.stringify(worktree)}]`,
    );
    const choices = await screen.evaluate(
      "Array.from(document.querySelectorAll('[data-iori-worktree-choice]'),row=>row.getAttribute('data-iori-worktree-choice')).sort()",
    );
    assert.deepEqual(
      choices,
      [worktree].sort(),
      `${kind}の候補は表示中の親だけで、兄弟worktreeを含まない`,
    );
    const fits = await screen.evaluate(`(()=>{
      const menu=document.querySelector('[data-slot="dropdown-menu-content"]');
      const r=menu.getBoundingClientRect();
      return {inside:r.left>=0&&r.right<=innerWidth, rows:[...menu.querySelectorAll('[data-iori-worktree-choice]')].map(row=>{
        const name=row.querySelector('span') ?? row;
        const style=getComputedStyle(row);
        return {fits:name.scrollWidth<=name.clientWidth, oneLine:row.getBoundingClientRect().height<=Math.max(parseFloat(style.minHeight),parseFloat(style.lineHeight)+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom))+1};
      })};
    })()`);
    assert.equal(fits.inside, true, `${kind}の一覧は画面内に収まる`);
    assert.ok(
      fits.rows.every((row) => row.fits && row.oneLine),
      `${kind}の全ての名前は省略されず1行で見える`,
    );
    if (process.env.IORI_READING_CAPTURE === "1") {
      for (const theme of ["light", "dark"]) {
        await screen.evaluate(
          `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
        );
        await shot(`pc-${kind}-worktree-menu-${theme}`);
      }
      await screen.key("Escape");
      await client.browser.viewport({ width: 2560, height: 1440 });
      await screen.click(`[data-iori-field="${kind}-worktree"]`);
      for (const theme of ["light", "dark"]) {
        await screen.evaluate(
          `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
        );
        await shot(`wqhd-${kind}-worktree-menu-${theme}`);
      }
      await screen.key("Escape");
      await client.browser.viewport({ width: 1440, height: 1000 });
      await screen.click(`[data-iori-field="${kind}-worktree"]`);
    }
    await screen.key("Escape");
    assert.equal(
      await current(),
      worktree,
      `${kind} must keep the selected workspace`,
    );
    assert.equal(
      await screen.attribute(
        `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
        "aria-current",
      ),
      "page",
    );
    await screen.wait(
      `[data-iori-field="${kind}-worktree"][title=${JSON.stringify(worktree)}]`,
    );
    if (kind === "git") {
      await screen.click(
        '[data-iori-action="git-change-select"][data-path="sample.txt"]',
      );
      await waitFor(async () =>
        (
          await screen.text(
            '[data-iori-view="git"] [data-iori-scroll="git-diff"]',
          )
        ).includes("ブラウザーからファイルを読む"),
      );
    }
  }
  await mobile({ width: 390, height: 844 });
  await selectWorktree(screen, worktree, true);
  for (const kind of ["files", "git"]) {
    await openSidebar(screen);
    await openWorkspaceView(screen, kind);
    const back = `[data-iori-view="${kind}"]:not([hidden]) [data-iori-action="reading-back"]`;
    if (!(await screen.visible(`[data-iori-field="${kind}-worktree"]`))) {
      if (await screen.visible('[data-iori-part="mobile-location"]'))
        await screen.key("Alt+ArrowLeft");
      else if (await screen.visible(back)) await screen.click(back);
    }
    await screen.tap(`[data-iori-field="${kind}-worktree"]`);
    await screen.wait(
      `[data-iori-worktree-choice=${JSON.stringify(worktree)}]`,
    );
    const choices = await screen.evaluate(
      "Array.from(document.querySelectorAll('[data-iori-worktree-choice]'),row=>row.getAttribute('data-iori-worktree-choice')).sort()",
    );
    assert.deepEqual(
      choices,
      [worktree].sort(),
      `スマホの${kind}の候補は表示中の親だけで、兄弟worktreeを含まない`,
    );
    assert.equal(
      await screen.evaluate(
        `(()=>{const r=document.querySelector('[data-slot="dropdown-menu-content"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()`,
      ),
      true,
      `スマホの${kind}の一覧は画面内に収まる`,
    );
    if (process.env.IORI_READING_CAPTURE === "1") {
      for (const theme of ["light", "dark"]) {
        await screen.evaluate(
          `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
        );
        await shot(`mobile-${kind}-worktree-menu-${theme}`);
      }
    }
    await screen.key("Escape");
  }
  await desktop();
  await waitFor(current, (path) => path === worktree);
  // The sidebar restores before the workspace panels. Wait for the last
  // visible tab to return before using the sidebar to select another tab.
  await screen.wait(
    `[data-iori-field="git-worktree"][title=${JSON.stringify(worktree)}]`,
  );
  for (const kind of ["files", "git"]) {
    await openWorkspaceView(screen, kind);
    await screen.wait(
      `[data-iori-field="${kind}-worktree"][title=${JSON.stringify(worktree)}]`,
    );
    await screen.click(
      kind === "files"
        ? '[data-iori-file="sample.txt"]'
        : '[data-iori-action="git-change-select"][data-path="sample.txt"]',
    );
    await waitFor(async () =>
      (
        await screen.text(
          kind === "files"
            ? '[data-iori-view="files"] .reading-body'
            : '[data-iori-view="git"] [data-iori-scroll="git-diff"]',
        )
      ).includes("ブラウザーからファイルを読む"),
    );
  }
  await record(
    "Files・Gitの候補から兄弟worktreeを外し、表示中の親の本文・差分と再起動後の対象を確認",
  );
  await wideMarkdown({
    client,
    screen,
    worktree,
    desktop,
    mobile,
    shot,
  });
  await record(
    "描画したMarkdownは最大化してもペインの幅いっぱいに広がり（WQHDで最大化しても狭くならない）、広い表とコードの長い行は横のホイールで最後まで読める",
  );
  await imageZoom({
    screen,
    worktree,
    desktop,
    mobile,
    shot,
    record,
  });
  if (process.env.IORI_READING_CAPTURE === "1") {
    // The open file goes away. Files keeps showing what it read; once the
    // page loads again, nothing is left to show but the read error.
    await openWorkspaceView(screen, "files");
    await rm(join(worktree, "sample.txt"));
    const failure = '[data-iori-view="files"]:not([hidden]) [role="alert"]';
    const themes = async (name) => {
      await screen.wait(failure);
      for (const theme of ["light", "dark"]) {
        await screen.evaluate(
          `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
        );
        await shot(`${name}-${theme}`);
      }
    };
    await desktop();
    await themes("pc-files-read-error");
  }
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
}

// A document wider than any screen (many columns, one long code line), with
// the prose around it that a survey usually has.
const wideTable =
  "# CLIの調査\n\n" +
  "この文書は、利用者が普段のPCやスマホから開発作業を続けられるかを確かめるために、各社のCLIを同じ観点で比べた結果をまとめたものです。表の列は観点ごとに分かれ、確かめられなかった項目は「未確認」と書きます。最大化して全幅で読むと、列の多い表も一度に見渡せます。\n\n" +
  "## 比べた観点\n\n" +
  `| ${Array.from({ length: 24 }, (_, i) => `列${i + 1} 調査の観点`).join(" | ")} |\n` +
  `|${"---|".repeat(24)}\n` +
  `| ${Array.from({ length: 24 }, (_, i) => `未確認 ${i + 1}`).join(" | ")} |\n\n` +
  "```\nLONG_CODE_START " +
  "code ".repeat(400) +
  "LONG_CODE_END\n```\n\n" +
  "## 次に確かめること\n\n" +
  "- WindowsとLinuxの両方で、TUIが同じ操作で動くか\n" +
  "- 再開の時に、会話のIDを外から取り出せるか\n" +
  "- Hooksの形が、iori の受け取る形と合うか\n\n" +
  "> 未確認の項目は、公式の文書と実物の出力の両方で確かめてから埋める。\n\n" +
  "### 参照\n\n" +
  "https://example.com/docs/cli/reference/very/long/path/that/does/not/break/on/its/own/because/it/has/no/spaces/at/all/and/keeps/going\n";

async function wideMarkdown({
  client,
  screen,
  worktree,
  desktop,
  mobile,
  shot,
}) {
  const scroller =
    '[data-iori-view="files"]:not([hidden]) [data-iori-scroll="file-markdown"]';
  const restore = '[data-iori-action="workspace-restore"]';
  const capture = process.env.IORI_READING_CAPTURE === "1";
  const themes = async (name) => {
    if (!capture) return;
    const dark = await screen.evaluate(
      "document.documentElement.classList.contains('dark')",
    );
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      await shot(`${name}-${theme}`);
    }
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${dark})`,
    );
  };
  // The rendered text is as wide as its pane, and the pane never scrolls sideways.
  const fillsPane = (state) =>
    waitFor(
      () =>
        screen.evaluate(
          `(()=>{const s=document.querySelector(${JSON.stringify(scroller)});const m=s?.querySelector('[data-iori-part="markdown-rendered"]');return Boolean(m)&&m.offsetWidth===s.clientWidth&&s.scrollWidth<=s.clientWidth})()`,
        ),
      Boolean,
      5000,
      `${state}の描画したMarkdownがペインの幅いっぱいに広がること`,
    );
  // Scroll sideways over the target's own scroll box with the wheel, as a
  // reader does, until the target is fully inside that box.
  const wheelToEnd = async (target, name) => {
    const read = () =>
      screen.evaluate(
        `(()=>{const t=${target};let b=t.startContainer?t.startContainer.parentElement:t.parentElement;while(b&&!/auto|scroll/.test(getComputedStyle(b).overflowX))b=b.parentElement;const r=b.getBoundingClientRect(),e=t.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(r.height/2,12)),seen:e.left>=r.left-1&&e.right<=r.right+1}})()`,
      );
    assert.equal((await read()).seen, false, `${name}は最初は入りきらない`);
    await waitFor(
      async () => {
        const at = await read();
        if (!at.seen)
          await client.browser.call("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: at.x,
            y: at.y,
            deltaX: 600,
            deltaY: 0,
          });
        return at.seen;
      },
      Boolean,
      20000,
      `${name}を横のホイールで最後まで読めること`,
    );
  };
  await writeFile(join(worktree, "wide-table.md"), wideTable);
  await openWorkspaceView(screen, "files");
  await screen.click('[data-iori-file="wide-table.md"]');
  await screen.wait(`${scroller} table`);
  await fillsPane("ふだんの幅");
  await themes("pc-files-markdown-wide");
  await groupAction(screen, "files", "workspace-maximize");
  await screen.wait(restore);
  await fillsPane("最大化した時");
  await themes("pc-files-markdown-wide-maximized");
  await wheelToEnd(
    `document.querySelector(${JSON.stringify(`${scroller} th:last-child`)})`,
    "広い表の最後の列",
  );
  await wheelToEnd(
    `(()=>{const w=document.createTreeWalker(document.querySelector(${JSON.stringify(scroller)}),NodeFilter.SHOW_TEXT);for(let n=w.nextNode();n;n=w.nextNode()){const at=n.data.indexOf('LONG_CODE_END');if(at>=0){const r=document.createRange();r.setStart(n,at);r.setEnd(n,at+13);return r}}})()`,
    "コードの長い行の終わり",
  );
  await themes("pc-files-markdown-wide-scrolled");
  await screen.click(restore);
  await screen.evaluate(
    `document.querySelectorAll(${JSON.stringify(`${scroller} *`)}).forEach(e=>{e.scrollLeft=0})`,
  );
  // On a wide screen the pane is already wide; maximizing never narrows it.
  const paneWidth = () =>
    screen.evaluate(
      `document.querySelector(${JSON.stringify(scroller)})?.clientWidth`,
    );
  const pcWidth = await paneWidth();
  await client.browser.viewport({ width: 2560, height: 1440 });
  // The panes follow the window a moment later; read the width once it settles.
  let last = 0;
  const before = await waitFor(
    async () => {
      const width = await paneWidth();
      const settled = width > pcWidth && width === last;
      last = width;
      return settled ? width : 0;
    },
    Boolean,
    5000,
    "WQHDのふだんの幅",
  );
  await themes("wqhd-files-markdown-wide");
  await groupAction(screen, "files", "workspace-maximize");
  await screen.wait(restore);
  await waitFor(
    paneWidth,
    (width) => width >= before,
    5000,
    "WQHDで最大化した本文がふだんの幅より狭くならないこと",
  );
  await fillsPane("WQHDで最大化した時");
  await themes("wqhd-files-markdown-wide-maximized");
  await screen.click(restore);
  await client.browser.viewport({ width: 1440, height: 1000 });
  if (capture) {
    await mobile({ width: 390, height: 844 });
    await selectWorktree(screen, worktree, true);
    await openSidebar(screen);
    await openWorkspaceView(screen, "files");
    if (!(await screen.visible(`${scroller} table`)))
      await screen.click('[data-iori-file="wide-table.md"]');
    await screen.wait(`${scroller} table`);
    await themes("mobile-files-markdown-wide");
    await desktop();
    await openWorkspaceView(screen, "files");
  }
  // Files goes back to the file the next steps read, without this one's tab.
  await screen.click('[data-iori-tab="wide-table.md"] .reading-tab-close');
  await screen.click('[data-iori-file="sample.txt"]');
  await waitFor(async () =>
    (await screen.text('[data-iori-view="files"] .reading-body')).includes(
      "ブラウザーからファイルを読む",
    ),
  );
  await rm(join(worktree, "wide-table.md"));
}

// An enlarged image keeps its own ratio and scrolls inside the frame (#177).
async function imageZoom({ screen, worktree, desktop, mobile, shot, record }) {
  const view = '[data-iori-view="files"]:not([hidden])';
  const frame = `${view} .reading-image-frame`;
  const image = `${view} [data-iori-part="file-image"]`;
  const scale = `${view} [data-iori-part="image-scale"]`;
  const capture = process.env.IORI_READING_CAPTURE === "1";
  const themes = async (name) => {
    if (!capture) return;
    const dark = await screen.evaluate(
      "document.documentElement.classList.contains('dark')",
    );
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      await shot(`${name}-${theme}`);
    }
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${dark})`,
    );
  };
  // The drawn box, the source size and the frame's scroll range, read together.
  const drawn = () =>
    screen.evaluate(
      `(()=>{const f=document.querySelector(${JSON.stringify(frame)}),i=f&&f.querySelector('[data-iori-part="file-image"]');if(!i||!i.naturalWidth)return null;const b=i.getBoundingClientRect(),v=f.getBoundingClientRect();return{width:Math.round(b.width),height:Math.round(b.height),naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,scrollWidth:f.scrollWidth,scrollHeight:f.scrollHeight,clientWidth:f.clientWidth,clientHeight:f.clientHeight,left:Math.round(b.left),top:Math.round(b.top),right:Math.round(b.right),bottom:Math.round(b.bottom),frameLeft:Math.round(v.left),frameTop:Math.round(v.top),frameRight:Math.round(v.right),frameBottom:Math.round(v.bottom)}})()`,
    );
  const shows = (label, name) =>
    waitFor(
      () => screen.text(scale),
      (text) => text.trim() === label,
      15000,
      `${name}の${label}`,
    );
  // The steps a reader takes to see the detail of an image larger than the frame.
  const enlarge = async (name) => {
    await screen.click('[data-iori-action="image-actual-size"]');
    await shows("100%", name);
    const actual = await drawn();
    assert.equal(
      actual.width,
      actual.naturalWidth,
      `${name}: 等倍では元の幅のまま描く`,
    );
    assert.equal(
      actual.height,
      actual.naturalHeight,
      `${name}: 等倍では元の高さのまま描く`,
    );
    for (let step = 0; step < 2; step++)
      await screen.click('[data-iori-action="image-zoom-in"]');
    await shows("156%", name);
    const zoomed = await drawn();
    assert.ok(
      Math.abs(
        zoomed.width /
          zoomed.height /
          (zoomed.naturalWidth / zoomed.naturalHeight) -
          1,
      ) < 0.01,
      `${name}: 拡大しても元の比（${zoomed.naturalWidth}×${zoomed.naturalHeight}）のまま描く（${zoomed.width}×${zoomed.height}）`,
    );
    assert.ok(
      zoomed.scrollWidth > zoomed.clientWidth,
      `${name}: 拡大した画像は枠の横からはみ出し、横にスクロールできる`,
    );
    assert.ok(
      zoomed.scrollHeight > zoomed.clientHeight,
      `${name}: 拡大した画像は枠の縦からはみ出し、縦にスクロールできる`,
    );
    // From the top-left corner to the far one, the whole enlarged image is reachable.
    await screen.scroll(frame, { top: 0, left: 0 });
    const start = await drawn();
    assert.ok(
      start.left >= start.frameLeft && start.top >= start.frameTop,
      `${name}: 枠の始めでは画像の左上の端が切れずに見える`,
    );
    await screen.scroll(frame, { top: "end", left: "end" });
    const end = await drawn();
    assert.ok(
      end.right <= end.frameRight + 1 && end.bottom <= end.frameBottom + 1,
      `${name}: 右と下の端まで動かすと画像の右下の端が見える`,
    );
    return zoomed;
  };
  const openImage = async () => {
    await openWorkspaceView(screen, "files");
    // The tab is there before the image is read, so it tells an open file from
    // one that still needs the list row. A narrow View hides the list while a
    // file is open, so go back to it first.
    if (!(await screen.visible('[data-iori-tab="zoom-image.png"]'))) {
      if (await screen.visible('[data-iori-action="reading-back"]'))
        await screen.click('[data-iori-action="reading-back"]');
      await screen.click('[data-iori-file="zoom-image.png"]');
    }
    await screen.wait(image);
    await waitFor(
      () => screen.text(`${view} .reading-image-facts`),
      (text) => text.includes("1600 × 700"),
      15000,
      "画像の元の大きさ",
    );
  };
  // Wide enough that both the width and the height overflow the frame.
  await writeFile(join(worktree, "zoom-image.png"), pngBytes(1600, 700));
  await openImage();
  const pc = await enlarge("PC 1440");
  await themes("pc-files-image-zoomed");
  await mobile({ width: 390, height: 844 });
  await selectWorktree(screen, worktree, true);
  await openSidebar(screen);
  await openImage();
  const phone = await enlarge("スマホ 390");
  await themes("mobile-files-image-zoomed");
  await desktop();
  await openWorkspaceView(screen, "files");
  await record(
    `Filesの画像は等倍・拡大でも元の比（1600×700）のまま描き、枠を縦横にスクロールして右下の端まで見える（PC 1440は${pc.width}×${pc.height}、スマホ 390は${phone.width}×${phone.height}）`,
  );
  // Files goes back to the file the next steps read, without this one's tab.
  await screen.click('[data-iori-tab="zoom-image.png"] .reading-tab-close');
  await screen.click('[data-iori-file="sample.txt"]');
  await waitFor(async () =>
    (await screen.text('[data-iori-view="files"] .reading-body')).includes(
      "ブラウザーからファイルを読む",
    ),
  );
  await rm(join(worktree, "zoom-image.png"));
}
