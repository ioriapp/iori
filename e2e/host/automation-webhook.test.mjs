import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runHostTest } from "../../verification/host/process.mjs";
import {
  registerAutomationCli,
  delivered,
  launchedRun,
} from "../../verification/host/automation-definition.mjs";

async function setup(client, dataRoot, enabled = true) {
  const cli = await registerAutomationCli(client, dataRoot);
  const definition = {
    name: "Webhook",
    instruction: "Handle the received data.",
    cwd: dataRoot,
    target: {
      kind: "cli",
      candidate: { id: "webhook-cli", cli, model: "", tools: [], minimum: "" },
    },
    schedule: { kind: "manual" },
    webhook: { scope: "local" },
    missed: "skip",
    enabled,
  };
  const { automation } = await client.request("automation.save", {
    definition,
  });
  const { webhook } = await client.request("automation.list");
  assert.ok(webhook && !webhook.error);
  return {
    automation,
    definition,
    url: `http://127.0.0.1:${webhook.port}/hooks/${automation.id}`,
  };
}

const post = (url, token, body = '{"message":"hello"}') =>
  fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: "private-cookie",
      "Proxy-Authorization": "private-proxy",
      "Content-Type": "application/json",
    },
    body,
  });

test("WebhookはBearer tokenを確認し、秘密を除いた受信内容を履歴に残す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("Webhook付きの無効な自動化を登録する");
    const { automation, url } = await setup(client, dataRoot, false);
    stage("誤ったtokenを拒否し履歴を増やさない");
    assert.equal((await post(url, "wrong-token")).status, 401);
    assert.deepEqual(
      (await client.request("automation.history", { id: automation.id })).runs,
      [],
    );
    stage("正しいtokenの受信を履歴で読む");
    const response = await post(
      `${url}?tag=one&tag=two`,
      automation.webhookToken,
    );
    assert.equal(response.status, 202);
    const result = await response.json();
    assert.equal(result.reason, "disabled");
    const { received } = await client.request("automation.received", {
      id: result.run,
    });
    assert.equal(received.body, '{"message":"hello"}');
    assert.deepEqual(received.query.tag, ["one", "two"]);
    assert.equal(received.headers.authorization, undefined);
    assert.equal(received.headers.cookie, undefined);
    assert.equal(received.headers["proxy-authorization"], undefined);
    assert.ok(!JSON.stringify(received).includes(automation.webhookToken));
  }));

test("Webhookで起動したCLIに本文が届き、認証tokenは渡らない", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("Webhook付きの自動化を登録する");
    const { automation, url } = await setup(client, dataRoot);
    stage("正しいtokenで本文を送る");
    const response = await post(url, automation.webhookToken);
    assert.equal(response.status, 202);
    const result = await response.json();
    assert.equal(result.status, "started");
    const run = await launchedRun(
      client,
      automation.id,
      (item) => item.id === result.run,
    );
    assert.ok(run?.terminalId, run?.launchError);
    stage("CLIのPTYで受信本文を読む");
    const terminal = await client.terminal(run.terminalId);
    const body = await delivered(terminal);
    assert.ok(body.includes("hello"));
    assert.ok(!body.includes(automation.webhookToken));
    assert.ok(!body.includes("private-cookie"));
    assert.ok(!body.includes("private-proxy"));
  }));

test("Webhookのtoken再生成で古いtokenを拒否する", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("Webhook付きの自動化を登録する");
    const { automation, url } = await setup(client, dataRoot, false);
    const { automation: updated } = await client.request(
      "automation.regenerateToken",
      { id: automation.id },
    );
    stage("古いtokenを拒否し新しいtokenを受理する");
    assert.equal((await post(url, automation.webhookToken)).status, 401);
    assert.equal((await post(url, updated.webhookToken)).status, 202);
  }));

test("Webhookは作業中の受信を飛ばして履歴に本文を残す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { automation, url } = await setup(client, dataRoot);
    const first = await (await post(url, automation.webhookToken)).json();
    const run = await launchedRun(
      client,
      automation.id,
      (run) => run.id === first.run,
    );
    await delivered(await client.terminal(run.terminalId));
    stage("作業中の受信は新しいCLIを起動しない");
    const skipped = await (
      await post(url, automation.webhookToken, "second delivery")
    ).json();
    assert.equal(skipped.status, "skipped");
    assert.equal(skipped.reason, "busy");
    const saved = (
      await client.request("automation.history", { id: automation.id })
    ).runs.find((run) => run.id === skipped.run);
    assert.equal(saved.terminalId, undefined);
    assert.equal(
      (await client.request("automation.received", { id: skipped.run }))
        .received.body,
      "second delivery",
    );
  }));

test("CLIの終了後に届いたWebhookは新しい会話を起動する", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { automation, url } = await setup(client, dataRoot);
    const first = await (await post(url, automation.webhookToken)).json();
    const run = await launchedRun(
      client,
      automation.id,
      (item) => item.id === first.run,
    );
    const terminal = await client.terminal(run.terminalId);
    await delivered(terminal);
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    await terminal.input(JSON.stringify({ exit: true }) + "\r");
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === run.terminalId &&
        !event.terminal.cli,
    );
    const response = await post(url, automation.webhookToken);
    assert.equal(response.status, 202);
    const next = await response.json();
    assert.equal(next.status, "started");
    const nextRun = await launchedRun(
      client,
      automation.id,
      (item) => item.id === next.run,
    );
    assert.notEqual(nextRun.terminalId, run.terminalId);
  }));

