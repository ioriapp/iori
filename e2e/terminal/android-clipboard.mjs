import assert from "node:assert/strict";
import { copyAndroidScreenshot } from "../../verification/native/android-clipboard.mjs";
import { linux, sh } from "../../verification/native/remote.mjs";
import { waitFor } from "../../verification/ui.mjs";
import { clearObserved, create, evaluateAsync, observed } from "./scenario.mjs";

export async function androidClipboardImage({
  client,
  host,
  record,
  shot,
  saveEvidence,
}) {
  const id = await create(client);
  const directory = `${host.dataHome}/iori-host/terminal-images/${id}`;
  const savedImages = () =>
    JSON.parse(
      linux(
        `sudo -u iori-dev -H node --input-type=module -e ${sh(`import {readdir,readFile} from 'node:fs/promises'; const directory=${JSON.stringify(directory)};const names=await readdir(directory).catch(e=>{if(e.code==='ENOENT')return [];throw e;});console.log(JSON.stringify(await Promise.all(names.filter(name=>name.endsWith('.png')).map(async name=>{const png=await readFile(directory+'/'+name);return {name,path:directory+'/'+name,png:png.subarray(0,8).toString('hex')==='89504e470d0a1a0a'};}))));`)}`,
      ),
    );
  await copyAndroidScreenshot(client, saveEvidence);
  await clearObserved(client);
  await client.screen.click('[data-iori-action="terminal-paste"]');
  const files = await waitFor(savedImages, (files) => files.length === 1);
  assert.equal(files[0].png, true);
  await observed(client, files[0].name);
  await shot(client, "android-clipboard-image");
  await record(
    "linux",
    "Android",
    "端末で撮った画像をChromeでコピーし、貼り付けでHostのPNGのパスが入力に入る",
  );
  // Read a PNG through the other input mode too, using the same real clipboard.
  await client.screen.click('[data-iori-action="terminal-input-live"]');
  await clearObserved(client);
  await client.screen.click('[data-iori-action="terminal-paste"]');
  const batchFiles = await waitFor(savedImages, (files) => files.length === 2);
  await observed(client, batchFiles[1].name);
  await shot(client, "android-clipboard-image-batch");
  const text = "clipboard文字入力";
  await evaluateAsync(
    client,
    `window.__TAURI__.core.invoke('native_clipboard_write',{text:${JSON.stringify(text)}}).then(()=>true)`,
  );
  await client.screen.click('[data-iori-action="terminal-paste"]');
  await waitFor(
    () => client.screen.value('[data-iori-field="terminal-batch-input"]'),
    (value) => value === text,
  );
  assert.equal(savedImages().length, 2);
  await shot(client, "android-clipboard-text");
  await record(
    "linux",
    "Android",
    "まとめて入力でも画像はTerminalへ渡り、文字は入力欄へ貼り付く",
  );
}
