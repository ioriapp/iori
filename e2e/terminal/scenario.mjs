import {
  openSidebar as openSidebarScreen,
  closeSidebar,
} from "../connection/scenario.mjs";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { waitForOperation, waitFor } from "../../verification/ui.mjs";
import { TerminalScreenObservation } from "../../verification/terminal/screen-observation.ts";

const input = '[data-iori-field="terminal-input"]';
const pane = '[data-iori-view="terminal"]';
// Tabs keep other Terminals mounted but hidden; act on the one on screen.
const shownPane = `(()=>{const panes=[...document.querySelectorAll(${JSON.stringify(pane)})].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';});return panes.find(e=>e.contains(document.activeElement))??panes[0];})()`;
// Output of the shown view's own stream; other retained views also stream.
const shownTail = `(window.__terminalObservation?.tails[${shownPane}?.getAttribute('data-iori-stream-id')]??'')`;
const action = (name) => `[data-iori-action=${JSON.stringify(name)}]`;
const row = (id) => `[data-iori-terminal-row=${JSON.stringify(id)}]`;
export const evaluateAsync = (client, expression) =>
  client.browser.evaluateAsync
    ? client.browser.evaluateAsync(expression)
    : client.browser.evaluate(expression);

const screenObservations = new WeakMap();

const runPhase = (phase, name, action) =>
  phase ? phase(name, action) : action();

// Observe the real native-to-WebView feed; the product has no text mirror or test globals.
export async function observe(
  client,
  listen = "window.__TAURI__.event.listen",
) {
  screenObservations.get(client)?.dispose();
  screenObservations.set(client, new TerminalScreenObservation());
  await evaluateAsync(
    client,
    `(async()=>{
      if(window.__terminalObservationStop)window.__terminalObservationStop();
      // Each retained Terminal View keeps its stream, so output is kept per
      // stream: a flooding Terminal must not push another one's output out.
      window.__terminalObservation={tails:{},streams:{},screenFrames:[],snapshots:0,frames:0,lastKind:null,endedStreams:[]};
      Object.defineProperty(window.__terminalObservation,'tail',{
        get(){return Object.values(this.tails).join('\\n');},
        set(value){if(value==='')this.tails={};},
      });
      const stopFrames=await ${listen}('native://terminal-frame',({payload})=>{
        const o=window.__terminalObservation;
        const f=JSON.parse(payload.json);
        if(['terminal.snapshot','terminal.output','terminal.size'].includes(f.kind))o.screenFrames.push({streamId:payload.streamId,frame:f});
        const known=['terminal.snapshot','terminal.output','terminal.exit','terminal.error','terminal.size','terminal.closed'];
        if(o.renderFrames&&['terminal.snapshot','terminal.output','terminal.size'].includes(f.kind))o.renderFrames.push({...f,streamId:payload.streamId});
        o.frames++;
        o.lastKind=known.includes(f.kind)?f.kind:'other';
        const stream=o.streams[payload.streamId]??={frames:0,snapshots:0,lastKind:null};
        stream.frames++;
        stream.lastKind=o.lastKind;
        if(f.kind==='terminal.snapshot')stream.snapshots++;
        let text='';
        if(f.kind==='terminal.output'&&typeof f.data==='string')text=f.data;
        if(f.kind==='terminal.snapshot'&&f.snapshot){
          o.snapshots++;
          text=[f.snapshot.scrollbackAnsi,f.snapshot.snapshotAnsi,f.snapshot.frameRestoreAnsi,f.snapshot.pendingEscapeTailAnsi].filter(value=>typeof value==='string').join('');
        }
        o.tails[payload.streamId]=((o.tails[payload.streamId]??'')+text).slice(-524288);
      });
      const stopEnds=await ${listen}('native://terminal-ended',({payload})=>{
        window.__terminalObservation.endedStreams.push(payload.streamId);
      });
      window.__terminalObservationStop=()=>{stopFrames();stopEnds();};
      return true;
    })()`,
  );
}
export async function beginRenderObservation(client) {
  await client.screen.evaluate("window.__terminalObservation.renderFrames=[]");
}

// Every retained Terminal View streams, so keep the shown view's own frames.
export async function observedRenderFrames(client, terminalId) {
  return client.screen.evaluate(`(()=>{
    const pane=${terminalId ? `document.querySelector(${JSON.stringify(`[data-iori-terminal-id="${terminalId}"]`)})` : shownPane};
    const stream=pane?.getAttribute('data-iori-stream-id');
    return window.__terminalObservation.renderFrames.filter(f=>f.streamId===stream);
  })()`);
}
export async function terminalState(client) {
  return client.screen.evaluate(`(()=>{
    const pane=${shownPane};
    const observation=window.__terminalObservation;
    return {
      connected:Boolean(document.querySelector('[data-iori-state="connected"]')),
      panePresent:Boolean(pane),
      terminalRows:[...document.querySelectorAll('[data-iori-terminal-row]')].map(e=>e.getAttribute('data-iori-terminal-row')),
      startScreenPresent:Boolean(document.querySelector('[data-iori-view="workspace-start"]')),
      terminalState:pane?.getAttribute('data-iori-state')??null,
      terminalId:pane?.getAttribute('data-iori-terminal-id')??null,
      createdTerminalId:${JSON.stringify(client.lastCreatedTerminalId ?? null)},
      rows:pane?.getAttribute('data-iori-rows')??null,
      cols:pane?.getAttribute('data-iori-cols')??null,
      desktopWidth:pane?.querySelector('[data-iori-action="terminal-width-toggle"]')?.getAttribute('aria-pressed')??null,
      innerWidth,
      mountedPanes:[...document.querySelectorAll('[data-iori-view="terminal"]')].map((item)=>({
        terminalId:item.getAttribute('data-iori-terminal-id'),
        streamId:item.getAttribute('data-iori-stream-id'),
        streamState:item.getAttribute('data-iori-stream-state'),
        displayed:item.getAttribute('data-iori-displayed'),
        cols:item.getAttribute('data-iori-cols'),
        width:item.offsetWidth,
        hidden:Boolean(item.closest('[hidden]')),
        received:observation?.streams?.[item.getAttribute('data-iori-stream-id')]??null
      })),
      streamState:pane?.getAttribute('data-iori-stream-state')??null,
      inputPresent:Boolean(pane?.querySelector(${JSON.stringify(input)})),
      focused:document.activeElement?.getAttribute('data-iori-field')??document.activeElement?.getAttribute('data-iori-action')??document.activeElement?.tagName??null,
      frames:observation?.frames??0,
      snapshots:observation?.snapshots??0,
      lastFrameKind:observation?.lastKind??null,
      observedTailCharacters:observation?.tail?.length??0
    };
  })()`);
}
async function readObservedScreen(client) {
  const received = await client.screen.evaluate(`(()=>{
    const observation=window.__terminalObservation;
    return {stream:${shownPane}?.getAttribute('data-iori-stream-id'),frames:observation?.screenFrames.splice(0)??[]};
  })()`);
  const observer = screenObservations.get(client);
  if (!observer) throw new Error("Terminalの画面の観測器が開始されていません");
  for (const { streamId, frame } of received.frames)
    await observer.apply(streamId, frame);
  return observer.text(received.stream);
}
export async function observed(
  client,
  text,
  phase,
  prefix = "observe",
  failed,
) {
  const matches = (output) =>
    text instanceof RegExp
      ? text.test(output)
      : output.replace(/\s+/gu, " ").includes(text.replace(/\s+/gu, " "));
  const until = failed
    ? (read, predicate, _milliseconds, observation) =>
        waitForOperation(observation, read, predicate, failed)
    : waitFor;
  await runPhase(phase, `${prefix}/wait-for-output`, () =>
    until(
      async () => matches(await readObservedScreen(client)),
      Boolean,
      undefined,
      "Terminalの画面の文字の観測",
    ),
  );
}

