import { fakeMarker } from "../fake-model/marker.mjs";
import { submitToCli } from "./input.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import {
  observeCliCompletion,
  cliFailure,
  waitForOperation,
} from "../../verification/web/operation.mjs";
import { observed, clearObserved } from "../terminal/scenario.mjs";
import {
  finishCli,
  waitForCliState,
  waitForCodexInput,
  waitForPiInput,
} from "./scenario.mjs";
const action = (name) => `[data-iori-action="${name}"]`;
async function focus(client, id) {
  await client.screen.evaluate(
    `document.querySelector('[data-iori-terminal-id="${id}"] [data-iori-field="terminal-input"]').focus()`,
  );
}
async function themedShots(client, shot, name) {
  for (const theme of ["light", "dark"]) {
    await client.screen.evaluate(
      `document.documentElement.classList.toggle('dark',${theme === "dark"})`,
    );
    await shot(`${name}-${theme}`);
  }
}
export async function cliStatusScenario({
  client,
  record,
  shot,
  mobile,
  desktop,
  windows = false,
  firstUse = false,
  notifications = false,
  missedWaiting,
}) {
  const screen = client.screen;
  if (notifications)
    await screen.evaluate(
      `(()=>{ window.__notificationRequests=[]; window.addEventListener('iori:notification-request', e=>window.__notificationRequests.push(e.detail)); })()`,
    );
  let runningTerminal;
  const open = async (cli) => {
    await screen.click(action("workspace-add-tab"));
    await screen.click(`[data-iori-cli-id="${cli}"]`);
    await screen.wait(`[data-iori-tab-cli="${cli}"]`);
    const id = (
      await screen.attribute(`[data-iori-tab-cli="${cli}"]`, "data-iori-tab-id")
    ).replace(/^terminal:/, "");
    await screen.wait(
      `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
    );
    await focus(client, id);
    return id;
  };
  const ready = (id) => waitForCodexInput(client, id);
  if (firstUse) {
    const first = await open("codex");
    await ready(first);
    const completion = await observeCliCompletion(screen, first);
    // Codex reports its session only once a turn starts, so the first
    // conversation's mark appears with its first reply.
    await submitToCli(
      client,
      "Reply exactly FIRST_DONE without using tools." +
        fakeMarker("codex-first"),
      undefined,
      "first-status-reply",
      { focus: false },
    );
    await screen.wait(`[data-iori-terminal-row="${first}"] [data-status]`);
    await observed(client, "FIRST_DONE");
    const answer = await waitForOperation(
      "最初のCodexの応答完了",
      completion.read,
      Boolean,
      cliFailure(screen, first),
    );
    await completion.stop();
    assert.equal(answer.response.trim(), "FIRST_DONE");
    await finishCli(client, first);
    await record("初めて開くCodexも最初の会話から状態の印が出る");
  }
  const id = await open("codex");
  await ready(id);
  const row = `[data-iori-terminal-row="${id}"]`;
  await clearObserved(client);
  await screen.evaluate(`(()=>{
    window.__cliStatusHistory=[];
    window.__cliStatusObserver=new MutationObserver(records=>{
      for(const record of records) {
        if(!record.target.closest(${JSON.stringify(row)}))continue;
        for(const state of [record.oldValue,record.target.getAttribute('data-status')])
          if(state)window.__cliStatusHistory.push(state);
      }
    });
    window.__cliStatusObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-status'],attributeOldValue:true});
  })()`);
  const completion = await observeCliCompletion(screen, id);
  await submitToCli(
    client,
    "Reply exactly STATUS_DONE password=iori_test_fake_secret without using tools." +
      fakeMarker("codex-status"),
    undefined,
    "status-reply",
    { focus: false },
  );
  const group = await screen.attribute(
    `[data-iori-tab-id="terminal:${id}"]`,
    "data-iori-group-id",
    "[data-iori-group-id]",
  );
  const sibling = await screen.evaluate(
    `[...document.querySelectorAll('[data-iori-group-id="${group}"] [data-iori-tab-id]')].find(e=>e.getAttribute('data-iori-tab-id')!=='terminal:${id}').getAttribute('data-iori-tab-id')`,
  );
  await screen.click(`[data-iori-tab-id="${sibling}"]`);
  await waitFor(() =>
    screen.evaluate("window.__cliStatusHistory.includes('active')"),
  );
  await waitForOperation(
    "Codexの応答完了",
    completion.read,
    Boolean,
    cliFailure(screen, id),
  );
  await completion.stop();
  if (notifications) {
    await waitFor(
      () =>
        screen.evaluate(
          `window.__notificationRequests.filter(n=>n.target.terminalId==='${id}').length`,
        ),
      (value) => value === 1,
    );
    const request = await screen.evaluate(
      `window.__notificationRequests.find(n=>n.target.terminalId==='${id}')`,
    );
    assert.equal(request.title, "repository / worktree - Codex 完了");
    assert.equal(request.body, "STATUS_DONE password=[redacted]");
    assert.ok(request.body.length);
    await record(
      "見ていないCLIの完了の通知要求が正しい題名と秘密を伏せた本文で1回だけ出る",
    );
  }
  await screen.evaluate("window.__cliStatusObserver.disconnect()");
  await screen.click(row);
  await screen.wait(`${row} [aria-label="待機中"],${row} [aria-label="Idle"]`);

  await record("本物のCodexで応答中→完了→表示で待機中");
  await focus(client, id);
  await clearObserved(client);
  await submitToCli(
    client,
    'For this new task, use exec to call tools.exec_command with cmd set to node -e "console.log(42)". Run that exact command once and request approval if needed. Do not substitute another command.' +
      fakeMarker("codex-approval"),
    undefined,
    "status-approval",
    { focus: false },
  );
  await screen.wait(`${row} [data-status="waiting"]`);
  assert.equal(
    await screen.attribute(
      action("attention-open"),
      "data-iori-attention-count",
    ),
    "1",
  );
  await record("本物のCodexの承認待ちがPCの判断待ち1に現れる");
  if (notifications) {
    assert.equal(
      await screen.evaluate(
        `window.__notificationRequests.filter(n=>n.target.terminalId==='${id}' && n.title.endsWith('完了')).length`,
      ),
      1,
    );
    assert.equal(
      await screen.evaluate(
        `window.__notificationRequests.filter(n=>n.target.terminalId==='${id}' && n.title.includes('承認待ち')).length`,
      ),
      0,
    );
    await record("見ているCLIの承認待ちは通知要求を出さない");
  }
  // v9 composition is two CLI panes above the shell; keep the approved
  // command untouched while the other real CLI works in its own pane.
  if (!windows) {
    const otherGroup = await screen.evaluate(
      `[...document.querySelectorAll('[data-iori-group-id]')].find(e=>e.getAttribute('data-iori-group-id')!=='${group}' && e.querySelector('[data-iori-tab-id]')).getAttribute('data-iori-group-id')`,
    );
    await screen.click(
      `[data-iori-group-id="${otherGroup}"] ${action("workspace-add-tab")}`,
    );
    await screen.wait('[data-iori-cli-id="pi"]');
    await screen.click('[data-iori-cli-id="pi"]');
    await screen.wait('[data-iori-tab-cli="pi"]');
    const pi = (
      await screen.attribute('[data-iori-tab-cli="pi"]', "data-iori-tab-id")
    ).replace(/^terminal:/, "");
    runningTerminal = pi;
    await screen.wait(
      `[data-iori-terminal-id="${pi}"][data-iori-stream-state="ready"]`,
    );
    await focus(client, pi);
    await waitForPiInput(client, pi);
    await submitToCli(
      client,
      "Use bash to run sleep 90, then reply done." + fakeMarker("pi-running"),
      undefined,
      "running",
      { focus: false },
    );
    await screen.wait(
      `[data-iori-terminal-row="${pi}"] [data-status="active"]`,
    );
    // UserPromptSubmit precedes the model response. Wait for Pi's real tool
    // call too, so closing the Running sample cannot erase its model record.
    await observed(client, "$ sleep 90");
    await themedShots(client, shot, "pc-overall-ja-status");
    await mobile();
    await screen.wait('[data-iori-view="mobile-home"]');
    await screen.wait(`[data-iori-attention-terminal="${id}"]`);
    await screen.wait("[data-iori-running-worktree]");
    await themedShots(client, shot, "mobile-home-status");
    await screen.click(`[data-iori-attention-terminal="${id}"]`);
    await screen.wait(
      `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
    );
    await record("Mobileの最初の画面で判断待ちとRunningを見て対象のCLIへ移る");
  } else await themedShots(client, shot, "pc-overall-ja-status");
  // A phone's CLI screen starts in batch input, where the terminal takes no
  // typed keys; the user answers with the key band's Enter.
  if (!windows)
    await screen.tap(`[data-iori-terminal-id="${id}"] [data-iori-key="enter"]`);
  else {
    await focus(client, id);
    await screen.key("Enter");
  }
  if (!windows) await desktop();
  await waitFor(
    () =>
      screen.attribute(action("attention-open"), "data-iori-attention-count"),
    (value) => value === "0",
  );
  await record("CLI自身の承認画面で答えると判断待ちから消える");
  await screen.wait(`[data-iori-tab-id="terminal:${id}"]`);
  await screen.click(`[data-iori-tab-id="terminal:${id}"]`);
  await focus(client, id);
  if (missedWaiting) {
    await waitForCodexInput(client, id);
    await submitToCli(
      client,
      "Run the two commands, asking approval for each." +
        fakeMarker("codex-two-approvals"),
      undefined,
      "two-approvals",
      { focus: false },
    );
    await screen.wait(`${row} [data-status="waiting"]`);
    const hostKey = await screen.evaluate(
      "(async()=> (await import('/src/connection.ts')).connection.getSnapshot().host.publicKey)()",
    );
    const key = JSON.stringify([hostKey, id]);
    await waitFor(
      () =>
        screen.evaluate(
          `(async()=> (await (await import('/src/native.ts')).native.loadView('notification-seen'))?.[${JSON.stringify(key)}])()`,
        ),
      (value) => value?.startsWith('["waiting",'),
    );
    await screen.click(`[data-iori-tab-id="${sibling}"]`);
    await missedWaiting(id);
    await screen.wait('[data-iori-view="workspace"]');
    const notices = await waitFor(
      () => screen.evaluate("window.__reopenedNotices"),
      (values) =>
        values?.some(
          (entry) =>
            entry.target.terminalId === id && entry.body.includes("approval-b"),
        ),
    );
    assert.equal(
      notices.filter(
        (entry) =>
          entry.target.terminalId === id && entry.body.includes("approval-b"),
      ).length,
      1,
    );
    await record(
      "Clientを閉じた間に承認Aを回答し承認Bで止まると、起動後にBを通知する",
    );
    await screen.click(row);
    await focus(client, id);
    await screen.key("Enter");
    await waitForCliState(client, id, ["done", "idle"]);
  }
  await finishCli(client, id);
  await waitFor(
    () =>
      screen.attribute(
        `[data-iori-tab-id="terminal:${id}"]`,
        "data-iori-tab-cli",
      ),
    (value) => !value,
  );
  assert.equal(
    await screen.visible(`${row} [data-status]`),
    false,
    "shellへ戻ると印が消える",
  );
  await record("CLIからshellへ戻ると状態の印を消す");
  if (runningTerminal) {
    const runningRow = `[data-iori-terminal-row="${runningTerminal}"]`;
    await screen.contextMenu(runningRow);
    await screen.click(action("terminal-close"));
    await screen.wait('[data-iori-dialog="terminal-close-confirmation"]');
    await screen.click(action("terminal-confirm-close"));
    await waitFor(
      () => screen.visible(runningRow),
      (visible) => !visible,
    );
    await screen.click(row);
  }
}
