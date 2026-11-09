import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { waitFor } from "../../verification/ui.mjs";

export async function childRowsRegression({
  client,
  worktree,
  repository,
  childListFault,
  record,
}) {
  const screen = client.screen;
  const request = (method, params = {}) =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const result=await connection.requestHost(connection.getSnapshot().host.publicKey,${JSON.stringify(method)},${JSON.stringify(params)});if(!result?.ok)throw new Error(${JSON.stringify(method)}+' failed');return result.result;})()`,
    );
  const cli = await request("cli.definition.simple", {
    simple: {
      name: "Child rows script",
      command: `${process.execPath} ${fileURLToPath(new URL("./child-rows-cli.mjs", import.meta.url))}`,
      modelArgument: "",
    },
  });
  const candidate = {
    id: "worker-candidate",
    cli: cli.cliId,
    model: "",
    tools: [],
    minimum: "",
  };
  const { saved } = await request("teams.create", {
    definition: {
      name: "Child rows regression",
      description: "",
      parent: { ...candidate, id: "parent-candidate" },
      instruction: "",
      roles: [
        {
          id: "worker",
          name: "Worker",
          when: "Verification",
          limit: "",
          reuse: true,
          split: false,
          instruction: "",
          request: "",
          report: "",
          candidates: { high: [], medium: [candidate], low: [] },
        },
      ],
    },
  });
  await request("teams.settings", {
    enabled: true,
    defaultTeam: saved.id,
    limits: {},
  });
  const { terminal: parent } = await request("team.launch", {
    teamId: saved.id,
    cwd: worktree,
  });
  await screen.wait(`[data-iori-terminal-row="${parent.id}"]`);
  // A separate real terminal stream allows the parent to receive a command
  // while its worktree is not displayed.
  const command = async (args) =>
    screen.evaluate(`(async()=>{
    const {connection}=await import('/src/connection.ts'); const {native}=await import('/src/native.ts');
    const id=crypto.randomUUID(); const host=connection.getSnapshot().host;
    const ready=new Promise(resolve=>{let stop; native.onTerminalFrame(frame=>{if(frame.streamId===id && JSON.parse(frame.json).kind==='terminal.snapshot'){stop();resolve();}}).then(value=>stop=value);});
    await native.terminalOpen(connection.connectionIdOf(host.publicKey),id,JSON.stringify({kind:'terminal',operationId:crypto.randomUUID(),action:'open',terminalId:${JSON.stringify(parent.id)},viewId:crypto.randomUUID(),deviceClass:'desktop',cols:80,rows:24,snapshotMaxLines:100,snapshotMaxBytes:1048576,viewAttributes:{foreground:[255,255,255],background:[0,0,0],cursor:[255,255,255],ansi:Array.from({length:256},()=>[0,0,0]),colorSchemeMode:'dark',cursorStyle:'block',cursorBlink:false}}));
    await ready; await native.terminalWrite(id,JSON.stringify({kind:'terminal.input',data:${JSON.stringify(JSON.stringify(args) + "\r")}})); await native.terminalDetach(id);
  })()`);
  const delegate = (tree, title) =>
    command([
      "delegate",
      "--role",
      "Worker",
      "--difficulty",
      "low",
      "--title",
      title,
      "--worktree",
      tree,
      "--body",
      "Check candidate availability.",
    ]);
  const children = async () =>
    (await request("teams.children")).children.filter(
      (entry) => entry.parentTerminalId === parent.id,
    );
  await delegate("new", "First worker");
  const child = await waitFor(
    async () => (await children())[0],
    (entry) => Boolean(entry?.terminalId),
  );
  const row = `[data-iori-child-id="${child.id}"]`;
  await screen.wait(row);
  const { terminal: other } = await request("team.launch", {
    teamId: saved.id,
    cwd: repository,
  });
  await screen.wait(`[data-iori-terminal-row="${other.id}"]`);
  const conversation = (await request("terminal.list")).terminals.find(
    (entry) => entry.id === other.id,
  ).teamConversation;
  childListFault.fail(conversation);
  const index = childListFault.requests.length;
  await childListFault.reload();
  await waitFor(
    () => childListFault.requests.slice(index),
    (entries) =>
      entries.some(
        (entry) => entry.conversation === child.conversation && !entry.failed,
      ) &&
      entries.some(
        (entry) => entry.conversation === conversation && entry.failed,
      ),
  );
  await delegate("parent", "Second worker");
  const both = await waitFor(children, (entries) => entries.length === 2);
  for (const entry of both)
    await screen.wait(`[data-iori-child-id="${entry.id}"]`);
  await record("別会話の子一覧が失敗しても既存と新規の子を表示する");
  childListFault.fail(undefined);
  await screen.click(`[data-iori-terminal-row="${parent.id}"]`);
  await screen.wait(
    `[data-iori-terminal-id="${parent.id}"][data-iori-stream-state="ready"]`,
  );
  await screen.click(`${row} .nav-child-button`);
  const tab = `[data-iori-tab-id="terminal:${child.terminalId}"]`;
  await screen.wait(tab);
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(repository)}]`,
  );
  await command([
    "finish",
    child.id,
    "--decision",
    "accept",
    "--reason",
    "Successful verification",
    "--worktree",
    "keep",
  ]);
  await waitFor(
    children,
    (entries) =>
      entries.find((entry) => entry.id === child.id)?.state === "finished",
  );
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await screen.wait(`[data-iori-tab-id="terminal:${parent.id}"]`);
  assert.equal(
    await screen.visible(tab),
    false,
    "別worktreeで終了した子のタブを閉じる",
  );
  await screen.wait('[data-iori-action="children-ended"]');
  if (
    (await screen.attribute(
      '[data-iori-action="children-ended"]',
      "aria-expanded",
    )) === "false"
  )
    await screen.click('[data-iori-action="children-ended"]');
  await screen.click(`${row} .nav-child-button`);
  await screen.wait(tab);
  await command([
    "finish",
    both.find((entry) => entry.id !== child.id).id,
    "--decision",
    "accept",
    "--reason",
    "Successful verification",
    "--worktree",
    "keep",
  ]);
  await waitFor(children, (entries) =>
    entries.every((entry) => entry.state === "finished"),
  );
  await screen.wait(
    `[data-iori-child-id="${both.find((entry) => entry.id !== child.id).id}"][data-iori-child-state="finished"]`,
  );
  assert.equal(await screen.visible(tab), true, "開き直した最後の画面を残す");
  await record("別worktreeで終了した子のタブを閉じ、開き直した画面を残す");
  await screen.contextMenu(`[data-iori-terminal-row="${parent.id}"]`);
  await screen.click('[data-iori-action="terminal-close"]');
  if (await screen.visible('[data-iori-dialog="terminal-close-confirmation"]'))
    await screen.click('[data-iori-action="terminal-confirm-close"]');
  await waitFor(
    async () =>
      !(await request("terminal.list")).terminals.some(
        (entry) => entry.id === parent.id,
      ),
  );
  await waitFor(() =>
    screen.evaluate(`!document.querySelector(${JSON.stringify(row)})`),
  );
  await screen.wait(
    `button[data-iori-worktree-path=${JSON.stringify(child.cwd)}]`,
  );
  await childListFault.reload();
  await screen.wait(
    `button[data-iori-worktree-path=${JSON.stringify(child.cwd)}]`,
  );
  await record("親を閉じた子のworktreeを再読込の前後で通常行として表示する");
}
