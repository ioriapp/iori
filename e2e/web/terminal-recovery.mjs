import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { typeTerminal, observed } from "../terminal/scenario.mjs";

const pane = (id) => `[data-iori-terminal-id="${id}"]`;
const rendered = (id) =>
  `document.querySelector('${pane(id)} .xterm').parentElement.__e2eTerminal`;

export async function terminalRetention({
  client,
  terminalId,
  withConnectionOffline,
  record,
}) {
  const screen = client.screen;
  await typeTerminal(
    client,
    "for i in $(seq 1 6000); do printf '保持する行 %s\\n' \"$i\"; done\r",
  );
  await observed(client, "保持する行 6000");
  await typeTerminal(
    client,
    "printf '%s%s\\n' '追加出力の' '準備完了'; while [ ! -f .retention-output ]; do sleep 0.1; done; for i in $(seq 1 400); do printf '切断中の追加行 %s\\n' \"$i\"; done; touch .retention-done\r",
  );
  await waitFor(() =>
    screen.evaluate(
      `(()=>{const b=${rendered(terminalId)}.buffer.active;return b.getLine(b.baseY+b.cursorY-1)?.translateToString().includes('追加出力の準備完了');})()`,
    ),
  );
  await screen.evaluate(
    `(()=>{const t=${rendered(terminalId)};t.scrollToLine(2000);t.select(0,2002,8);window.__retainedTerminal=t;window.__retainedViewport=t.buffer.active.viewportY;window.__retainedSelection=t.getSelection();window.__retainedTop=t.buffer.active.getLine(t.buffer.active.viewportY).translateToString();return true;})()`,
  );
  await withConnectionOffline(async () => {
    await screen.wait('[data-iori-state="disconnected"]');
    assert.equal(
      await screen.evaluate(
        `Boolean(document.querySelector('${pane(terminalId)} .xterm'))`,
      ),
      true,
      "切断中も最後のTerminal画面がある",
    );
    assert.equal(
      await screen.evaluate(
        `(()=>{const t=${rendered(terminalId)};return t===window.__retainedTerminal&&t.buffer.active.viewportY===window.__retainedViewport&&t.getSelection()===window.__retainedSelection&&t.buffer.active.getLine(t.buffer.active.viewportY).translateToString()===window.__retainedTop;})()`,
      ),
      true,
      "切断中も本文・読み位置・選択を保つ",
    );
  });
  await screen.wait(`${pane(terminalId)}[data-iori-stream-state="ready"]`);
  assert.equal(
    await screen.evaluate(
      `(()=>{const t=${rendered(terminalId)};return t===window.__retainedTerminal&&t.getSelection()===window.__retainedSelection&&t.buffer.active.getLine(t.buffer.active.viewportY).translateToString()===window.__retainedTop&&t.buffer.active.viewportY<window.__retainedViewport;})()`,
    ),
    true,
    "切断中の出力で履歴が押し出されても、元の行と選択を戻す",
  );
  await screen.evaluate(`${rendered(terminalId)}.scrollToBottom()`);
  await record(
    "切断中の本文・読み位置・選択を保ち、再接続も同じTerminalで続ける",
  );
}

export async function eventTolerance({
  client,
  terminalId,
  malformedEvent,
  record,
}) {
  const screen = client.screen;
  const stream = await screen.attribute(
    pane(terminalId),
    "data-iori-stream-id",
  );
  await screen.evaluate(
    `(async()=>{const {connection}=await import('/src/connection.ts');window.__eventReceiverStop=connection.subscribeHostEvents((_host,event)=>{if(event.type==='terminal.updated')throw new Error('E2E receiver fault');});window.__laterReceiverTitle=undefined;window.__laterReceiverStop=connection.subscribeHostEvents((_host,event)=>{if(event.type==='terminal.updated'&&event.terminal.id===${JSON.stringify(terminalId)})window.__laterReceiverTitle=event.terminal.title;});return true;})()`,
  );
  malformedEvent(true);
  await typeTerminal(
    client,
    "printf '\\033]2;受信を続ける\\007'; printf '%s%s\\n' '出来事の後も' '入力できる'\r",
  );
  await observed(client, "出来事の後も入力できる");
  await waitFor(
    () => screen.text(`[data-iori-tab-id="terminal:${terminalId}"]`),
    (text) => text.includes("受信を続ける"),
  );
  assert.equal(
    await screen.attribute(pane(terminalId), "data-iori-stream-id"),
    stream,
    "出来事1件の解析・受け手の例外で接続とTerminalを切らない",
  );
  assert.equal(
    await screen.evaluate("window.__laterReceiverTitle"),
    "受信を続ける",
    "例外を投げた受け手の後も出来事を受け取る",
  );
  await screen.evaluate(
    "window.__eventReceiverStop();window.__laterReceiverStop();true",
  );
  malformedEvent(false);
  await typeTerminal(client, "printf '%s%s\\n' '同じ接続で' '続ける'\r");
  await observed(client, "同じ接続で続ける");
  await record(
    "読めない出来事と受け手の例外を捨て、同じ接続で画面更新・入力を続ける",
  );
}