// Inspect the latest parsed screen, rather than lines that appeared earlier
// and may already have been erased by a CLI repaint. Reuse received frames.
export async function observedCurrentScreen(client, terminalId, text, failed) {
  const until = failed
    ? (read, predicate, _milliseconds, observation) =>
        waitForOperation(observation, read, predicate, failed)
    : waitFor;
  return until(
    async () => {
      await readObservedScreen(client);
      const stream = await client.screen.evaluate(
        `document.querySelector('[data-iori-terminal-id="${terminalId}"]')?.getAttribute('data-iori-stream-id')`,
      );
      const observer = screenObservations.get(client);
      return text.test(observer.currentText(stream))
        ? observer.snapshot(stream)
        : undefined;
    },
    Boolean,
    undefined,
    "現在のTerminal画面の文字の観測",
  );
}
// Terminal protocol modes are not visible text. Use the same real frame parser
// as text observation rather than looking for escape bytes in rendered rows.
export async function observedTerminalMode(client, mode, value) {
  await waitFor(
    async () => {
      await readObservedScreen(client);
      const stream = await client.screen.evaluate(
        `${shownPane}?.getAttribute('data-iori-stream-id')`,
      );
      return screenObservations.get(client).modes(stream)?.[mode] === value;
    },
    Boolean,
    undefined,
    `Terminalの${mode}モードの観測`,
  );
}
export async function clearObserved(
  client,
  phase,
  prefix = "clear-observation",
) {
  await runPhase(phase, prefix, async () => {
    // Apply everything already received before taking the next observation's baseline.
    await readObservedScreen(client);
    screenObservations.get(client).clear();
    await client.screen.evaluate("window.__terminalObservation.tail=''");
  });
}

