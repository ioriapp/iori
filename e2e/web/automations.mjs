import { fakeMarker } from "../fake-model/marker.mjs";
import {
  waitForOperation,
  cliFailure,
} from "../../verification/web/operation.mjs";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { access, readFile } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import { automationDateTime } from "../../packages/protocol/src/automation-time.ts";
import { waitFor } from "../../verification/ui.mjs";
import {
  closedRow,
  observe,
  observeTerminalInstances,
  requestClose,
} from "../terminal/scenario.mjs";
import { openSidebar } from "../connection/scenario.mjs";
import { waitForCliState } from "../cli-screen/scenario.mjs";
const action = (name) => `[data-iori-action="${name}"]`;
const field = (name) => `[data-iori-field="automation-${name}"]`;
const view = '[data-iori-view="automations"]';
const item = (id) => `${view} [data-iori-automation-id="${id}"]`;
async function readTranscript(file) {
  try {
    return (await readFile(file, "utf8"))
      .split("\n")
      .slice(0, -1)
      .filter(Boolean)
      .map(JSON.parse);
  } catch (error) {
    // SessionStart can arrive before the CLI creates its transcript.
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
export async function automationsScenario({
  fakeModelRequests,
  client,
  worktree,
  record,
  shot,
  desktop,
  mobile,
  session,
  assistantReply,
  restartPreservingHost,
  automationDatabase,
  ptyDimensions,
}) {
  const screen = client.screen;
  let deliveredInstruction;
  // API calls prepare the team fixture and clean up our CLI processes only.
  const request = async (method, params = {}) =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const response=await connection.requestHost(connection.getSnapshot().host.publicKey,${JSON.stringify(method)},${JSON.stringify(params)});if(!response?.ok)throw new Error('Automation request failed');return response.result;})()`,
    );
  const show = async () => {
    await openSidebar(screen);
    await screen.click(action("open-agents-teams"));
    await screen.click(action("teams-automations"));
    await screen.wait(view);
  };
  const open = async (id) => screen.click(item(id));
  const choose = async (name, value) => {
    await screen.click(field(name));
    await screen.click(`[data-iori-automation-option="${value}"]`);
  };
  const save = async (name) => {
    await screen.click(action("automation-save"));
    await screen.wait(action("automation-run"));
    await waitFor(() =>
      screen.evaluate(
        `document.querySelector('${view} ${action("automation-save")}')?.disabled === true`,
      ),
    );
    await screen.click(action("automation-back"));
    const id = await waitFor(() =>
      screen.evaluate(
        `(()=>{const row=[...document.querySelectorAll('${view} [data-iori-automation-id]')].find(e=>e.querySelector('strong')?.textContent===${JSON.stringify(name)});return row?.dataset.ioriAutomationId;})()`,
      ),
    );
    return { id, name };
  };
  const checkEnabled = async (id, enabled) => {
    await screen.click(action("automation-back"));
    await screen.wait(
      `${item(id)} [data-iori-automation-enabled="${enabled}"]`,
    );
    assert.equal(
      await screen.text(`${item(id)} [data-iori-automation-enabled]`),
      enabled ? "有効" : "無効",
    );
    await open(id);
  };
  const disable = async (id) => {
    await screen.click(action("automation-enabled"));
    await waitFor(() =>
      screen.evaluate(
        `document.querySelector('${view} ${action("automation-enabled")}')?.getAttribute('aria-checked') === 'false'`,
      ),
    );
    await checkEnabled(id, false);
  };
  const pickFolder = async () => {
    await screen.click(action("automation-folder-choose"));
    const input = '[data-iori-field="folder-path"]';
    await waitFor(
      () => screen.value(input),
      (value) => Boolean(value),
    );
    await screen.input(input, worktree);
    await screen.wait(
      "[data-iori-folder-path=" + JSON.stringify(worktree) + "]",
    );
    await screen.key("Enter");
    await waitFor(
      () => screen.value(input),
      (value) => /[\\/]$/u.test(value),
    );
    await screen.click(action("folder-open"));
    const selected = worktree;
    await waitFor(
      () => screen.value(field("folder")),
      (value) => value === selected,
    );
    return selected;
  };
  const prompt =
    '7と5を足した答えを数字だけで返してください。\n引用符は"そのまま"、タブも\tそのまま扱ってください。ツールは指示のファイルを読む時だけ使ってください。' +
    fakeMarker("automations");
  const create = async (name, cli = "codex") => {
    const claude = cli === "claude";
    await screen.click(action("automation-new"));
    await screen.input(field("name"), name);
    await screen.input(field("instruction"), prompt);
    await screen.input(field("folder"), worktree);
    await screen.click(`${view} ${action("candidate-model")}`);
    await screen.input(
      ".model-picker input",
      claude ? "Claude Code Haiku 4.5" : "Codex gpt-6-luna",
    );
    await screen.wait(`[cmdk-item][data-cli="${cli}"][data-selected="true"]`);
    await screen.key("Enter");
    await waitFor(
      () => screen.text(`${view} ${action("candidate-model")}`),
      (value) => (claude ? /Haiku/iu : /Luna/iu).test(value),
      undefined,
      "Enterで選んだモデルを下書きに表示",
    );
    assert.match(
      await screen.text(`${view} .page-description`),
      /未保存の変更/u,
    );
    assert.equal(await screen.visible(action("automation-run")), false);
  };
  const rows = () =>
    screen.evaluate(
      `Array.from(document.querySelectorAll('${view} [data-iori-automation-run]')).map(row=>({id:row.dataset.ioriAutomationRun,terminalId:row.querySelector('[data-iori-action="automation-conversation"]')?.dataset.ioriTerminalId,reason:row.querySelector('[data-iori-automation-reason]')?.dataset.ioriAutomationReason,reasonText:row.querySelector('[data-iori-automation-reason]')?.textContent,text:row.textContent}))`,
    );
  const launched = async () =>
    waitForOperation(
      "automations: 画面の履歴に起動した会話が現れる",
      async () => {
        const rendered = await rows();
        const error = rendered.find((r) => r.reason === "launch");
        assert.equal(error, undefined, error?.reasonText);
        return rendered.find((r) => r.terminalId);
      },
      Boolean,
      async () => (await rows()).find((r) => r.reason === "launch")?.reasonText,
    );
  const reply = async (run) => {
    await screen.wait(`[data-iori-terminal-row="${run.terminalId}"]`);
    await screen.click(
      `${view} [data-iori-automation-run="${run.id}"] ${action("automation-conversation")}`,
    );
    await screen.wait(
      `[data-iori-terminal-id="${run.terminalId}"][data-iori-stream-state="ready"]`,
    );
    const saved = await waitForOperation(
      "automations: 起動した会話のIDを保存",
      () => session(run.terminalId),
      (value) => Boolean(value?.session?.id),
      cliFailure(screen, run.terminalId),
    );
    if (run.id === first.id) {
      const initial = await waitForOperation(
        "automations: 会話の記録に配送した依頼の写し",
        async () => {
          return (await readTranscript(saved.session.file))
            .filter(
              (entry) =>
                entry.payload?.role === "user" || entry.type === "user",
            )
            .flatMap((entry) => {
              const content =
                entry.payload?.content ?? entry.message?.content ?? [];
              return typeof content === "string"
                ? [{ text: content }]
                : content;
            })
            .map(
              (content) =>
                content.text?.match(
                  /^Read (.+) and follow its instructions\.$/u,
                )?.[1],
            )
            .find(Boolean);
        },
        Boolean,
        cliFailure(screen, run.terminalId),
      );
      // Linux keeps the copies under the Host's team-deliveries.
      const inside = (root) => {
        const location = relative(root, initial);
        return !location.startsWith("..") && !isAbsolute(location);
      };
      const hostData = dirname(automationDatabase);
      assert.ok(
        !inside(hostData) || inside(join(hostData, "team-deliveries")),
        "単独CLIにもHostの非公開保存先ではなく配送用の写しを渡す",
      );
      assert.equal(await readFile(initial, "utf8"), prompt);
      deliveredInstruction = initial;
    }
    await waitForOperation(
      "automations: 起動した会話の応答",
      async () => {
        if (saved.cli.id !== "claude")
          return assistantReply(saved.session.id, "12");
        return (await readTranscript(saved.session.file)).some(
          (entry) =>
            entry.type === "assistant" &&
            entry.message?.content?.some(
              (content) =>
                content.type === "text" && content.text.trim() === "12",
            ),
        );
      },
      Boolean,
      cliFailure(screen, run.terminalId),
    );
    if (fakeModelRequests && run.id === first.id)
      assert.equal(
        fakeModelRequests.find(
          (request) => request.marker === "automations" && request.step === 0,
        )?.tokensPresent["7と5を足した答え"],
        true,
        "自動化の指示ファイルの内容がモデル要求に含まれる",
      );
    await waitForCliState(client, run.terminalId, ["idle", "done"]);
    await record(
      "自動化の指示のファイルを実CLIが既定の許可で読み、12と返答。会話をサイドバーと履歴から開く",
    );
    const renderedSize = await screen.evaluate(
      `(()=>{const pane=document.querySelector('[data-iori-terminal-id="${run.terminalId}"]');return {cols:Number(pane.dataset.ioriCols),rows:Number(pane.dataset.ioriRows)};})()`,
    );
    await show();
    return renderedSize;
  };
  await desktop();
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  await observeTerminalInstances(client);
  const settings = await request("teams.list");
  const team = await request("teams.create", {
    definition: {
      name: "Automation team",
      description: "Automation schedule verification",
      parent: {
        id: "parent",
        cli: "codex",
        model: "gpt-6-luna",
        effort: "low",
        tools: [],
        minimum: "",
      },
      instruction: "Follow the user's initial instructions. Do not delegate.",
      roles: [],
    },
  });
  await request("teams.settings", {
    enabled: true,
    defaultTeam: settings.defaultTeam,
    limits: settings.limits,
  });
  await show();
  await create("Manual automation", "claude");
  await pickFolder();
  const manual = await save("Manual automation");
  await open(manual.id);
  assert.match(
    await screen.text(`${view} ${action("candidate-model")}`),
    /Haiku/iu,
  );
  await record(
    "モデル検索でEnterを押しても保存せず、選んだモデルが未保存の下書きと保存後に残る",
  );
  const pending = prompt + "\n説明は付けないでください。";
  await screen.input(field("instruction"), pending);
  await screen.click(action("automation-back"));
  await open(manual.id);
  assert.equal(await screen.value(field("instruction")), pending);
  await record("保存せず一覧へ戻っても、開き直すと編集途中の指示が残る");
  await screen.input(field("instruction"), prompt);
  await screen.click(action("automation-run"));
  const first = await launched();
  await reply(first);
  assert.equal((await rows()).length, 1, "実行履歴の行を画面で確認");
  await disable(manual.id);
  await record(
    "パス入力でフォルダーを選んで作成→今すぐ実行→実CLIの応答→履歴の行→一覧で無効の表示を確認",
  );
  await shot("pc-automations-detail");
  await mobile();
  await show();
  await shot("mobile-automations-detail");
  await screen.click(action("automation-back"));
  await open(manual.id);
  assert.equal(await screen.value(field("instruction")), prompt);
  await desktop();
  await show();
  await screen.click(action("automation-back"));
  await create("Once automation");
  await choose("target", "team");
  await choose("schedule", "once");
  const timeZone = (await screen.text("[data-iori-automation-timezone]"))
    .split(": ")
    .at(-1);
  const scheduledAt = Math.ceil(Date.now() / 60_000) * 60_000 + 60_000;
  await screen.input(field("once"), automationDateTime(scheduledAt, timeZone));
  const once = await save("Once automation");
  const expectedDate = new Intl.DateTimeFormat("ja", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(scheduledAt);
  assert.equal(
    await screen.text(`${item(once.id)} [data-iori-automation-next]`),
    `次回の実行: ${expectedDate}`,
  );
  await open(once.id);
  const scheduled = await launched();
  assert.ok(
    (await rows())[0].text.includes(expectedDate),
    "履歴の予定時刻も画面で確認",
  );
  await reply(scheduled);
  assert.equal((await rows()).length, 1);
  await checkEnabled(once.id, false);
  await record(
    "一回の次の予定を一覧で確認し、その時刻にチームが起動。履歴1行と無効の表示を確認",
  );
  await screen.click(action("automation-back"));
  await create("Missed daily automation");
  await choose("schedule", "daily");
  const daily = await save("Missed daily automation");
  await open(daily.id);
  await restartPreservingHost(async () => {
    // Only the stopped, dedicated verification Host's next date is moved back; runs are produced by the real Host.
    const db = new DatabaseSync(automationDatabase);
    try {
      const row = db
        .prepare("SELECT value_json FROM automations WHERE id = ?")
        .get(daily.id);
      const value = JSON.parse(row.value_json);
      value.nextAt -= 3 * 86_400_000;
      db.prepare("UPDATE automations SET value_json = ? WHERE id = ?").run(
        JSON.stringify(value),
        daily.id,
      );
    } finally {
      db.close();
    }
  });
  const catchup = await launched();
  const missedRows = await rows();
  assert.equal(missedRows.length, 3, "履歴に3行ある");
  assert.equal(
    missedRows.filter((r) => r.terminalId).length,
    1,
    "会話を開く行が1つある",
  );
  assert.equal(
    missedRows.filter(
      (r) => r.reasonText === "飛ばした理由: Hostが停止またはスリープ中",
    ).length,
    2,
    "古い2行に飛ばした理由が表示される",
  );
  await reply(catchup);
  await disable(daily.id);
  await record("停止後は履歴3行、会話1行、飛ばした理由2行を画面で確認");
  // Opening an Automation must also work in the split layout used by the
  // complete scenario. Give --only=automations the same ordinary UI condition.
  await screen.click(`[data-iori-terminal-row="${catchup.terminalId}"]`);
  await screen.wait(
    `[data-iori-terminal-id="${catchup.terminalId}"][data-iori-stream-state="ready"]`,
  );
  if (
    (await screen.evaluate(
      "document.querySelectorAll('.dv-groupview').length",
    )) === 1
  ) {
    const group = await screen.attribute(
      `[data-iori-tab-id="terminal:${catchup.terminalId}"]`,
      "data-iori-group-id",
      "[data-iori-group-id]",
    );
    await screen.click(
      `[data-iori-group-id="${group}"] ${action("workspace-split-below")}`,
    );
    await screen.wait('[data-iori-view="workspace-start"]');
  }
  await show();
  await screen.click(action("automation-back"));
  await create("Folder recovery automation");
  await screen.input(field("folder"), worktree + "/missing-automation-folder");
  const recovery = await save("Folder recovery automation");
  await open(recovery.id);
  await screen.click(action("automation-run"));
  await waitFor(
    rows,
    (value) => value.length === 1 && value[0].reason === "launch",
  );
  assert.equal(
    (await rows())[0].reasonText,
    "フォルダーを開けませんでした。フォルダーを編集して、もう一度実行してください。",
  );
  assert.equal((await rows())[0].terminalId, undefined);
  const failedRunId = (await rows())[0].id;
  await pickFolder();
  await screen.click(action("automation-run"));
  const recovered = await waitForOperation(
    "automations: 起動の失敗の後に作業フォルダーを選び直して起動",
    rows,
    (value) => value.length === 2 && value.some((r) => r.terminalId),
    async () => {
      const attempt = (await rows()).find((row) => row.id !== failedRunId);
      return attempt?.reason === "launch" ? attempt.reasonText : false;
    },
  );
  const recoveredRun = recovered.find((r) => r.terminalId);
  const recoveredSize = await reply(recoveredRun);
  const dimensions = ptyDimensions?.()?.filter(
    (entry) => entry.terminalId === recoveredRun.terminalId,
  );
  // Distribution Hosts do not import the development-only observer. Their
  // real Codex reply above remains the acceptance check.
  if (dimensions) {
    assert.equal(
      ptyDimensions().some(
        (entry) =>
          entry.kind === "resize" && entry.cols === 2 && entry.rows === 1,
      ),
      false,
      "再表示で0×0のペインを2×1のPTY寸法にしない",
    );
    assert.equal(dimensions[0]?.kind, "spawn", "実PTYの起動をHostで記録する");
    assert.deepEqual(
      { cols: dimensions.at(-1).cols, rows: dimensions.at(-1).rows },
      recoveredSize,
      "実PTYの最後の寸法が表示中のペインに揃う",
    );
    assert.ok(
      dimensions.filter((entry) => entry.kind === "resize").length <= 1,
      `分割した会話を開く時のPTY寸法は1回で表示先へ揃う: ${JSON.stringify(dimensions)}`,
    );
    await record(
      "分割ペインのAutomationは起動後1回の寸法変更で実CLIの応答まで進む",
    );
  }
  await record(
    "存在しないフォルダーの起動理由を履歴で読み、フォルダーを選び直して今すぐ実行すると起動する",
  );
  await screen.click(action("automation-actions"));
  await screen.click(action("automation-delete"));
  const confirmation = await screen.text(
    '[data-iori-view="automation-delete"]',
  );
  assert.ok(confirmation.includes(recovery.name));
  assert.ok(confirmation.includes("開始済みの会話は残ります"));
  await screen.click(action("automation-delete-confirm"));
  await waitFor(() => screen.visible(action("automation-new")));
  await waitFor(
    () => screen.visible(item(recovery.id)),
    (visible) => !visible,
  );
  await record("削除の確認から削除すると、自動化が一覧から消える");
  await shot("pc-automations-list");
  await request("teams.delete", { teamId: team.saved.id });
  await request("teams.settings", {
    enabled: settings.enabled,
    defaultTeam: settings.defaultTeam,
    limits: settings.limits,
  });
  await requestClose(client, first.terminalId);
  await screen.wait(action("terminal-confirm-close"));
  await screen.click(action("terminal-confirm-close"));
  await closedRow(client, first.terminalId);
  for (const run of [scheduled, catchup, recoveredRun])
    await request("terminal.close", {
      terminalId: run.terminalId,
      confirm: true,
    });
  await waitFor(async () => {
    try {
      await access(deliveredInstruction);
      return false;
    } catch (error) {
      if (error.code === "ENOENT") return true;
      throw error;
    }
  });
  await record(
    "単独CLIの指示は配送用の写しから読み、Terminalを閉じると回収される",
  );
  await desktop();
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
}
