import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { splitTab } from "../../verification/workspace/interaction.mjs";
import { clearObserved, observed } from "../terminal/scenario.mjs";
import { controlKey, focusTerminal } from "./scenario.mjs";

/** Resize a live CLI pane with the real pointer, then keep typing into it. */
export async function cliPaneResize({
  client,
  terminalId,
  record,
  split = true,
}) {
  const screen = client.screen;
  const tab = `[data-iori-tab-id="terminal:${terminalId}"]`;
  const pane = `[data-iori-terminal-id="${terminalId}"]`;
  if (split) await splitTab(screen, tab, "right");
  await focusTerminal(client, terminalId);
  // Both callers split immediately before measuring. The pane can already
  // have its new size while the Host's reply to that split is still in flight.
  await waitFor(() =>
    screen.evaluate(`(()=>{
      const pane=document.querySelector(${JSON.stringify(pane)});
      const stream=pane.getAttribute('data-iori-stream-id');
      const size=window.__terminalObservation.screenFrames.findLast(item=>item.streamId===stream&&item.frame.kind==='terminal.size')?.frame;
      return size?.cols===Number(pane.getAttribute('data-iori-cols'))&&size?.rows===Number(pane.getAttribute('data-iori-rows'));
    })()`),
  );
  await screen.evaluate(`(()=>{
    const pane=document.querySelector(${JSON.stringify(pane)});
    const screen=pane.querySelector('.xterm-screen');
    const bounds=pane.getBoundingClientRect(),y=bounds.top+bounds.height/2;
    const sashes=[...document.querySelectorAll('.dv-sash')].filter(e=>{const r=e.getBoundingClientRect();return r.height>r.width&&r.top<=y&&r.bottom>=y;});
    sashes.sort((a,b)=>Math.abs(a.getBoundingClientRect().left-bounds.left)-Math.abs(b.getBoundingClientRect().left-bounds.left));
    sashes[0].setAttribute('data-iori-cli-resize-sash','');
    const read=()=>({width:pane.getBoundingClientRect().width,cols:Number(pane.getAttribute('data-iori-cols')),screenWidth:screen.getBoundingClientRect().width});
    const o=window.__cliResize={before:read(),moves:[]};
    let dragging=false;
    const down=()=>{dragging=true;};
    const move=()=>requestAnimationFrame(()=>{if(dragging)o.moves.push(read());});
    const up=()=>{dragging=false;document.removeEventListener('pointerdown',down);document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);};
    document.addEventListener('pointerdown',down);
    document.addEventListener('pointermove',move);
    document.addEventListener('pointerup',up);
    o.read=read;
    return true;
  })()`);
  await screen.drag("[data-iori-cli-resize-sash]", pane, { x: 0.25 });
  const focused = await screen.evaluate(
    `document.activeElement===document.querySelector(${JSON.stringify(pane)}).querySelector('[data-iori-field="terminal-input"]')`,
  );
  await clearObserved(client);
  // A physical key follows the product's focus; insertText can obscure blur.
  await screen.key("z");
  assert.equal(focused, true, "ドラッグ後も同じ端末へキー入力が届く");
  await observed(client, "z");
  const metrics = await screen.evaluate(`(()=>{
    const o=window.__cliResize;
    return {before:o.before,moves:o.moves,after:o.read()};
  })()`);
  await record(`CLIの境界ドラッグと直後の入力: ${JSON.stringify(metrics)}`);
  assert.ok(
    metrics.after.width < metrics.before.width - 20,
    "ドラッグ後の幅を保持する",
  );
  assert.ok(
    metrics.moves.some((move) => move.width < metrics.before.width - 20),
    "ドラッグで境界が動く",
  );
  assert.ok(
    metrics.moves.every(
      (move, index) =>
        index === 0 || move.width <= metrics.moves[index - 1].width + 1,
    ),
    "ドラッグ途中で幅が巻き戻らない",
  );
  assert.ok(
    metrics.moves.every(
      (move) =>
        move.cols === metrics.before.cols &&
        move.screenWidth === metrics.before.screenWidth,
    ),
    "ドラッグ中は端末の寸法と描画幅を保つ",
  );
  assert.ok(
    metrics.after.cols < metrics.before.cols,
    "離した後の端末は新しい幅に合う",
  );
  await controlKey(client, "u");
  await clearObserved(client);
  await screen.evaluate(
    "(()=>{document.querySelector('[data-iori-cli-resize-sash]').removeAttribute('data-iori-cli-resize-sash');return true;})()",
  );
}