export async function typeTerminal(
  client,
  text,
  phase,
  prefix = "type",
  { ready = true, focus = true } = {},
) {
  // The input follows the cursor, which can sit beyond a phone screen while
  // the PC's width is shown; it only has to belong to the shown Terminal.
  await runPhase(phase, `${prefix}/input-present`, () =>
    waitFor(() =>
      client.screen.evaluate(
        `Boolean(${shownPane}?.querySelector(${JSON.stringify(input)}))`,
      ),
    ),
  );
  if (ready)
    await runPhase(phase, `${prefix}/stream-ready`, () =>
      waitFor(() =>
        client.screen.evaluate(
          `${shownPane}?.getAttribute('data-iori-stream-state')==='ready'`,
        ),
      ),
    );
  // `focus: false` types where the product left the focus: what a user gets
  // right after opening or creating the Terminal.
  if (focus)
    await runPhase(phase, `${prefix}/focus`, () =>
      client.screen.evaluate(
        `${shownPane}.querySelector(${JSON.stringify(input)}).focus()`,
      ),
    );
  await runPhase(phase, `${prefix}/send-keys`, async () => {
    // A pane change also claims the PTY size/focus. Let that gesture settle
    // before typing; otherwise the first shell character can be lost.
    await new Promise((resolve) => setTimeout(resolve, 200));
    for (const character of text) {
      if (client.browser.webdriver) {
        const key = character === "\r" ? "\uE007" : character;
        await client.browser.call("actions", {
          actions: [
            {
              type: "key",
              id: "terminal-keyboard",
              actions: [
                { type: "keyDown", value: key },
                { type: "keyUp", value: key },
              ],
            },
          ],
        });
      } else if (character === "\r") {
        await client.browser.call("Input.dispatchKeyEvent", {
          type: "rawKeyDown",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        });
        await client.browser.call("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        });
      } else {
        await client.browser.call("Input.insertText", { text: character });
      }
    }
  });
}
async function openSidebar(client) {
  await openSidebarScreen(client.screen);
}
const sidebarCollapsed = (client) =>
  client.screen.evaluate(
    "Boolean(document.querySelector('[data-slot=sidebar][data-state=collapsed]'))",
  );
async function terminalRows(client) {
  return client.screen.evaluate(
    "JSON.stringify([...document.querySelectorAll('[data-iori-terminal-row]')].map(e=>e.getAttribute('data-iori-terminal-row')))",
  );
}
// A new Terminal starts with the Host's default shell in the opened folder:
// from the start screen, or from "New tab" (the tab bar, or the Mobile row).
export async function create(client) {
  const shownId = () =>
    client.screen.evaluate(
      `${shownPane}?.getAttribute('data-iori-terminal-id')??''`,
    );
  // Mobile keeps the sidebar rows only while the drawer is open, so the new
  // Terminal is also recognized as the View that replaces the shown one.
  const mobile = await client.screen.visible(
    '[data-iori-part="mobile-location"]',
  );
  const before = new Set([
    ...JSON.parse(await terminalRows(client)),
    ...(await client.screen.evaluate(
      `[...document.querySelectorAll(${JSON.stringify(pane)})].map(e=>e.getAttribute('data-iori-terminal-id'))`,
    )),
  ]);
  const start = '[data-iori-view="workspace-start"] button[data-iori-shell-id]';
  if (await client.screen.visible(start)) await client.screen.click(start);
  else {
    await client.screen.click(action("workspace-add-tab"));
    await client.screen.click(
      '[data-slot="popover-content"] button[data-iori-shell-id], [data-iori-view="shell-picker"] button[data-iori-shell-id]',
    );
  }
  const id = await waitFor(async () => {
    const shown = await shownId();
    if (mobile) return shown && !before.has(shown) ? shown : undefined;
    return (
      JSON.parse(await terminalRows(client)).find(
        (item) => !before.has(item),
      ) || (shown && !before.has(shown) ? shown : undefined)
    );
  });
  client.lastCreatedTerminalId = id;
  await client.screen.wait(
    `[data-iori-view="terminal"][data-iori-terminal-id=${JSON.stringify(id)}][data-iori-stream-state="ready"]`,
  );
  await waitFor(() =>
    client.screen.evaluate(
      `${shownPane}?.getAttribute('data-iori-terminal-id')===${JSON.stringify(id)}&&${shownPane}?.getAttribute('data-iori-state')==='running'`,
    ),
  );
  return id;
}
export async function open(
  client,
  id,
  phase,
  prefix = "open",
  { ready = true } = {},
) {
  // A restarted Client can already show the Terminal; selecting it again
  // changes nothing for the user.
  const shown = await client.screen.evaluate(
    `${shownPane}?.getAttribute('data-iori-terminal-id')===${JSON.stringify(id)}`,
  );
  if (!shown) {
    await runPhase(phase, `${prefix}/open-sidebar`, () => openSidebar(client));
    await runPhase(phase, `${prefix}/select-terminal`, () =>
      client.screen.click(row(id)),
    );
    // The closing drawer returns focus to its trigger; type after it is gone.
    await runPhase(phase, `${prefix}/drawer-closed`, () =>
      waitFor(() =>
        client.screen.evaluate(
          "!document.querySelector('[data-sidebar=sidebar][data-mobile=true]')",
        ),
      ),
    );
  }
  await runPhase(phase, `${prefix}/pane-visible`, () =>
    waitFor(() =>
      client.screen.evaluate(
        `${shownPane}?.getAttribute('data-iori-terminal-id')===${JSON.stringify(id)}`,
      ),
    ),
  );
  if (ready)
    await runPhase(phase, `${prefix}/stream-ready`, () =>
      client.screen.wait(
        '[data-iori-view="terminal"][data-iori-stream-state="ready"]',
      ),
    );
  // Whether it was opened from the sidebar, rather than already shown.
  return !shown;
}
// "Close" ends the Terminal from its sidebar row: the right-click menu on PC,
// or a long press in the phone's drawer.
export async function requestClose(client, id) {
  await openSidebar(client);
  if (client.browser.webdriver) await client.screen.contextMenu(row(id));
  else await client.screen.longPress(row(id));
  await client.screen.click(
    '[data-slot="context-menu-content"] ' + action("terminal-close"),
  );
}
export async function closedRow(client, id) {
  await waitFor(async () => !(await client.screen.visible(row(id))));
  await waitFor(() =>
    client.screen.evaluate(
      `!document.querySelector(${JSON.stringify(row(id))})`,
    ),
  );
  // The phone closed it from the drawer; go back to the work surface.
  const drawer = '[data-sidebar="sidebar"][data-mobile="true"]';
  if (await client.screen.visible(drawer)) {
    await client.screen.key("Escape");
    await waitFor(() =>
      client.screen.evaluate(
        `!document.querySelector(${JSON.stringify(drawer)})`,
      ),
    );
  }
}
async function interrupt(client) {
  // Ctrl+C goes to the shown Terminal, as typing does.
  await client.screen.evaluate(
    `${shownPane}.querySelector(${JSON.stringify(input)}).focus()`,
  );
  if (client.browser.webdriver) {
    await client.browser.call("actions", {
      actions: [
        {
          type: "key",
          id: "terminal-keyboard",
          actions: [
            { type: "keyDown", value: "\uE009" },
            { type: "keyDown", value: "c" },
            { type: "keyUp", value: "c" },
            { type: "keyUp", value: "\uE009" },
          ],
        },
      ],
    });
  } else {
    await client.browser.call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "c",
      code: "KeyC",
      windowsVirtualKeyCode: 67,
      modifiers: 2,
    });
    await client.browser.call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "c",
      code: "KeyC",
      windowsVirtualKeyCode: 67,
      modifiers: 2,
    });
  }
}
export async function clipboardPaste(client, os) {
  try {
    await evaluateAsync(
      client,
      `(async()=>{window.__terminalClipboardBefore=await window.__TAURI__.core.invoke('native_clipboard_read');return true})()`,
    );
  } catch {
    // A non-text clipboard cannot be preserved with a text-only plugin; leave it intact.
    return false;
  }
  try {
    const command = say(os, "clipboard入力").slice(0, -1);
    await clearObserved(client);
    await evaluateAsync(
      client,
      `window.__TAURI__.core.invoke('native_clipboard_write',{text:${JSON.stringify(command)}}).then(()=>true)`,
    );
    if (client.browser.webdriver) {
      await client.browser.call("actions", {
        actions: [
          {
            type: "key",
            id: "terminal-keyboard",
            actions: [
              { type: "keyDown", value: "\uE009" },
              { type: "keyDown", value: "v" },
              { type: "keyUp", value: "v" },
              { type: "keyUp", value: "\uE009" },
            ],
          },
        ],
      });
    } else {
      await client.screen.click('[data-iori-action="terminal-paste"]');
    }
    await observed(client, os === "linux" ? "printf" : "Write-Output");
    await typeTerminal(client, "\r");
    await observed(client, "clipboard入力");
    return true;
  } finally {
    await evaluateAsync(
      client,
      `(async()=>{await window.__TAURI__.core.invoke('native_clipboard_write',{text:window.__terminalClipboardBefore});delete window.__terminalClipboardBefore;return true})()`,
    );
  }
}
export const say = (os, text) => {
  // The expected output is absent from the command's echo, so an echo cannot pass the check.
  const characters = [...text];
  const first = characters.slice(0, Math.floor(characters.length / 2)).join("");
  const second = characters.slice(Math.floor(characters.length / 2)).join("");
  return os === "linux"
    ? `printf '\\n%s%s\\n' '${first}' '${second}'\r`
    : `Write-Output ('${first}'+'${second}')\r`;
};

