import { closeSidebar } from "../connection/scenario.mjs";
import assert from "node:assert/strict";
import { clickWithin } from "../../verification/ui.mjs";
import {
  observe,
  create,
  open,
  clearObserved,
  observed,
  typeTerminal,
  say,
  evaluateAsync,
} from "./scenario.mjs";

// Other Terminals stay mounted in their tabs; read this one.
const pane = (id) =>
  `[data-iori-view="terminal"][data-iori-terminal-id=${JSON.stringify(id)}]`;
const columns = (client, id) =>
  client.screen.evaluate(
    `Number(document.querySelector(${JSON.stringify(pane(id))}).getAttribute('data-iori-cols'))`,
  );

export async function repeatedResize(os, clients, cwd, record, shot, trace) {
  const [win, android] = clients;
  for (const client of clients) {
    await observe(client);
    await evaluateAsync(
      client,
      `(async()=>{
      if(window.__terminalResizeTraceStop)window.__terminalResizeTraceStop();
      window.__terminalResizeTrace=[];
      window.__terminalResizeTraceStop=await window.__TAURI__.event.listen('native://terminal-frame',({payload})=>{
        const frame=JSON.parse(payload.json);
        if(['terminal.output','terminal.size','terminal.snapshot'].includes(frame.kind))
          window.__terminalResizeTrace.push({receivedAt:performance.now(),frame});
      });
      return true;
    })()`,
    );
  }
  const id = await create(win, cwd);
  // The 800x600 PC window gives the Terminal its full width with the sidebar
  // closed, so the PC width exceeds the phone width as on a normal desktop.
  if (
    !(await win.screen.evaluate(
      "Boolean(document.querySelector('[data-slot=sidebar][data-state=collapsed]'))",
    ))
  )
    await closeSidebar(win.screen);
  await typeTerminal(win, os === "windows" ? "cls\r" : "clear\r");
  await typeTerminal(win, say(os, "resize-start"));
  await observed(win, "resize-start");
  for (let cycle = 1; cycle <= 3; cycle++) {
    // Opening or typing on the phone takes its width without replacing the PTY.
    await open(android, id);
    for (const client of clients) await clearObserved(client);
    const phoneOutput = `resize-${cycle}-phone`;
    await typeTerminal(android, say(os, phoneOutput));
    for (const client of clients) await observed(client, phoneOutput);
    const mobileCols = await columns(android, id);
    await shot(android, `${os}-android-cycle-${cycle}-mobile`);

    for (const client of clients) await clearObserved(client);
    const pcOutput = `resize-${cycle}-pc`;
    await clickWithin(win, `${pane(id)} [data-iori-part="terminal-screen"]`);
    await typeTerminal(win, say(os, pcOutput));
    for (const client of clients) await observed(client, pcOutput);
    const pcCols = await columns(win, id);
    assert.equal(pcCols > mobileCols, true);
    await shot(win, `${os}-windows-cycle-${cycle}-pc`);
    await shot(android, `${os}-android-cycle-${cycle}-pc`);
    await record(os, cycle, { terminalId: id, mobileCols, pcCols });
    for (const [index, client] of clients.entries())
      await trace(
        os,
        index === 0 ? "windows" : "android",
        await client.screen.evaluate("window.__terminalResizeTrace"),
      );
  }
  return id;
}
