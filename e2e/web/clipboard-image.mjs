import { fakeMarker } from "../fake-model/marker.mjs";
import { clipboardScripts } from "../fake-model/clipboard.mjs";
import {
  waitForOperation,
  cliFailure,
  observeCliCompletion,
} from "../../verification/web/operation.mjs";
import { submitToCli } from "../cli-screen/input.mjs";
import assert from "node:assert/strict";
import { openClaude } from "../cli-screen/claude-status.mjs";
import {
  controlKey,
  focusTerminal,
  finishCli,
  waitForCodexInput,
  waitForPiInput,
} from "../cli-screen/scenario.mjs";
import { observed, clearObserved, create } from "../terminal/scenario.mjs";
import { waitFor } from "../../verification/ui.mjs";

export async function clipboardImageScenario({
  client,
  clipboardFiles,
  fakeModelRequests,
  record,
  shot,
  cliId = "claude",
}) {
  const screen = client.screen;
  let id;
  if (cliId === "claude") id = await openClaude(client);
  else {
    await screen.click('[data-iori-action="workspace-add-tab"]');
    await screen.click(`[data-iori-cli-id="${cliId}"]`);
    await screen.wait(`[data-iori-tab-cli="${cliId}"]`);
    id = (
      await screen.attribute(
        `[data-iori-tab-cli="${cliId}"]`,
        "data-iori-tab-id",
      )
    ).replace(/^terminal:/u, "");
    await focusTerminal(client, id);
    if (cliId === "pi") await waitForPiInput(client, id);
    else await waitForCodexInput(client, id);
  }
  const put = async (text) =>
    screen.evaluate(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=200;
    const ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,320,200);
    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    await navigator.clipboard.write([new ClipboardItem({'image/png':png,${text ? `'text/plain':new Blob([${JSON.stringify(text)}],{type:'text/plain'})` : ""}})]);
    return true;
  })()`);
  await put("clipboard文字優先");
  await focusTerminal(client, id);
  await controlKey(client, "v");
  await observed(client, "clipboard文字優先");
  assert.equal((await clipboardFiles(id)).length, 0);
  await controlKey(client, "c");
  await clearObserved(client);
  await put();
  await focusTerminal(client, id);
  await controlKey(client, "v");
  const files = await waitForOperation(
    "clipboard-image: 画像がHostに保存される",
    () => clipboardFiles(id),
    (files) => files.length === 1,
    cliFailure(screen, id),
  );
  assert.equal(files[0].png, true);
  assert.equal(files[0].name, "1.png");
  await observed(
    client,
    cliId === "codex"
      ? /\[Image #1\]/u
      : new RegExp(
          `Image #1|${files[0].name.slice(-12).replace(".", "\\.")}`,
          "u",
        ),
  );
  await shot(`clipboard-${cliId}-input`);
  await record(
    "文字と画像があれば文字を優先し、画像だけならHostのPNGの絶対パスをCLIへ貼る（Enterは送らない）",
  );
  const marker = cliId === "pi" ? "clipboard-color-pi" : "clipboard-color";
  // Pi sends the pasted path as text; its real read tool supplies the image.
  if (fakeModelRequests && cliId === "pi")
    clipboardScripts[marker][0].input.path = files[0].path;
  const requestOffset = fakeModelRequests?.length;
  const completion = await observeCliCompletion(screen, id);
  await submitToCli(
    client,
    ` What color is this image? Reply with the color name only.${fakeMarker(marker)}`,
  );
  const answer = await waitForOperation(
    "clipboard-image: 画像の色の回答完了",
    completion.read,
    Boolean,
    cliFailure(screen, id),
  );
  await completion.stop();
  assert.match(
    answer.response,
    /^\s*(?:red|赤(?:色)?)[.!。]?\s*$/iu,
    `${cliId}の画像の色の回答`,
  );
  if (fakeModelRequests)
    assert.ok(
      fakeModelRequests
        .slice(requestOffset)
        .some(
          (request) =>
            request.marker === marker &&
            request.imageCount > 0 &&
            (cliId !== "pi" || request.step === 1),
        ),
      `${cliId}のモデル要求に貼り付けた画像が含まれる`,
    );
  await shot(`clipboard-${cliId}-response`);
  await record(
    `${cliId}は貼り付けた画像の赤色を回答する（検証用の安価なモデル）`,
  );
  await finishCli(client, id, cliId);
  await screen.contextMenu(`[data-iori-terminal-row="${id}"]`);
  await screen.click('[data-iori-action="terminal-close"]');
  await waitFor(
    () => clipboardFiles(id),
    (files) => files.length === 0,
  );
  await record("Terminalを閉じると貼り付けた画像を削除する");
}

