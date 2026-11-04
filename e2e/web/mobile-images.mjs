import { fakeMarker } from "../fake-model/marker.mjs";
import {
  waitForOperation,
  cliFailure,
} from "../../verification/web/operation.mjs";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openClaude } from "../cli-screen/claude-status.mjs";
import { finishCli } from "../cli-screen/scenario.mjs";
import { observe, observed, open } from "../terminal/scenario.mjs";
import { waitFor } from "../../verification/ui.mjs";

export async function mobileImages({
  fakeModelRequests,
  client,
  mobile,
  clipboardFiles,
  record,
  shot,
}) {
  const screen = client.screen;
  const id = await openClaude(client);
  await screen.click(
    `.dock-tab-header:has([data-iori-tab-id="terminal:${id}"]) [data-iori-action="workspace-close-tab"]`,
  );
  await mobile();
  await screen.wait('[data-iori-view="workspace"]');
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  await open(client, id);
  const pane = `[data-iori-terminal-id="${id}"]`;
  const batch = `${pane} [data-iori-field="terminal-batch-input"]`;
  await screen.wait(batch);
  const directory = await mkdtemp(join(tmpdir(), "iori-mobile-images-"));
  try {
    const paths = [];
    const originals = [];
    for (const [extension, color] of [
      ["jpeg", "red"],
      ["png", "blue"],
    ]) {
      // A detailed phone-sized image exercises the CLI's asynchronous image loading.
      const data = await screen.evaluate(`(()=>{
        const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=2400;
        const ctx=canvas.getContext('2d');
        const pixels=ctx.createImageData(canvas.width,canvas.height);
        let seed=1;
        for(let i=0;i<pixels.data.length;i+=4){
          seed=(Math.imul(seed,1664525)+1013904223)>>>0;
          const noise=seed>>>26;
          pixels.data[i]=${JSON.stringify(color)}==='red'?220-noise:30+noise;
          pixels.data[i+1]=30+noise;
          pixels.data[i+2]=${JSON.stringify(color)}==='blue'?220-noise:30+noise;
          pixels.data[i+3]=255;
        }
        ctx.putImageData(pixels,0,0);
        return canvas.toDataURL('image/${extension}').split(',')[1];
      })()`);
      const file = join(directory, `photo.${extension}`);
      const bytes = Buffer.from(data, "base64");
      if (extension === "png") assert.ok(bytes.length > 1024 * 1024);
      await writeFile(file, bytes);
      originals.push(bytes);
      paths.push(file);
    }
    await client.browser.call("Page.setInterceptFileChooserDialog", {
      enabled: true,
    });
    try {
      await screen.click(`${pane} [data-iori-action="terminal-images"]`);
      const { root } = await client.browser.call("DOM.getDocument");
      const { nodeId } = await client.browser.call("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: `${pane} [data-iori-field="terminal-images"]`,
      });
      await client.browser.call("DOM.setFileInputFiles", {
        nodeId,
        files: paths,
      });
    } finally {
      await client.browser.call("Page.setInterceptFileChooserDialog", {
        enabled: false,
      });
    }
    const files = await waitForOperation(
      "mobile-images: スマホで選んだ画像2枚がHostに保存される",
      () => clipboardFiles(id),
      (files) => files.length === 2,
      cliFailure(screen, id),
    );
    files.sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(
      files.map((file) => file.name),
      ["1.jpg", "2.png"],
    );
    for (let index = 0; index < files.length; index++) {
      assert.equal(
        (await readFile(files[index].path)).equals(originals[index]),
        true,
      );
    }
    await observed(client, /\[Image #1\][\s\S]*\[Image #2\]/u);
    assert.equal(await screen.value(batch), "");
    await screen.input(
      batch,
      "What colors are these two images? Reply with the two color names only." +
        fakeMarker("mobile-images"),
    );
    await shot("mobile-images-input");
    await record(
      "Mobileの画像ボタンで実寸のJPEGと1MB超のPNGを選び、元のbytesと形式でHostに保存し、CLIへ画像の参照を入れてから文を書く",
    );
    await screen.click(`${pane} [data-iori-action="terminal-batch-send"]`);
    await observed(
      client,
      /\b[Rr]ed\b[\s\S]*\b[Bb]lue\b|\b[Bb]lue\b[\s\S]*\b[Rr]ed\b|赤[\s\S]*青|青[\s\S]*赤/u,
      undefined,
      "observe",
      cliFailure(screen, id),
    );
    if (fakeModelRequests)
      assert.ok(
        fakeModelRequests.some(
          (request) =>
            request.marker === "mobile-images" &&
            request.step === 0 &&
            request.imageCount >= 2,
        ),
        "選んだ2枚の画像がモデル要求に含まれる",
      );
    await shot("mobile-images-response");
    await record(
      "Claude Codeの安価なモデルが選んだ2枚の画像を読み、赤と青を回答する",
    );
    await finishCli(client, id, "claude");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
