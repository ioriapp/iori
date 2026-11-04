import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { waitFor } from "../../verification/ui.mjs";
import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import { openSidebar } from "../connection/scenario.mjs";
import { selectWorktree } from "../workspace/scenario.mjs";

export async function filesReading({
  client,
  screen,
  repository,
  worktree,
  mobile,
  desktop,
  shot,
  record,
}) {
  const files = {
    "syntax.ts":
      "/*\n" +
      Array.from({ length: 160 }, (_, i) => `comment line ${i + 2}`).join(
        "\n",
      ) +
      "\n*/\nconst answer = 42;\n",
    "syntax.rs":
      '// Rust comment\nfn main() {\n    let answer: i32 = 42;\n    println!("{}", answer);\n}\n',
    "syntax.json":
      '{\n  "name": "iori",\n  "count": 42,\n  "enabled": true\n}\n',
    "syntax.md":
      "# Reading code\n\nA short example.\n\n```ts\nconst answer = 42;\n```\n",
    "syntax-plain":
      "Plain text without a known language.\nconst answer = 42;\n",
    "syntax-empty.txt": "",
    "syntax-error.txt": "Temporary file for the read error.\n",
    "rewrite.ts":
      Array.from({ length: 300 }, (_, i) =>
        i === 9 ? "const a = 'x';" : i === 19 ? "a b" : `line ${i + 1}`,
      ).join("\n") + "\n",
  };
  await Promise.all(
    Object.entries(files).map(([name, text]) =>
      writeFile(join(worktree, name), text),
    ),
  );
  await openWorkspaceView(screen, "files");
  const tab = (name) => `[data-iori-tab=${JSON.stringify(name)}]`;
  const file = (name) => `[data-iori-file=${JSON.stringify(name)}]`;
  const action = (name) => `[data-iori-action=${JSON.stringify(name)}]`;
  const open = async (name) => {
    if (!(await screen.visible(file(name)))) {
      if (await screen.visible('[data-iori-part="mobile-location"]'))
        await screen.key("Alt+ArrowLeft");
      else if (await screen.visible(action("reading-back")))
        await screen.click(action("reading-back"));
    }
    await screen.wait(file(name));
    await screen.click(file(name));
    await screen.wait(`${tab(name)}[aria-selected="true"]`);
  };
  const menu = async (name) => {
    await screen.contextMenu(tab(name));
    await screen.wait(action("file-tab-close"));
  };
  const tabs = () =>
    screen.evaluate(
      `[...document.querySelectorAll('[data-iori-part="file-tabs"] [data-iori-tab]')].map(e=>[e.dataset.ioriTab,e.getAttribute('aria-selected')])`,
    );
  const closeAll = async () => {
    const current = await tabs();
    if (current.length) {
      await menu(current[0][0]);
      await screen.click(action("file-tab-close-all"));
    }
  };
  await closeAll();
  const names = ["syntax.ts", "syntax.rs", "syntax.json", "syntax.md"];
  for (const name of names) await open(name);
  await menu(names[1]);
  assert.deepEqual(
    await screen.evaluate(
      `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(e=>e.textContent.trim())`,
    ),
    [
      "閉じる",
      "その他を閉じる",
      "右側を閉じる",
      "左側を閉じる",
      "すべて閉じる",
      "パスをコピー",
      "ダウンロード…",
    ],
  );
  await screen.key("Escape");
  await menu(names[0]);
  assert.equal(
    await screen.attribute(action("file-tab-close-left"), "data-disabled"),
    "",
  );
  assert.equal(
    await screen.evaluate(
      `document.querySelector(${JSON.stringify(action("file-tab-close-left"))}).hasAttribute('data-disabled')`,
    ),
    true,
  );
  await screen.key("Escape");
  await menu(names[3]);
  assert.equal(
    await screen.evaluate(
      `document.querySelector(${JSON.stringify(action("file-tab-close-right"))}).hasAttribute('data-disabled')`,
    ),
    true,
  );
  await screen.key("Escape");
  await menu(names[1]);
  await screen.click(action("file-tab-close-right"));
  assert.deepEqual(await tabs(), [
    [names[0], "false"],
    [names[1], "true"],
  ]);
  await open(names[2]);
  await open(names[3]);
  await menu(names[2]);
  await screen.click(action("file-tab-close-left"));
  assert.deepEqual(await tabs(), [
    [names[2], "false"],
    [names[3], "true"],
  ]);
  await menu(names[2]);
  await screen.click(action("file-tab-close-others"));
  assert.deepEqual(await tabs(), [[names[2], "true"]]);
  await menu(names[2]);
  await screen.click(action("file-tab-close-all"));
  assert.deepEqual(await tabs(), []);
  await record(
    "Filesのタブメニューの順序・無効項目・一括閉じと選択の維持を確認",
  );

  const line = (n) => `[data-iori-view="files"] [data-iori-line="${n}"]`;
  const comment = (n) => `${line(n)} [data-syntax="comment"]`;
  const color = (selector) =>
    screen.evaluate(
      `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).color`,
    );
  const expectedComment = () =>
    screen.evaluate(
      `(()=>{const e=document.createElement('span');e.style.color='var(--syntax-comment)';document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c})()`,
    );
  const waitComment = async (n) => {
    await screen.wait(comment(n));
    assert.equal(await color(comment(n)), await expectedComment());
  };
  const go = async (n) => {
    const point = await screen.point('[data-iori-view="files"] .reading-lines');
    await client.browser.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await client.browser.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await screen.key("Control+g");
    await screen.input('[data-iori-field="go-to-line"]', String(n));
    await screen.key("Enter");
    await screen.wait(line(n));
  };
  await open("syntax.ts");
  await waitComment(2);
  await go(145);
  await waitComment(145);
  await screen.key("Control+f");
  await screen.input('[data-iori-field="find-query"]', "comment line 145");
  await screen.wait(`${line(145)} mark`);
  // The matched text reads in the plain color on the highlight.
  const matched = `${line(145)} mark [data-syntax="comment"]`;
  await screen.wait(matched);
  assert.equal(
    await color(matched),
    await screen.evaluate(
      `(()=>{const e=document.createElement('span');e.style.color='var(--foreground)';document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c})()`,
    ),
  );
  await record(
    "128行を越えるコメントを先頭・行移動後で色付けし、検索の一致は前景色で読めることを確認",
  );
  await screen.click(action("find-close"));
  await writeFile(
    join(worktree, "syntax.ts"),
    "/* closed */\n" +
      Array.from({ length: 160 }, (_, i) => `const line${i + 2} = 42;`).join(
        "\n",
      ) +
      "\n",
  );
  await waitFor(
    () => screen.text(line(145)),
    (text) => text.includes("const line145"),
  );
  await waitFor(
    () => screen.visible(`${line(145)} [data-syntax="keyword"]`),
    Boolean,
  );
  assert.equal(await screen.visible(comment(145)), false);
  await record("外部変更後に新しい本文と色へ追従");
  await open("rewrite.ts");
  await screen.wait(`${line(10)} [data-syntax="string"]`);
  const rewritten = files["rewrite.ts"].replace(
    "const a = 'x';",
    "/* a = 'x';   ",
  );
  assert.equal(
    Buffer.byteLength(rewritten),
    Buffer.byteLength(files["rewrite.ts"]),
  );
  await writeFile(join(worktree, "rewrite.ts"), rewritten);
  await waitFor(
    () => screen.text(line(10)),
    (text) => text.includes("/* a"),
  );
  await screen.wait(`${line(10)} [data-syntax]`);
  const commentAfterRewrite = await screen.visible(comment(10));
  const split = rewritten.replace("a b", "a\nb");
  assert.equal(Buffer.byteLength(split), Buffer.byteLength(rewritten));
  await writeFile(join(worktree, "rewrite.ts"), split);
  await waitFor(
    () => screen.text(`${line(20)} .reading-line-text`),
    (text) => text.trim() === "a",
  );
  const nextLine = (await screen.text(`${line(21)} .reading-line-text`)).trim();
  await go(300);
  const lastLine = await screen.visible(line(301));
  const extraLine = await screen.visible(line(302));
  assert.deepEqual(
    { commentAfterRewrite, nextLine, lastLine, extraLine },
    {
      commentAfterRewrite: true,
      nextLine: "b",
      lastLine: true,
      extraLine: false,
    },
  );
  await record("同じ大きさの外部変更で色と行数・区切りが更新されることを確認");
  await open("syntax-plain");
  await waitFor(
    () => screen.text('[data-iori-view="files"] .reading-body'),
    (text) => text.includes("Plain text"),
  );
  assert.equal(
    await screen.evaluate(
      `document.querySelectorAll('[data-iori-view="files"] .reading-line-text [data-syntax]').length`,
    ),
    0,
  );
  await open("syntax.md");
  await screen.wait('[data-iori-part="markdown-rendered"] pre code');
  assert.equal(
    await screen.evaluate(
      `document.querySelectorAll('[data-iori-part="markdown-rendered"] pre [data-syntax]').length`,
    ),
    0,
  );
  await screen.click(action("markdown-source"));
  await screen.wait(
    '[data-iori-view="files"] .reading-line-text [data-syntax]',
  );
  await record("言語不明の平文とMarkdownの描画・原文を確認");

  // Capture each state in the actual view at the requested widths and themes.
  await writeFile(join(worktree, "syntax.ts"), files["syntax.ts"]);
  for (const [device, size] of [
    ["pc", { width: 1440, height: 1000 }],
    ["wqhd", { width: 2560, height: 1440 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    if (device === "mobile") {
      await mobile(size);
      await selectWorktree(screen, repository, true);
      await openSidebar(screen);
      await openWorkspaceView(screen, "files");
    } else {
      await desktop();
      await screen.wait('button[data-iori-tab-kind="files"]');
      if (device === "wqhd") await client.browser.viewport(size);
      await openWorkspaceView(screen, "files");
    }
    const capture = async (name) => {
      for (const theme of ["light", "dark"]) {
        await screen.evaluate(
          `document.documentElement.classList.toggle('dark',${theme === "dark"})`,
        );
        await shot(`${device}-files-${name}-${theme}`);
      }
    };
    await open("syntax.ts");
    await go(2);
    await waitComment(2);
    await screen.evaluate("document.documentElement.classList.add('dark')");
    const dark = await color(comment(2));
    await screen.evaluate("document.documentElement.classList.remove('dark')");
    const light = await color(comment(2));
    assert.notEqual(dark, light);
    await capture("typescript");
    await go(145);
    // Line 145 keeps the search highlight from the earlier step.
    await waitComment(146);
    await capture("later-page");
    await screen.key("Control+f");
    await screen.input('[data-iori-field="find-query"]', "comment line 145");
    await screen.wait(`${line(145)} mark`);
    await capture("search");
    await screen.click(action("find-close"));
    for (const [name, label] of [
      ["syntax.rs", "rust"],
      ["syntax.json", "json"],
      ["syntax-plain", "plain"],
    ]) {
      await open(name);
      await screen.wait(line(1));
      if (label !== "plain")
        await screen.wait(
          '[data-iori-view="files"] .reading-line-text [data-syntax]',
        );
      await capture(label);
    }
    await open("syntax.md");
    if (
      (await screen.attribute(action("markdown-source"), "aria-pressed")) ===
      "true"
    )
      await screen.click(action("markdown-source"));
    await screen.wait('[data-iori-part="markdown-rendered"] pre code');
    await capture("markdown-rendered");
    await screen.click(action("markdown-source"));
    await screen.wait(
      '[data-iori-view="files"] .reading-line-text [data-syntax]',
    );
    await capture("markdown-source");
    await open("syntax-empty.txt");
    await screen.wait('[data-iori-state="empty-file"]');
    await capture("empty");
    await open("syntax.ts");
    const last = (await tabs()).at(-1)[0];
    if (device === "mobile") await screen.longPress(tab(last));
    else await menu(last);
    assert.equal(
      await screen.evaluate(
        `document.querySelector(${JSON.stringify(action("file-tab-close-right"))}).hasAttribute('data-disabled')`,
      ),
      true,
    );
    await screen.wait(action("file-tab-close"));
    await capture("tab-menu");
    if (device === "mobile") {
      await screen.tap(action("file-tab-close"));
      assert.equal(await screen.visible(tab(last)), false);
    } else await screen.key("Escape");
  }
  await desktop();
  await screen.wait('button[data-iori-tab-kind="files"]');
  await openWorkspaceView(screen, "files");
  await open("syntax-error.txt");
  await rm(join(worktree, "syntax-error.txt"));
  const alert = '[data-iori-view="files"] [role="alert"]';
  await screen.wait(alert);
  assert.equal(
    (await screen.text(alert)).includes("ファイルが見つかりません"),
    true,
  );
  assert.equal(await screen.text(action("file-retry")), "再読み込み");
  assert.equal(
    (await screen.text('[data-iori-view="files"] .reading-body')).includes(
      "Temporary file for the read error.",
    ),
    false,
  );
  for (const theme of ["light", "dark"]) {
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark',${theme === "dark"})`,
    );
    await shot(`pc-files-error-${theme}`);
  }
  await record("削除されたファイルは古い本文を消し、再読み込みを示す");
  await record(
    "PC・WQHD・スマホの各テーマでFilesの本文とタブメニューを撮影し、スマホの長押しで閉じる",
  );
}
