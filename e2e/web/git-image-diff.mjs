import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pngBytes } from "../../verification/reading/png.mjs";
import { clickWithin, waitFor } from "../../verification/ui.mjs";
import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import { openSidebar } from "../connection/scenario.mjs";
import { openFolder, selectWorktree } from "../workspace/scenario.mjs";

export async function gitImageDiff({
  client,
  screen,
  repository,
  desktop,
  mobile,
  shot,
  record,
}) {
  const capture = process.env.IORI_GIT_IMAGE_CAPTURE === "1";
  const git = (...args) => execFileSync("git", args, { cwd: repository });
  const images = join(repository, "images");
  await mkdir(images, { recursive: true });
  const before = pngBytes(1600, 1400);
  const after = pngBytes(1200, 1000);
  await writeFile(join(images, "layout.png"), before);
  await writeFile(join(images, "original.png"), pngBytes(480, 320));
  await writeFile(join(images, "capture.png"), pngBytes(640, 2400));
  await writeFile(join(images, "broken.png"), pngBytes(640, 420));
  if (capture) {
    await writeFile(join(images, "icon.png"), pngBytes(16, 16));
    await writeFile(join(images, "sample.tiff"), tiffBytes(128));
  }
  git("add", "images");
  git("commit", "-m", "test: prepare image comparison");
  await writeFile(join(images, "layout.png"), after);
  await writeFile(join(images, "new-layout.png"), after);
  await writeFile(join(images, "capture.png"), pngBytes(640, 2560));
  await writeFile(
    join(images, "broken.png"),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
  );
  await writeFile(
    join(images, "archive.zip"),
    Buffer.from([80, 75, 3, 4, 0, 1]),
  );
  git("mv", "images/original.png", "images/renamed.png");
  if (capture) {
    await writeFile(join(images, "icon.png"), pngBytes(32, 32));
    await writeFile(join(images, "sample.tiff"), tiffBytes(192));
  }
  await desktop();
  await client.browser.viewport({ width: 1440, height: 1000 });
  await openFolder(screen, repository, false);
  await openWorkspaceView(screen, "git");
  const view = '[data-iori-view="git"]:not([hidden])';
  const columns = `${view} .image-diff-columns`;
  const expanded = `${view} [data-iori-part="git-image-expanded"]`;
  const frame = `${expanded} .reading-image-frame`;
  const theme = async (dark) =>
    screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${dark})`,
    );
  const take = async (id, width, dark = false) => {
    if (!capture) return;
    await theme(dark);
    await shot(`${id}-${width}-${dark ? "dark" : "light"}`);
    await theme(false);
  };
  const select = async (name, area = "unstaged", touch = false) => {
    if (
      touch &&
      !(await screen.visible(`${view} [data-iori-field="git-worktree"]`))
    )
      await screen.key("Alt+ArrowLeft");
    const target = `${view} [data-iori-action="git-change-select"][data-path="images/${name}"][data-area="${area}"]`;
    if (touch) await screen.tap(target);
    else await screen.click(target);
  };
  const drawn = () =>
    screen.evaluate(
      `(()=>{const c=document.querySelector(${JSON.stringify(columns)});return c?[...c.querySelectorAll('img')].map(i=>{const r=i.getBoundingClientRect();return {width:r.width-2,height:r.height-2,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,top:r.top,left:r.left}}):[]})()`,
    );
  const ready = async (count) =>
    waitFor(
      drawn,
      (items) =>
        items.length === count && items.every((i) => i.naturalWidth > 0),
    );
  await select("layout.png");
  await ready(2);
  // The shared scale is applied on the render after both images report
  // their natural size, so wait for it instead of measuring the first frame.
  await waitFor(
    drawn,
    (items) =>
      items.length === 2 &&
      Math.abs(
        items[0].width / items[1].width -
          items[0].naturalWidth / items[1].naturalWidth,
      ) < 0.01,
    undefined,
    "前後の画像を同じ縮尺で描く",
  );
  const facts = await screen.text(columns);
  assert.ok(
    facts.includes("1600 × 1400") && facts.includes("1200 × 1000"),
    "前後の事実の行に元の幅と高さがある",
  );
  await take("G1", 1440);
  await take("G1", 1440, true);
  await clickWithin(
    client,
    `${view} [data-iori-action="git-image-open"][data-side="new"]`,
  );
  await screen.wait(expanded);
  await take("OPEN-FIT", 1440);
  await screen.click(`${expanded} [data-iori-action="image-zoom-in"]`);
  await screen.click(`${expanded} [data-iori-action="image-zoom-in"]`);
  await screen.scroll(frame, { left: 60, top: 60 });
  const openedState = () =>
    screen.evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(expanded)}),f=e.querySelector('.reading-image-frame'),i=f.querySelector('img');return {label:e.querySelector('[data-iori-part="image-scale"]').textContent,left:f.scrollLeft,top:f.scrollTop,scale:i.getBoundingClientRect().width/i.naturalWidth}})()`,
    );
  const afterZoom = await openedState();
  assert.ok(
    afterZoom.left > 0 && afterZoom.top > 0,
    "拡大した画像の位置を動かせる",
  );
  await openWorkspaceView(screen, "files");
  await screen.wait('[data-iori-view="files"]:not([hidden])');
  await openWorkspaceView(screen, "git");
  await screen.wait(expanded);
  const returned = await openedState();
  assert.deepEqual(
    returned,
    afterZoom,
    "同じペインの別のタブからGitへ戻っても倍率と位置を保つ",
  );
  await clickWithin(
    client,
    `${expanded} [data-iori-action="git-image-before"]`,
  );
  const beforeZoom = await openedState();
  assert.equal(
    beforeZoom.label,
    afterZoom.label,
    "前後の切替で倍率の表示を保つ",
  );
  assert.ok(
    Math.abs(beforeZoom.scale - afterZoom.scale) < 0.001,
    "前後の切替で描画の倍率を保つ",
  );
  assert.equal(beforeZoom.left, afterZoom.left, "前後の切替で横の位置を保つ");
  assert.equal(beforeZoom.top, afterZoom.top, "前後の切替で縦の位置を保つ");
  await take("OPEN", 1440);
  await take("OPEN", 1440, true);
  await screen.key("Escape");
  assert.equal(await screen.visible(expanded), false, "Escで差分へ戻る");
  await select("new-layout.png", "untracked");
  await ready(1);
  assert.equal(
    await screen.attribute(`${columns} .image-diff-side`, "data-image-side"),
    "new",
  );
  assert.ok(
    (await screen.text(`${view} [data-iori-part="diff-notes"]`)).includes(
      "Gitがまだ追跡していないファイルです。全体が追加として表示されます。",
    ),
  );
  await take("U-FIX", 1440);
  await select("renamed.png", "staged");
  await ready(1);
  assert.equal(
    (await screen.text(`${columns} .image-diff-label`)).trim(),
    "",
    "内容の変わらない名前変更はラベル無しの1枚",
  );
  assert.ok(
    (await screen.text(`${view} [data-iori-part="diff-notes"]`)).includes(
      "内容の差分はありません。",
    ),
  );
  await take("G5", 1440);
  await select("broken.png");
  await waitFor(
    () => screen.text(columns),
    (text) => text.includes("この画像は表示できません。"),
  );
  await take("G8b", 1440);
  await select("capture.png");
  await ready(2);
  await take("G10", 1440);
  if (capture) {
    await select("icon.png");
    await ready(2);
    await take("G9", 1440);
    await select("sample.tiff");
    await waitFor(
      () =>
        screen.evaluate(
          `document.querySelectorAll(${JSON.stringify(`${columns} .reading-image-unavailable`)}).length`,
        ),
      (count) => count === 2,
    );
    await take("G8", 1440);
    await select("layout.png");
    await ready(2);
    const language = async (value) => {
      await screen.click('[data-iori-action="settings-open"]');
      await screen.click('[data-iori-action="settings-display"]');
      await screen.click('[data-iori-action="display-language"]');
      await screen.click(`[data-iori-option="language-${value}"]`);
      await screen.click('[data-iori-action="settings-close"]');
    };
    await language("en");
    await screen.wait(`${columns} .image-diff-side[aria-label="Before"]`);
    await take("G1-EN", 1440);
    await language("ja");
  }
  await select("archive.zip", "untracked");
  await waitFor(
    () => screen.text(`${view} [data-iori-part="diff-notes"]`),
    (text) => text.includes("バイナリのため、行の差分はありません。"),
  );
  await record(
    "PC 1440で画像の変更前後・同じ縮尺・事実、拡大後の切替で倍率と位置の保持、Esc、未追跡、内容不変の名前変更、画像以外のbinaryを確認",
  );
  await mobile({ width: 390, height: 844 });
  await selectWorktree(screen, repository, true);
  await openSidebar(screen);
  await openWorkspaceView(screen, "git");
  await select("layout.png", "unstaged", true);
  const phonePair = await ready(2);
  assert.ok(
    phonePair[1].top > phonePair[0].top + phonePair[0].height,
    "スマホでは変更前の下に変更後を積む",
  );
  await take("M1", 390);
  await take("M1", 390, true);
  await screen.tap(
    `${view} [data-iori-action="git-image-open"][data-side="new"]`,
  );
  await screen.wait(expanded);
  await take("OPEN-FIT", 390);
  await screen.tap(`${expanded} [data-iori-action="image-zoom-in"]`);
  await screen.tap(`${expanded} [data-iori-action="image-zoom-in"]`);
  await take("OPEN", 390);
  await take("OPEN", 390, true);
  await screen.key("Alt+ArrowLeft");
  assert.equal(
    await screen.visible(expanded),
    false,
    "スマホの戻るで画像の差分へ戻る",
  );
  assert.equal(await screen.visible(columns), true);
  await select("capture.png", "unstaged", true);
  await ready(2);
  await take("M4", 390);
  await record("スマホ 390のtouchで上下の画像を開き、拡大して戻ると差分へ戻る");
}

// A valid one-pixel, uncompressed grayscale TIFF; Chromium does not decode TIFF.
function tiffBytes(value) {
  const tags = [
    [256, 1],
    [257, 1],
    [258, 8],
    [259, 1],
    [262, 1],
    [273, 122],
    [277, 1],
    [278, 1],
    [279, 1],
  ];
  const bytes = Buffer.alloc(123);
  bytes.write("II");
  bytes.writeUInt16LE(42, 2);
  bytes.writeUInt32LE(8, 4);
  bytes.writeUInt16LE(tags.length, 8);
  tags.forEach(([tag, number], index) => {
    const offset = 10 + index * 12;
    bytes.writeUInt16LE(tag, offset);
    bytes.writeUInt16LE([258, 259, 262, 277].includes(tag) ? 3 : 4, offset + 2);
    bytes.writeUInt32LE(1, offset + 4);
    bytes.writeUInt32LE(number, offset + 8);
  });
  bytes[122] = value;
  return bytes;
}
