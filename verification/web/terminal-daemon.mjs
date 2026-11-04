import { fakeMarker } from "../../e2e/fake-model/marker.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { register } from "../../e2e/connection/scenario.mjs";
import { openFolder } from "../../e2e/workspace/scenario.mjs";
import {
  create,
  observe,
  observeTerminalInstances,
  observed,
  clearObserved,
  typeTerminal,
} from "../../e2e/terminal/scenario.mjs";
import {
  focusTerminal,
  waitForCliState,
} from "../../e2e/cli-screen/scenario.mjs";
import { pressCliKey, submitToCli } from "../../e2e/cli-screen/input.mjs";
import { waitFor } from "../ui.mjs";

/** Real Claude shell mode keeps producing output and runs iori while Host is absent. */
export async function terminalDaemonScenario({
  client,
  invitation,
  repository,
  worktree,
  restartPreservingHost,
  hostReplacement,
  loseTerminalDaemon,
  hostMaintenance,
  hostMaintenancePreview,
  hostMaintenanceEmpty,
  hostRemoval,
  record,
  shot,
}) {
  const screen = client.screen;
  await register(screen, invitation, "Terminal continuity verification");
  await screen.key("Escape");
  await openFolder(screen, repository, false);
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  await observeTerminalInstances(client);
  const pulse = join(worktree, "terminal-continuity.mjs");
  await writeFile(
    pulse,
    `import {readFile,writeFile,rename,access} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const name=process.argv[2];let count=0,calling=false;
const present=path=>access(path).then(()=>true,()=>false);
for(;;){
 const marker=name.toUpperCase()+'_CONTINUITY_'+(++count);
 if(name==='terminal')process.stdout.write("\\x1b]2;IORI_HOST_TITLE_PROBE\\x07");
 console.log(marker);
 await writeFile(name+'.pulse.tmp',JSON.stringify({pid:process.pid,count,marker}));await rename(name+'.pulse.tmp',name+'.pulse.json');
 if(name==='cli'&&!calling&&await present('command.trigger')){calling=true;void promisify(execFile)('iori',['plan','goal','--body','DAEMON_OFFLINE_COMMAND']).then(()=>writeFile('command.done','done'));}
 if(await present(name+'.stop'))break;
 await new Promise(resolve=>setTimeout(resolve,250));
}
console.log(name.toUpperCase()+'_CONTINUITY_STOPPED');
`,
  );
  const pulseState = (name) =>
    readFile(join(worktree, `${name}.pulse.json`), "utf8")
      .then(JSON.parse)
      .catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
  await hostMaintenanceEmpty?.();
  await create(client);
  await screen.wait(
    '[data-iori-view="terminal"][data-iori-stream-state="ready"]',
  );
  const terminalId = await screen.attribute(
    '[data-iori-view="terminal"]',
    "data-iori-terminal-id",
  );

  const definition = {
    name: "Terminal continuity",
    description: "Host restart verification",
    parent: {
      id: "parent",
      cli: "claude",
      model: "claude-haiku-4-5",
      tools: [],
      minimum: "",
    },
    instruction:
      "Follow the user's explicit commands. Do not change files or delegate on your own. Use iori only when asked. On child notifications, finish your turn without acting.",
    roles: [
      {
        id: "worker",
        name: "Worker",
        when: "Restart verification",
        limit: "1",
        reuse: false,
        split: false,
        instruction:
          "Read the parent request. Reply READY only and end your turn. Do not use tools, delegate or change files.",
        request: "Follow the request.",
        report: "Result.",
        candidates: {
          high: [],
          low: [],
          medium: [
            {
              id: "worker-candidate",
              cli: "claude",
              model: "claude-haiku-4-5",
              tools: [],
              minimum: "",
            },
          ],
        },
      },
    ],
  };
  const team = await screen.evaluate(
    `(async()=>{const {connection}=await import('/src/connection.ts');const host=connection.getSnapshot().host.publicKey;const saved=await connection.requestHost(host,'teams.create',{definition:${JSON.stringify(definition)}});if(!saved.ok)throw new Error('team fixture failed');await connection.requestHost(host,'teams.settings',{enabled:true,defaultTeam:saved.result.saved.id,limits:{}});return saved.result.saved;})()`,
  );
  await screen.click('[data-iori-action="workspace-add-tab"]');
  await screen.click(`[data-iori-team-id="${team.id}"]`);
  await screen.wait('[data-iori-tab-cli="claude"]');
  const cliId = (
    await screen.attribute('[data-iori-tab-cli="claude"]', "data-iori-tab-id")
  ).replace(/^terminal:/u, "");
  await waitForCliState(client, cliId, ["idle", "done"]);
  await screen.click(`[data-iori-tab-id="terminal:${terminalId}"]`);
  await typeTerminal(client, "node terminal-continuity.mjs terminal\r");
  const terminalBefore = await waitFor(() => pulseState("terminal"), Boolean);
  await observed(client, terminalBefore.marker);
  await screen.click(`[data-iori-tab-id="terminal:${cliId}"]`);
  await focusTerminal(client, cliId);
  if (hostRemoval) {
    await submitToCli(
      client,
      "What shell command prints the current working directory? Reply with only the command name." +
        fakeMarker("host-pwd"),
      undefined,
      "before-host-uninstall",
      { focus: false },
    );
    await observed(client, "pwd");
    await waitForCliState(client, cliId, ["idle", "done"]);
  }
  await submitToCli(
    client,
    "!node terminal-continuity.mjs cli",
    undefined,
    "continuity-command",
    { focus: false },
  );
  const cliBefore = await waitFor(() => pulseState("cli"), Boolean);
  await observed(client, cliBefore.marker);
  if (hostRemoval) {
    await hostRemoval();
    return;
  }
  if (hostMaintenance) {
    await hostMaintenance({
      terminalId,
      cliId,
      pulseState,
      terminalBefore,
      cliBefore,
    });
    await writeFile(join(worktree, "cli.stop"), "stop");
    await writeFile(join(worktree, "terminal.stop"), "stop");
    await screen.click(`[data-iori-tab-id="terminal:${cliId}"]`);
    await waitForCliState(client, cliId, ["idle", "done"]);
    await focusTerminal(client, cliId);
    await screen.evaluate(`(async()=>{
      const {connection}=await import('/src/connection.ts');
      window.__hostMaintenanceCliStates=[];
      window.__stopHostMaintenanceCliStates=connection.subscribeHostEvents((_,event)=>{
        if(event.type==='terminal.updated' && event.terminal.id===${JSON.stringify(cliId)})
          window.__hostMaintenanceCliStates.push(event.terminal.cliStatus?.state);
      });
    })()`);
    await submitToCli(
      client,
      "What shell command prints the current working directory? Reply with only the command name." +
        fakeMarker("host-pwd"),
      undefined,
      "after-host-update",
      { focus: false },
    );
    await observed(client, "pwd");
    const states = await waitFor(
      () => screen.evaluate("window.__hostMaintenanceCliStates"),
      (states) => {
        const active = states.indexOf("active");
        return (
          active >= 0 &&
          states
            .slice(active + 1)
            .some((state) => state === "done" || state === "idle")
        );
      },
    );
    await screen.evaluate("window.__stopHostMaintenanceCliStates()");
    record("host-update-cli-response", { answerObserved: true, states });
    await hostMaintenancePreview?.({ terminalId, cliId });
    return;
  }
  let terminalDuring, cliDuring;
  await clearObserved(client);
  const terminalAtStop = await pulseState("terminal");
  const cliAtStop = await pulseState("cli");
  await restartPreservingHost(async () => {
    terminalDuring = await waitFor(
      () => pulseState("terminal"),
      (value) => value?.count > terminalAtStop.count + 2,
    );
    cliDuring = await waitFor(
      () => pulseState("cli"),
      (value) => value?.count > cliAtStop.count + 2,
    );
    await writeFile(join(worktree, "command.trigger"), "trigger");
  });
  await screen.wait(
    `[data-iori-terminal-id="${cliId}"][data-iori-stream-state="ready"]`,
  );
  await observed(client, cliDuring.marker);
  await waitFor(() =>
    readFile(join(worktree, "command.done"), "utf8").then(
      () => true,
      () => false,
    ),
  );
  const cliAfter = await waitFor(
    () => pulseState("cli"),
    (value) => value?.count > cliDuring.count,
  );
  assert.equal(cliAfter.pid, cliBefore.pid);
  assert.equal(cliDuring.pid, cliBefore.pid);
  await writeFile(join(worktree, "cli.stop"), "stop");
  await observed(client, "CLI_CONTINUITY_STOPPED");
  await waitForCliState(client, cliId, ["idle", "done"]);
  await submitToCli(
    client,
    "Run exactly iori plan goal --body DAEMON_AFTER_RESTART then reply exactly DAEMON_CLI_DONE. Do not use other tools or commands." +
      fakeMarker("daemon-after"),
    undefined,
    "continuity-after",
    { focus: false },
  );
  await waitForCliState(client, cliId, ["active"]);
  await observed(client, "DAEMON_CLI_DONE");
  await waitForCliState(client, cliId, ["idle", "done"]);
  assert.equal(
    await screen.visible(
      `[data-iori-terminal-id="${cliId}"] [data-iori-state="cli-resume-pending"]`,
    ),
    false,
  );
  const goal = await screen.evaluate(
    `(async()=>{const {connection}=await import('/src/connection.ts');const host=connection.getSnapshot().host.publicKey;const board=await connection.requestHost(host,'teams.board',{cwd:${JSON.stringify(worktree)}});return board;})()`,
  );
  assert.ok(
    JSON.stringify(goal).includes("DAEMON_AFTER_RESTART"),
    "the real iori command updated the team after reconnect",
  );
  await screen.click(`[data-iori-tab-id="terminal:${terminalId}"]`);
  await screen.wait(
    `[data-iori-terminal-id="${terminalId}"][data-iori-stream-state="ready"]`,
  );
  await observed(client, terminalDuring.marker);
  if (hostReplacement) {
    await waitFor(
      () =>
        screen.evaluate(
          `(async()=>{const {connection}=await import('/src/connection.ts');const host=connection.getSnapshot().host.publicKey;const reply=await connection.requestHost(host,'terminal.list',{});return reply.ok&&reply.result.terminals.find(t=>t.id===${JSON.stringify(terminalId)})?.title;})()`,
        ),
      (value) => value === "UPDATED_HOST_TITLE",
    );
    await record(
      "同じ係・PTYを保つ配布物交換でHostだけの新しい題名判定が適用される",
    );
  }
  const terminalAfter = await waitFor(
    () => pulseState("terminal"),
    (value) => value?.count > terminalDuring.count,
  );
  assert.equal(terminalAfter.pid, terminalBefore.pid);
  assert.equal(terminalDuring.pid, terminalBefore.pid);
  await writeFile(join(worktree, "terminal.stop"), "stop");
  await observed(client, "TERMINAL_CONTINUITY_STOPPED");
  await shot("terminal-daemon-reconnected");
  await record(
    "Host不在中と再起動後も同じCLI・Terminalが出力を継続し、ioriコマンドとhooksが届く",
  );
  const request = (method, params) =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const result=await connection.requestHost(connection.getSnapshot().host.publicKey,${JSON.stringify(method)},${JSON.stringify(params)});if(!result.ok)throw new Error('Host request failed');return result.result;})()`,
    );
  const delegate = async (title) => {
    await screen.click(`[data-iori-tab-id="terminal:${cliId}"]`);
    await focusTerminal(client, cliId);
    await waitForCliState(client, cliId, ["idle", "done"]);
    await typeTerminal(
      client,
      `!iori delegate --role Worker --difficulty medium --title ${title} --worktree parent --body 'Reply READY only.${fakeMarker("daemon-child")}'\r`,
    );
    // A newly listed child can still be starting without a Terminal ID.
    // Keep reading until the returned record can identify the CLI we observe.
    const child = await waitFor(
      async () =>
        (await request("teams.children", {})).children.find(
          (c) => c.title === title,
        ),
      (value) => Boolean(value?.terminalId),
    );
    const row = `[data-iori-child-id="${child.id}"]`;
    await waitFor(
      () => screen.text(`${row} .nav-child-state`),
      (value) => value === "Running",
    );
    await pressCliKey(client, "Escape");
    await screen.click(`${row} .nav-child-button`);
    await waitForCliState(client, child.terminalId, ["idle", "done"]);
    return child;
  };
  const exitChild = async (child) => {
    await focusTerminal(client, child.terminalId);
    await submitToCli(client, "/exit", undefined, "continuity-child-exit", {
      focus: false,
    });
    await waitFor(
      async () =>
        (await request("terminal.list", {})).terminals.find(
          (t) => t.id === child.terminalId,
        )?.state === "error",
    );
    await screen.click(`[data-iori-tab-id="terminal:${cliId}"]`);
    await waitForCliState(client, cliId, ["idle", "done"]);
  };
  const firstChild = await delegate("Continuity-first");
  await exitChild(firstChild);
  await restartPreservingHost();
  await screen.wait(
    `[data-iori-terminal-id="${cliId}"][data-iori-stream-state="ready"]`,
  );
  const secondChild = await delegate("Continuity-second");
  assert.notEqual(secondChild.id, firstChild.id);
  await record(
    "終了した子を残して係を保つHost再起動後も、上限1の同じ役割へ新しい委譲が始まる",
  );
  await exitChild(secondChild);
  await focusTerminal(client, cliId);
  await submitToCli(client, "/exit", undefined, "continuity-parent-exit", {
    focus: false,
  });
  await screen.wait(
    `[data-iori-terminal-id="${cliId}"] [data-iori-state="cli-resume-pending"]`,
  );
  await restartPreservingHost();
  await screen.wait('[data-iori-state="connected"]');
  await screen.click(
    `[data-iori-terminal-id="${cliId}"] [data-iori-action="cli-resume"]`,
  );
  await screen.wait(
    `[data-iori-terminal-id="${cliId}"][data-iori-stream-state="ready"]`,
  );
  await waitForCliState(client, cliId, ["idle", "done"]);
  await clearObserved(client);
  await submitToCli(
    client,
    "Reply exactly PARENT_RESUMED_OK without using tools." +
      fakeMarker("daemon-resumed"),
    undefined,
    "continuity-parent-resumed",
  );
  await waitForCliState(client, cliId, ["active"]);
  await observed(client, "PARENT_RESUMED_OK");
  await waitForCliState(client, cliId, ["idle", "done"]);
  await record(
    "親のCLI終了後に係を保つHost再起動を行い、会話を再開して新しい応答を受け取る",
  );
  await screen.click(`[data-iori-tab-id="terminal:${terminalId}"]`);
  await loseTerminalDaemon();
  await screen.wait(
    `[data-iori-terminal-id="${terminalId}"][data-iori-stream-state="ready"]`,
  );
  await screen.click(`[data-iori-tab-id="terminal:${cliId}"]`);
  await screen.wait(
    `[data-iori-terminal-id="${cliId}"] [data-iori-state="cli-resume-pending"]`,
  );
  await record(
    "係が異常終了した場合は同じPTYの継続とせず、履歴と明示的な会話再開を残す",
  );
}
