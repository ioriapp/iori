import { openSidebar, closeSidebar } from "../connection/scenario.mjs";
import {
  observed,
  clearObserved,
  typeTerminal,
} from "../terminal/scenario.mjs";
import { waitFor } from "../../verification/ui.mjs";

export async function terminalFit({ client, record }) {
  const { screen } = client;
  const viewport = await screen.evaluate(
    "({width:innerWidth,height:innerHeight})",
  );
  const pane = '[data-iori-view="terminal"][data-iori-displayed="true"]';
  const program = [
    "import os,signal,time",
    "count=0",
    "def report(*_):",
    "  global count",
    "  count+=1",
    "  size=os.get_terminal_size(0)",
    "  print('\\r\\nFIT_%d_%dx%d_END'%(count,size.columns,size.lines),flush=True)",
    "signal.signal(signal.SIGWINCH,report)",
    "print('FIT_'+'READY',flush=True)",
    "while True: time.sleep(60)",
  ].join("\n");
  await openSidebar(screen);
  await typeTerminal(
    client,
    `python3 -c '${`exec(${JSON.stringify(program)})`.replaceAll("'", "'\\''")}'\r`,
  );
  await observed(client, "FIT_READY");
  // A smaller intermediate grid can fit inside the final box too. Measure
  // with the real addon and require its final dimensions before accepting a report.
  await screen.evaluate(`(async()=>{
    const source=await (await fetch('/src/terminal/TerminalPane.tsx')).text();
    const url=/from "([^"]*@xterm_addon-fit[^"]*)"/.exec(source)[1];
    const {FitAddon}=await import(url);
    const fit=window.__terminalFitMeasurement=new FitAddon();
    fit.activate(document.querySelector(${JSON.stringify(pane)}).querySelector('[data-iori-part="terminal-screen"]').__e2eTerminal);
  })()`);
  const check = async (operation) => {
    await clearObserved(client);
    await screen.evaluate(`(()=>{
      const e=document.querySelector(${JSON.stringify(pane)});
      const viewport=e.querySelector('[data-iori-part="terminal-viewport"]');
      const initial=viewport.getBoundingClientRect();
      let previous={width:initial.width,height:initial.height};
      const observation=window.__terminalFit={changes:0};
      observation.observer=new ResizeObserver(([entry])=>{
        const next=entry.target.getBoundingClientRect();
        if(next.width!==previous.width||next.height!==previous.height){
          observation.changes++;
          previous={width:next.width,height:next.height};
        }
      });
      observation.observer.observe(viewport);
    })()`);
    try {
      await operation();
      // Sidebar transitions can still be running after the control disappears.
      // Wait for their actual completion, without assuming a frame interval.
      await waitFor(() =>
        screen.evaluate(`document.getAnimations().every(a=>
        a.effect?.getComputedTiming().iterations===Infinity||
        (a.playState!=='running'&&!a.pending))`),
      );
      const result = await waitFor(() =>
        screen.evaluate(`(()=>{
          const e=document.querySelector(${JSON.stringify(pane)});
          if(!e)return null;
          const grid=e.querySelector('.xterm-screen').getBoundingClientRect();
          const box=e.querySelector('[data-iori-part="terminal-viewport"]').getBoundingClientRect();
          if(grid.right>box.right+0.5||grid.bottom>box.bottom+0.5)return null;
          const size=window.__terminalFitMeasurement.proposeDimensions();
          if(!size||Number(e.dataset.ioriCols)!==size.cols||Number(e.dataset.ioriRows)!==size.rows)return null;
          const reports=Object.values(window.__terminalObservation.tails).join('');
          const matches=[...reports.matchAll(/FIT_(\\d+)_(\\d+)x(\\d+)_END/gu)];
          const last=matches.at(-1);
          if(!last||last[2]!==e.dataset.ioriCols||last[3]!==e.dataset.ioriRows)return null;
          return {reports:matches.map(m=>Number(m[1])),cols:e.dataset.ioriCols,rows:e.dataset.ioriRows,changes:window.__terminalFit.changes};
        })()`),
      );
      await record(`寸法変化と実PTYの最終報告: ${JSON.stringify(result)}`);
    } finally {
      await screen.evaluate("window.__terminalFit.observer.disconnect()");
    }
  };
  try {
    await check(() => closeSidebar(screen));
    await check(() => openSidebar(screen));
    await check(async () => {
      for (
        let width = viewport.width - 20;
        width >= viewport.width - 200;
        width -= 20
      )
        await client.browser.call("Emulation.setDeviceMetricsOverride", {
          ...viewport,
          width,
          deviceScaleFactor: 1,
          mobile: false,
        });
    });
    await check(() =>
      client.browser.call("Emulation.setDeviceMetricsOverride", {
        ...viewport,
        deviceScaleFactor: 1,
        mobile: false,
      }),
    );
  } finally {
    await client.browser.call("Emulation.clearDeviceMetricsOverride");
    await typeTerminal(client, "\x03");
  }
  await record(
    "サイドバー開閉・ウィンドウ連続幅変更をまとめ、実PTYが最終寸法に追いつく",
  );
}
