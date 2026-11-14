export { waitForOperation } from "../ui.mjs";

export const operationFailure = (screen, selector) => () =>
  screen.text(selector);

export const cliFailure = (screen, terminalId, native = false) => {
  let seenCli = false;
  return async () => {
    const result = native
      ? await screen.evaluate(`(()=>{
        const terminal=window.__nativeCliTerminals?.[${JSON.stringify(terminalId)}];
        if(!terminal)return null;
        const pane=document.querySelector('[data-iori-terminal-id="${terminalId}"]');
        const cli=Boolean(terminal.cli),resumePending=Boolean(terminal.cliResumePending);
        if(terminal.cliStatus?.outcome==='failure')return {cli,resumePending,failure:terminal.cliStatus.failure??'CLIが失敗しました'};
        const error=pane?.querySelector('[role="alert"]');
        if(error)return {cli,resumePending,failure:error.textContent};
        return {cli,resumePending,failure:['exited','error'].includes(terminal.state)?'CLIが終了しました':false};
      })()`)
      : await screen.evaluate(`(async () => {
    const { connection } = await import('/src/connection.ts');
    const pane = document.querySelector('[data-iori-terminal-id="${terminalId}"]');
    const hostKey = pane?.dataset.ioriHostKey ?? connection.getSnapshot().host?.publicKey;
    if (!hostKey) return null;
    const response = await connection.requestHost(hostKey, 'terminal.list', {});
    if (!response?.ok) return null;
    const terminal = response.result.terminals.find(t => t.id === ${JSON.stringify(terminalId)});
    if (!terminal) return { cli: false, resumePending: false, failure: false };
    const cli = Boolean(terminal.cli);
    const resumePending = Boolean(terminal.cliResumePending);
    if (terminal.cliStatus?.outcome === 'failure') return { cli, resumePending, failure: terminal.cliStatus.failure ?? 'CLIが失敗しました' };
    const error = pane?.querySelector('[role="alert"]');
    if (error) return { cli, resumePending, failure: error.textContent };
    return { cli, resumePending, failure: ['exited','error'].includes(terminal.state) ? 'CLIが終了しました' : false };
  })()`);
    if (!result) return false;
    if (result.cli) seenCli = true;
    return (
      result.failure ||
      (seenCli && !result.cli && !result.resumePending
        ? "CLIが終了しました"
        : false)
    );
  };
};

export const observeCliCompletion = async (
  screen,
  terminalId,
  native = false,
) => {
  if (native)
    await screen.evaluate(`(async()=>{
      window.__cliCompletions??={};
      const observation=window.__cliCompletions[${JSON.stringify(terminalId)}]={};
      observation.stop=await window.__TAURI__.event.listen('native://stream',({payload})=>{
        const event=JSON.parse(payload.json);
        const status=event.type==='terminal.updated'&&event.terminal.id===${JSON.stringify(terminalId)}&&event.terminal.cliStatus;
        if(status?.state==='done'&&status.outcome!=='failure')observation.response=status.response??'';
      });
    })()`);
  else
    await screen.evaluate(`(async () => {
    const { connection } = await import('/src/connection.ts');
    window.__cliCompletions ??= {};
    const observation = window.__cliCompletions[${JSON.stringify(terminalId)}] = {};
    observation.stop = connection.subscribeHostEvents((_host, event) => {
      const status = event.type === 'terminal.updated' && event.terminal.id === ${JSON.stringify(terminalId)} && event.terminal.cliStatus;
      if (status?.state === 'done' && status.outcome !== 'failure') observation.response = status.response ?? '';
    });
  })()`);
  return {
    read: () =>
      screen.evaluate(`(()=>{
      const value = window.__cliCompletions?.[${JSON.stringify(terminalId)}]?.response;
      return value === undefined ? undefined : {response: value};
    })()`),
    stop: () =>
      screen.evaluate(`(()=>{
      const observation = window.__cliCompletions?.[${JSON.stringify(terminalId)}];
      observation?.stop();
      if (observation) delete window.__cliCompletions[${JSON.stringify(terminalId)}];
    })()`),
  };
};

export const childFailure = (records, select) => async () => {
  const child = select((await records()).children);
  return child?.state === "failed"
    ? (child.failure ?? "子が失敗しました")
    : false;
};

export const anyFailure =
  (...observations) =>
  async () => {
    for (const observe of observations) {
      const failure = await observe();
      if (failure) return failure;
    }
    return false;
  };

// A normal reply is the opposite result when this scenario expects a CLI error.
// Initial idle is not completion: require an active turn or its no-report result.
export const unexpectedChildCompletion = (records, select) => {
  let active = false;
  return async () => {
    const value = await records();
    const child = select(value.children);
    if (!child || child.state === "failed") return false;
    const status = value.terminals.find((t) => t.id === child.terminalId)?.value
      .runtime?.status;
    if (status?.state === "active") active = true;
    if (
      ["reported", "question", "finished", "stopped"].includes(child.state) ||
      (status?.outcome !== "failure" &&
        ["idle", "done"].includes(status?.state) &&
        (child.parentResponse === "unreported" || active))
    )
      return `子がCLIの失敗を通知せず終了しました: ${child.state}/${status?.state ?? ""}`;
    return false;
  };
};
