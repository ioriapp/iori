import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import {
  clearObserved,
  observedTerminalMode,
  typeTerminal,
} from "./scenario.mjs";

// The real PTY program returns exactly the bytes it received, without letting
// the terminal interpret them as escape sequences again.
const program = `import os,sys,tty,termios
fd=sys.stdin.fileno()
old=termios.tcgetattr(fd)
tty.setraw(fd)
try:
 os.write(1,b'\\x1b[?1000h\\x1b[?1006h')
 data=b''
 while True:
  byte=os.read(fd,1)
  if byte==b'\\x04': break
  data+=byte
 os.write(1,b'\\x1b[?1000l\\x1b[?1006l\\r\\nSCROLL_BYTES_'+data.hex().encode()+b'_END\\r\\n')
finally:
 termios.tcsetattr(fd,termios.TCSANOW,old)
`;

export async function terminalMouseScroll(client) {
  const screen = client.screen;
  const observations = [];
  const selector =
    '[data-iori-view="terminal"][data-iori-displayed="true"] .xterm-screen';
  for (const [from, to, button] of [
    [0.75, 0.25, 65],
    [0.25, 0.75, 64],
  ]) {
    await clearObserved(client);
    await typeTerminal(
      client,
      `python3 -c 'import base64;exec(base64.b64decode("${Buffer.from(program).toString("base64")}"))'\r`,
    );
    await observedTerminalMode(client, "mouseTracking", true);
    // Observe the real gesture's last animation frame, so the PTY keeps reading
    // through the inertia after the finger is lifted. This does not emit input.
    await screen.evaluate(`(()=>{
      window.__scrollFinished=false;
      window.__scrollCoordinates={};
      const element=document.querySelector(${JSON.stringify(selector)});
      const coordinates=window.__scrollCoordinates;
      const rect=()=>{
        const r=element.getBoundingClientRect();
        return {top:r.top,height:r.height,left:r.left,width:r.width};
      };
      coordinates.before=rect();
      element.addEventListener('touchend',e=>{
        const t=e.changedTouches[0];
        coordinates.end={x:t.clientX,y:t.clientY};
      },{once:true,capture:true});
      const done=e=>{
        coordinates.gesture={x:e.clientX,y:e.clientY};
        coordinates.after=rect();
        if(e.translationX===0&&e.translationY===0){
          window.__scrollFinished=true;
          element.removeEventListener('-xterm-gesturechange',done);
        }
      };
      element.addEventListener('-xterm-gesturechange',done);
    })()`);
    if (client.nativeSwipe) {
      const bounds = await screen.evaluate(
        `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y,height:r.height};})()`,
      );
      await client.nativeSwipe(
        { x: bounds.x, y: bounds.y + bounds.height * from },
        { x: bounds.x, y: bounds.y + bounds.height * to },
      );
    } else {
      await screen.swipe(selector, { x: 0.5, y: from }, { x: 0.5, y: to });
    }
    await waitFor(() => screen.evaluate("window.__scrollFinished"));
    await typeTerminal(client, "\x04");
    const hex = await waitFor(() =>
      screen.evaluate(
        "window.__terminalObservation.tail.match(/SCROLL_BYTES_([0-9a-f]+)_END/)?.[1]",
      ),
    );
    const bytes = Buffer.from(hex, "hex").toString();
    assert.equal(
      bytes.includes("NaN"),
      false,
      "指のスクロールがNaNをPTYへ送らない",
    );
    const packets = [
      ...bytes.matchAll(/\x1b\[<(64|65);([1-9]\d*);([1-9]\d*)M/g),
    ];
    assert.ok(packets.length > 0, "実PTYがホイール報告を受け取る");
    assert.equal(packets.map(([packet]) => packet).join(""), bytes);
    const dimensions = await screen.evaluate(
      `(()=>{const p=document.querySelector('[data-iori-view="terminal"][data-iori-displayed="true"]')??document.querySelector('[data-iori-view="terminal"]');return {cols:Number(p.dataset.ioriCols),rows:Number(p.dataset.ioriRows)};})()`,
    );
    for (const [, code, col, row] of packets) {
      assert.equal(Number(code), button);
      assert.ok(
        Number(col) <= dimensions.cols && Number(row) <= dimensions.rows,
      );
    }
    const touch = await screen.evaluate("window.__scrollCoordinates");
    // Read the PTY's actual packets. Inertia varies with gesture timing, so
    // validate their direction, shape and final position rather than a count
    // inferred from xterm or a platform-specific send hook.
    const last = packets.at(-1);
    const coordinates = {
      from,
      to,
      dimensions,
      actual: { col: Number(last[2]), row: Number(last[3]) },
      expected: { col: dimensions.cols / 2, row: dimensions.rows * to },
      touch: {
        before: touch.before,
        end: touch.end,
        gesture: touch.gesture,
        after: touch.after,
        packets: packets.length,
      },
    };
    observations.push(coordinates);
    assert.ok(Math.abs(Number(last[2]) - dimensions.cols / 2) <= 1);
    assert.ok(
      Math.abs(Number(last[3]) - dimensions.rows * to) <= 1,
      `慣性中も最後に触れた位置を報告する: ${JSON.stringify(coordinates)}`,
    );
  }
  return observations;
}