async function captureAppearance(os, clients, shot) {
  // Exercise the real ANSI palette in each theme, without changing OS settings.
  await typeTerminal(
    clients.at(-1),
    (os === "linux"
      ? 'for i in {30..37} {90..97}; do printf \'\\033[%sm%s\\033[0m \' "$i" "$i"; done; echo; '
      : '(30..37)+(90..97)|%{Write-Host ("$([char]27)[$($_)m$_$([char]27)[0m ") -NoNewline};Write-Host; ') +
      say(os, "palette-complete"),
  );
  for (const client of clients) await observed(client, "palette-complete");
  for (const client of clients) {
    const wasDark = await client.screen.evaluate(
      "document.documentElement.classList.contains('dark')",
    );
    try {
      for (const theme of ["light", "dark"]) {
        await evaluateAsync(
          client,
          `(async()=>{document.documentElement.classList.toggle('dark',${theme === "dark"});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;})()`,
        );
        await shot(
          client,
          `${os}-${client.browser.webdriver ? "windows" : "android"}-appearance-${theme}`,
        );
      }
    } finally {
      await client.screen.evaluate(
        `document.documentElement.classList.toggle('dark',${wasDark})`,
      );
    }
  }
}

// The phone's on-screen keyboard shrinks the page instead of sliding it up:
// the location row stays on screen, the key band sits on the keyboard, and the
// line being typed is visible. A finger tap on the live Terminal's own screen
// focuses it and opens the keyboard; a swipe does not. The batch input field
// opens it too.
async function softKeyboard(os, client, shot) {
  const setLive = async (live) => {
    const toggle = `[data-iori-action="${live ? "terminal-input-batch" : "terminal-input-live"}"]`;
    if (await client.screen.visible(toggle)) await client.screen.click(toggle);
  };
  const layout = () =>
    client.screen.evaluate(`(()=>{
      const pane=${shownPane};
      const rect=(selector,root=document)=>{const e=root.querySelector(selector);if(!e)return null;const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom};};
      const batch=pane?.querySelector('[data-iori-field="terminal-batch-input"]');
      const field=(batch??pane?.querySelector(${JSON.stringify(input)}))?.getBoundingClientRect();
      const view=(batch?pane?.querySelector('[data-iori-panel="terminal-mobile-controls"]'):pane?.querySelector('[data-iori-part="terminal-viewport"]'))?.getBoundingClientRect();
      return {
        height:innerHeight,
        scrolled:Math.max(scrollY,visualViewport.offsetTop),
        row:rect('[data-iori-part="mobile-location"]'),
        band:rect('[data-iori-panel="terminal-mobile-controls"]',pane),
        field:field&&{top:field.top,bottom:field.bottom},
        view:view&&{top:view.top,bottom:view.bottom}
      };
    })()`);
  const centerOf = (selector) =>
    client.screen.evaluate(`(()=>{
      const r=${shownPane}.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
    })()`);
  const assertOpen = (open) => {
    assert.equal(open.scrolled, 0, "the page slid up instead of shrinking");
    assert.equal(
      open.row.top >= 0 && open.row.bottom <= open.height,
      true,
      `location row left the screen: ${JSON.stringify(open.row)}`,
    );
    // Only the one-line connection strip sits between the key band and the keyboard.
    assert.equal(
      open.band.bottom <= open.height && open.band.bottom >= open.height - 60,
      true,
      `key band is not just above the keyboard: ${JSON.stringify(open.band)} of ${open.height}`,
    );
    assert.equal(
      open.field.top >= open.view.top && open.field.bottom <= open.view.bottom,
      true,
      `the typing line is not visible: ${JSON.stringify(open.field)} in ${JSON.stringify(open.view)}`,
    );
  };
  const keyboardOpened = (before) =>
    waitFor(async () => {
      const now = await layout();
      // The Terminal fits its rows to the shrunk page a moment after the page
      // shrinks, so the line being typed is checked once the fit has happened.
      return now.height < before.height - 200 &&
        now.field.top >= now.view.top &&
        now.field.bottom <= now.view.bottom
        ? now
        : undefined;
    });
  const keyboardClosed = (before) =>
    waitFor(async () => (await layout()).height >= before.height - 20);

  // Live input: a swipe leaves the keyboard closed, a tap opens it and the
  // typed characters arrive, and a tap opens it again after Back.
  await setLive(true);
  const liveBefore = await layout();
  const screenPoint = await centerOf(".xterm-screen");
  await client.screen.evaluate(`(()=>{
    window.__terminalFocusEvents=0;
    window.__terminalBlurEvents=0;
    const field=${shownPane}.querySelector(${JSON.stringify(input)});
    field.addEventListener('focus',()=>{window.__terminalFocusEvents+=1;});
    field.addEventListener('blur',()=>{window.__terminalBlurEvents+=1;});
    return true;
  })()`);
  await client.nativeSwipe(screenPoint, {
    x: screenPoint.x,
    y: screenPoint.y - 120,
  });
  await evaluateAsync(
    client,
    "(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true})()",
  );
  assert.equal(
    await client.screen.evaluate("window.__terminalFocusEvents"),
    0,
    "a swipe on the Terminal focused it",
  );
  for (const round of ["1", "2"]) {
    await client.nativeTap(screenPoint);
    assertOpen(await keyboardOpened(liveBefore));
    const blurs = await client.screen.evaluate("window.__terminalBlurEvents");
    await client.nativeTap(await centerOf(".xterm-screen"));
    assertOpen(await keyboardOpened(liveBefore));
    assert.equal(
      await client.screen.evaluate("window.__terminalBlurEvents"),
      blurs,
      "tapping with the keyboard open blurred the input",
    );
    await clearObserved(client);
    const phrase = `指で触れて開いた入力${round}`;
    await typeTerminal(client, say(os, phrase), undefined, "tap", {
      focus: false,
    });
    await observed(client, phrase);
    client.nativeBack();
    await keyboardClosed(liveBefore);
  }
  await setLive(false);
  const batch = '[data-iori-field="terminal-batch-input"]';
  await client.screen.wait(batch);
  const before = await layout();
  await client.nativeTap(await centerOf(batch));
  const open = await keyboardOpened(before);
  assertOpen(open);
  await client.browser.call("Input.insertText", { text: "書きかけ\n続き" });
  await client.nativeTap(await centerOf(".xterm-screen"));
  await keyboardClosed(before);
  assert.equal(await client.screen.value(batch), "書きかけ\n続き");
  await client.nativeTap(await centerOf(batch));
  assertOpen(await keyboardOpened(before));
  await client.screen.input(batch, "");
  await clearObserved(client);
  const command = say(os, "キーボードを開いた入力").slice(0, -1);
  await client.browser.call("Input.insertText", { text: command });
  await client.screen.click('[data-iori-action="terminal-batch-send"]');
  await observed(client, "キーボードを開いた入力");
  const typed = await layout();
  assert.equal(
    typed.row.top >= 0 && typed.height < before.height - 200,
    true,
    "the keyboard closed or the location row moved after typing",
  );
  const wasDark = await client.screen.evaluate(
    "document.documentElement.classList.contains('dark')",
  );
  try {
    for (const theme of ["light", "dark"]) {
      await evaluateAsync(
        client,
        `(async()=>{document.documentElement.classList.toggle('dark',${theme === "dark"});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;})()`,
      );
      await shot(client, `${os}-android-keyboard-${theme}`);
    }
  } finally {
    await client.screen.evaluate(
      `document.documentElement.classList.toggle('dark',${wasDark})`,
    );
  }
  // Back closes the keyboard first; the next scenario step starts live.
  client.nativeBack();
  await keyboardClosed(before);
  await setLive(true);
  return { before, open, typed, nativeOrigin: client.nativeOrigin };
}

