import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { focusTerminal } from "../cli-screen/scenario.mjs";
import { closeSidebar, openSidebar } from "../connection/scenario.mjs";
import {
  clearObserved,
  observed,
  typeTerminal,
} from "../terminal/scenario.mjs";

export async function sidebarWidth({ client, terminalId, record, reload }) {
  const { screen, browser } = client;
  const handle =
    '[aria-label="Resize sidebar"], [aria-label="サイドバーの幅を変更"]';
  const width = () =>
    screen.evaluate(
      `document.querySelector('[data-slot="sidebar-gap"]').getBoundingClientRect().width`,
    );
  const dragTo = async (x) => {
    await screen.evaluate(`document.body.dataset.sidebarDragTarget = 'true'`);
    await screen.drag(handle, "body[data-sidebar-drag-target]", {
      x: x / (await screen.evaluate("innerWidth")),
      y: 0.5,
    });
  };
  const checkWidth = async (expected) =>
    waitFor(
      width,
      (actual) => Math.abs(actual - expected) < 2,
      undefined,
      `幅 ${expected}px`,
    );
  await browser.viewport({ width: 1440, height: 900 });
  await screen.wait(handle);
  await checkWidth(360);
  await focusTerminal(client, terminalId);
  await screen.evaluate(`(()=>{
    const pane=document.querySelector('[data-iori-terminal-id="${terminalId}"]');
    const stream=pane.getAttribute('data-iori-stream-id');
    const count=()=>window.__terminalObservation.renderFrames.filter(f=>f.kind==='terminal.size'&&f.streamId===stream).length;
    window.__terminalObservation.renderFrames=[];
    const o=window.__sidebarResize={before:Number(pane.getAttribute('data-iori-cols')),moves:[],count};
    let dragging=false;
    const sample=()=>{if(dragging){o.moves.push({cols:Number(pane.getAttribute('data-iori-cols')),sizes:count()});requestAnimationFrame(sample)}};
    document.addEventListener('pointerdown',()=>{dragging=true;sample()},{once:true});
    document.addEventListener('pointerup',()=>{dragging=false},{once:true});
  })()`);
  await dragTo(520);
  await checkWidth(520);
  await waitFor(
    () => screen.evaluate("window.__sidebarResize.count()"),
    (n) => n > 0,
  );
  await focusTerminal(client, terminalId);
  await clearObserved(client);
  await typeTerminal(client, "printf '%s%s\\n' 'sidebar-' 'complete'\r");
  await observed(client, "sidebar-complete");
  const metrics = await screen.evaluate(
    `(()=>{const o=window.__sidebarResize;const pane=document.querySelector('[data-iori-terminal-id="${terminalId}"]');const stream=pane.getAttribute('data-iori-stream-id');return {before:o.before,moves:o.moves,sizes:o.count(),dimensions:window.__terminalObservation.renderFrames.filter(f=>f.kind==='terminal.size'&&f.streamId===stream).map(f=>({cols:f.cols,rows:f.rows})),after:Number(pane.getAttribute('data-iori-cols'))}})()`,
  );
  assert.ok(metrics.moves.length > 1);
  assert.ok(
    metrics.moves.every((m) => m.sizes === 0 && m.cols === metrics.before),
  );
  assert.equal(metrics.sizes, 1);
  assert.ok(metrics.after < metrics.before);
  await record(`サイドバーのドラッグとPTY寸法: ${JSON.stringify(metrics)}`);
  await reload();
  await screen.wait(handle);
  await checkWidth(520);
  await browser.viewport({ width: 800, height: 900 });
  await checkWidth(400);
  await browser.viewport({ width: 1440, height: 900 });
  await checkWidth(520);
  await closeSidebar(screen);
  await waitFor(async () => !(await screen.visible(handle)));
  await reload();
  await waitFor(() =>
    screen.evaluate(`Boolean(document.querySelector('[data-slot="sidebar"]'))`),
  );
  assert.equal(
    await screen.attribute('[data-slot="sidebar"]', "data-state"),
    "collapsed",
    "閉じたサイドバーは再読み込み後も閉じたまま",
  );
  await openSidebar(screen);
  await screen.wait(handle);
  await checkWidth(520);
  await screen.doubleClick(handle);
  await checkWidth(360);
  await reload();
  await screen.wait(handle);
  await checkWidth(360);
  await dragTo(100);
  await checkWidth(240);
  await dragTo(1400);
  await checkWidth(720);
  await screen.click('[data-iori-action="workspace-add-tab"]');
  await screen.wait(".cli-launcher-search input");
  await screen.evaluate(
    `document.querySelector('.cli-launcher-search input').focus()`,
  );
  await screen.key("Control+b");
  assert.equal(await screen.visible(handle), true);
  await screen.key("Escape");
  await record("入力欄でCtrl+Bを押してもサイドバーは閉じない");
  await browser.viewport({ width: 390, height: 844 });
  await waitFor(async () => !(await screen.visible(handle)));
  await record("幅の復元・既定値・上下限・スマホの表示を確認");
}