export async function clipboardImageRestartScenario({
  client,
  clipboardFiles,
  restartHostLosingTerminals,
  record,
}) {
  const screen = client.screen;
  const id = await create(client);
  const put = (color) =>
    screen.evaluate(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=200;
    const context=canvas.getContext('2d');context.fillStyle=${JSON.stringify(color)};context.fillRect(0,0,320,200);
    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);
    return true;
  })()`);
  const paste = async (color) => {
    await put(color);
    await focusTerminal(client, id);
    await controlKey(client, "v");
    return waitForOperation(
      "Hostの再起動の後に前の画像の番号を使わない",
      () => clipboardFiles(id),
      (files) => files.length === 1,
      cliFailure(screen, id),
    );
  };

  const before = await paste("red");
  assert.equal(before[0].name, "1.png");
  await restartHostLosingTerminals({ terminalId: id });
  await screen.wait(
    `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
  );
  await screen.wait(
    `[data-iori-terminal-id="${id}"][data-iori-state="running"]`,
  );

  const after = await paste("blue");
  assert.equal(
    after[0].name,
    "2.png",
    "Hostの再起動の後に前の画像の番号を使わない",
  );
  assert.notEqual(after[0].path, before[0].path);
  await record("Hostの再起動の後に前の画像の番号を使わない");
}

export async function clipboardTransferScenario({
  client,
  terminalId,
  clipboardFiles,
  record,
}) {
  const screen = client.screen;
  // An ordinary screenshot can exceed one protocol frame. Use a PNG whose
  // compressed bytes actually require several requests, through the real clipboard.
  const size = await screen.evaluate(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=1100;
    const context=canvas.getContext('2d');const pixels=context.createImageData(canvas.width,canvas.height);
    for(let offset=0;offset<pixels.data.length;offset+=65536) crypto.getRandomValues(pixels.data.subarray(offset,offset+65536));
    for(let offset=3;offset<pixels.data.length;offset+=4) pixels.data[offset]=255;
    context.putImageData(pixels,0,0);
    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);
    // Chromium sanitizes/re-encodes PNG on clipboard write. Compare the
    // actual clipboard source with the Host file, not the earlier canvas encoding.
    return (await (await navigator.clipboard.read())[0].getType('image/png')).size;
  })()`);
  assert.ok(size > 4 * 1024 * 1024);
  await focusTerminal(client, terminalId);
  await screen.key("Control+Shift+v");
  const first = await waitForOperation(
    "clipboard-image: 4MBを超える画像がHostに保存される",
    () => clipboardFiles(terminalId),
    (files) => files.length === 1,
    cliFailure(screen, terminalId),
  );
  await observed(client, first[0].name);
  assert.equal(first[0].name, "1.png");
  assert.equal(first[0].size, size);
  await controlKey(client, "c");
  await screen.contextMenu(`[data-iori-terminal-id="${terminalId}"] .xterm`);
  await screen.click('[data-iori-action="terminal-paste-menu"]');
  const both = await waitForOperation(
    "clipboard-image: メニューから貼った2枚目の画像がHostに保存される",
    () => clipboardFiles(terminalId),
    (files) => files.length === 2,
    cliFailure(screen, terminalId),
  );
  for (const file of both) assert.equal(file.size, size);
  assert.deepEqual(both.map((file) => file.name).sort(), ["1.png", "2.png"]);
  await observed(client, both.find((file) => file.name !== first[0].name).name);
  await record(
    "4MiBを超えるPNGをCtrl+Shift+Vとメニューの貼り付けで分割転送し、shellへパスだけ入力する",
  );
  await controlKey(client, "c");
  await screen.contextMenu(`[data-iori-terminal-row="${terminalId}"]`);
  await screen.click('[data-iori-action="terminal-close"]');
  await waitFor(
    () => clipboardFiles(terminalId),
    (files) => files.length === 0,
  );
  await record("Terminalの閉じる操作で複数の一時画像をまとめて回収する");
}

// Keep the three real CLIs and the multi-frame transfer together on one Host.
export async function clipboardScenarios({
  client,
  clipboardFiles,
  fakeModelRequests,
  record,
  shot,
}) {
  for (const cliId of ["claude", "codex", "pi"])
    await clipboardImageScenario({
      client,
      clipboardFiles,
      fakeModelRequests,
      record,
      shot,
      cliId,
    });
  const terminalId = await create(client);
  await clipboardTransferScenario({
    client,
    terminalId,
    clipboardFiles,
    record,
  });
}
