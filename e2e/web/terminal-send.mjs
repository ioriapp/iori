import {
  waitForOperation,
  cliFailure,
} from "../../verification/web/operation.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  observed,
  clearObserved,
  typeTerminal,
  open,
} from "../terminal/scenario.mjs";
import { waitFor } from "../../verification/ui.mjs";

export async function terminalSend({
  client,
  record,
  worktree,
  clipboardFiles,
}) {
  const { screen } = client;
  await closeWhileOpening(client, record);
  const pane = '[data-iori-view="terminal"][data-iori-displayed="true"]';
  const terminalId = await screen.attribute(pane, "data-iori-terminal-id");
  const viewport = await screen.evaluate(
    "({width:innerWidth,height:innerHeight})",
  );
  const capture = async (file) => {
    const program = [
      "import os,tty,termios,hashlib,json",
      "fd=0; old=termios.tcgetattr(fd); tty.setraw(fd)",
      "print('\\r\\nSEND_'+'READY',flush=True)",
      "data=b''",
      "while not data.endswith(b'\\r'): data+=os.read(fd,65536)",
      "termios.tcsetattr(fd,termios.TCSANOW,old)",
      `open(${JSON.stringify(file)},'w').write(json.dumps({'bytes':len(data)-1,'sha256':hashlib.sha256(data[:-1]).hexdigest()}))`,
      "print('\\r\\nSEND_'+'DONE',flush=True)",
    ].join("\n");
    await clearObserved(client);
    await typeTerminal(
      client,
      `python3 -c '${`exec(${JSON.stringify(program)})`.replaceAll("'", "'\\''")}'\r`,
    );
    await observed(client, "SEND_READY");
  };
  const expectCapture = async (file, text) => {
    const value = await waitFor(async () => {
      try {
        const contents = await readFile(file, "utf8");
        return contents ? JSON.parse(contents) : null;
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    });
    assert.deepEqual(value, {
      bytes: Buffer.byteLength(text),
      sha256: createHash("sha256").update(text).digest("hex"),
    });
  };
  const openingText = "開き直す間の貼り付け";
  const openingFile = join(worktree, "terminal-opening-input.json");
  await capture(openingFile);
  // Paste at the actual opening boundary, without replacing native methods or
  // holding a promise. MutationObserver only chooses the user's paste timing.
  await screen.evaluate(`(()=>{
    window.__openingPaste=false;
    const observer=new MutationObserver(()=>{
      const pane=document.querySelector('[data-iori-terminal-id="${terminalId}"]');
      if(pane?.dataset.ioriStreamState!=='opening')return;
      const field=pane.querySelector('[data-iori-field="terminal-input"]');
      if(!field)return;
      observer.disconnect();
      const clipboardData=new DataTransfer();clipboardData.setData('text/plain',${JSON.stringify(openingText)});
      field.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));
      window.__openingPaste=true;
    });
    observer.observe(document.body,{attributes:true,childList:true,subtree:true});
    return true;
  })()`);
  try {
    await client.browser.call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitFor(() => screen.evaluate("window.__openingPaste"));
    await screen.wait(
      '[data-iori-view="terminal"][data-iori-stream-state="ready"]',
    );
    await typeTerminal(client, "\r");
    await expectCapture(openingFile, openingText);
  } finally {
    await client.browser.call("Emulation.setDeviceMetricsOverride", {
      ...viewport,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.browser.call("Emulation.clearDeviceMetricsOverride");
  }
  await screen.wait(".dock-tab-header");
  await open(client, terminalId);
  await record(
    "実際のstream開通待ちに貼り付けた日本語が欠けも重複もなく実PTYへ届く",
  );
  const hiddenFile = join(worktree, "terminal-hidden-input.json");
  await capture(hiddenFile);
  const payload = "日本語-0123456789".repeat(65536);
  await screen.evaluate(`(()=>{
    const pane=document.querySelector(${JSON.stringify(pane)});
    const field=pane.querySelector('[data-iori-field="terminal-input"]');
    const clipboardData=new DataTransfer();clipboardData.setData('text/plain',${JSON.stringify(payload + "\r")});
    field.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));
    document.querySelector('.dock-tab-header:has([data-iori-tab-id="terminal:${terminalId}"]) [data-iori-action="workspace-close-tab"]').click();
    return true;
  })()`);
  await expectCapture(hiddenFile, payload);
  await open(client, terminalId);
  await record("長い貼り付け直後にタブを閉じても全入力が一度だけ実PTYへ届く");
  const imageFile = join(worktree, "terminal-image-input.json");
  await capture(imageFile);
  await screen.evaluate(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=200;
    canvas.getContext('2d').fillRect(0,0,320,200);
    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);
    return true;
  })()`);
  await screen.evaluate(`(()=>{
    const pane=document.querySelector(${JSON.stringify(pane)});
    const field=pane.querySelector('[data-iori-field="terminal-input"]');field.focus();
    field.dispatchEvent(new KeyboardEvent('keydown',{key:'v',code:'KeyV',ctrlKey:true,bubbles:true,cancelable:true}));
    const clipboardData=new DataTransfer();clipboardData.setData('text/plain','\\r');
    field.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));
    document.querySelector('.dock-tab-header:has([data-iori-tab-id="terminal:${terminalId}"]) [data-iori-action="workspace-close-tab"]').click();
    return true;
  })()`);
  const images = await waitForOperation(
    "terminal-send: 送った画像がHostに保存される",
    () => clipboardFiles(terminalId),
    (files) => files.length === 1,
    cliFailure(screen, terminalId),
  );
  await expectCapture(imageFile, images[0].path + " ");
  await open(client, terminalId);
  await record(
    "画像のアップロード中にタブを閉じても画像のパスと後続のEnterが順に実PTYへ届く",
  );
}

// Closing a newly opened tab without typing still has to retire its stream.
// Observe real open/detach calls only to choose the user's close timing: no
// response or promise is held, and the actual ended event proves retirement.
async function closeWhileOpening(client, record) {
  const { screen } = client;
  const originalTerminal = await screen.attribute(
    '[data-iori-view="terminal"][data-iori-displayed="true"]',
    "data-iori-terminal-id",
  );
  await screen.evaluate(`(async()=>{
    const {native}=await import('/src/native.ts');
    const open=native.terminalOpen;
    window.__openingClose={};
    const state=window.__openingClose;
    native.terminalOpen=function(connection,stream,json){
      const opening=open.call(this,connection,stream,json);
      if(state.stream)return opening;
      state.stream=stream;
      state.terminal=JSON.parse(json).terminalId;
      const close=document.querySelector('.dock-tab-header:has([data-iori-tab-id="terminal:'+state.terminal+'"]) [data-iori-action="workspace-close-tab"]');
      state.closed=Boolean(close);close?.click();
      return opening.finally(()=>{state.openSettled=true;});
    };
    window.__openingCloseStop=()=>{native.terminalOpen=open;};
    return true;
  })()`);
  try {
    await screen.click('[data-iori-action="workspace-add-tab"]');
    await screen.click(
      '[data-slot="popover-content"] button[data-iori-shell-id], [data-iori-view="shell-picker"] button[data-iori-shell-id]',
    );
    const state = await waitFor(
      () => screen.evaluate("window.__openingClose"),
      (state) => state.openSettled,
    );
    assert.equal(state.closed, true);
    await waitFor(() =>
      screen.evaluate(
        "window.__terminalObservation.endedStreams.includes(window.__openingClose.stream)",
      ),
    );
    await open(client, originalTerminal);
  } finally {
    await screen.evaluate("(()=>{window.__openingCloseStop();return true;})()");
  }
  await record(
    "初回の開通中に入力せずタブを閉じても、登録後にstreamを閉じて終了通知を受け取る",
  );
}
