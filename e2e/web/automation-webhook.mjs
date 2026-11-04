import { fakeMarker } from "../fake-model/marker.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { submitToCli } from "../cli-screen/input.mjs";
import { waitFor } from "../../verification/ui.mjs";
import {
  waitForOperation,
  cliFailure,
} from "../../verification/web/operation.mjs";
import { openSidebar } from "../connection/scenario.mjs";
import { waitForCliState } from "../cli-screen/scenario.mjs";

const action = (name) => `[data-iori-action="${name}"]`;
const field = (name) => `[data-iori-field="automation-${name}"]`;
const view = '[data-iori-view="automations"]';
const historyRow = (id) => `[data-iori-automation-run="${id}"]`;

export async function automationWebhookScenario({
  fakeModelRequests,
  client,
  worktree,
  record,
  shot,
  desktop,
  session,
  assistantReply,
  restartPreservingHost,
}) {
  const screen = client.screen;
  const request = (method, params = {}) =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const response=await connection.requestHost(connection.getSnapshot().host.publicKey,${JSON.stringify(method)},${JSON.stringify(params)});if(!response?.ok)throw new Error('Automation request failed');return response.result;})()`,
    );
  const capture = async (name, section) => {
    if (process.env.IORI_AUTOMATION_WEBHOOK_CAPTURE !== "1") return;
    const dark = await screen.evaluate(
      "document.documentElement.classList.contains('dark')",
    );
    for (const [device, width, height] of [
      ["pc", 1440, 1000],
      ["wqhd", 2560, 1440],
      ["mobile", 390, 844],
    ]) {
      await client.browser.viewport({ width, height });
      if (section)
        await screen.evaluate(
          `document.querySelector(${JSON.stringify(section)}).scrollIntoView({block:'start'})`,
        );
      for (const theme of ["light", "dark"]) {
        await screen.evaluate(
          `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
        );
        await shot(`${device}-automation-webhook-${name}-${theme}`);
      }
    }
    await client.browser.viewport({ width: 1440, height: 1000 });
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${dark})`,
    );
  };
  const scrollWebhook = `${field("webhook")}`;
  const save = async () => {
    await screen.click(action("automation-save"));
    await waitFor(() =>
      screen.evaluate(
        `document.querySelector('${view} ${action("automation-save")}')?.disabled === true && document.querySelector('${view} ${action("automation-run")}')?.disabled === false`,
      ),
    );
  };
  const post = async (
    url,
    token,
    body = '{"a":7,"b":5}',
    scheme = "Bearer",
  ) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `${scheme} ${token}`,
        "Content-Type": "application/json",
      },
      body,
    });
    return {
      status: response.status,
      data: response.status === 202 ? await response.json() : undefined,
    };
  };
  const noConnection = async (url, token) =>
    assert.rejects(post(url, token), /fetch failed/u);
  const getToken = async (id) =>
    (await request("automation.list")).automations.find((a) => a.id === id)
      .webhookToken;
  const show = async () => {
    await openSidebar(screen);
    await screen.click(action("open-agents-teams"));
    await screen.click(action("teams-automations"));
    await screen.wait(view);
  };
  await desktop();
  await show();
  await screen.click(action("automation-new"));
  await screen.input(field("name"), "Webhook automation");
  await screen.input(
    field("instruction"),
    "受け取った本文のaとbを足した答えを数字だけで返してください。" +
      fakeMarker("automation-webhook"),
  );
  await screen.input(field("folder"), worktree);
  await screen.click(`${view} ${action("candidate-model")}`);
  await screen.input(".model-picker input", "Codex gpt-6-luna");
  await screen.wait('[cmdk-item][data-cli="codex"][data-selected="true"]');
  await screen.key("Enter");
  await capture("off", scrollWebhook);
  await screen.click(field("webhook"));
  assert.match(await screen.text(view), /保存するとURLとtokenを作成します。/u);
  assert.match(await screen.text(field("webhook-scope")), /LAN・VPN/u);
  await capture("before-save", scrollWebhook);
  await save();
  await screen.reveal(action("automation-regenerate-webhook-token"));
  const id = await screen.evaluate(
    `document.querySelector('${view} ${action("automation-back")}') && [...document.querySelectorAll('[data-iori-automation-id]')].find(e=>e.querySelector('strong')?.textContent==='Webhook automation')?.dataset.ioriAutomationId`,
  );
  // The selected row may be hidden in the mobile layout; the Host returns its ID.
  const automation = (await request("automation.list")).automations.find(
    (a) => a.name === "Webhook automation",
  );
  assert.ok(automation?.id);
  const automationId = id || automation.id;
  let token = await getToken(automationId);
  const url = await screen.evaluate(
    `document.querySelector('${action("automation-copy-webhook-url")}').parentElement.parentElement.querySelector('code').textContent`,
  );
  assert.match(await screen.text(view), /••••••••/u);
  assert.match(await screen.text(view), /curl -X POST/u);
  await capture("saved", scrollWebhook);
  await capture("history-empty", '[data-iori-view="automation-history"]');
  const first = await post(url, token);
  assert.equal(first.status, 202);
  assert.equal(first.data.status, "started");
  const skipped = await post(url, token);
  assert.equal(skipped.status, 202);
  assert.equal(skipped.data.status, "skipped");
  assert.equal(skipped.data.reason, "busy");
  await waitFor(() =>
    screen.evaluate(
      `Boolean(document.querySelector('${historyRow(skipped.data.run)}'))`,
    ),
  );
  const before = await screen.evaluate(
    `document.querySelectorAll('[data-iori-automation-run]').length`,
  );
  assert.equal((await post(url, "wrong-token")).status, 401);
  assert.equal(
    await screen.evaluate(
      `document.querySelectorAll('[data-iori-automation-run]').length`,
    ),
    before,
  );
  for (const run of [first.data.run, skipped.data.run]) {
    await screen.reveal(historyRow(run));
    const text = await screen.text(historyRow(run));
    assert.match(text, /Webhook/u);
    assert.match(text, /送信元/u);
    await screen.click(`${historyRow(run)} ${action("automation-received")}`);
    await screen.wait('[data-iori-view="automation-received"]');
    assert.match(
      await screen.text('[data-iori-view="automation-received"]'),
      /\{"a":7,"b":5\}/u,
    );
    if (run === first.data.run) await capture("received");
    await screen.key("Escape");
  }
  await capture("history", '[data-iori-view="automation-history"]');
  const terminalId = await screen.attribute(
    `${historyRow(first.data.run)} ${action("automation-conversation")}`,
    "data-iori-terminal-id",
  );
  await screen.click(
    `${historyRow(first.data.run)} ${action("automation-conversation")}`,
  );
  await screen.wait(
    `[data-iori-terminal-id="${terminalId}"][data-iori-stream-state="ready"]`,
  );
  const saved = await waitForOperation(
    "Webhookの会話ID",
    () => session(terminalId),
    (value) => Boolean(value?.session?.id),
    cliFailure(screen, terminalId),
  );
  await waitForOperation(
    "Webhookの本文を受け取ったCLIの応答",
    () => assistantReply(saved.session.id, "12"),
    Boolean,
    cliFailure(screen, terminalId),
  );
  if (fakeModelRequests)
    assert.ok(
      fakeModelRequests.some(
        (request) =>
          request.marker === "automation-webhook" &&
          request.step === 0 &&
          request.tokensPresent['"a": 7'] &&
          request.tokensPresent['"b": 5'],
      ),
      "Webhook本文の値がモデル要求に含まれる",
    );
  await waitForCliState(client, terminalId, ["idle", "done"]);
  await record("Webhookの本文から実CLIが12と返し、作業中の受信は飛ばされる");
  const second = await post(url, token);
  assert.equal(second.data.status, "started");
  await show();
  await screen.click(action("automation-back"));
  await screen.click(`[data-iori-automation-id="${automationId}"]`);
  await waitFor(() =>
    screen.evaluate(
      `Boolean(document.querySelector('${historyRow(second.data.run)} ${action("automation-conversation")}'))`,
    ),
  );
  const secondTerminal = await screen.attribute(
    `${historyRow(second.data.run)} ${action("automation-conversation")}`,
    "data-iori-terminal-id",
  );
  await screen.click(
    `${historyRow(second.data.run)} ${action("automation-conversation")}`,
  );
  await screen.wait(
    `[data-iori-terminal-id="${secondTerminal}"][data-iori-stream-state="ready"]`,
  );
  await waitForCliState(client, secondTerminal, ["idle", "done"]);
  await submitToCli(client, "/exit", undefined, "automation-webhook-exit");
  await waitFor(
    async () =>
      !(await request("terminal.list")).terminals.find(
        (t) => t.id === secondTerminal,
      )?.cli,
  );
  const third = await post(url, token, undefined, "bearer");
  assert.equal(third.status, 202);
  assert.equal(third.data.status, "started");
  await show();
  await screen.click(action("automation-regenerate-webhook-token"));
  await screen.wait('[role="dialog"]');
  await capture("regenerate");
  await screen.evaluate(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).find(e=>e.textContent.trim()==='作り直す').click()`,
  );
  await waitFor(async () => (await getToken(automationId)) !== token);
  const oldToken = token;
  token = await getToken(automationId);
  assert.equal((await post(url, oldToken)).status, 401);
  await screen.click(action("automation-enabled"));
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector('${action("automation-enabled")}').getAttribute('aria-checked') === 'false'`,
    ),
  );
  const disabled = await post(url, token);
  assert.equal(disabled.status, 202);
  assert.equal(disabled.data.reason, "disabled");
  await restartPreservingHost();
  await screen.wait('[data-iori-state="connected"]');
  assert.equal((await post(url, token)).status, 202);
  await screen.click(field("webhook-scope"));
  await screen.click('[data-iori-automation-option="local"]');
  await save();
  await noConnection(url, token);
  const localUrl = new URL(url);
  localUrl.hostname = "127.0.0.1";
  assert.equal((await post(localUrl.href, token)).status, 202);
  await screen.click(field("webhook"));
  await save();
  const blocker = createServer();
  await new Promise((resolve, reject) =>
    blocker
      .once("error", reject)
      .listen(Number(localUrl.port), "0.0.0.0", resolve),
  );
  try {
    await screen.click(field("webhook"));
    await save();
    assert.equal(await getToken(automationId), token);
    await waitFor(async () =>
      (await screen.text(view)).includes(
        `ポート${localUrl.port}を開けないため、Webhookを受け付けていません。`,
      ),
    );
    await capture("port-error", scrollWebhook);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
  await screen.click(action("automation-back"));
  await screen.click(`[data-iori-automation-id="${automationId}"]`);
  await waitFor(
    async () =>
      !(await screen.text(view)).includes(
        `ポート${localUrl.port}を開けないため`,
      ),
  );
  assert.equal((await post(localUrl.href, token)).status, 202);
  if (process.env.IORI_AUTOMATION_WEBHOOK_CAPTURE === "1") {
    const long = JSON.stringify({
      a: 7,
      b: 5,
      message: "長い本文です。\n".repeat(80),
    });
    const received = await post(localUrl.href, token, long);
    await screen.reveal(historyRow(received.data.run));
    await screen.click(
      `${historyRow(received.data.run)} ${action("automation-received")}`,
    );
    await screen.wait('[data-iori-view="automation-received"]');
    await client.browser.viewport({ width: 390, height: 844 });
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      await shot(`mobile-automation-webhook-received-long-${theme}`);
    }
    await client.browser.viewport({ width: 1440, height: 1000 });
    await screen.key("Escape");
  }
  await screen.click(field("webhook"));
  await save();
  await noConnection(localUrl.href, token);
  const terminalIds = (
    await request("automation.history", { id: automationId })
  ).runs.flatMap((run) => (run.terminalId ? [run.terminalId] : []));
  await screen.click(action("automation-actions"));
  await screen.click(action("automation-delete"));
  await screen.click(action("automation-delete-confirm"));
  await waitFor(
    async () =>
      !(await request("automation.list")).automations.some(
        (a) => a.id === automationId,
      ),
  );
  const files = await readdir(
    join(
      process.env.XDG_DATA_HOME,
      "iori-host",
      "automation-files",
      automationId,
    ),
  );
  assert.equal(
    files.some((file) => file.endsWith(".received.json")),
    false,
  );
  for (const id of terminalIds) {
    await request("terminal.close", { terminalId: id, confirm: true });
  }
  await record(
    "tokenの更新、無効、再起動、受信範囲、ポート競合後の画面を開き直しての回復と待受の終了を確認",
  );
}
