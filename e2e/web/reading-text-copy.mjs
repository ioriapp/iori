import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { waitFor } from "../../verification/ui.mjs";
import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import { openSidebar } from "../connection/scenario.mjs";
import { selectWorktree } from "../workspace/scenario.mjs";

export async function readingTextCopy({
  client,
  screen,
  worktree,
  mobile,
  desktop,
  record,
  shot,
}) {
  const lines = Array.from(
    { length: 360 },
    (_, i) =>
      `line ${String(i + 1).padStart(3, "0")} 日本語😀 text to select and copy`,
  );
  await writeFile(join(worktree, "text-copy.ts"), lines.join("\n") + "\n");
  await desktop();
  await openWorkspaceView(screen, "files");
  await screen.wait('[data-iori-file="text-copy.ts"]');
  await screen.click('[data-iori-file="text-copy.ts"]');
  const line = (n) =>
    `[data-iori-view="files"] [data-iori-line="${n}"] .reading-line-text`;
  await screen.wait(line(4));
  const at = async (selector, offset) => {
    await screen.point(selector);
    return screen.evaluate(`(()=>{
    const e=document.querySelector(${JSON.stringify(selector)}),w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);
    let node,remaining=${offset};while(node=w.nextNode()){if(remaining<=node.length){const r=document.createRange();r.setStart(node,remaining);r.collapse(true);const b=r.getBoundingClientRect();return {x:b.x+0.1,y:b.y+b.height/2};}remaining-=node.length;}
  })()`);
  };
  const clickAt = async (point) => {
    await client.browser.call("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...point,
    });
    await client.browser.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      buttons: 1,
      clickCount: 1,
      ...point,
    });
    await client.browser.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      buttons: 0,
      clickCount: 1,
      ...point,
    });
  };
  const clearSelection = async () => clickAt(await at(line(1), 3));
  const readClipboard = () => screen.evaluate("navigator.clipboard.readText()");
  const seed = () =>
    screen.evaluate("navigator.clipboard.writeText('clipboard before copy')");
  const copy = async (expected) => {
    await seed();
    await screen.key("Control+c");
    try {
      await waitFor(readClipboard, (text) => text === expected);
    } catch {
      assert.equal(await readClipboard(), expected);
    }
    assert.equal(await readClipboard(), expected);
  };
  await clickAt(await at(line(1), 3));
  await screen.key("Control+f");
  const findInput = '[data-iori-field="find-query"]';
  await screen.input(findInput, "search text");
  await screen.key("Control+a");
  assert.equal(
    await screen.evaluate(
      `(()=>{const e=document.querySelector('${findInput}');return e.value.slice(e.selectionStart,e.selectionEnd)})()`,
    ),
    "search text",
  );
  assert.equal(
    await screen.evaluate(
      `document.querySelectorAll('[data-iori-view="files"] [data-selected="true"]').length`,
    ),
    0,
  );
  await screen.key("Backspace");
  await screen.key("Escape");
  await clickAt(await at(line(1), 3));
  assert.equal(await screen.visible(line(360)), false);
  await screen.key("Control+a");
  await copy(lines.join("\n"));
  await record("検索欄の全選択を保ち、本文の全選択で画面外を含む全文をコピー");
  const partial =
    lines[1].slice(5) + "\n" + lines[2] + "\n" + lines[3].slice(0, 15);
  await client.browser.drag(await at(line(2), 5), await at(line(4), 15));
  await copy(partial);

  await clearSelection();
  await client.browser.drag(await at(line(2), 0), await at(line(2), 4));
  await writeFile(
    join(worktree, "text-copy.ts"),
    ["Inserted before the selected row", ...lines].join("\n") + "\n",
  );
  await waitFor(
    () => screen.text(line(2)),
    (text) => text === lines[0],
  );
  await screen.click('[data-iori-action="file-wrap"]');
  await client.browser.drag(await at(line(4), 0), await at(line(4), 4));
  await writeFile(
    join(worktree, "text-copy.ts"),
    "A shorter replacement\nSecond updated line\n",
  );
  await waitFor(
    () => screen.text(line(1)),
    (text) => text === "A shorter replacement",
  );
  await writeFile(join(worktree, "text-copy.ts"), lines.join("\n") + "\n");
  await waitFor(
    () => screen.text(line(1)),
    (text) => text === lines[0],
  );
  await screen.click('[data-iori-action="file-wrap"]');
  await record(
    "文字を選んでいても外部変更の新しい行を表示し、折り返し中の短い本文への変更でも画面を保つ",
  );

  await clickAt(
    await screen.point(
      '[data-iori-view="files"] [data-iori-line="10"] .reading-gutter',
    ),
  );
  await screen.wait(
    '[data-iori-view="files"] [data-iori-line="10"][data-selected="true"]',
  );
  await screen.evaluate(`(()=>{
    const e=document.querySelector('[data-iori-view="files"] .reading-virtual');
    e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',button:0,buttons:1}));
    e.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse',button:0,buttons:0}));
  })()`);
  await screen.scroll('[data-iori-view="files"] .reading-lines', { top: 4200 });
  await screen.wait(line(200));
  const endLine = await screen.point(
    '[data-iori-view="files"] [data-iori-line="200"] .reading-gutter',
  );
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...endLine,
  });
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    buttons: 1,
    clickCount: 1,
    modifiers: 8,
    ...endLine,
  });
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    buttons: 0,
    clickCount: 1,
    modifiers: 8,
    ...endLine,
  });
  await copy(lines.slice(9, 200).join("\n"));
  await record(
    "本文のスクロール操作で行の選択を失わず、Shiftで10〜200行目へ延ばしてコピー",
  );
  await screen.scroll('[data-iori-view="files"] .reading-lines', { top: 0 });
  await screen.wait(line(4));
  await clearSelection();
  await client.browser.drag(await at(line(2), 0), await at(line(2), 4));
  await clickAt(
    await screen.point('[data-iori-view="files"] .reading-path-header'),
  );
  await screen.contextMenu(line(2));
  await screen.wait('[data-iori-action="open-find"]');
  assert.equal(await screen.visible('[data-iori-action="copy-text"]'), false);
  await screen.key("Escape");
  await record(
    "本文の外をクリックして選択を外した後は、前の文字のコピーをメニューへ残さない",
  );

  await clearSelection();
  const from = await at(line(2), 5);
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...from,
  });
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    buttons: 1,
    clickCount: 1,
    ...from,
  });
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    button: "left",
    buttons: 1,
    x: from.x + 20,
    y: from.y + 30,
  });
  const view = await screen.point('[data-iori-view="files"] .reading-lines');
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    buttons: 1,
    deltaY: 1600,
    deltaX: 0,
    ...view,
  });
  await screen.wait(line(80));
  const to = await at(line(80), 15);
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    button: "left",
    buttons: 1,
    ...to,
  });
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    buttons: 0,
    clickCount: 1,
    ...to,
  });
  const outside =
    lines[1].slice(5) +
    "\n" +
    lines.slice(2, 79).join("\n") +
    "\n" +
    lines[79].slice(0, 15);
  await copy(outside);
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    deltaY: 1000,
    deltaX: 0,
    ...view,
  });
  await copy(outside);
  await record(
    "ドラッグ中と選択後のスクロールで画面外へ出ても、描画しなかった本文を含めてコピー",
  );
  await screen.scroll('[data-iori-view="files"] .reading-lines', { top: 0 });
  await screen.wait(line(4));
  await clearSelection();
  await client.browser.drag(await at(line(2), 5), await at(line(4), 15));
  await seed();
  await screen.contextMenu(line(3));
  await screen.wait('[data-iori-action="copy-text"]');
  await screen.click('[data-iori-action="copy-text"]');
  await waitFor(readClipboard, (text) => text === partial);
  assert.equal(await readClipboard(), partial);
  await record(
    "本文の途中から複数行をドラッグし、Ctrl+Cとメニューのコピーで本文だけをコピー",
  );

  await openWorkspaceView(screen, "git");
  await screen.wait(
    '[data-iori-action="git-change-select"][data-path="text-copy.ts"]',
  );
  await screen.click(
    '[data-iori-action="git-change-select"][data-path="text-copy.ts"]',
  );
  const added =
    '[data-iori-view="git"] [data-kind="added"][data-iori-new-line="2"] .reading-line-text';
  await screen.wait(added);
  await client.browser.drag(await at(added, 5), await at(added, 15));
  await copy(lines[1].slice(5, 15));
  await clickAt(await at(added, 3));
  await screen.key("Control+a");
  await copy(lines.join("\n"));
  await record(
    "Gitの追加行の一部と差分全体をコピーし、行番号と追加の記号を含めない",
  );

  await writeFile(
    join(worktree, "text-copy.md"),
    "# Selected text\n\nA Markdown paragraph 日本語😀 for copying.\n",
  );
  await openWorkspaceView(screen, "files");
  await screen.wait('[data-iori-file="text-copy.md"]');
  await screen.click('[data-iori-file="text-copy.md"]');
  const paragraph = '[data-iori-part="markdown-rendered"] p';
  await screen.wait(paragraph);
  const markdownCopy = "Markdown paragraph 日本語😀";
  await client.browser.drag(
    await at(paragraph, 2),
    await at(paragraph, 2 + markdownCopy.length),
  );
  await seed();
  await screen.contextMenu(paragraph);
  await screen.wait('[data-iori-action="copy-text"]');
  await screen.click('[data-iori-action="copy-text"]');
  await waitFor(readClipboard, (text) => text === markdownCopy);
  assert.equal(await readClipboard(), markdownCopy);
  await record("描画したMarkdownの選んだ文字を右クリックのコピーでコピー");

  await mobile({ width: 390, height: 844 });
  await client.browser.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await selectWorktree(screen, worktree, true);
  await openSidebar(screen);
  await openWorkspaceView(screen, "files");
  if (!(await screen.visible('[data-iori-file="text-copy.ts"]'))) {
    if (await screen.visible('[data-iori-part="mobile-location"]'))
      await screen.key("Alt+ArrowLeft");
    else await screen.click('[data-iori-action="reading-back"]');
  }
  await screen.wait('[data-iori-file="text-copy.ts"]');
  await screen.tap('[data-iori-file="text-copy.ts"]');
  await screen.scroll('[data-iori-view="files"] .reading-lines', { top: 0 });
  await screen.wait(line(2));
  await screen.longPress(line(2));
  assert.equal(await screen.visible('[role="menu"]'), false);
  await shot("touch-selectable-text");
  await screen.tap(
    '[data-iori-view="files"] [data-iori-line="2"] .reading-gutter',
  );
  await screen.wait(
    '[data-iori-view="files"] [data-iori-line="2"][data-selected="true"]',
  );
  await seed();
  await screen.longPress(
    '[data-iori-view="files"] [data-iori-line="2"] .reading-gutter',
  );
  await screen.wait('[data-iori-action="copy-lines"]');
  assert.equal(
    await screen.visible('[data-iori-action="open-go-to-line"]'),
    true,
  );
  await screen.tap('[data-iori-action="copy-lines"]');
  await waitFor(readClipboard, (text) => text === lines[1]);
  assert.equal(await readClipboard(), lines[1]);
  await record(
    "本物のtouchで本文の長押しはioriのメニューを開かず、行番号のタップ・長押しから選択行をコピー",
  );
}
