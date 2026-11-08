import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import { forgeFixture } from "../../verification/host/forge-fixture.mjs";
import {
  automationCommand,
  plainOutput,
  registerAutomationCli,
} from "../../verification/host/automation-definition.mjs";

const list = (client, path) =>
  client.request("forge.issues.list", {
    path,
    state: "open",
    labels: [],
    page: 1,
  });
const site = async (client, origin) =>
  (await client.request("forge.sites")).sites.find(
    (site) => site.origin === origin,
  );

test("Forgeでないサイトにはtokenを送らず、登録しない", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    forge.state.notForge = true;
    assert.equal(
      (
        await client.request("forge.token.set", {
          origin: forge.origin,
          token: forge.token,
        })
      ).rejected,
      "not-forge",
    );
    assert.ok(forge.requests.length > 0);
    assert.equal(
      forge.requests.some((request) => request.hasAuthorization),
      false,
    );
    assert.equal((await site(client, forge.origin))?.token, undefined);
  }));

test("Forgeが受け付けないtokenは保存しない", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    const result = await client.request("forge.token.set", {
      origin: forge.origin,
      token: "wrong-token",
    });
    assert.equal(result.rejected, "token-invalid");
    assert.equal((await site(client, forge.origin))?.token, undefined);
  }));

test("Forge tokenを登録・再起動・削除すると非公開Issueの読み取りにも反映する", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const forge = await forgeFixture(t, dataRoot);
    forge.state.private = true;
    await assert.rejects(
      list(client, forge.repository),
      /Host request failed/u,
    );
    const cliId = await registerAutomationCli(client, dataRoot);
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: forge.repository,
    });
    const terminal = await client.terminal(created.id);
    await terminal.output("AUTOMATION_READY");
    const missing = await automationCommand(terminal, "missing", [
      "issue",
      "list",
    ]);
    assert.equal(missing.code, 1);
    assert.equal(
      missing.stdout,
      `No token is registered for ${forge.origin}. Register one in iori: Settings > Integrations of this Host.\n`,
    );

    await client.request("forge.token.set", {
      origin: forge.origin,
      token: forge.token,
    });
    assert.equal((await list(client, forge.repository)).issues[0].number, 3);
    stage("再起動後もtokenを利用し、削除後は送信しない");
    client = await restart();
    assert.equal((await list(client, forge.repository)).issues[0].number, 3);
    await client.request("forge.token.remove", { origin: forge.origin });
    const before = forge.requests.length;
    await assert.rejects(
      list(client, forge.repository),
      /Host request failed/u,
    );
    assert.ok(forge.requests.length > before);
    assert.equal(
      forge.requests.slice(before).some((request) => request.hasAuthorization),
      false,
    );
  }));

test("無効になったForge tokenは連携に理由を示し、交換後は読める", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    await client.request("forge.token.set", {
      origin: forge.origin,
      token: forge.token,
    });
    forge.state.rejected = true;
    await assert.rejects(list(client, forge.repository));
    assert.equal(
      (await site(client, forge.origin)).failure.reason,
      "token-invalid",
    );
    forge.state.rejected = false;
    await client.request("forge.token.set", {
      origin: forge.origin,
      token: forge.replacementToken,
    });
    assert.equal((await list(client, forge.repository)).issues[0].number, 3);
    assert.equal((await site(client, forge.origin)).failure, undefined);
  }));

test("接続できないForgeの連携は再試行で復帰する", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    await client.request("forge.token.set", {
      origin: forge.origin,
      token: forge.token,
    });
    forge.state.unreachable = true;
    await assert.rejects(list(client, forge.repository));
    assert.equal(
      (await site(client, forge.origin)).failure.reason,
      "unreachable",
    );
    forge.state.unreachable = false;
    assert.equal(
      (await client.request("forge.site.check", { origin: forge.origin })).site
        .failure,
      undefined,
    );
  }));

test("Forge tokenはCLIの環境・引数・応答やSQLiteに出ず、本人だけが読める場所に保存する", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const forge = await forgeFixture(t, dataRoot);
    forge.state.private = true;
    const saved = await client.request("forge.token.set", {
      origin: forge.origin,
      token: forge.token,
    });
    assert.equal(JSON.stringify(saved).includes(forge.token), false);
    const cliId = await registerAutomationCli(client, dataRoot);
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: forge.repository,
    });
    const terminal = await client.terminal(created.id);
    const { output } = await terminal.waitFor(({ output }) =>
      output.includes("AUTOMATION_READY"),
    );
    const pid = /AUTOMATION_PID:(\d+)/u.exec(plainOutput(output))[1];
    stage("CLIへ渡した環境と引数にtokenが無い");
    for (const name of ["environ", "cmdline"])
      assert.equal(
        (await readFile(`/proc/${pid}/${name}`)).includes(forge.token),
        false,
      );
    const answer = await automationCommand(terminal, "private", [
      "issue",
      "show",
      "2",
      "--json",
    ]);
    assert.equal(answer.code, 0);
    assert.equal(answer.stdout.includes(forge.token), false);
    assert.equal(JSON.parse(answer.stdout).data.issue.body, "Issue body");
    stage("通常の設定応答とHostの記録にtokenが無い");
    assert.equal(
      JSON.stringify(await client.request("forge.sites")).includes(forge.token),
      false,
    );
    for (const name of ["host.sqlite", "host.sqlite-wal"]) {
      const bytes = await readFile(join(dataRoot, "iori-host", name)).catch(
        () => Buffer.of(),
      );
      assert.equal(bytes.includes(forge.token), false);
    }
    assert.equal(
      (await stat(join(dataRoot, "iori-host", "forge-tokens"))).mode & 0o777,
      0o600,
    );
  }));

test("Forgeの権限不足は連携へ必要なscopeを返す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    await client.request("forge.token.set", {
      origin: forge.origin,
      token: forge.token,
    });
    forge.state.scope = true;
    await assert.rejects(list(client, forge.repository));
    const failure = (await site(client, forge.origin)).failure;
    assert.equal(failure.reason, "insufficient-scope");
    assert.equal(failure.scope, "read:repository");
  }));
