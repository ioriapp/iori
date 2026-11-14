import { openSidebar } from "../../e2e/connection/scenario.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../ui.mjs";
import { openWorkspaceView, splitTab } from "../workspace/interaction.mjs";
import { openFolder } from "../../e2e/workspace/scenario.mjs";
import {
  create,
  clearObserved,
  observe,
  observed,
  typeTerminal,
} from "../../e2e/terminal/scenario.mjs";

const attr = (name, value) => `[${name}=${JSON.stringify(value)}]`;
const action = (value) => attr("data-iori-action", value);
const tabButton = (kind) => "button" + attr("data-iori-tab-kind", kind);
const mobileView = (kind) => attr("data-iori-mobile-view-kind", kind);

/**
 * Files and Git as a user reads them on a real Client and Host, opened from
 * the workspace frame. `host` runs file and Git operations on the Host (as an
 * Agent would); `shot` saves the current screen in the light and dark theme.
 */
export async function readingScenario({
  client,
  fixture: { root, worktree, bulk },
  host,
  clipboard,
  record,
  restart,
  shot,
  back,
  mobile,
  hostOs,
  watchOnly = false,
  pathDragOnly = false,
}) {
  let screen = client().screen;
  const sep = root.includes("\\") ? "\\" : "/";
  const absolute = (path) =>
    root.replace(/[\\/]$/u, "") + sep + path.split("/").join(sep);
  const currentWorktree = (path) =>
    waitFor(() =>
      screen.evaluate(
        `document.querySelector('[data-iori-current-worktree-path]')?.getAttribute('data-iori-current-worktree-path')===${JSON.stringify(path)}`,
      ),
    );
  const selectWorktree = async (path) => {
    await openSidebar(screen);
    await screen.click("button" + attr("data-iori-worktree-path", path));
    await currentWorktree(path);
  };
  // PC uses its tab or + menu; Mobile keeps the drawer's entries.
  const show = async (kind) => {
    view = kind;
    if (mobile) await openSidebar(screen);
    await openWorkspaceView(screen, kind);
    if (mobile)
      await waitFor(() =>
        screen.evaluate(
          `!document.querySelector(${JSON.stringify(mobileView(kind))})?.hidden`,
        ),
      );
    await screen.wait(`[data-iori-view="${kind}"]`);
  };
  // On a narrow View the detail replaces the list; a commit's file goes back to
  // the commit first. A phone uses the OS back, which the frame passes to the View.
  const detailShown = (view) =>
    screen.evaluate(
      `[...document.querySelectorAll('[data-iori-view="${view}"]')].some(v=>v.getBoundingClientRect().width>0&&v.querySelector('.reading-split[data-narrow="true"]')&&!v.querySelector('.reading-detail').hidden)`,
    );
  const backToList = async (view) => {
    if (mobile) {
      await client().browser.dismissKeyboard();
      for (let step = 0; step < 3 && (await detailShown(view)); step++) {
        const before = await screen.evaluate(
          `document.querySelector('[data-iori-view="${view}"] .reading-detail')?.innerText.slice(0,200)`,
        );
        await back();
        await waitFor(
          async () =>
            !(await detailShown(view)) ||
            (await screen.evaluate(
              `document.querySelector('[data-iori-view="${view}"] .reading-detail')?.innerText.slice(0,200)`,
            )) !== before,
        );
      }
      await waitFor(async () => !(await detailShown(view)));
      return;
    }
    const selector = `[data-iori-view="${view}"] [data-iori-action="reading-back"]`;
    for (let step = 0; step < 3 && (await screen.visible(selector)); step++)
      await screen.click(selector);
  };
  const filesText = () => screen.text('[data-iori-view="files"] .reading-body');
  const alerts = (view) =>
    screen.evaluate(
      `Array.from(document.querySelectorAll('[data-iori-view="${view}"] [role=alert]')).map(e=>e.textContent).join('|')`,
    );
  const row = (path) => `[data-iori-file=${JSON.stringify(path)}]`;
  const openFile = async (path) => {
    await backToList("files");
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join("/");
      if (
        !(await screen.evaluate(
          `document.querySelector(${JSON.stringify(row(folder))})?.getAttribute('aria-expanded')==='true'`,
        ))
      )
        await screen.click(row(folder));
    }
    await screen.click(row(path));
    await screen.wait(
      `[data-iori-tab=${JSON.stringify(path)}][aria-selected="true"]`,
    );
  };
  let view = "files";
  const inView = (selector) => `[data-iori-view="${view}"] ${selector}`;
  const find = async (query, direction = "next") => {
    if (!(await screen.visible(inView('[data-iori-field="find-query"]'))))
      await screen.click(inView('[data-iori-action="open-find"]'));
    // Typing the same word again would start over; Enter (next) continues instead.
    if (
      (await screen.value(inView('[data-iori-field="find-query"]'))) !== query
    )
      await screen.input(inView('[data-iori-field="find-query"]'), query);
    await screen.click(inView(`[data-iori-action="find-${direction}"]`));
  };
  // The current match is drawn inside the visible part of its scroller.
  const matchInView = (scroller) =>
    screen.evaluate(`(()=>{
      const mark=[...document.querySelectorAll('[data-iori-scroll="${scroller}"] [data-iori-part="search-current"]')].find(e=>e.getBoundingClientRect().width>0);
      if(!mark)return null;
      const box=mark.closest('[data-iori-scroll="long-line"]')??mark.closest('[data-iori-scroll="${scroller}"]');
      const m=mark.getBoundingClientRect(),b=box.getBoundingClientRect();
      const surface=mark.closest('[data-iori-match-row]');
      return {text:mark.textContent,visible:m.width>0&&m.left>=b.left-1&&m.right<=b.right+1&&m.top>=b.top-1&&m.bottom<=b.bottom+1,row:Number(surface?.dataset.ioriMatchRow),byte:Number(surface?.dataset.ioriMatchByte)};
    })()`);
  const selectGitChange = async (path) => {
    await backToList("git");
    await screen.click(
      `[data-iori-action="git-change-select"][data-path=${JSON.stringify(path)}]`,
    );
  };
  const diffText = () =>
    screen.text('[data-iori-view="git"] [data-iori-scroll="git-diff"]');
  const visibleGroups = () =>
    screen.evaluate(
      `JSON.stringify([...document.querySelectorAll('button[data-iori-tab-id][data-iori-tab-kind]')].map(tab=>[tab.getAttribute('data-iori-tab-kind'),tab.closest('[data-iori-group-id]')?.getAttribute('data-iori-group-id')]).sort())`,
    );
  // The worktree's layout as the frame saved it.
  const savedLayout = async () => {
    const scope = await screen.attribute(
      "[data-iori-layout-scope]",
      "data-iori-layout-scope",
    );
    return screen.evaluateAsync(
      `window.__TAURI__.core.invoke('native_load_workspace_layout',{scopeKey:${JSON.stringify(scope)}})`,
    );
  };
  const groupAction = async (kind, name) => {
    const group = attr(
      "data-iori-group-id",
      await screen.attribute(
        tabButton(kind),
        "data-iori-group-id",
        "[data-iori-group-id]",
      ),
    );
    if (await screen.visible(group + " " + action(name)))
      await screen.click(group + " " + action(name));
    else {
      await screen.click(group + " " + action("workspace-tab-list"));
      await screen.click(action(name + "-list"));
    }
  };

  const dragFileToTerminal = async () => {
    // Files, Git and a Terminal side by side; a file dragged from Files to the
    // Terminal is typed as its path, and Enter stays with the user.
    await show("files");
    await openSidebar(screen);
    // Attach before creating the Terminal: a ready View has already received
    // its initial snapshot, which the common screen observer needs.
    await observe(client());
    await create(client());
    await screen.wait(tabButton("terminal"));
    const single = await visibleGroups();
    await splitTab(screen, tabButton("terminal"), "right");
    await waitFor(visibleGroups, (groups) => groups !== single);
    await screen.click(tabButton("git"));
    const two = await visibleGroups();
    await splitTab(screen, tabButton("git"), "below");
    await waitFor(visibleGroups, (groups) => groups !== two);
    await screen.click(tabButton("files"));
    view = "files";
    await backToList("files");
    if (
      !(await screen.evaluate(
        `document.querySelector(${JSON.stringify(row("many"))})?.getAttribute('aria-expanded')==='true'`,
      ))
    )
      await screen.click(row("many"));
    const dragged = row("many/entry 0001.txt");
    await screen.wait(dragged);
    const printArgument = "printf '<%s>\\n' ";
    await typeTerminal(client(), printArgument);
    await screen.htmlDrag(dragged, tabButton("terminal"));
    await typeTerminal(client(), "\r");
    await observed(client(), `<${absolute("many/entry 0001.txt")}>`);
    // A shell that reports its directory (OSC 7) gets the path relative to it.
    await client().screen.evaluate(
      `(()=>{window.__ioriCwdReported=false;window.__TAURI__.event.listen('native://stream',({payload})=>{if(payload.json.includes('"cwdFromShell":true'))window.__ioriCwdReported=true}).then(stop=>{window.__ioriCwdStop=stop});return true})()`,
    );
    await typeTerminal(
      client(),
      `printf '\\033]7;file://%s%s\\007' "$(hostname)" "$PWD"\r`,
    );
    await waitFor(() => screen.evaluate("window.__ioriCwdReported===true"));
    await screen.evaluate("(()=>{window.__ioriCwdStop?.();return true})()");
    await clearObserved(client());
    await typeTerminal(client(), printArgument);
    await screen.htmlDrag(dragged, '[data-iori-view="terminal"]');
    await typeTerminal(client(), "\r");
    await observed(client(), "<many/entry 0001.txt>");
    // The long folder is closed again so the next rows stay in the list's window.
    await screen.click(row("many"));
    await record("dragging-a-file-to-a-terminal-types-its-path", {
      host: hostOs,
      before: "absolute",
      afterReportedDirectory: "relative",
    });
    await screen.wait('[data-iori-view="git"]');
    await shot("pc-files-git-terminal");
  };

  await openFolder(screen, root, mobile);
  await screen.wait('[data-iori-view="workspace-start"]');
  await show("files");
  await record("open-files-from-the-frame-sidebar");

  if (pathDragOnly) {
    await dragFileToTerminal();
    return;
  }

  if (watchOnly) {
    await openFile("inside/linked.txt");
    await waitFor(filesText, (text) => text.includes("inside target"));
    await record("read-file-before-external-change");
    await host.write("inside/linked.txt", "watched content updated\n");
    await waitFor(filesText, (text) =>
      text.includes("watched content updated"),
    );
    await record("external-change-updates-open-file");
    await show("git");
    await selectGitChange("diff.txt");
    await waitFor(diffText, (text) => text.includes("original 1"));
    await record("switch-to-git-and-read-diff");
    await show("files");
    await waitFor(filesText, (text) =>
      text.includes("watched content updated"),
    );
    await record("return-to-files-with-updated-content");
    return;
  }

  // Folders come first, then files, each in name order.
  const folders = new Set([
    ".git",
    "inside",
    "inside-link",
    "many",
    "outside-link",
    "tracked-dir",
  ]);
  const rootRows = await waitFor(
    () =>
      screen.evaluate(
        `Array.from(document.querySelectorAll('[data-iori-scroll="file-tree"] [data-iori-file][aria-level="1"]')).sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top).map(e=>e.dataset.ioriFile)`,
      ),
    (rows) => rows.some((name) => !folders.has(name)),
  );
  const firstFile = rootRows.findIndex((name) => !folders.has(name));
  assert.equal(firstFile > 0, true);
  assert.equal(
    rootRows.slice(firstFile).some((name) => folders.has(name)),
    false,
  );
  const byName = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  for (const group of [rootRows.slice(0, firstFile), rootRows.slice(firstFile)])
    assert.deepEqual(group, [...group].sort(byName.compare));
  await record("folder-lists-folders-first-in-name-order", {
    folders: firstFile,
    shownRows: rootRows.length,
  });

  // A folder with many entries is read as the list scrolls, in name order.
  await screen.click(row("many"));
  const lastEntry = await waitFor(async () => {
    await screen.scroll('[data-iori-scroll="file-tree"]', { top: "end" });
    return screen.visible(row("many/entry-1199.txt"));
  }, Boolean);
  await screen.scroll('[data-iori-scroll="file-tree"]', { top: 0 });
  await screen.click(row("many"));
  await record("large-directory-reaches-last-entry-in-name-order", {
    lastEntry,
  });

  // A large file: search from the top reaches the last line.
  await openFile("large.txt");
  await find("LAST_FILE_MARKER");
  const lastMatch = await waitFor(
    () => matchInView("file-text"),
    (m) => m?.visible,
  );
  assert.equal(lastMatch.row, 99999);
  assert.equal(lastMatch.text, "LAST_FILE_MARKER");
  const rendered = await screen.evaluate(
    'document.querySelectorAll("[data-iori-scroll=file-text] [data-iori-row]").length',
  );
  assert.equal(rendered < 200, true);
  await record("large-file-search-reaches-last-line", {
    renderedRows: rendered,
  });
  if (mobile) await shot("files");

  // Lines are selected with the line numbers and copied.
  await screen.press('[data-iori-line="99999"] .reading-gutter');
  await screen.press('[data-iori-line="100000"] .reading-gutter', {
    shiftKey: true,
  });
  await screen.contextMenu('[data-iori-line="100000"] .reading-line-text');
  await screen.click('[data-iori-action="copy-lines"]');
  await waitFor(
    clipboard,
    (text) => text === "line 99999 text\nline 100000 LAST_FILE_MARKER",
  );
  await screen.contextMenu('[data-iori-line="100000"] .reading-line-text');
  await screen.click('[data-iori-action="copy-line-path"]');
  await waitFor(
    clipboard,
    (text) => text === absolute("large.txt") + ":99999-100000",
  );
  await screen.contextMenu('[data-iori-line="100000"] .reading-line-text');
  await screen.click('[data-iori-action="copy-path"]');
  await waitFor(clipboard, (text) => text === absolute("large.txt"));
  await record("line-number-selection-copy-lines-and-paths");

  // Go to a line from the menu (phones have no Ctrl+G).
  await screen.contextMenu('[data-iori-line="100000"] .reading-line-text');
  await screen.click('[data-iori-action="open-go-to-line"]');
  await screen.input('[data-iori-field="go-to-line"]', "50000");
  await screen.submit('[data-iori-field="go-to-line"]');
  await waitFor(
    () => screen.text('[data-iori-line="50000"]'),
    (text) => text.includes("line 50000 text"),
  );
  await record("go-to-line-from-menu");

  // The reading position survives switching to Git and back.
  await show("git");
  await show("files");
  await waitFor(
    () => screen.text('[data-iori-line="50000"]'),
    (text) => text.includes("line 50000"),
  );
  await screen.click(inView('[data-iori-action="open-find"]'));
  await waitFor(
    () => screen.value(inView('[data-iori-field="find-query"]')),
    (v) => v === "LAST_FILE_MARKER",
  );
  await record("files-position-kept-across-git-view");

  // One huge logical line: both ends are found and shown.
  await openFile("one-line.txt");
  await find("LONG_LINE_END");
  const end = await waitFor(
    () => matchInView("file-text"),
    (m) => m?.visible && m.text === "LONG_LINE_END",
  );
  await find("LONG_LINE_START");
  const start = await waitFor(
    () => matchInView("file-text"),
    (m) => m?.visible && m.text === "LONG_LINE_START",
  );
  assert.equal(end.byte > start.byte, true);
  await record("huge-line-search-shows-both-ends", {
    start: start.byte,
    end: end.byte,
  });

  // Markdown is drawn without running scripts or fetching remote images.
  await openFile("readme.md");
  await screen.wait('[data-iori-part="markdown-rendered"] h1');
  assert.equal(
    await screen.evaluate("document.body.dataset.scriptRan==='yes'"),
    false,
  );
  assert.equal(
    await screen.evaluate(
      "Array.from(document.images).some(i=>i.src.includes('example.invalid'))",
    ),
    false,
  );
  await screen.click('[data-iori-href="#last-heading"]');
  const headingInView = () =>
    screen.evaluate(
      `(()=>{const h=document.getElementById('last-heading');const b=document.querySelector('[data-iori-scroll="file-markdown"]');if(!h||!b)return false;const r=h.getBoundingClientRect(),c=b.getBoundingClientRect();return r.top>=c.top-1&&r.bottom<=c.bottom+1;})()`,
    );
  await waitFor(headingInView, Boolean);
  await screen.click('[data-iori-action="markdown-source"]');
  await waitFor(
    () => screen.text('[data-iori-scroll="file-text"]'),
    (text) => text.includes("## Last heading"),
  );
  await screen.click('[data-iori-action="markdown-source"]');
  await waitFor(headingInView, Boolean);
  await record("markdown-safe-render-anchor-and-source-position");

  // An image fits the view, zooms, and shows at actual size.
  await openFile("image.png");
  await screen.wait('[data-iori-part="file-image"]');
  const imageWidth = () =>
    screen.evaluate(
      `Math.round(document.querySelector('[data-iori-part="file-image"]').getBoundingClientRect().width)`,
    );
  await screen.click('[data-iori-action="image-actual-size"]');
  await waitFor(imageWidth, (width) => width === 240);
  await screen.click('[data-iori-action="image-zoom-in"]');
  await waitFor(imageWidth, (width) => width === 300);
  await record("image-actual-size-and-zoom", { zoomedWidth: 300 });

  // A binary file and an empty file are told apart from a failure.
  await openFile("binary.bin");
  await screen.wait('[data-iori-state="binary-file"]');
  await openFile("empty.txt");
  await screen.wait('[data-iori-state="empty-file"]');
  assert.equal(await alerts("files"), "");
  await record("binary-and-empty-files-are-distinct");

  // A log being written stays readable while it grows.
  await openFile("app.log");
  await host.append("app.log", 60);
  let tailSeen = "";
  for (let pass = 0; pass < 6; pass++) {
    await screen.scroll('[data-iori-scroll="file-text"]', { top: "end" });
    tailSeen = await waitFor(
      () =>
        screen.evaluate(
          `Array.from(document.querySelectorAll('[data-iori-scroll="file-text"] .reading-line-text')).map(e=>e.textContent).join('\\n')`,
        ),
      (text) =>
        /appended \d+/u.test(text) &&
        text.includes("appended") &&
        text !== tailSeen,
    );
    await screen.scroll('[data-iori-scroll="file-text"]', { top: 0 });
    await waitFor(
      () => screen.text('[data-iori-line="1"]'),
      (text) => text.includes("log line 1"),
    );
    assert.equal(await alerts("files"), "");
  }
  const lastAppended = Math.max(
    ...[...tailSeen.matchAll(/appended (\d+)(?!\d)/gu)].map((match) =>
      Number(match[1]),
    ),
  );
  await record("growing-log-stays-readable", { lastAppended });

  // A file changed on the Host updates without any action.
  await openFile("untracked.txt");
  await host.write("untracked.txt", "WATCH_UPDATED\n");
  await waitFor(filesText, (text) => text.includes("WATCH_UPDATED"));
  await record("open-file-follows-host-change");

  // Open folders stay open while an Agent saves files elsewhere.
  await backToList("files");
  await screen.click(row("inside"));
  await screen.wait(row("inside/linked.txt"));
  await host.write("inside/agent-save.txt", "saved by an agent\n");
  await host.write("staged.txt", "staged addition\nmore\n");
  await screen.wait(row("inside/agent-save.txt"));
  assert.equal(
    await screen.evaluate(
      `document.querySelector(${JSON.stringify(row("inside"))}).getAttribute('aria-expanded')`,
    ),
    "true",
  );
  await record("open-folders-stay-open-on-changes");

  // Links inside the folder open; a link to the outside does not.
  await openFile("inside-link/linked.txt");
  await waitFor(filesText, (text) => text.includes("inside target"));
  await backToList("files");
  await screen.click(row("outside-link"));
  await screen.wait('[data-iori-state="link-outside_root"]');
  assert.equal(
    await screen.evaluate(
      "document.body.textContent.includes('MUST_NOT_READ_OUTSIDE')",
    ),
    false,
  );
  assert.equal(
    await screen.visible('[data-iori-file^="outside-link/"]'),
    false,
  );
  await record("inside-link-opens-outside-link-does-not");

  // Git: each change is listed in its section, even with a tracked folder replaced by a link.
  await show("git");
  await screen.wait(
    '[data-iori-action="git-change-select"][data-path="diff.txt"]',
  );
  const sections = await screen.evaluate(`(()=>{
    const expected=[['many/entry 0001.txt','staged'],['diff.txt','unstaged'],['tracked-dir/a.txt','unstaged'],['tracked-dir','untracked'],['untracked.txt','untracked'],['conflict.txt','conflict']];
    const headings=Array.from(document.querySelectorAll('.git-section-heading[data-area]')).map(h=>[h.dataset.area,Number(h.closest('.reading-virtual-row').dataset.index)]);
    return expected.every(([path,area])=>{
      const e=document.querySelector('[data-iori-action="git-change-select"][data-path="'+CSS.escape(path)+'"]');
      const index=Number(e?.closest('.reading-virtual-row')?.dataset.index);
      const own=headings.find(h=>h[0]===area);
      const next=headings.filter(h=>h[1]>own[1]).map(h=>h[1]).sort((a,b)=>a-b)[0]??Infinity;
      return e?.dataset.area===area&&index>own[1]&&index<next;
    });
  })()`);
  assert.equal(sections, true);
  assert.equal(await alerts("git"), "");
  await record("git-sections-and-tracked-folder-replaced-by-link");

  await selectGitChange("many/entry 0001.txt");
  const rename = await screen.text('[data-iori-action="git-detail-path"]');
  assert.equal(
    rename.includes("many/entry-0001.txt") &&
      rename.includes("many/entry 0001.txt"),
    true,
  );
  assert.equal(
    (await screen.text('[data-iori-part="git-detail-area"]')).includes(
      "ステージ済み",
    ),
    true,
  );
  await record("git-staged-rename-shows-old-and-new-path");

  await selectGitChange("conflict.txt");
  await screen.click('[data-iori-action="git-conflict-stage"][data-stage="2"]');
  await waitFor(diffText, (text) => text.includes("ours version"));
  await screen.click('[data-iori-action="git-conflict-stage"][data-stage="3"]');
  await waitFor(diffText, (text) => text.includes("theirs version"));
  await record("git-conflict-stages");

  await selectGitChange("diff.txt");
  await waitFor(diffText, (text) => text.includes("original 1"));
  assert.equal((await diffText()).includes("diff --git"), false);
  await find("LAST_DIFF_MARKER");
  await waitFor(
    () => matchInView("git-diff"),
    (m) => m?.visible && m.text === "LAST_DIFF_MARKER",
  );
  await record("git-diff-search-reaches-end-without-raw-headers");
  if (mobile) await shot("git");

  await selectGitChange("long-diff.txt");
  await find("NEEDLE");
  const first = await waitFor(
    () => matchInView("git-diff"),
    (m) => m?.visible,
  );
  await find("NEEDLE");
  const second = await waitFor(
    () => matchInView("git-diff"),
    (m) => m?.visible && m.byte > first.byte,
  );
  await find("NEEDLE", "previous");
  await waitFor(
    () => matchInView("git-diff"),
    (m) => m?.visible && m.byte === first.byte,
  );
  await record("git-long-line-search-forward-backward", {
    first: first.byte,
    second: second.byte,
  });

  // Unchanged lines far from changes are folded; search and a click open them.
  await selectGitChange("context.txt");
  await screen.wait('[data-iori-action="git-expand-context"]');
  await find("context line 500");
  await waitFor(
    () => screen.text('[data-iori-new-line="500"]'),
    (text) => text.includes("context line 500"),
  );
  await screen.click(inView('[data-iori-action="find-close"]'));
  await screen.scroll('[data-iori-scroll="git-diff"]', { top: 0 });
  await screen.click('[data-iori-action="git-expand-context"]', {
    scroll: false,
  });
  await screen.wait('[data-iori-new-line="20"]');
  await record("git-folded-context-opens-by-search-and-click");

  // History: a commit's message and one of its files.
  await backToList("git");
  await screen.click('[data-iori-action="git-mode-history"]');
  await screen.wait('[data-iori-action="git-commit-select"]');
  const initial = await screen.evaluate(
    `Array.from(document.querySelectorAll('[data-iori-action="git-commit-select"]')).find(n=>n.textContent.includes('Initial reading fixtures'))?.dataset.hash`,
  );
  await screen.click(
    `[data-iori-action="git-commit-select"][data-hash="${initial}"]`,
  );
  await waitFor(
    () => screen.text('[data-iori-part="commit-message"]'),
    (text) => text.includes("Full commit message detail"),
  );
  await screen.click(
    '[data-iori-action="git-commit-file-select"][data-path="diff.txt"]',
  );
  await waitFor(diffText, (text) => text.includes("original 1"));
  await record("git-history-commit-message-and-file-diff");

  await backToList("git");
  await screen.click('[data-iori-action="git-mode-changes"]');
  await host.write("watch-new.txt", "new watched change\n");
  await screen.wait(
    '[data-iori-action="git-change-select"][data-path="watch-new.txt"]',
  );
  await record("git-list-follows-host-change");

  // Files asks for a file's history; the Git View shows it filtered to the file.
  await show("files");
  await openFile("diff.txt");
  await screen.click(inView('[data-iori-action="file-history"]'));
  view = "git";
  await waitFor(
    () => screen.text('[data-iori-view="git"] .git-filter'),
    (text) => text.includes("diff.txt"),
  );
  await screen.wait(
    '[data-iori-view="git"] [data-iori-action="git-commit-select"]',
  );
  await record("file-history-opens-the-git-view-filtered-to-the-file");
  await screen.click(
    '[data-iori-view="git"] [data-iori-action="git-history-clear-filter"]',
  );
  await screen.click(
    '[data-iori-view="git"] [data-iori-action="git-mode-changes"]',
  );

  if (mobile) {
    // Back closes the file and shows the list, then goes to the previous View.
    await show("files");
    await openFile("large.txt");
    const listShown = () =>
      screen.evaluate(
        `(()=>{const v=document.querySelector('[data-iori-view="files"]');return Boolean(v)&&!v.querySelector('.reading-list').hidden&&v.querySelector('.reading-detail').hidden&&!document.querySelector(${JSON.stringify(mobileView("files"))}).hidden})()`,
      );
    await client().browser.dismissKeyboard();
    await back();
    await waitFor(listShown, Boolean);
    await back();
    await waitFor(() =>
      screen.evaluate(
        `!document.querySelector(${JSON.stringify(mobileView("git"))}).hidden`,
      ),
    );
    view = "git";
    await record("android-back-closes-the-file-then-shows-the-previous-view");
  } else {
    await dragFileToTerminal();
  }

  // Leaving the worktree and coming back shows the Views as they were.
  await show("files");
  await openFile("large.txt");
  await waitFor(
    () => screen.text('[data-iori-line="50000"]'),
    (text) => text.includes("line 50000"),
  );
  await show("git");
  await selectGitChange("long-diff.txt");
  await find("NEEDLE");
  const saved = await waitFor(
    () => matchInView("git-diff"),
    (m) => m?.visible,
  );
  const layout = mobile ? "" : await visibleGroups();
  await selectWorktree(worktree);
  await selectWorktree(root);
  await waitFor(
    () => matchInView("git-diff"),
    (m) => m?.visible && m.byte === saved.byte,
  );
  await show("files");
  await waitFor(
    () => screen.text('[data-iori-line="50000"]'),
    (text) => text.includes("line 50000"),
  );
  await record("views-restored-after-switching-worktree");

  // The Client restarts with the same reading positions and View layout,
  // saved with the workspace layout.
  let ratio;
  if (!mobile) {
    await groupAction("files", "workspace-maximize");
    const divider = '[data-iori-view="files"] [role="separator"]';
    await screen.wait(divider);
    const before = Number(await screen.attribute(divider, "aria-valuenow"));
    await screen.evaluate(
      `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(divider)})].find(e=>e.getBoundingClientRect().width>0);e.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));return true})()`,
    );
    ratio = await waitFor(
      () => screen.attribute(divider, "aria-valuenow"),
      (value) => value === String(before + 2),
    );
    // A width changed just before leaving the worktree (within the moment
    // the View waits to save) is kept as well.
    const quick = String(Number(ratio) + 2);
    await screen.evaluate(
      `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(divider)})].find(e=>e.getBoundingClientRect().width>0);e.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));document.querySelector(${JSON.stringify("button" + attr("data-iori-worktree-path", worktree))}).click();return true})()`,
    );
    await currentWorktree(worktree);
    await selectWorktree(root);
    await groupAction("files", "workspace-maximize");
    ratio = await waitFor(
      () => screen.attribute(divider, "aria-valuenow"),
      (value) => value === quick,
    );
    await screen.click(action("workspace-restore"));
    await waitFor(savedLayout, (saved) =>
      Object.values(saved?.views ?? {}).some(
        (view) => view?.ratio === Number(quick),
      ),
    );
  }
  screen = await restart();
  await screen.wait('[data-iori-view="workspace"]');
  if (mobile) await selectWorktree(root);
  else await currentWorktree(root);
  if (!mobile) {
    assert.equal(
      await waitFor(visibleGroups, (groups) => groups === layout),
      layout,
    );
    // Restoring a View does not scroll the workspace's tab rows out of sight.
    for (const kind of ["files", "git", "terminal"])
      await waitFor(() => screen.visible(tabButton(kind)), Boolean);
  }
  await show("git");
  await waitFor(
    () => matchInView("git-diff"),
    (m) => m?.visible && m.byte === saved.byte,
  );
  await show("files");
  await waitFor(
    () => screen.text('[data-iori-line="50000"]'),
    (text) => text.includes("line 50000"),
  );
  if (!mobile) {
    await groupAction("files", "workspace-maximize");
    assert.equal(
      await screen.attribute(
        '[data-iori-view="files"] [role="separator"]',
        "aria-valuenow",
      ),
      ratio,
    );
    await screen.click(action("workspace-restore"));
  }
  await record("positions-and-view-layout-restored-after-client-restart", {
    groups: mobile ? undefined : JSON.parse(layout).length,
    listWidth: ratio,
  });

  if (!mobile) {
    // Closing a split panel takes its View's saved state with it.
    const filesGroup = await screen.attribute(
      tabButton("files"),
      "data-iori-group-id",
      "[data-iori-group-id]",
    );
    const splitGit = await screen.evaluate(
      `[...document.querySelectorAll('[data-tab-kind="git"][data-iori-group-id]')].map(e=>e.getAttribute('data-iori-group-id')).find(id=>id!==${JSON.stringify(filesGroup)})`,
    );
    await screen.click(tabButton("files"));
    await screen.click(
      '[data-iori-view="git"] [data-iori-action="git-mode-history"]',
    );
    const splitId = await waitFor(
      async () =>
        Object.entries((await savedLayout())?.views ?? {}).find(
          ([key, view]) => key.includes(":split:") && view?.mode === "history",
        )?.[0],
      Boolean,
    );
    await screen.click(
      `[data-tab-kind="git"]${attr("data-iori-group-id", splitGit)} ${action("workspace-close-tab")}`,
    );
    await waitFor(
      savedLayout,
      (saved) =>
        !JSON.stringify(saved?.layout ?? {}).includes(splitId) &&
        !(splitId in (saved?.views ?? {})),
    );
    await record("closing-a-split-panel-removes-its-view-state", {
      closedPanel: "git split",
    });
  }

  // A repository with many folders and changes lists quickly.
  const listStarted = Date.now();
  await openFolder(screen, bulk, mobile);
  await show("git");
  await screen.wait(
    '[data-iori-action="git-change-select"][data-path="dir0/file0.txt"]',
  );
  const firstPageMs = Date.now() - listStarted;
  assert.equal(
    await screen.text('.git-section-heading[data-area="unstaged"] .git-count'),
    "200",
  );
  const lastChange = await waitFor(async () => {
    await screen.scroll(
      '[data-iori-view="git"] [data-iori-scroll="git-changes"]',
      {
        top: "end",
      },
    );
    return screen.visible(
      '[data-iori-action="git-change-select"][data-path="dir99/file0.txt"]',
    );
  }, Boolean);
  await record("bulk-repository-lists-all-changes", {
    firstPageMs,
    lastChange,
  });

  // A linked worktree: stage and commit there show up without reopening.
  await selectWorktree(worktree);
  await show("git");
  await host.write("wt-change.txt", "worktree change\n", worktree);
  await screen.wait(
    '[data-iori-action="git-change-select"][data-path="wt-change.txt"][data-area="untracked"]',
  );
  await host.git(worktree, ["add", "wt-change.txt"]);
  await screen.wait(
    '[data-iori-action="git-change-select"][data-path="wt-change.txt"][data-area="staged"]',
  );
  await host.git(worktree, [
    "-c",
    "user.name=Reading verification",
    "-c",
    "user.email=reading@example.invalid",
    "commit",
    "-m",
    "Worktree commit",
  ]);
  await waitFor(
    () =>
      screen.visible(
        '[data-iori-action="git-change-select"][data-path="wt-change.txt"]',
      ),
    (shown) => shown === false,
  );
  await screen.click(
    '[data-iori-view="git"] [data-iori-action="git-mode-history"]',
  );
  await waitFor(
    () =>
      screen.text('[data-iori-view="git"] [data-iori-scroll="git-history"]'),
    (text) => text.includes("Worktree commit"),
  );
  await screen.click(
    '[data-iori-view="git"] [data-iori-action="git-mode-changes"]',
  );
  await record("linked-worktree-stage-and-commit-update-git");
}
