import {
  openSidebar,
  closeSidebar,
  openSettingsSection,
} from "../connection/scenario.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import {
  typeTerminal,
  observed,
  clearObserved,
  open,
  observe,
  observeTerminalInstances,
} from "../terminal/scenario.mjs";

const terminal = `document.querySelector('[data-iori-view="terminal"]:not([hidden]) [data-iori-part="terminal-screen"]').__e2eTerminal`;
const action = (name) => `[data-iori-action="${name}"]`;

export async function terminalFileLinks({
  client,
  terminalId,
  worktree,
  createPlainFolder,
  desktop,
  mobile,
  record,
  shot,
}) {
  const screen = client.screen;
  await screen.evaluate(
    `(async()=>{const {native}=await import('/src/native.ts');const request=native.request.bind(native);window.__resolvedTerminalPaths=[];native.request=async(...args)=>{const result=await request(...args);const message=JSON.parse(args[1]);if(message.method==='files.resolve')window.__resolvedTerminalPaths.push({paths:message.params.paths,result:JSON.parse(result)});return result;};return true;})()`,
  );
  const outside = `${await createPlainFolder()}/outside.txt`;
  const point = async (value) =>
    waitFor(
      () =>
        screen.evaluate(
          `(()=>{const t=${terminal};if(!t)return;const b=t.buffer.active;for(let row=b.length-1;row>=b.viewportY;row--){if(b.getLine(row).isWrapped)continue;let text='',cells=[];for(let next=row;next<b.length&&(next===row||b.getLine(next).isWrapped);next++){const line=b.getLine(next);for(let col=0;col<t.cols;col++){const cell=line.getCell(col);if(cell.getWidth()===0)continue;const chars=cell.getChars()||' ';text+=chars;for(let i=0;i<chars.length;i++)cells.push({col,row:next});}}const index=text.indexOf(${JSON.stringify(value)});if(index>=0){const target=cells[index+2];const r=t.element.querySelector('.xterm-screen').getBoundingClientRect();return {x:r.x+(target.col+0.5)*r.width/t.cols,y:r.y+(target.row-b.viewportY+0.5)*r.height/t.rows};}}})()`,
        ),
      Boolean,
      undefined,
      "描画された出力のパス",
    );
  const pointer = () =>
    screen.evaluate(
      `Boolean(${terminal}.element.querySelector('.xterm-cursor-pointer'))`,
    );
  const hover = (at, modifiers = 0) =>
    client.browser.call("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...at,
      modifiers,
    });
  const click = async (at, { modifiers = 0, button = "left" } = {}) => {
    for (const type of ["mousePressed", "mouseReleased"])
      await client.browser.call("Input.dispatchMouseEvent", {
        type,
        ...at,
        button,
        clickCount: 1,
        modifiers,
      });
  };
  const clickPath = async (value, modifiers = 0) => {
    const at = await point(value);
    await hover(at, modifiers);
    await waitFor(pointer);
    await click(at, { modifiers });
  };
  await typeTerminal(
    client,
    `mkdir -p nested/deep; for n in $(seq -w 1 200); do : > nested/deep/item-$n.txt; done; printf 'first\\nsecond\\nthird\\n' > nested/deep/zz-target.txt; printf 'outside body\\n' > '${outside}'; printf '\\n%s %s%s\\n' '長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長' 'nested/deep/zz-target.' 'txt:2'\r`,
  );
  await observed(client, "nested/deep/zz-target.txt:2");
  await clickPath("nested/deep/zz-target.txt:2");
  await screen.wait(
    '[data-iori-view="files"] [data-iori-line="2"][data-selected="true"]',
  );
  await screen.wait(
    '[data-iori-file="nested/deep/zz-target.txt"][aria-selected="true"]',
  );
  await record(
    "出力の相対パスと行番号を修飾キー無しでクリックしてFilesの一覧と2行目を選択",
  );
  await open(client, terminalId);
  await clearObserved(client);
  await typeTerminal(
    client,
    `printf '\\n%s%s\\n' '${outside.slice(0, -3)}' 'txt'\r`,
  );
  await observed(client, outside);
  await clickPath(outside, 2);
  await screen.wait('[data-iori-view="file"]');
  assert.equal(
    await screen.attribute(
      '[data-iori-view="file"] [data-iori-part="file-header"] nav',
      "title",
    ),
    outside,
  );
  await screen.wait('[data-iori-tab-kind="file"]');
  await shot("desktop-file-tab");
  await screen.click(
    `.dock-tab-header:has([data-iori-tab-id="terminal:${terminalId}"]) [data-iori-action="workspace-close-tab"]`,
  );
  await desktop();
  await observeTerminalInstances(client);
  await screen.wait('[data-iori-view="file"]');
  await waitFor(async () =>
    (await screen.text('[data-iori-view="file"] .reading-body')).includes(
      "outside body",
    ),
  );
  await record(
    "外の絶対パスをファイルのタブで開き、全体のパスと本文を表示しPC再起動で復元",
  );
  await screen.evaluate(
    `(async()=>{const {native}=await import('/src/native.ts');const request=native.request.bind(native);window.__resolvedTerminalPaths=[];native.request=async(...args)=>{const result=await request(...args);const message=JSON.parse(args[1]);if(message.method==='files.resolve')window.__resolvedTerminalPaths.push({paths:message.params.paths,result:JSON.parse(result)});return result;};return true;})()`,
  );
  await open(client, terminalId);
  await clearObserved(client);
  await typeTerminal(
    client,
    "printf '\\n%s%s\\n' '/missing-iori-' 'path/no-file.txt'\r",
  );
  await observed(client, "/missing-iori-path/no-file.txt");
  const absent = await point("/missing-iori-path/no-file.txt");
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...absent,
    modifiers: 2,
  });
  await waitFor(() =>
    screen.evaluate(
      `window.__resolvedTerminalPaths.some(item=>item.result.ok&&item.paths.some((path,index)=>path==='/missing-iori-path/no-file.txt'&&item.result.result.results[index].found===false))`,
    ),
  );
  assert.equal(
    await screen.evaluate(
      `Boolean(${terminal}.element.querySelector('.xterm-cursor-pointer'))`,
    ),
    false,
  );
  await record("実在しないパスの出力はリンクにならない");
  await pointerLinkClicks({ client, terminalId, point, pointer, hover, click });
  await record(
    "URLはクリックで開き、ドラッグ・選択を外すクリック・右クリック・別のペインからのクリックでは開かず、選択中と焦点の無い時は手のカーソルを出さない",
  );
  await mouseReportingLinks({ client, point, pointer, hover, click });
  await record(
    "マウス報告中もリンクの上の修飾キー無しのクリックはURLを開いて実PTYへ送らず、リンクの横のクリックは実PTYへ届く",
  );
  await ctrlClickSetting({ client, point, pointer, hover, click, shot });
  await record(
    "設定を「Ctrl+クリック」にすると修飾キー無しのクリックでは開かず、Ctrlを押す間だけ下線と手のカーソルを出す",
  );
  await screen.click(
    `.dock-tab-header:has([data-iori-tab-id="terminal:${terminalId}"]) [data-iori-action="workspace-close-tab"]`,
  );
  await mobile();
  await screen.wait('[data-iori-view="workspace"]');
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  await observeTerminalInstances(client);
  await open(client, terminalId);
  await clearObserved(client);
  await typeTerminal(
    client,
    "printf '\\n%s%s\\n' 'nested/deep/zz-target.' 'txt:3'\r",
  );
  await observed(client, "nested/deep/zz-target.txt:3");
  // The real touch starts with the software keyboard closed.
  await openSidebar(screen);
  await closeSidebar(screen);
  const at = await point("nested/deep/zz-target.txt:3");
  await client.browser.call("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 0, ...at }],
  });
  await client.browser.call("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await screen.wait(
    '[data-iori-view="files"] [data-iori-line="3"][data-selected="true"]',
  );
  assert.equal(
    await screen.evaluate(
      `document.activeElement?.matches('textarea,input,[contenteditable="true"]')`,
    ),
    false,
  );
  await record("400×900の指タップでパスを開き、入力への焦点を移さない");
  await open(client, terminalId);
  await clearObserved(client);
  await screen.evaluate(
    `(async()=>{const {native}=await import('/src/native.ts');window.__openedUrls=[];native.openUrl=async(url)=>{window.__openedUrls.push(url);};return true;})()`,
  );
  await typeTerminal(
    client,
    "printf '\\n%s%s\\n' 'https://example.' 'com/iori-tap'\r",
  );
  await observed(client, "https://example.com/iori-tap");
  await openSidebar(screen);
  await closeSidebar(screen);
  const url = await point("https://example.com/iori-tap");
  await client.browser.call("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 0, ...url }],
  });
  await client.browser.call("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await waitFor(() => screen.evaluate("window.__openedUrls.length === 1"));
  assert.deepEqual(await screen.evaluate("window.__openedUrls"), [
    "https://example.com/iori-tap",
  ]);
  assert.equal(
    await screen.evaluate(
      `document.activeElement?.matches('textarea,input,[contenteditable="true"]')`,
    ),
    false,
  );
  await record("スマホのURLを最初の指タップで開き、入力へ焦点を移さない");
  await open(client, terminalId);
  await clearObserved(client);
  await typeTerminal(
    client,
    `printf '\\n%s%s\\n' '${outside.slice(0, -3)}' 'txt'\r`,
  );
  await observed(client, outside);
  const external = await point(outside);
  await client.browser.call("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 0, ...external }],
  });
  await client.browser.call("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await screen.wait('[data-iori-view="file"]');
  await mobile();
  await screen.click(
    `[data-iori-home-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await screen.wait('[data-iori-view="file"]');
  await shot("mobile-file-tab");
  await record("スマホのファイルのタブも再起動で復元");
  // Loaded at a phone's width, the web Client stands in for Android, which
  // shows neither "Right-click" nor "Open links".
  await mobile({ width: 390, height: 844 });
  await settingsShots(screen, shot, "mobile");
  assert.equal(await screen.visible(action("terminal-link-open")), false);
  assert.equal(await screen.visible(action("terminal-right-click")), false);
}

const chooseOption = async (screen, name, option) => {
  await screen.click(action(name));
  await screen.click(
    `[role="option"][data-state][data-iori-option="${option}"]`,
  );
  await waitFor(
    () => screen.visible('[role="option"]'),
    (shown) => !shown,
  );
};

// The display settings and other screens built from the same field rows.
async function settingsShots(screen, shot, name) {
  for (const theme of ["light", "dark"]) {
    await openSettingsSection(screen, "settings-display");
    await chooseOption(screen, "display-theme", `theme-${theme}`);
    await shot(`${name}-settings-display-${theme}`);
    for (const section of ["general", "devices", "host-version"]) {
      await openSettingsSection(
        screen,
        section === "general" ? `settings-${section}` : `open-${section}`,
      );
      await shot(`${name}-settings-${section}-${theme}`);
    }
  }
  await openSettingsSection(screen, "settings-display");
  await chooseOption(screen, "display-theme", "theme-system");
}

const stubOpenUrl = (screen) =>
  screen.evaluate(
    `(async()=>{const {native}=await import('/src/native.ts');window.__openedUrls=[];native.openUrl=async(url)=>{window.__openedUrls.push(url);};return true;})()`,
  );
const openedUrls = (screen) => screen.evaluate("window.__openedUrls");

async function pointerLinkClicks({
  client,
  terminalId,
  point,
  pointer,
  hover,
  click,
}) {
  const screen = client.screen;
  await stubOpenUrl(screen);
  await clearObserved(client);
  await typeTerminal(
    client,
    "printf '\\n%s%s\\n' 'https://example.' 'com/iori-click'\r",
  );
  await observed(client, "https://example.com/iori-click");
  const url = "https://example.com/iori-click";
  let at = await point(url);
  await hover(at);
  await waitFor(pointer);
  // xterm opens the link on the button's release, in the same dispatch.
  await click(at);
  assert.deepEqual(await openedUrls(screen), [url]);
  // A drag across the link selects its text instead.
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...at,
    button: "left",
    clickCount: 1,
  });
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: at.x + 60,
    y: at.y,
    button: "left",
    buttons: 1,
  });
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: at.x + 60,
    y: at.y,
    button: "left",
    clickCount: 1,
  });
  assert.equal(await screen.evaluate(`${terminal}.hasSelection()`), true);
  assert.equal((await openedUrls(screen)).length, 1);
  // With a selection the link does not look clickable, and the next click
  // only clears it. Each click() sends clickCount 1, which Chromium reports
  // as the event's detail: a new click, not a double-click's second press.
  await hover(at);
  assert.equal(await pointer(), false);
  await click(at);
  assert.equal(await screen.evaluate(`${terminal}.hasSelection()`), false);
  assert.equal((await openedUrls(screen)).length, 1);
  await waitFor(pointer);
  await click(at);
  assert.equal((await openedUrls(screen)).length, 2);
  await click(at, { button: "right" });
  await screen.wait(action("terminal-paste-menu"));
  assert.equal((await openedUrls(screen)).length, 2);
  await screen.key("Escape");
  // With focus in another pane, the first click only brings focus back.
  const group = await screen.attribute(
    `[data-iori-tab-id="terminal:${terminalId}"]`,
    "data-iori-group-id",
    "[data-iori-group-id]",
  );
  await screen.click(
    `[data-iori-group-id="${group}"] ${action("workspace-split-right")}`,
  );
  const launcher =
    '[data-iori-view="workspace-start"] .cli-launcher-search input';
  await screen.wait(launcher);
  await click(
    await screen.evaluate(
      `(()=>{const r=document.querySelector(${JSON.stringify(launcher)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    ),
  );
  assert.equal(
    await screen.evaluate(
      `document.activeElement===document.querySelector(${JSON.stringify(launcher)})`,
    ),
    true,
  );
  // Without focus the link does not look clickable and the first click only
  // brings focus back; then it looks clickable and a new click opens it.
  at = await point(url);
  await hover(at);
  assert.equal(await pointer(), false);
  await click(at);
  assert.equal((await openedUrls(screen)).length, 2);
  await waitFor(pointer);
  await click(at);
  assert.equal((await openedUrls(screen)).length, 3);
  await screen.click(
    '.dock-tab-header:has([data-iori-tab-kind="start"]) [data-iori-action="workspace-close-tab"]',
  );
  // Alt+click keeps xterm's cursor move and does not open the link.
  at = await point(url);
  await hover(at);
  await click(at, { modifiers: 1 });
  assert.equal((await openedUrls(screen)).length, 3);
}

async function mouseReportingLinks({ client, point, pointer, hover, click }) {
  const screen = client.screen;
  const url = "https://example.com/iori-mouse";
  // The program prints the URL, asks for mouse reports and ends with the
  // first click it reads, which must be the one beside the link.
  const program = `import sys,tty,termios,os; fd=sys.stdin.fileno(); old=termios.tcgetattr(fd); tty.setraw(fd); print('\\r\\nhttps://example.com/iori-'+'mouse\\r\\n\\x1b[?1000h\\x1b[?1006h',end='',flush=True); data=b''.join(iter(lambda: os.read(fd,1),b'm'))+b'm'; termios.tcsetattr(fd,termios.TCSANOW,old); print('\\x1b[?1000l\\x1b[?1006l'); print('MOUSE_PACKET_'+data.hex()+'_END',flush=True)`;
  await clearObserved(client);
  await typeTerminal(client, `python3 -c "${program}"\r`);
  await observed(client, url);
  await waitFor(
    () => screen.evaluate(`${terminal}.modes.mouseTrackingMode`),
    (value) => value !== "none",
  );
  const at = await point(url);
  await hover(at);
  await waitFor(pointer);
  const opened = (await openedUrls(screen)).length;
  await click(at);
  assert.deepEqual((await openedUrls(screen)).slice(opened), [url]);
  assert.notEqual(
    await screen.evaluate(`${terminal}.modes.mouseTrackingMode`),
    "none",
  );
  // A click 40 cells to the right of the link, on blank output.
  const beside = await screen.evaluate(
    `(()=>{const t=${terminal};const r=t.element.querySelector('.xterm-screen').getBoundingClientRect();const cell=r.width/t.cols;const x=${at.x}+40*cell;return {x,y:${at.y},col:Math.floor((x-r.x)/cell)+1};})()`,
  );
  await hover({ x: beside.x, y: beside.y });
  await click({ x: beside.x, y: beside.y });
  await observed(client, /MOUSE_PACKET_[0-9a-f]+_END/u);
  const packet = await screen.evaluate(
    `(()=>{const b=${terminal}.buffer.active;for(let row=b.length-1;row>=0;row--){const m=/MOUSE_PACKET_([0-9a-f]+)_END/.exec(b.getLine(row).translateToString());if(m)return m[1];}})()`,
  );
  const report = /\x1b\[<(\d+);(\d+);\d+M/u.exec(
    Buffer.from(packet, "hex").toString(),
  );
  assert.deepEqual([report?.[1], Number(report?.[2])], ["0", beside.col]);
  assert.equal((await openedUrls(screen)).length, opened + 1);
}

async function ctrlClickSetting({
  client,
  point,
  pointer,
  hover,
  click,
  shot,
}) {
  const screen = client.screen;
  const choose = (name, option) => chooseOption(screen, name, option);
  // The display settings with the default "Click", then the open choices.
  for (const [name, viewport] of [
    ["wqhd", { width: 2560, height: 1440 }],
    ["pc", { width: 1440, height: 1000 }],
  ]) {
    await client.browser.viewport(viewport);
    await settingsShots(screen, shot, name);
  }
  await openSettingsSection(screen, "settings-display");
  await choose("display-theme", "theme-dark");
  await screen.click(action("terminal-link-open"));
  await screen.wait('[role="option"][data-iori-option="link-open-click"]');
  await shot("pc-settings-link-open-choices-dark");
  await screen.click(
    '[role="option"][data-state][data-iori-option="link-open-ctrl-click"]',
  );
  await waitFor(
    () => screen.visible('[role="option"]'),
    (shown) => !shown,
  );
  await choose("display-theme", "theme-system");
  await screen.click(action("settings-close"));
  await screen.wait(
    '[data-iori-view="terminal"][data-iori-stream-state="ready"]',
  );
  const url = "https://example.com/iori-ctrl";
  await clearObserved(client);
  await typeTerminal(
    client,
    "printf '\\n%s%s\\n' 'https://example.' 'com/iori-ctrl'\r",
  );
  await observed(client, url);
  const at = await point(url);
  await hover(at, 2);
  await waitFor(pointer);
  await hover({ x: at.x + 1, y: at.y });
  await waitFor(pointer, (shown) => !shown);
  const opened = (await openedUrls(screen)).length;
  await click(at);
  assert.equal((await openedUrls(screen)).length, opened);
  await click(at, { modifiers: 2 });
  assert.deepEqual((await openedUrls(screen)).slice(opened), [url]);
  await openSettingsSection(screen, "settings-display");
  await choose("terminal-link-open", "link-open-click");
  await screen.click(action("settings-close"));
}
