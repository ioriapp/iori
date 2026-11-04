import { openSidebar } from "../connection/scenario.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import {
  observe,
  observed,
  clearObserved,
  typeTerminal,
  say,
} from "../terminal/scenario.mjs";

const pane = (id) =>
  `[data-iori-view="terminal"][data-iori-terminal-id=${JSON.stringify(id)}]`;

// Browser visibility is the OS boundary used by the development Client. Do not
// call its connection controller or alter the Terminal's own implementation.
async function foreground(client, visible) {
  await client.screen.evaluate(`(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>${JSON.stringify(visible ? "visible" : "hidden")}});
    document.dispatchEvent(new Event('visibilitychange'));
    return true;
  })()`);
}

export async function terminalSizeOwnership({
  desktop,
  phone,
  worktree,
  terminalId,
  record,
}) {
  const dimensions = (client) =>
    client.screen.evaluate(`(()=>{
    const e=document.querySelector(${JSON.stringify(pane(terminalId))});
    return {cols:Number(e.getAttribute('data-iori-cols')),rows:Number(e.getAttribute('data-iori-rows'))};
  })()`);
  const initialPcSize = await dimensions(desktop);
  const screen = phone.screen;
  await screen.wait('[data-iori-view="workspace"]');
  // Selecting the worktree can open the retained Terminal and deliver its
  // snapshot before the later explicit selection. Observe that first frame.
  await observe(phone, "(await import('/src/native-platform-web.ts')).listen");
  await openSidebar(screen);
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  const selectAgain = async () => {
    await openSidebar(screen);
    await screen.click(
      `[data-iori-terminal-row=${JSON.stringify(terminalId)}]`,
    );
    await screen.wait(`${pane(terminalId)}[data-iori-stream-state="ready"]`);
  };
  await selectAgain();
  await typeTerminal(phone, say("linux", "スマホ幅で選び直す準備"));
  await observed(phone, "スマホ幅で選び直す準備");
  await waitFor(
    async () => (await dimensions(phone)).cols < initialPcSize.cols,
  );
  const mobileSize = await dimensions(phone);
  // Selecting an already shown Terminal must consume the open operation now,
  // not leave an instruction for the next automatic stream opening.
  await selectAgain();
  await clearObserved(phone);
  await foreground(phone, false);
  await waitFor(
    () => screen.attribute(pane(terminalId), "data-iori-stream-state"),
    (value) => value !== "ready",
  );
  await typeTerminal(desktop, say("linux", "背面の間にPCが寸法を取る"));
  await observed(desktop, "背面の間にPCが寸法を取る");
  const pcSize = await dimensions(desktop);
  assert.equal(
    pcSize.cols > mobileSize.cols,
    true,
    "the PC and phone must have different widths",
  );
  await foreground(phone, true);
  await screen.wait(`${pane(terminalId)}[data-iori-stream-state="ready"]`);
  await observed(phone, "背面の間にPCが寸法を取る");
  await screen.evaluate(
    "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
  );
  assert.deepEqual(
    await dimensions(desktop),
    pcSize,
    "foreground used a stale selection to take the PC's size",
  );
  // The phone's available width can change while it is only reading. Selecting
  // it must use the layout now, not the dimensions from its first opening.
  await phone.browser.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await screen.evaluate(
    "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
  );
  assert.deepEqual(
    await dimensions(desktop),
    pcSize,
    "resizing a reading phone took the PC's size",
  );
  // With the PC owning it now, selecting the shown phone Terminal takes its
  // width immediately, without moving focus or automatically opening a keyboard.
  await selectAgain();
  await waitFor(
    async () => {
      const phoneSize = await dimensions(phone);
      const desktopSize = await dimensions(desktop);
      return (
        phoneSize.cols < pcSize.cols &&
        desktopSize.cols === phoneSize.cols &&
        desktopSize.rows === phoneSize.rows
      );
    },
    Boolean,
    undefined,
    "スマホ選び直し後の両画面の現在の寸法",
  );
  await typeTerminal(desktop, say("linux", "PC幅で続ける"));
  await observed(desktop, "PC幅で続ける");
  await waitFor(async () => {
    const size = await dimensions(desktop);
    return size.cols === pcSize.cols && size.rows === pcSize.rows;
  });
  await foreground(phone, false);
  await record(
    "表示中のTerminalを選び直しても、前面復帰でPCの寸法を奪わず、選択時にだけ寸法を取る",
  );
}
