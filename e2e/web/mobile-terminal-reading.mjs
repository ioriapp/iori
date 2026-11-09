import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { openSidebar, closeSidebar } from "../connection/scenario.mjs";
import { typeTerminal } from "../terminal/scenario.mjs";

const action = (name) => `[data-iori-action="${name}"]`;
const selector = '[data-iori-view="terminal"][data-iori-displayed="true"]';
const terminal = `document.querySelector('${selector} [data-iori-part="terminal-screen"]').__e2eTerminal`;

export async function mobileTerminalReading({ client, record, shot }) {
  const screen = client.screen;
  const pinch = async (ratio) => {
    const point = await waitFor(() =>
      screen.evaluate(
        `(()=>{const element=${terminal}.element.querySelector('.xterm-screen');const r=element.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;if(element.contains(document.elementFromPoint(x,y)))return {x,y};})()`,
      ),
    );
    for (let step = 0; step <= 8; step++) {
      const radius = 50 * (1 + ((ratio - 1) * step) / 8);
      await client.browser.call("Input.dispatchTouchEvent", {
        type: step === 0 ? "touchStart" : "touchMove",
        touchPoints: [
          { id: 0, x: point.x - radius, y: point.y },
          { id: 1, x: point.x + radius, y: point.y },
        ],
      });
    }
    await client.browser.call("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  const original = await screen.evaluate(`${terminal}.options.fontSize`);
  await pinch(16 / original);
  const enlarged = await waitFor(
    () => screen.evaluate(`${terminal}.options.fontSize`),
    (value) => value > original,
  );
  await openSidebar(screen);
  await screen.click(action("settings-open"));
  await screen.click(action("settings-display"));
  assert.equal(
    await screen.evaluate(
      `document.querySelector('${action("terminal-text-size")}').textContent.trim()`,
    ),
    String(enlarged),
  );
  await screen.click(action("settings-close"));
  await closeSidebar(screen);
  await pinch(original / enlarged);
  await waitFor(
    () => screen.evaluate(`${terminal}.options.fontSize`),
    (value) => value === original,
  );
  await record("2本指のピンチで文字サイズを広げ、設定と一致し、縮めて戻せる");

  await typeTerminal(
    client,
    "i=0; while :; do printf 'READING_LINE_%s\\n' \"$i\"; i=$((i+1)); sleep 0.2; done\r",
  );
  await waitFor(
    () => screen.evaluate(`${terminal}.buffer.active.baseY`),
    (value) => value > 30,
  );
  const scrollUp = async () => {
    // Observe the end of xterm's real swipe inertia, as in mouse-scroll.mjs.
    await screen.evaluate(`(()=>{
      window.__readingSwipeFinished=false;
      const element=${terminal}.element.querySelector('.xterm-screen');
      const done=e=>{if(e.translationX===0&&e.translationY===0){
        window.__readingSwipeFinished=true;
        element.removeEventListener('-xterm-gesturechange',done);
      }};
      element.addEventListener('-xterm-gesturechange',done);
    })()`);
    await screen.swipe(
      `${selector} .xterm-screen`,
      { x: 0.5, y: 0.3 },
      { x: 0.5, y: 0.65 },
    );
    await waitFor(() => screen.evaluate("window.__readingSwipeFinished"));
    await screen.wait(action("terminal-jump-latest"));
  };
  await scrollUp();
  const position = await screen.evaluate(
    `({viewport:${terminal}.buffer.active.viewportY,base:${terminal}.buffer.active.baseY})`,
  );
  await waitFor(
    () => screen.evaluate(`${terminal}.buffer.active.baseY`),
    (value) => value > position.base + 3,
  );
  assert.equal(
    await screen.evaluate(`${terminal}.buffer.active.viewportY`),
    position.viewport,
  );
  await shot("mobile-terminal-jump-latest");
  const atBottom = async () => {
    await waitFor(() =>
      screen.evaluate(
        `${terminal}.buffer.active.viewportY === ${terminal}.buffer.active.baseY`,
      ),
    );
    await waitFor(
      () => screen.visible(action("terminal-jump-latest")),
      (value) => !value,
    );
  };
  await screen.click(action("terminal-jump-latest"));
  await atBottom();
  await scrollUp();
  // Button names widen the band; scope to the shown pane so the key scrolls in.
  await screen.tap(`${selector} [data-iori-key="enter"]`);
  await atBottom();
  await typeTerminal(client, "\x03");
  await record(
    "新しい出力中も過去の読み位置を維持し、最新へボタンと帯のキーで追従へ戻れる",
  );
}