// Android input goes through the OS, including WebView's touch cancellation.
export async function nativeTerminalTextSelection(client, shot) {
  const screen = client.screen;
  const line = "LONG_PRESS_OUTPUT";
  await typeTerminal(
    client,
    "printf '\\033[2J\\033[H%s\\n\\033[?1000h\\033[?1006h' 'LONG_PRESS_OUTPUT'\r",
  );
  await observed(client, line);
  await observedTerminalMode(client, "mouseTracking", true);
  await screen.click(action("terminal-input-live"));
  const point = await screen.evaluate(`(()=>{
    const pane=${shownPane};
    const r=pane.querySelector('.xterm-screen').getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/Number(pane.dataset.ioriRows)/2};
  })()`);
  await client.nativeLongPress(point);
  await screen.wait(action("terminal-select-text"));
  await shot(client, "linux-android-long-press-menu");
  await screen.click(action("terminal-select-text"));
  await waitFor(
    () => screen.evaluate("window.getSelection()?.toString()"),
    (value) => value === line,
  );
  await shot(client, "linux-android-long-press-text");
  await screen.click(
    '[data-iori-panel="terminal-text"] [data-slot="sheet-close"]',
  );
  await screen.click(action("terminal-input-batch"));
  await typeTerminal(client, "printf '\\033[?1000l\\033[?1006l'\r");
  await observedTerminalMode(client, "mouseTracking", false);
}

function outputFlood(os) {
  return os === "linux"
    ? {
        command:
          "sh -c 'while true; do printf \"%s%s\\n\" output- flow; done'\r",
        marker: "output-flow",
      }
    : {
        command: '& cmd /c "for /L %i in (0,0,1) do @echo output-%i"\r',
        marker: "output-0",
      };
}

async function backgroundTerminal(
  os,
  mobile,
  desktop,
  cwd,
  record,
  shot,
  phase,
) {
  const primary = desktop ?? mobile;
  const watched = await create(primary, cwd);
  const { command: flood, marker: floodOutput } = outputFlood(os);
  await clearObserved(primary);
  await typeTerminal(primary, flood);
  await observed(primary, floodOutput);
  if (desktop) await open(mobile, watched);
  const frameRate = async () => {
    const first = await primary.screen.evaluate(
      "window.__terminalObservation.frames",
    );
    const startedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const last = await primary.screen.evaluate(
      "window.__terminalObservation.frames",
    );
    return ((last - first) * 1000) / (Date.now() - startedAt);
  };
  const flowing = await frameRate();
  await typeTerminal(mobile, "x", phase, "claim-the-size");
  const oldStream = await mobile.screen.evaluate(
    `${shownPane}.getAttribute('data-iori-stream-id')`,
  );
  mobile.nativeHome();
  await waitFor(() =>
    mobile.screen.evaluate(
      `window.__terminalObservation.endedStreams.includes(${JSON.stringify(oldStream)})`,
    ),
  );
  const counts = () =>
    mobile.screen.evaluate(
      "({frames:window.__terminalObservation.frames,snapshots:window.__terminalObservation.snapshots})",
    );
  const backgroundStart = await counts();
  const backgrounded = await frameRate();
  assert.deepEqual(
    await counts(),
    backgroundStart,
    "the background phone kept receiving or reopening its Terminal",
  );
  let pcRows;
  if (desktop) {
    assert.equal(
      backgrounded >= flowing / 2,
      true,
      "the background phone slowed the PC output",
    );
    await interrupt(desktop);
    await typeTerminal(desktop, say(os, "背面の間に停止"));
    await observed(desktop, "背面の間に停止");
    pcRows = await desktop.screen.evaluate(
      `${shownPane}.getAttribute('data-iori-rows')`,
    );
  }
  await clearObserved(mobile);
  mobile.nativeForeground();
  await waitFor(() =>
    mobile.screen.evaluate(
      `${shownPane}?.getAttribute('data-iori-stream-state')==='ready'`,
    ),
  );
  await observed(mobile, desktop ? "背面の間に停止" : floodOutput);
  if (desktop) {
    assert.equal(
      await desktop.screen.evaluate(
        `${shownPane}.getAttribute('data-iori-rows')`,
      ),
      pcRows,
      "foreground stole the PC's row count",
    );
  } else {
    await interrupt(mobile);
  }
  await typeTerminal(
    mobile,
    say(os, "背面から戻った後の入力"),
    phase,
    "type-after-foreground",
  );
  await observed(mobile, "背面から戻った後の入力");
  await record(
    os,
    "Android",
    desktop
      ? "2 背面では受信を閉じPCの出力を止めず、前面復帰で保存画面と入力を戻しPCの行数を奪わない"
      : "2 背面では受信を閉じ、前面復帰で保存画面と入力を戻す",
    { flowing, backgrounded, pcRows, backgroundStart },
  );
}

export async function beginMobileInput(client) {
  // Mobile deliberately does not focus/open the keyboard on creation.
  const closedHeight = await client.screen.evaluate("innerHeight");
  assert.equal(
    await client.screen.evaluate(
      `document.activeElement===${shownPane}.querySelector(${JSON.stringify(input)})`,
    ),
    false,
  );
  const point = await client.screen.evaluate(
    `(()=>{const r=${shownPane}.querySelector('.xterm-screen').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`,
  );
  await client.nativeTap(point);
  await waitFor(() =>
    client.screen.evaluate(
      `document.activeElement===${shownPane}.querySelector(${JSON.stringify(input)})`,
    ),
  );
  return async () => {
    client.nativeBack();
    await waitFor(
      async () =>
        (await client.screen.evaluate("innerHeight")) >= closedHeight - 20,
    );
  };
}

