import assert from "node:assert/strict";
import { Cdp, waitFor } from "../../verification/ui.mjs";
import { typeTerminal, observed } from "../terminal/scenario.mjs";

export async function terminalClipboard({ client, record }) {
  await copyMargin({ client, record });
  const { screen } = client;
  const read = () => screen.evaluate("navigator.clipboard.readText()");
  await screen.evaluate(
    "navigator.clipboard.writeText('before-osc52').then(()=>true)",
  );
  await typeTerminal(
    client,
    "printf '\\033]52;c;%s\\a' \"$(printf 'iori-osc52-日本語' | base64 -w0)\"; printf 'OSC_%s\\n' DONE\r",
  );
  await observed(client, "OSC_DONE");
  await waitFor(read, (value) => value === "iori-osc52-日本語");
  await record("OSC 52で実PTYの文字列をクリップボードへコピー");

  // The PTY application owns the drag and requests the copy on SGR release,
  // as a CLI with mouse reporting does. No key input restores focus after
  // clicking outside the Terminal: the drag alone must reclaim the view.
  const mouseProgram =
    "import sys,tty,termios,os,base64; fd=sys.stdin.fileno(); old=termios.tcgetattr(fd); tty.setraw(fd); print('\\x1b[?1000h\\x1b[?1002h\\x1b[?1006h\\r\\nMOUSE_'+'READY',flush=True); data=b''.join(iter(lambda: os.read(fd,1),b'm'))+b'm'; print('\\x1b]52;c;'+base64.b64encode(b'iori-mouse-copy').decode()+'\\x07\\x1b[?1000l\\x1b[?1002l\\x1b[?1006l',flush=True); termios.tcsetattr(fd,termios.TCSANOW,old)";
  await typeTerminal(client, `python3 -c "${mouseProgram}"\r`);
  await observed(client, "MOUSE_READY");
  await screen.click('[data-slot="sidebar-header"] input');
  const drag = await screen.evaluate(
    `(()=>{const r=document.querySelector('[data-iori-part="terminal-screen"] .xterm-screen').getBoundingClientRect();return {x:r.x+r.width/4,y:r.y+r.height/2,end:r.x+r.width/2};})()`,
  );
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: drag.x,
    y: drag.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: drag.end,
    y: drag.y,
    button: "left",
    buttons: 1,
  });
  await client.browser.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: drag.end,
    y: drag.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await waitFor(read, (value) => value === "iori-mouse-copy");
  await record("Terminal外からマウスドラッグだけで操作を戻し、OSC 52でコピー");

  await screen.evaluate(
    "navigator.clipboard.writeText('after-copy').then(()=>true)",
  );
  // A real raw-mode PTY reader records all input up to the user's Enter.
  // A clipboard reply would precede that Enter and appear in the hex output.
  const program =
    "import sys,tty,termios,os; fd=sys.stdin.fileno(); old=termios.tcgetattr(fd); tty.setraw(fd); print('\\x1b]52;c;?\\x07\\r\\nQUERY_'+'READY',flush=True); data=b''.join(iter(lambda: os.read(fd,1),b'\\r')); termios.tcsetattr(fd,termios.TCSANOW,old); print('\\r\\nQUERY_BYTES_'+data.hex()+'_END',flush=True)";
  await typeTerminal(client, `python3 -c "${program}"\r`);
  await observed(client, "QUERY_READY");
  await typeTerminal(client, "\r");
  await observed(client, "QUERY_BYTES__END");
  assert.equal(await read(), "after-copy");
  await record("OSC 52読取へ応答しない");

  await screen.evaluate("window.__clipboardReloadPending = true");
  await client.browser.call("Page.reload");
  await waitFor(() =>
    screen
      .evaluate(
        "!window.__clipboardReloadPending && document.readyState === 'complete'",
      )
      .catch(() => false),
  );
  await screen.wait(
    '[data-iori-view="terminal"][data-iori-stream-state="ready"]',
  );
  assert.equal(await read(), "after-copy");
  await record("再読込で過去のOSC 52コピーを再実行しない");
}

// Select the actual PTY output with a mouse drag; copy through the user's keys.
async function copyMargin({ client, record }) {
  const { screen } = client;
  const terminal = `document.querySelector('[data-iori-part="terminal-screen"]').__e2eTerminal`;
  const raw = "  first reply\n    nested reply\n  last reply";
  const trimmed = "first reply\n  nested reply\nlast reply";
  await typeTerminal(
    client,
    "printf '\\033[2J\\033[H  first reply\\n    nested reply\\n  last reply\\n'\r",
  );
  await observed(client, "last reply");
  const select = async () => {
    const points = await waitFor(() =>
      screen.evaluate(`(()=>{
      const t=${terminal};
      const first=t.buffer.active.viewportY;
      for(let row=first;row<first+t.rows-2;row++) {
        if(t.buffer.active.getLine(row)?.translateToString(true)!=='  first reply') continue;
        const r=t.element.querySelector('.xterm-screen').getBoundingClientRect();
        const cell=r.width/t.cols, height=r.height/t.rows;
        return {from:{x:r.x+0.1*cell,y:r.y+(row-first+0.5)*height},
          to:{x:r.x+12.1*cell,y:r.y+(row-first+2.5)*height}};
      }
      return null;
    })()`),
    );
    await Cdp.prototype.drag.call(client.browser, points.from, points.to);
    await waitFor(
      () => screen.evaluate(`${terminal}.getSelection()`),
      (value) => value === raw,
    );
  };
  const copy = async (key, expected) => {
    await screen.evaluate(
      "navigator.clipboard.writeText('before-margin-copy').then(()=>true)",
    );
    await select();
    await screen.key(key);
    await waitFor(
      () => screen.evaluate("navigator.clipboard.readText()"),
      (value) => value === expected,
    );
  };
  await copy("Control+Shift+c", trimmed);
  await copy("Control+c", trimmed);
  await copy("Control+Insert", trimmed);
  await record(
    "Ctrl+Shift+C・Ctrl+C・Ctrl+Insertの複数行コピーから共通の余白だけ外れる",
  );
}