test("WebhookはPOSTとBearer認証、UTF-8の本文の上限を確認する", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { automation, url } = await setup(client, dataRoot, false);
    const authorization = `Bearer ${automation.webhookToken}`;
    assert.equal((await fetch(url)).status, 405);
    assert.equal(
      (
        await fetch(`${url}?token=${automation.webhookToken}`, {
          method: "POST",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: { Authorization: authorization },
          body: Buffer.from([0xff]),
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: { Authorization: authorization },
          body: "x".repeat(1024 * 1024 + 1),
        })
      ).status,
      413,
    );
    assert.deepEqual(
      (await client.request("automation.history", { id: automation.id })).runs,
      [],
    );
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: { Authorization: `bearer ${automation.webhookToken}` },
          body: "",
        })
      ).status,
      202,
    );
  }));

test("Webhookの設定とtokenは無効化とHost再起動の後も保持する", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart }) => {
    const { automation, definition, url } = await setup(
      client,
      dataRoot,
      false,
    );
    await client.request("automation.save", {
      id: automation.id,
      definition: { ...definition, webhook: undefined },
    });
    await assert.rejects(post(url, automation.webhookToken), /fetch failed/u);
    const restored = await client.request("automation.save", {
      id: automation.id,
      definition,
    });
    assert.equal(
      restored.automation.webhookToken === automation.webhookToken,
      true,
    );
    client = await restart();
    const { webhook } = await client.request("automation.list");
    const response = await post(
      `http://127.0.0.1:${webhook.port}/hooks/${automation.id}`,
      automation.webhookToken,
    );
    assert.equal(response.status, 202);
    assert.equal((await response.json()).reason, "disabled");
  }));

test("Webhookの自動化を削除すると受信本文も削除する", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { automation, url } = await setup(client, dataRoot, false);
    const { run } = await (await post(url, automation.webhookToken)).json();
    assert.equal(
      (await client.request("automation.received", { id: run })).received.body,
      '{"message":"hello"}',
    );
    await client.request("automation.delete", { id: automation.id });
    await assert.rejects(
      client.request("automation.received", { id: run }),
      /Host request failed/u,
    );
    assert.equal((await client.request("automation.list")).webhook, undefined);
    const files = await readdir(
      join(dataRoot, "iori-host", "automation-files", automation.id),
    );
    assert.equal(
      files.some((file) => file.endsWith(".received.json")),
      false,
    );
  }));

test("Webhookのportが使えなくても設定を保ち、一覧を開き直すと受信へ戻る", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { automation, definition, url } = await setup(
      client,
      dataRoot,
      false,
    );
    await client.request("automation.save", {
      id: automation.id,
      definition: { ...definition, webhook: undefined },
    });
    const blocker = createServer();
    await new Promise((resolve, reject) =>
      blocker
        .once("error", reject)
        .listen(Number(new URL(url).port), "0.0.0.0", resolve),
    );
    t.after(() => new Promise((resolve) => blocker.close(resolve)));
    await client.request("automation.save", { id: automation.id, definition });
    assert.equal(
      (await client.request("automation.list")).webhook.error,
      "port",
    );
    stage("portを空けて一覧から待受を再試行する");
    await new Promise((resolve) => blocker.close(resolve));
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    for (;;) {
      const seen = events.values.length;
      const { webhook } = await client.request("automation.list");
      if (!webhook.error) break;
      await events.waitFor(() => events.values.length > seen);
    }
    assert.equal((await post(url, automation.webhookToken)).status, 202);
  }));

test("Webhookの受信元をこのマシンだけに替えるとLAN側からは接続できない", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const { automation, definition, url } = await setup(
      client,
      dataRoot,
      false,
    );
    const address = Object.values(networkInterfaces())
      .flat()
      .find((value) => value.family === "IPv4" && !value.internal)?.address;
    assert.ok(address, "Linuxの検証HostのLANアドレスを使う");
    const lanUrl = new URL(url);
    lanUrl.hostname = address;
    await client.request("automation.save", {
      id: automation.id,
      definition: { ...definition, webhook: { scope: "lan" } },
    });
    assert.equal(
      (await post(lanUrl.href, automation.webhookToken)).status,
      202,
    );
    await client.request("automation.save", { id: automation.id, definition });
    const { automation: lan } = await client.request("automation.save", {
      definition: { ...definition, name: "LAN", webhook: { scope: "lan" } },
    });
    assert.equal(
      (await post(lanUrl.href, automation.webhookToken)).status,
      403,
    );
    await client.request("automation.delete", { id: lan.id });
    await assert.rejects(
      post(lanUrl.href, automation.webhookToken),
      /fetch failed/u,
    );
    assert.equal((await post(url, automation.webhookToken)).status, 202);
  }));