export async function terminalSession(
  os,
  clients,
  cwd,
  record,
  shot,
  reconnectClient,
  phase,
) {
  const [win, android] = clients;
  const names = clients.map((client) =>
    client.browser.webdriver ? "Windows" : "Android",
  );
  for (const client of clients) await observe(client);
  const id = await create(win, cwd);
  // PC focuses on creation; Mobile starts input by tapping the Terminal.
  const closeInitialKeyboard = !win.browser.webdriver
    ? await beginMobileInput(win)
    : undefined;
  await typeTerminal(win, say(os, "PC日本語入力"), undefined, "type", {
    focus: false,
  });
  await observed(win, "PC日本語入力");
  await closeInitialKeyboard?.();
  // The 800x600 PC window gives the Terminal its full width with the sidebar
  // closed, so the PC width exceeds the phone width as on a normal desktop.
  if (win.browser.webdriver && !(await sidebarCollapsed(win)))
    await closeSidebar(win.screen);

  await shot(win, os + "-" + names[0].toLowerCase() + "-terminal");
  await record(os, names[0], "1 日本語を含む入力・実行・出力");
  let mobileCols;
  if (android) {
    await open(android, id);
    // The width choice is saved on the device; start from the phone's width.
    const desktopWidth = `${shownPane}?.querySelector('[data-iori-action="terminal-width-toggle"][aria-pressed="true"]')`;
    if (await android.screen.evaluate(`Boolean(${desktopWidth})`))
      await android.screen.evaluate(`${desktopWidth}.click()`);
    await typeTerminal(android, say(os, "スマホ日本語入力"));
    await observed(win, "スマホ日本語入力");
    await observed(android, "スマホ日本語入力");
    mobileCols = Number(
      await android.screen.evaluate(
        `${shownPane}.getAttribute('data-iori-cols')`,
      ),
    );
  }
  for (const [index, client] of clients.entries()) {
    if (await clipboardPaste(client, os))
      await record(os, names[index], "明示的なclipboard貼り付け・元の値の復元");
  }
  if (android) {
    await shot(android, os + "-android-terminal");
    await record(os, "Android", "1 日本語を含む入力・実行・出力");
    await typeTerminal(win, say(os, "PC幅へ復帰"));
    await observed(android, "PC幅へ復帰");
    const pcCols = Number(
      await win.screen.evaluate(`${shownPane}.getAttribute('data-iori-cols')`),
    );
    assert.equal(
      pcCols > mobileCols,
      true,
      `PC columns ${pcCols} should exceed mobile columns ${mobileCols}`,
    );
    for (const clientName of ["Windows", "Android"])
      await record(os, clientName, "3 双方の入力・操作した端末の幅", {
        mobileCols,
        pcCols,
      });
    // The normal toggle path starts while the phone already owns the PTY.
    await typeTerminal(android, say(os, "端末幅でスマホ入力"));
    await observed(win, "端末幅でスマホ入力");
    await waitFor(() =>
      win.screen.evaluate(
        `Number(${shownPane}.getAttribute('data-iori-cols'))===${mobileCols}`,
      ),
    );
    await android.screen.click('[data-iori-action="terminal-width-toggle"]');
    await waitFor(() =>
      win.screen.evaluate(
        `Number(${shownPane}.getAttribute('data-iori-cols'))===${pcCols}`,
      ),
    );
    await typeTerminal(android, say(os, "PC幅のままスマホ入力"));
    await observed(win, "PC幅のままスマホ入力");
    assert.equal(
      Number(
        await android.screen.evaluate(
          `${shownPane}.getAttribute('data-iori-cols')`,
        ),
      ),
      pcCols,
    );
    await android.screen.click('[data-iori-action="terminal-width-toggle"]');
    await waitFor(() =>
      win.screen.evaluate(
        `Number(${shownPane}.getAttribute('data-iori-cols'))<${pcCols}`,
      ),
    );
    await record(os, "Android", "3 PC幅の縮小表示・入力・端末幅へ戻る");
  }
  // Theme changes and page scrolling can fit/resize a view and claim its size.
  // Keep appearance capture outside the width-ownership operation sequence.
  await captureAppearance(os, clients, shot);
  const mobile = clients.find((client) => !client.browser.webdriver);
  if (mobile) {
    const keyboard = await softKeyboard(os, mobile, shot);
    await record(
      os,
      "Android",
      "1 キーボードを開いても現在地の行が残り、入力が届く",
      { keyboard },
    );
  }

  const { command: flood, marker: floodOutput } = outputFlood(os);
  await typeTerminal(win, flood);
  await observed(win, floodOutput);
  const other = android ?? win;
  const second = await create(other, cwd);
  await typeTerminal(other, say(os, "別Terminalの入力"));
  await observed(other, "別Terminalの入力");
  if (!android) await open(win, id);
  await interrupt(win);
  await typeTerminal(win, say(os, "大量出力を停止"));
  await observed(win, "大量出力を停止");
  for (const clientName of names)
    await record(os, clientName, "2 大量出力と別Terminalの入力");
  if (mobile)
    await backgroundTerminal(
      os,
      mobile,
      clients.find((client) => client.browser.webdriver),
      cwd,
      record,
      shot,
      phase,
    );
  const fresh = await create(win, cwd);
  const closeFreshKeyboard = !win.browser.webdriver
    ? await beginMobileInput(win)
    : undefined;
  // PC takes keys immediately; Mobile takes them after the tap above.
  await typeTerminal(win, say(os, "プラスで作った直後の入力"), phase, "type", {
    focus: false,
  });
  await observed(win, "プラスで作った直後の入力");
  await closeFreshKeyboard?.();
  await record(os, names[0], "2 ＋で作った直後の入力が新しいTerminalへ届く");
  if (android) {
    await open(android, fresh, phase, "open-and-type", { ready: false });
    await waitFor(() => android.screen.evaluate(`${shownTail}.length>0`));
    await typeTerminal(
      android,
      say(os, "開いた直後の入力"),
      phase,
      "type-right-after-open",
      { ready: false },
    );
    await observed(android, "開いた直後の入力");
    await record(os, "Android", "2 開いた直後の入力が欠けない");
    // The PC goes back by its tab, keeping the sidebar and the Terminal's width.
    await win.screen.click(
      `button[data-iori-tab-id=${JSON.stringify(`terminal:${id}`)}]`,
    );
    await waitFor(() =>
      win.screen.evaluate(
        `${shownPane}?.getAttribute('data-iori-terminal-id')===${JSON.stringify(id)}`,
      ),
    );
    await open(android, id);
  } else {
    await open(win, id);
  }
  const sessionMarker = `same-shell-${Date.now()}`;
  await clearObserved(win);
  await typeTerminal(
    win,
    os === "linux"
      ? `export IORI_TERMINAL_SESSION='${sessionMarker}'; printf '\\n%s%s\\n' 'session-' 'ready'\r`
      : `$env:IORI_TERMINAL_SESSION='${sessionMarker}'; Write-Output ('session-' + 'ready')\r`,
  );
  await observed(win, "session-ready");
  // Each Client retains the other Terminal it created while showing the first.
  // In a two-Client run the PC created `fresh`, while the phone created `second`.
  for (const [index, client] of clients.entries()) {
    const hiddenId = client === other ? second : fresh;
    const hiddenCols = Number(
      await client.screen.evaluate(
        `document.querySelector('[data-iori-view="terminal"][data-iori-terminal-id="${hiddenId}"]')?.getAttribute('data-iori-cols')`,
      ),
    );
    assert.equal(
      hiddenCols >= 40,
      true,
      `hidden Terminal shrank to ${hiddenCols} columns`,
    );
    await record(os, names[index], "2 隠れたTerminalの幅を保持", {
      hiddenCols,
    });
  }
  for (let index = 0; index < clients.length; index++) {
    const clientName = names[index];
    const phasePrefix = `case4/${os}/${clientName}`;
    const clientPhase = (name, action) =>
      runPhase(phase, `${phasePrefix}/${name}`, action);
    const client = await reconnectClient(index, clientPhase);
    clients[index] = client;
    await clientPhase("attach-output-observer", () => observe(client));
    await clientPhase("select-folder", () => selectFolder(client, cwd));
    // The PC restores its tabs at start, so the restored screen can arrive
    // before the observer. Close the restored tab and open it from its row.
    const restoredTab = `[data-tab-kind="terminal"]:has([data-iori-tab-id="terminal:${id}"]) [data-iori-action="workspace-close-tab"]`;
    if (
      await client.screen.evaluate(
        `Boolean(document.querySelector(${JSON.stringify(restoredTab)}))`,
      )
    ) {
      await clientPhase("close-restored-tab", async () => {
        await client.screen.click(restoredTab);
        await waitFor(
          async () =>
            !(await client.screen.evaluate(
              `Boolean(document.querySelector(${JSON.stringify(restoredTab)}))`,
            )),
        );
      });
    }
    await open(client, id, clientPhase, "open-terminal");
    await observed(
      client,
      "大量出力を停止",
      clientPhase,
      "snapshot-output-marker",
    );
    await clearObserved(client, clientPhase, "clear-snapshot-output");
    await typeTerminal(
      client,
      os === "linux"
        ? `printf '\\n%s\\n' "$IORI_TERMINAL_SESSION"\r`
        : `Write-Output $env:IORI_TERMINAL_SESSION\r`,
      clientPhase,
      "query-shell-session",
    );
    await observed(client, sessionMarker, clientPhase, "verify-shell-session");
    await typeTerminal(
      client,
      say(os, "再接続後の入力"),
      clientPhase,
      "reconnected-input",
    );
    await observed(
      client,
      "再接続後の入力",
      clientPhase,
      "verify-reconnected-input",
    );
    await record(
      os,
      clientName,
      "4 Client終了・再起動で同じTerminalへ再接続・入力を継続",
    );
  }
  // Keep case 5 readable on both real screens. The old final line must survive
  // below earlier output; the runner renders received frames to check its row
  // against the restart separator and the new shell, beyond received words.
  const restartMarker = `old-${Date.now()}`;
  await typeTerminal(
    clients.at(-1),
    (os === "linux" ? "clear; " : "cls; ") + say(os, restartMarker),
  );
  for (const client of clients) await observed(client, restartMarker);
  return { id, second, restartMarker };
}

