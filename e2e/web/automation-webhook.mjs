import { fakeMarker } from "../fake-model/marker.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { waitFor } from "../../verification/ui.mjs";
import { firstCliModel, modelItem } from "../../verification/web/models.mjs";
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
}) {
  const screen = client.screen;
  const codexModel = await firstCliModel(screen, "codex");
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
  await screen.input(".model-picker input", `Codex ${codexModel.name}`);
  await screen.wait(`${modelItem("codex", codexModel)}[data-selected="true"]`);
  await screen.key("Enter");
  await capture("off", scrollWebhook);
  await screen.click(field("webhook"));
  assert.match(
    await screen.text(view),
    /保存してください。URLとトークンが作成されます。/u,
  );
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
  const skipped = await post(url, token);
  await waitFor(() =>
    screen.evaluate(
      `Boolean(document.querySelector('${historyRow(skipped.data.run)}'))`,
    ),
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
  await record("Webhookの履歴と受信本文から会話を開き、実CLIが12と返す");
  await show();
  await screen.click(action("automation-regenerate-webhook-token"));
  await screen.wait('[role="dialog"]');
  await capture("regenerate");
  await screen.evaluate(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).find(e=>e.textContent.trim()==='再生成').click()`,
  );
  await waitFor(async () => (await getToken(automationId)) !== token);
  token = await getToken(automationId);
  await screen.click(action("automation-enabled"));
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector('${action("automation-enabled")}').getAttribute('aria-checked') === 'false'`,
    ),
  );
  await screen.click(field("webhook-scope"));
  await screen.click('[data-iori-automation-option="local"]');
  await save();
  assert.equal(
    (await request("automation.list")).automations.find(
      (a) => a.id === automationId,
    ).webhook.scope,
    "local",
  );
  const localUrl = new URL(url);
  localUrl.hostname = "127.0.0.1";
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
    await waitFor(async () =>
      (await screen.text(view)).includes(
        `ポート${localUrl.port}を使えないため、Webhookを受信できません。`,
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
        `ポート${localUrl.port}を使えないため`,
      ),
  );
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
  const terminalIds = (
    await request("automation.history", { id: automationId })
  ).runs.flatMap((run) => (run.terminalId ? [run.terminalId] : []));
  await screen.click(action("automation-actions"));
  await screen.click(action("automation-delete"));
  await screen.click(action("automation-delete-confirm"));
  await waitFor(
    () => screen.visible(`[data-iori-automation-id="${automationId}"]`),
    (visible) => !visible,
  );
  for (const id of terminalIds) {
    await request("terminal.close", { terminalId: id, confirm: true });
  }
  await record(
    "token再生成の確認、有効の切替と受信範囲の保存、ポートの理由と開き直した後の表示、削除を確認",
  );
  return { codex: codexModel.name };
}
