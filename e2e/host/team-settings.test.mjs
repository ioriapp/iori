import assert from "node:assert/strict";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import { registerScriptedCli } from "../../verification/host/scripted-definition.mjs";

test("チームの編集、履歴、メモと復元を再起動後も保持する", (t) =>
  runHostTest(t, async ({ client, restart, stage }) => {
    stage("テンプレートから作ったチームの役割の上限を変更する");
    const created = await client.request("teams.create", {
      template: "development",
      language: "ja",
    });
    const definition = structuredClone(created.saved);
    definition.roles[0].limit = "3";
    const saved = await client.request("teams.save", {
      teamId: created.saved.id,
      definition,
    });
    assert.equal(saved.saved.roles[0].limit, "3");
    await client.request("teams.memo", {
      teamId: created.saved.id,
      version: saved.saved.version,
      memo: "上限を調整",
    });
    await client.request("teams.restore", {
      teamId: created.saved.id,
      version: created.saved.version,
    });
    stage("再起動後も復元と変更履歴を読める");
    const restarted = await restart();
    const read = await restarted.request("teams.read", {
      teamId: created.saved.id,
    });
    assert.equal(read.saved.roles[0].limit, created.saved.roles[0].limit);
    assert.equal(
      read.history.find((entry) => entry.team.version === saved.saved.version)
        ?.memo,
      "上限を調整",
    );
    assert.equal(
      read.history.find((entry) => entry.team.version === read.saved.version)
        ?.restoredFrom,
      created.saved.version,
    );
  }));

test("既定チームを隠すと既定が解除され、戻しても解除されたまま", (t) =>
  runHostTest(t, async ({ client, restart, stage }) => {
    stage("チームを既定にして隠す");
    const team = await client.request("teams.create", {
      template: "development",
      language: "ja",
    });
    await client.request("teams.settings", {
      enabled: true,
      defaultTeam: team.saved.id,
      limits: {},
    });
    await client.request("teams.hidden.set", {
      teamId: team.saved.id,
      hidden: true,
    });
    let list = await client.request("teams.list");
    assert.equal(list.defaultTeam, "");
    assert.equal(
      list.teams.find((item) => item.saved.id === team.saved.id).hidden,
      true,
    );
    await client.request("teams.hidden.set", {
      teamId: team.saved.id,
      hidden: false,
    });
    stage("再起動しても既定は解除されたままで版は増えない");
    const restarted = await restart();
    list = await restarted.request("teams.list");
    assert.equal(list.defaultTeam, "");
    assert.equal(
      list.teams.find((item) => item.saved.id === team.saved.id).saved.version,
      team.saved.version,
    );
    assert.equal(
      list.teams.find((item) => item.saved.id === team.saved.id).hidden,
      false,
    );
  }));

test("CLIとモデルの上限設定をHost再起動後も保持する", (t) =>
  runHostTest(t, async ({ client, restart, stage }) => {
    stage("CLIとモデルの上限を保存する");
    const limits = {
      '["pi","cli",""]': "1",
      '["pi","model","openai/gpt-6-luna"]': "2",
    };
    await client.request("teams.settings", {
      enabled: true,
      defaultTeam: "",
      limits,
    });
    stage("Host再起動後に上限を読める");
    const restarted = await restart();
    const list = await restarted.request("teams.list");
    assert.equal(list.enabled, true);
    assert.deepEqual(list.limits, limits);
  }));

test("隠したCLIを候補に残してチームを保存し、変更点を履歴に記録する", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("候補にCLIを持つチームを作ってそのCLIを隠す");
    const cliId = await registerScriptedCli(client, dataRoot);
    const team = await client.request("teams.create", {
      template: "development",
      language: "ja",
    });
    const definition = structuredClone(team.saved);
    const role = definition.roles[0];
    role.candidates.low = [
      {
        id: "candidate-hidden",
        cli: cliId,
        model: "sonnet",
        tools: [],
        minimum: "",
      },
    ];
    const withCandidate = await client.request("teams.save", {
      teamId: team.saved.id,
      definition,
    });
    await client.request("cli.hidden.set", { cliId, hidden: true });
    stage("上限だけを変更して保存し、候補と履歴を読む");
    const edited = structuredClone(withCandidate.saved);
    edited.roles[0].limit = "3";
    const saved = await client.request("teams.save", {
      teamId: team.saved.id,
      definition: edited,
    });
    await client.request("cli.hidden.set", { cliId, hidden: false });
    const read = await client.request("teams.read", { teamId: team.saved.id });
    assert.equal(read.saved.roles[0].candidates.low[0].cli, cliId);
    assert.equal(read.saved.version, saved.saved.version);
    assert.deepEqual(
      read.history.find((entry) => entry.team.version === saved.saved.version)
        .changes,
      [{ item: "Concurrency limit", name: role.name, action: "changed" }],
    );
  }));

test("チーム候補の優先順を保存し再起動後も保持する", (t) =>
  runHostTest(t, async ({ client, restart, stage }) => {
    stage("候補の優先順を設定する");
    const team = await client.request("teams.create", {
      template: "development",
      language: "ja",
    });
    const edited = structuredClone(team.saved);
    edited.roles[0].candidates.low = [
      { id: "first", cli: "claude", model: "sonnet", tools: [], minimum: "" },
      {
        id: "second",
        cli: "codex",
        model: "gpt-6.1-sol",
        tools: [],
        minimum: "",
      },
    ];
    await client.request("teams.save", {
      teamId: team.saved.id,
      definition: edited,
    });
    stage("再起動後の候補の順を読む");
    const restarted = await restart();
    const saved = await restarted.request("teams.read", {
      teamId: team.saved.id,
    });
    assert.deepEqual(
      saved.saved.roles[0].candidates.low.map(({ cli, model }) => ({
        cli,
        model,
      })),
      [
        { cli: "claude", model: "sonnet" },
        { cli: "codex", model: "gpt-6.1-sol" },
      ],
    );
  }));