// After a restart, PC returns to the last worktree and Mobile to its first screen.
export async function selectFolder(client, cwd) {
  const current = () =>
    client.screen.evaluate(
      "document.querySelector('[data-iori-current-worktree-path]')?.getAttribute('data-iori-current-worktree-path')??''",
    );
  await waitFor(
    async () =>
      (await current()) === cwd ||
      (await client.screen.visible('[data-iori-view="mobile-home"]')) ||
      (await client.screen.visible(
        `button[data-iori-worktree-path=${JSON.stringify(cwd)}]`,
      )),
  );
  if ((await current()) === cwd) return;
  const home = `[data-iori-home-worktree-path=${JSON.stringify(cwd)}]`;
  if (await client.screen.visible(home)) await client.screen.click(home);
  else
    await client.screen.click(
      `button[data-iori-worktree-path=${JSON.stringify(cwd)}]`,
    );
  await waitFor(async () => (await current()) === cwd);
}

export async function closing(
  os,
  client,
  cwd,
  record,
  clientName,
  processEnded,
  phase,
) {
  const case6 = (name, action) =>
    runPhase(phase, `case6/${os}/${clientName}/${name}`, action);
  const id = await create(client, cwd);
  await clearObserved(client);
  await typeTerminal(
    client,
    os === "linux"
      ? 'sh -c \'printf "\\nchild-%s\\n" "$$"; sleep 120\'\r'
      : `& powershell -NoProfile -Command 'Write-Output ("child-"+$PID); ping -n 121 127.0.0.1'\r`,
  );
  const childPid = await waitFor(async () => {
    const tail = await client.screen.evaluate(shownTail);
    return Number(tail.match(/child-(\d+)/u)?.[1]) || undefined;
  });
  if (os === "windows") await observed(client, "TTL=");
  const descendants = await processEnded(os, childPid);
  await requestClose(client, id);
  await client.screen.wait(action("terminal-confirm-close"));
  await client.screen.click(action("terminal-confirm-close"));
  await closedRow(client, id);
  await processEnded(os, childPid, descendants);
  await record(os, clientName, "6 実行中の閉じる確認・OSで子プロセス終了", {
    childPid,
  });
  const failed = await create(client, cwd);
  await typeTerminal(client, "exit 7\r");
  await client.screen.wait(
    '[data-iori-view="terminal"][data-iori-state="error"]',
  );
  assert.match(
    await client.screen.text('[data-iori-state="terminal-exit"]'),
    /(?:\s|\()7\)?$/u,
  );
  await record(os, clientName, "6 エラー終了の画面・終了コード保持");
  await case6("close-error-terminal", () => requestClose(client, failed));
  await case6("wait-row-after-error-close", () => closedRow(client, failed));
  const normal = await case6("create-normal-exit-terminal", () =>
    create(client, cwd),
  );
  await typeTerminal(
    client,
    "exit\r",
    phase,
    `case6/${os}/${clientName}/normal-exit-command`,
  );
  await case6("wait-normal-exit-row", () => closedRow(client, normal));
  await record(os, clientName, "6 exitで閉じる");
  if (os === "linux") {
    const signaled = await create(client, cwd);
    await typeTerminal(client, "exec sh -c 'kill -TERM $$'\r");
    await client.screen.wait(
      '[data-iori-view="terminal"][data-iori-state="error"]',
    );
    assert.match(
      await client.screen.text('[data-iori-state="terminal-exit"]'),
      /(?:\s|\()143\)?$/u,
    );
    await record(os, clientName, "6 signal終了の画面・コード143保持");
    await requestClose(client, signaled);
    await closedRow(client, signaled);
  }

  const idle = await create(client, cwd);
  await requestClose(client, idle);
  assert.equal(
    await client.screen.visible(action("terminal-confirm-close")),
    false,
  );
  await case6("wait-row-after-idle-close", () => closedRow(client, idle));
  await record(os, clientName, "6 入力待ちは確認せず閉じる");
  await closingOutput(os, client, cwd, record, clientName, phase);
  await closingOtherTerminal(os, client, cwd, record, clientName, phase);
}

