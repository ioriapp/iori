import { terminalFit } from "./terminal-fit.mjs";
import { terminalSend } from "./terminal-send.mjs";
import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import { openClaude } from "../cli-screen/claude-status.mjs";
import { mobileTerminalReading } from "./mobile-terminal-reading.mjs";
import { openSidebar } from "../connection/scenario.mjs";
import assert from "node:assert/strict";
import { Cdp, waitFor } from "../../verification/ui.mjs";
import {
  typeTerminal,
  observed,
  clearObserved,
  observe,
  observeTerminalInstances,
  create,
  open,
} from "../terminal/scenario.mjs";

import { terminalMouseScroll } from "../terminal/mouse-scroll.mjs";

const action = (name) => `[data-iori-action="${name}"]`;
const terminal = `document.querySelector('[data-iori-view="terminal"][data-iori-displayed="true"] [data-iori-part="terminal-screen"]').__e2eTerminal`;

export async function terminalPreferences({
  client,
  record,
  shot,
  worktree,
  mobile,
  desktop,
  clipboardFiles,
  reload,
}) {
  await terminalSend({ client, record, worktree, clipboardFiles });
  await terminalFit({ client, record });
  const screen = client.screen;
  const rightClick = async (modifiers = 0) => {
    const point = await screen.point(
      '[data-iori-view="terminal"][data-iori-displayed="true"] .xterm-screen',
    );
    for (const type of ["mousePressed", "mouseReleased"]) {
      await client.browser.call("Input.dispatchMouseEvent", {
        type,
        ...point,
        button: "right",
        clickCount: 1,
        modifiers,
      });
    }
  };
  const configure = async (name, label) => {
    await screen.click(action("settings-open"));
    await screen.click(action("settings-display"));
    await screen.click(action(name));
    await screen.click(`[role="option"][data-state]` + label);
    await screen.click(action("settings-close"));
  };
  await shot("sidebar-before-preferences");
  // Keep the same Terminal open while only the window's width changes. The
  // responsive layout must retain this Client's size ownership without a click.
  const originalViewport = await screen.evaluate(
    "({width:innerWidth,height:innerHeight})",
  );
  const terminalId = await screen.attribute(
    '[data-iori-view="terminal"]',
    "data-iori-terminal-id",
  );
  const responsivePane = `[data-iori-view="terminal"][data-iori-terminal-id=${JSON.stringify(terminalId)}]`;
  // The preceding window-resize gesture also restores its viewport. Read the
  // starting grid only once it fills that viewport, after the coalesced fit.
  const originalSize = await waitFor(() =>
    screen.evaluate(`(()=>{
    const t=${terminal};
    const mount=t.element.parentElement;
    const grid=t.element.querySelector('.xterm-screen').getBoundingClientRect();
    const bottom=mount.getBoundingClientRect().bottom-parseFloat(getComputedStyle(mount).paddingBottom);
    const gap=bottom-grid.bottom;
    return gap>=-0.5&&gap<grid.height/t.rows+0.5?{cols:t.cols,rows:t.rows}:null;
  })()`),
  );
  const sizeReporter = [
    "import os,signal,time",
    "def report(*_):",
    "  size=os.get_terminal_size(0)",
    "  print('\\r\\nRESPONSIVE_%dx%d'%(size.columns,size.lines),flush=True)",
    "signal.signal(signal.SIGWINCH,report)",
    "report()",
    "while True: time.sleep(60)",
  ].join("\n");
  // Slow the real renderer so accepted keystrokes are still draining on the
  // old stream when the responsive layout opens its replacement. The old
  // stream must deliver the command without reclaiming its previous grid.
  await client.browser.call("Emulation.setCPUThrottlingRate", { rate: 8 });
  try {
    await clearObserved(client);
    await typeTerminal(
      client,
      `python3 -c '${`exec(${JSON.stringify(sizeReporter)})`.replaceAll("'", "'\\''")}'\r`,
    );
    // Change width immediately after typing, without waiting for echo or output.
    // The accepted command must survive replacing the Terminal's stream.
    for (const [viewport, phoneWidth] of [
      [{ width: 390, height: 844 }, true],
      [originalViewport, false],
    ]) {
      if (!phoneWidth) await clearObserved(client);
      await client.browser.call("Emulation.setDeviceMetricsOverride", {
        ...viewport,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await screen.wait(`${responsivePane}[data-iori-stream-state="ready"]`);
      if (phoneWidth) await observed(client, /RESPONSIVE_\d+x\d+/u);
      const size = await waitFor(
        () =>
          screen.evaluate(`(()=>{
          const pane=document.querySelector(${JSON.stringify(responsivePane)});
          const mount=pane?.querySelector('[data-iori-part="terminal-screen"]');
          const grid=mount?.querySelector('.xterm-screen');
          if(!grid)return null;
          const cols=Number(pane.dataset.ioriCols),rows=Number(pane.dataset.ioriRows);
          const r=grid.getBoundingClientRect();
          const viewport=pane.querySelector('[data-iori-part="terminal-viewport"]').getBoundingClientRect();
          return {cols,rows,fits:r.right<=viewport.right+0.5&&r.bottom<=viewport.bottom+0.5};
        })()`),
        (size) =>
          size?.fits &&
          (phoneWidth
            ? size.cols < originalSize.cols && size.rows < originalSize.rows
            : size.cols === originalSize.cols &&
              size.rows === originalSize.rows),
        undefined,
        "選び直さずにTerminalの文字の升目が画面の幅と高さに収まる",
      );
      await observed(client, `RESPONSIVE_${size.cols}x${size.rows}`);
    }
  } finally {
    await client.browser.call("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
  // Leave the following touch/reload scenarios to Playwright's viewport owner.
  await client.browser.call("Emulation.clearDeviceMetricsOverride");
  await typeTerminal(client, "\x03");
  await record(
    "命令の入力直後に同じTerminalをPC→スマホ→PCへ幅変更しても入力が欠けず、画面・Client・実PTYの寸法が追従",
  );
  const fontInput = '[data-iori-field="terminal-font-family"]';
  const openFontSettings = async () => {
    await screen.click(action("settings-open"));
    await screen.click(action("settings-display"));
  };
  const fontValue = "Missing Font \"quoted\"\\name, 'JetBrains Mono Variable'";
  const defaultFamily = await screen.evaluate(
    `(async()=>{const {DEFAULT_TERMINAL_FONT_FAMILY}=await import('/src/terminal/terminal-font-family.ts');return DEFAULT_TERMINAL_FONT_FAMILY;})()`,
  );
  const expectedFamily =
    '"Missing Font \\"quoted\\"\\\\name", "JetBrains Mono Variable", ' +
    defaultFamily;
  await openFontSettings();
  const fontOptions = '.terminal-font-options[data-state="open"]';
  const fontList = `${fontOptions} [role="listbox"]`;
  const pointAtFont = (selector) => screen.point(selector);
  const clickFont = async (selector) => {
    const point = await pointAtFont(selector);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await client.browser.call("Input.dispatchMouseEvent", {
        type,
        ...point,
        button: "left",
        clickCount: 1,
      });
    }
  };
  await clickFont(fontInput);
  await screen.wait(fontOptions);
  const selectedFont = `${fontList} [aria-selected="true"]`;
  assert.equal(await screen.visible(selectedFont), false);
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...(await pointAtFont(`${fontList} [role="option"]`)),
  });
  await screen.wait(fontOptions);
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    ...(await pointAtFont(fontList)),
    deltaX: 0,
    deltaY: 500,
  });
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector(${JSON.stringify(fontList)})?.scrollTop > 0`,
    ),
  );
  await clickFont(`${fontList} [data-value="Ubuntu Mono"]`);
  assert.equal(await screen.value(fontInput), "Ubuntu Mono");
  await waitFor(
    () => screen.visible(fontOptions),
    (visible) => !visible,
  );
  // Filter only the final comma-separated name, retaining the preceding font.
  await screen.input(fontInput, "Ubuntu Mono, Fira");
  await screen.wait(fontOptions);
  await screen.key("ArrowDown");
  await waitFor(
    () => screen.text(selectedFont),
    (text) => text === "Fira Mono",
  );
  await client.browser.call("Input.insertText", { text: "C" });
  await waitFor(
    () => screen.value(fontInput),
    (value) => value === "Ubuntu Mono, FiraC",
  );
  assert.equal(await screen.visible(selectedFont), false);
  assert.equal(await screen.attribute(fontInput, "aria-activedescendant"), "");
  await screen.key("Enter");
  await screen.wait('[data-iori-state="terminal-font-saved"]');
  assert.equal(await screen.value(fontInput), "Ubuntu Mono, FiraC");
  await waitFor(
    () => screen.evaluate(`${terminal}.options.fontFamily`),
    (value) => value === '"Ubuntu Mono", "FiraC", ' + defaultFamily,
  );
  await screen.input(fontInput, "");
  await screen.key("Enter");
  await screen.wait('[data-iori-state="terminal-font-saved"]');
  await waitFor(
    () => screen.evaluate(`${terminal}.options.fontFamily`),
    (value) => value === defaultFamily,
  );
  await screen.input(fontInput, "Ubuntu Mono, cAsCaDiA");
  await screen.wait(fontOptions);
  assert.equal(await screen.visible(selectedFont), false);
  assert.equal(await screen.attribute(fontInput, "aria-activedescendant"), "");
  assert.deepEqual(
    await screen.evaluate(
      `Array.from(document.querySelectorAll(${JSON.stringify(`${fontList} [role="option"]`)}),e=>e.getAttribute('data-value'))`,
    ),
    ["Cascadia Code", "Cascadia Mono"],
  );
  await screen.key("ArrowDown");
  await waitFor(
    () => screen.text(selectedFont),
    (text) => text === "Cascadia Code",
  );
  await screen.key("ArrowDown");
  await waitFor(
    () => screen.text(`${fontList} [aria-selected="true"]`),
    (text) => text === "Cascadia Mono",
  );
  await screen.key("ArrowUp");
  await waitFor(
    () => screen.text(`${fontList} [aria-selected="true"]`),
    (text) => text === "Cascadia Code",
  );
  await screen.key("Enter");
  assert.equal(await screen.value(fontInput), "Ubuntu Mono, Cascadia Code");
  await waitFor(
    () => screen.visible(fontOptions),
    (visible) => !visible,
  );
  assert.equal(
    await screen.visible('[data-iori-state="terminal-font-saved"]'),
    false,
  );
  await screen.input(fontInput, "Fira");
  await screen.wait(fontOptions);
  await screen.key("Escape");
  await waitFor(
    () => screen.visible(fontOptions),
    (visible) => !visible,
  );
  assert.ok(await screen.visible(action("settings-close")));
  await screen.input(fontInput, "Mono");
  await screen.wait(fontOptions);
  await screen.key("Tab");
  await waitFor(
    () => screen.visible(fontOptions),
    (visible) => !visible,
  );
  await clickFont(".terminal-font-settings label");
  await screen.wait(fontOptions);
  await clickFont('[data-iori-action="settings-display"]');
  await waitFor(
    () => screen.visible(fontOptions),
    (visible) => !visible,
  );
  await record(
    "Terminalフォント候補の焦点での表示・マウス移動・ホイール・クリック・末尾の絞り込み・選択後の追加入力で未選択に戻りEnterで保存・上下矢印とEnter・Esc・Tab・欄の外のクリック",
  );
  await screen.input(fontInput, "unsaved");
  await screen.click(action("settings-close"));
  await screen.wait('[data-iori-view="settings-discard-confirmation"]');
  await screen.click(action("settings-discard"));
  assert.equal(
    await screen.evaluate(`${terminal}.options.fontFamily`),
    defaultFamily,
  );
  await openFontSettings();
  await screen.input(fontInput, `  ${fontValue}  `);
  await screen.key("Tab");
  assert.equal(
    await screen.evaluate(`${terminal}.options.fontFamily`),
    defaultFamily,
  );
  await screen.click(action("save-terminal-font"));
  await screen.wait('[data-iori-state="terminal-font-saved"]');
  await screen.click(action("settings-close"));
  await waitFor(
    () => screen.evaluate(`${terminal}.options.fontFamily`),
    (value) => value === expectedFamily,
  );
  await openFontSettings();
  await screen.input(fontInput, "Fira");
  await screen.wait(fontOptions);
  assert.equal(await screen.visible(selectedFont), false);
  await screen.key("Enter");
  await screen.wait('[data-iori-state="terminal-font-saved"]');
  assert.equal(await screen.value(fontInput), "Fira");
  await waitFor(
    () => screen.evaluate(`${terminal}.options.fontFamily`),
    (value) => value === '"Fira", ' + defaultFamily,
  );
  await screen.input(fontInput, "");
  await screen.key("Enter");
  await screen.wait('[data-iori-state="terminal-font-saved"]');
  await screen.click(action("settings-close"));
  await waitFor(
    () => screen.evaluate(`${terminal}.options.fontFamily`),
    (value) => value === defaultFamily,
  );
  await openFontSettings();
  await screen.input(fontInput, fontValue);
  await screen.click(action("save-terminal-font"));
  await screen.wait('[data-iori-state="terminal-font-saved"]');
  await screen.click(action("settings-close"));
  await record(
    "Terminalフォントの保存・即時反映・候補未選択のEnterで入力値を保存・空欄で既定へ戻る操作・未保存の破棄確認",
  );
  const before = await screen.evaluate(
    `({font:${terminal}.options.fontSize,cols:${terminal}.cols})`,
  );
  assert.equal(before.font, 14);
  await configure(
    "terminal-text-size",
    '[data-iori-option="terminal-size-18"]',
  );
  await waitFor(
    () => screen.evaluate(`${terminal}.options.fontSize`),
    (value) => value === 18,
  );
  const cols = await screen.evaluate(`${terminal}.cols`);
  assert.ok(cols < before.cols);
  await clearObserved(client);
  await typeTerminal(client, "printf 'FONT_COLS_%s_END\\n' \"$(tput cols)\"\r");
  await observed(client, `FONT_COLS_${cols}_END`);
  await record("Terminal文字サイズ変更が開いた画面と実PTY列数へ反映");
  await configure(
    "terminal-right-click",
    '[data-iori-option="right-click-copy-paste"]',
  );
  await screen.evaluate(
    `(async()=>{const {native}=await import('/src/native.ts');await native.clipboardWrite("printf '%s%s\\n' 'RIGHT_' 'PASTE'");return true;})()`,
  );
  await rightClick();
  assert.equal(await screen.visible(action("terminal-paste-menu")), false);
  await observed(client, "RIGHT_");
  await typeTerminal(client, "\r");
  await observed(client, "RIGHT_PASTE");
  // Double-click a real rendered output word, then use right-click to copy it.
  const point = await screen.evaluate(
    `(()=>{const t=${terminal};for(let row=t.buffer.active.viewportY;row<t.buffer.active.length;row++){const text=t.buffer.active.getLine(row).translateToString();const col=text.indexOf('RIGHT_PASTE');if(col>=0){const r=t.element.querySelector('.xterm-screen').getBoundingClientRect();return {x:r.x+(col+2)*r.width/t.cols,y:r.y+(row-t.buffer.active.viewportY+0.5)*r.height/t.rows};}}throw new Error('Output word missing');})()`,
  );
  for (const type of ["mousePressed", "mouseReleased"]) {
    await client.browser.call("Input.dispatchMouseEvent", {
      type,
      ...point,
      button: "left",
      clickCount: 2,
    });
  }
  await waitFor(
    () => screen.evaluate(`${terminal}.getSelection()`),
    (value) => value === "RIGHT_PASTE",
  );
  await rightClick();
  await waitFor(
    () => screen.evaluate(`${terminal}.hasSelection()`),
    (value) => !value,
  );
  assert.equal(
    await screen.evaluate(
      `(async()=>{const {native}=await import('/src/native.ts');return native.clipboardRead();})()`,
    ),
    "RIGHT_PASTE",
  );
  assert.equal(await screen.visible(action("terminal-paste-menu")), false);
  await configure(
    "terminal-right-click",
    '[data-iori-option="right-click-menu"]',
  );
  await rightClick();
  await screen.wait(action("terminal-paste-menu"));
  await screen.key("Escape");
  await record("右クリックのコピー・選択解除・貼り付けとメニュー切替");
  // A real PTY program requests mouse reporting and reads the actual packet.
  for (const [motion, setting] of ["no-preference", "reduce"].flatMap(
    (motion) => ["menu", "copy-paste"].map((setting) => [motion, setting]),
  )) {
    await client.browser.call("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: motion }],
    });
    await configure(
      "terminal-right-click",
      `[data-iori-option="right-click-${setting}"]`,
    );
    const keyboardMode = setting === "copy-paste" ? "\\x1b[=3u" : "";
    const program = `import sys,tty,termios,os; fd=sys.stdin.fileno(); old=termios.tcgetattr(fd); tty.setraw(fd); print('\\r\\nSHIFT_COPY\\r\\n${keyboardMode}\\x1b[?1000h\\x1b[?1006h',end='',flush=True); data=b''.join(iter(lambda: os.read(fd,1),b'm'))+b'm'; termios.tcsetattr(fd,termios.TCSANOW,old); print('\\x1b[=0u\\x1b[?1000l\\x1b[?1006l'); print('MOUSE_PACKET_'+data.hex()+'_END',flush=True)`;
    await clearObserved(client);
    await typeTerminal(client, `python3 -c "${program}"\r`);
    await waitFor(
      () => screen.evaluate(`${terminal}.modes.mouseTrackingMode`),
      (value) => value !== "none",
    );
    await rightClick(2);
    await screen.wait(action("terminal-paste-menu"));
    assert.notEqual(
      await screen.evaluate(`${terminal}.modes.mouseTrackingMode`),
      "none",
    );
    await screen.key("Escape");
    // Shift-drag selects output even while the PTY program owns the mouse.
    const selection = await screen.evaluate(
      `(()=>{const t=${terminal};for(let row=t.buffer.active.length-1;row>=t.buffer.active.viewportY;row--){const text=t.buffer.active.getLine(row).translateToString();const col=text.indexOf('SHIFT_COPY');if(col>=0){const r=t.element.querySelector('.xterm-screen').getBoundingClientRect();const cell=r.width/t.cols;return {x:r.x+(col+0.25)*cell,y:r.y+(row-t.buffer.active.viewportY+0.5)*r.height/t.rows,end:r.x+(col+10.25)*cell};}}throw new Error('Selection word missing');})()`,
    );
    await client.browser.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: selection.x,
      y: selection.y,
      button: "left",
      clickCount: 1,
      modifiers: 8,
    });
    await client.browser.call("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: selection.end,
      y: selection.y,
      button: "left",
      buttons: 1,
      modifiers: 8,
    });
    await client.browser.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: selection.end,
      y: selection.y,
      button: "left",
      clickCount: 1,
      modifiers: 8,
    });
    await waitFor(
      () => screen.evaluate(`${terminal}.getSelection()`),
      (value) => value === "SHIFT_COPY",
    );
    await rightClick(8);
    if (setting === "menu") {
      await screen.wait(action("terminal-paste-menu"));
      await screen.key("Escape");
    } else {
      await waitFor(
        () => screen.evaluate(`${terminal}.hasSelection()`),
        (value) => !value,
      );
      assert.equal(
        await screen.evaluate(
          `(async()=>{const {native}=await import('/src/native.ts');return native.clipboardRead();})()`,
        ),
        "SHIFT_COPY",
      );
      assert.equal(
        await screen.visible(
          '[role="menu"][data-state="open"] ' + action("terminal-paste-menu"),
        ),
        false,
      );
    }
    // The program must still be waiting: only the unmodified right-click below
    // may supply the packet that ends it. A Shift packet has a different code.
    assert.notEqual(
      await screen.evaluate(`${terminal}.modes.mouseTrackingMode`),
      "none",
    );
    await rightClick();
    await observed(client, "MOUSE_PACKET_1b5b3c32");
    assert.equal(
      await screen.visible(
        '[role="menu"][data-state="open"] ' + action("terminal-paste-menu"),
      ),
      false,
    );
  }
  await client.browser.call("Emulation.setEmulatedMedia", { features: [] });
  await record(
    "動きの有無と両設定でEscをメニューだけに渡し、Ctrl・Shift・通常の右クリックを実PTYで確認",
  );
  await configure("display-text-size", ":last-child");
  await configure(
    "terminal-text-size",
    '[data-iori-option="terminal-size-14"]',
  );
  await client.browser.call("Emulation.setTouchEmulationEnabled", {
    enabled: true,
  });
  await mobile();
  await screen.wait('[data-iori-view="workspace"]');
  await openSidebar(screen);
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  if (!(await screen.visible(action("sidebar-open-terminal"))))
    await openSidebar(screen);
  await shot("mobile-sidebar");
  await openWorkspaceView(screen, "terminal");
  await screen.wait(
    '[data-iori-view="terminal"][data-iori-stream-state="ready"]',
  );
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  await observeTerminalInstances(client);
  await create(client);
  await terminalMouseScroll(client);
  await record(
    "スマホの上下スワイプが実PTYへ正しい座標のホイール報告として届く",
  );
  await terminalTextSelection({ client, record, shot });
  await mobileTerminalReading({ client, record, shot });
  await desktop();
  await screen.wait(
    '[data-iori-view="terminal"][data-iori-stream-state="ready"]',
  );
  await shot("desktop-sidebar");
  // The CLI's default batch input and desktop-width scale use the same menu.
  const cliId = await openClaude(client);
  await screen.click(
    `.dock-tab-header:has([data-iori-tab-id="terminal:${cliId}"]) [data-iori-action="workspace-close-tab"]`,
  );
  await mobile();
  await screen.wait('[data-iori-view="workspace"]');
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  await observeTerminalInstances(client);
  await open(client, cliId);
  await screen.wait('[data-iori-field="terminal-batch-input"]');
  await screen.click(action("terminal-width-toggle"));
  const target = await waitFor(() =>
    screen.evaluate(`(()=>{
    const t=document.querySelector('[data-iori-terminal-id="${cliId}"] [data-iori-part="terminal-screen"]').__e2eTerminal;
    const b=t.buffer.active;
    for(let row=b.viewportY;row<b.viewportY+t.rows;row++){
      const line=b.getLine(row),text=line?.translateToString(true);
      if(text?.includes('Haiku')&&!line.isWrapped&&!b.getLine(row+1)?.isWrapped){
        const r=t.element.querySelector('.xterm-screen').getBoundingClientRect();
        return {text,x:r.x+r.width/2,y:r.y+(row-b.viewportY+0.5)*r.height/t.rows};
      }
    }
  })()`),
  );
  await Cdp.prototype.longPress.call(client.browser, {
    x: target.x,
    y: target.y,
  });
  await screen.click(action("terminal-select-text"));
  await waitFor(
    () => screen.evaluate("window.getSelection()?.toString()"),
    (value) => value === target.text,
  );
  await shot("mobile-cli-long-press-text");
  await screen.click(
    '[data-iori-panel="terminal-text"] [data-slot="sheet-close"]',
  );
  await record(
    "Claude Code（haiku）のまとめて入力・縮小表示で長押しした行をテキスト選択",
  );
  await desktop();
  // Persistence is visible in Settings itself; no renderer observer is needed
  // after reloading the Client.
  await reload();
  await screen.wait('[data-iori-view="workspace"]');
  await openFontSettings();
  assert.equal(await screen.value(fontInput), fontValue);
  await screen.input(fontInput, "");
  await screen.key("Enter");
  await screen.wait('[data-iori-state="terminal-font-saved"]');
  await screen.click(action("settings-close"));
  await record(
    "Clientを読み込み直しても保存したTerminalのフォント名が設定欄に残る",
  );
}

async function terminalTextSelection({ client, record, shot }) {
  const screen = client.screen;
  const terminal = `document.querySelector('[data-iori-view="terminal"][data-iori-displayed="true"] [data-iori-part="terminal-screen"]').__e2eTerminal`;
  const longLine = "TEXT_SELECTION_" + "abcdefghij".repeat(12);
  await clearObserved(client);
  await typeTerminal(
    client,
    `printf '\\033[2J\\033[H'; printf '%s\\n' '${longLine}' 'SECOND_TEXT_LINE' 'THIRD_TEXT_LINE'\r`,
  );
  const point = await waitFor(() =>
    screen.evaluate(
      `(()=>{const t=${terminal};const b=t.buffer.active;const lines=Array.from({length:b.length},(_,row)=>b.getLine(row).translateToString(true));if(!lines.includes('THIRD_TEXT_LINE'))return;for(let row=b.viewportY;row<b.length;row++){if(lines[row].startsWith('TEXT_SELECTION_')){const r=t.element.querySelector('.xterm-screen').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+(row-b.viewportY+1.5)*r.height/t.rows};}}})()`,
    ),
  );
  await Cdp.prototype.longPress.call(client.browser, point);
  await screen.click(action("terminal-select-text"));
  await screen.wait('[data-iori-panel="terminal-text"]');
  await waitFor(
    () => screen.evaluate("window.getSelection()?.toString()"),
    (value) => value === longLine,
  );
  const output = await screen.evaluate(
    `document.querySelector('[data-iori-panel="terminal-text"] .terminal-text-output').textContent`,
  );
  assert.ok(output.includes(`${longLine}\nSECOND_TEXT_LINE\nTHIRD_TEXT_LINE`));
  await shot("mobile-terminal-text-selection");
  await screen.click(
    '[data-iori-panel="terminal-text"] [data-slot="sheet-close"]',
  );
  await waitFor(
    () => screen.visible('[data-iori-panel="terminal-text"]'),
    (value) => !value,
  );
  assert.ok(await screen.visible('[data-iori-part="terminal-screen"]'));
  await record(
    "スマホの出力をテキストで開き、折り返し行の結合・長押し行の選択・Terminalへ戻る操作を確認",
  );
}