export async function closingOtherTerminal(
  os,
  client,
  cwd,
  record,
  clientName,
  phase,
) {
  const prefix = `case8/${os}/${clientName}`;
  const step = (name, action) => runPhase(phase, `${prefix}/${name}`, action);
  const older = await step("create-older", () => create(client, cwd));
  const remaining = await step("create-remaining", () => create(client, cwd));
  const suffix = String(Date.now());
  const marker = `original-shell-${suffix}`;
  await typeTerminal(
    client,
    os === "linux"
      ? `export IORI_CLOSE_SESSION='original-shell-'${suffix}; printf '\\n%s%s\\n' 'session-' 'ready'\r`
      : `$env:IORI_CLOSE_SESSION='original-shell-'+'${suffix}'; Write-Output ('session-' + 'ready')\r`,
    phase,
    `${prefix}/set-shell-value`,
  );
  await observed(client, "session-ready", phase, `${prefix}/shell-ready`);
  await record(os, clientName, "8 閉じる前のshellの値", { marker });
  await open(client, older, phase, `${prefix}/open-older`);
  await clearObserved(client, phase, `${prefix}/clear-older-observation`);
  await typeTerminal(
    client,
    os === "linux"
      ? `while :; do printf '%s%s\\n' 'running-' 'output'; sleep 0.05; done\r`
      : `while(1){ Write-Output ('running-' + 'output'); Start-Sleep -Milliseconds 50 }\r`,
    phase,
    `${prefix}/start-output`,
  );
  await observed(client, "running-output", phase, `${prefix}/output-started`);
  await step("close-older", () => requestClose(client, older));
  const confirmClose = await step("wait-close-result", () =>
    waitFor(async () => {
      if (await client.screen.visible(action("terminal-confirm-close")))
        return "confirm";
      if (!(await client.screen.visible(row(older)))) return "closed";
    }),
  );
  if (confirmClose === "confirm")
    await step("confirm-close-older", () =>
      client.screen.click(action("terminal-confirm-close")),
    );
  await step("wait-older-closed", () => closedRow(client, older));
  await open(client, remaining, phase, `${prefix}/open-remaining`);
  await clearObserved(client, phase, `${prefix}/clear-observation`);
  await typeTerminal(
    client,
    os === "linux"
      ? `printf '\\n%s\\n' "$IORI_CLOSE_SESSION"\r`
      : `Write-Output $env:IORI_CLOSE_SESSION\r`,
    phase,
    `${prefix}/read-shell-value`,
  );
  await observed(client, marker, phase, `${prefix}/verify-original-shell`);
  await record(os, clientName, "8 他のTerminalを閉じても元のshellが継続", {
    marker,
  });
}

export async function closingOutput(
  os,
  client,
  cwd,
  record,
  clientName,
  phase,
  shot,
) {
  const case7 = (name, action) =>
    runPhase(phase, `case7/${os}/${clientName}/${name}`, action);
  const busy = await case7("create-output-terminal", () => create(client, cwd));
  await clearObserved(
    client,
    phase,
    `case7/${os}/${clientName}/clear-old-output`,
  );
  await typeTerminal(
    client,
    os === "linux"
      ? "sh -c 'while true; do printf \"%s%s\\n\" conti nuous; done'\r"
      : "ping -t 127.0.0.1\r",
    phase,
    `case7/${os}/${clientName}/start-output`,
  );
  await observed(
    client,
    os === "linux" ? "continuous" : "TTL=",
    phase,
    `case7/${os}/${clientName}/wait-output`,
  );
  await case7("request-close", () => requestClose(client, busy));
  await case7("wait-close-confirmation", () =>
    client.screen.wait(action("terminal-confirm-close")),
  );
  if (os === "windows") {
    const title = await client.screen.text(
      '[data-iori-dialog="terminal-close-confirmation"] [data-slot="dialog-title"]',
    );
    if (shot) await shot(client, "windows-command-close");
    assert.match(title, /^(pingを実行中です|ping is running)$/iu);
    await record(os, clientName, "実行中の閉じる確認にコマンド名が出る", {
      title,
    });
  }
  await case7("confirm-close", () =>
    client.screen.click(action("terminal-confirm-close")),
  );
  await case7("wait-row-after-busy-close", () => closedRow(client, busy));
  await case7("create-followup-terminal", () => create(client, cwd));
  await typeTerminal(
    client,
    say(os, "終了後もHostが応答"),
    phase,
    `case7/${os}/${clientName}/followup-input`,
  );
  await observed(
    client,
    "終了後もHostが応答",
    phase,
    `case7/${os}/${clientName}/wait-followup-output`,
  );
  await record(
    os,
    clientName,
    "7 出力中のTerminal終了後もHost・別Terminalが応答",
  );
}

// Keep access to actual xterm instances in the browser for input/retention checks.
export async function observeTerminalInstances(client) {
  await client.screen.evaluate(`(async()=>{
    const source=await (await fetch("/src/terminal/TerminalPane.tsx")).text();
    const url=/from "([^"]*@xterm_xterm[^"]*)"/.exec(source)[1];
    const {Terminal}=await import(url);
    const open=Terminal.prototype.open;
    Terminal.prototype.open=function(element){open.call(this,element);element.__e2eTerminal=this;};
    return true;
  })()`);
}
