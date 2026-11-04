import { cliMenuAction } from "./agents-navigation.mjs";
import { definitionPictures } from "./cli-definition-capture.mjs";
import { openSidebar, mobileSidebarTarget } from "../connection/scenario.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import {
  returnToWorktree,
  saveStartupArguments,
} from "./agents-navigation.mjs";
const action = (name) => `[data-iori-action="${name}"]`;
const surface = ".team-surface:not([hidden])";
const inTeam = (selector) => `${surface} ${selector}`;

export async function teamsScenario({
  client,
  restartHostLosingTerminals,
  record,
  shot,
  desktop,
  mobile,
}) {
  const screen = client.screen;
  const pictures = definitionPictures({ client, shot });
  const captureViews = process.env.IORI_TEAMS_CAPTURE_VIEWS?.split(",");
  const capture = async (name) => {
    if (
      process.env.IORI_TEAMS_CAPTURE === "1" &&
      (!captureViews ||
        captureViews.some(
          (view) =>
            name === `pc-${view}-light` ||
            name === `pc-${view}-dark` ||
            name === `mobile-${view}-light` ||
            name === `mobile-${view}-dark`,
        ))
    )
      await shot(name);
  };
  const launcher = '[data-iori-view="workspace-start"]';
  const launcherTeams = `${launcher} [data-iori-action="launcher-open-teams"]`;
  const captureLauncher = async (name, reveal) => {
    if (process.env.IORI_TEAMS_CAPTURE !== "1") return;
    for (const [device, width, height, theme] of [
      ["pc", 1440, 900, "light"],
      ["pc", 1440, 900, "dark"],
      ["mobile", 390, 844, "dark"],
    ]) {
      await client.browser.viewport({ width, height });
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      await screen.wait(
        `${launcher} .cli-launcher[data-iori-teams-loaded="true"]`,
      );
      if (reveal) await screen.reveal(reveal);
      await shot(`${device}-${name}-${theme}`);
    }
    await client.browser.viewport({ width: 1440, height: 1000 });
  };
  const captureUnconfiguredEditor = async (name) => {
    if (process.env.IORI_TEAMS_CAPTURE !== "1") return;
    if (name === "unconfigured-candidates")
      await screen.evaluate(
        `document.querySelector('${surface} #team-section-1').scrollIntoView({block:"start"})`,
      );
    await themes(name);
    await client.browser.viewport({ width: 390, height: 844 });
    await screen.evaluate(`document.documentElement.classList.add('dark')`);
    if (name === "unconfigured-candidates")
      await screen.evaluate(
        `document.querySelector('${surface} #team-section-1').scrollIntoView({block:"start"})`,
      );
    await capture(`mobile-${name}-dark`);
    await client.browser.viewport({ width: 1440, height: 1000 });
  };
  const step = async (selector, direction, expected) => {
    await screen.click(
      `${selector} ${action(direction === 1 ? "limit-increase" : "limit-decrease")}`,
    );
    await waitFor(
      () => screen.value(`${selector} input`),
      (value) => value === expected,
      undefined,
      "上限の増減を反映",
    );
  };
  const themes = async (name) => {
    const section =
      name === "worker-basic"
        ? 0
        : name === "worker-candidates"
          ? 1
          : name === "worker-instructions"
            ? 2
            : undefined;
    if (section !== undefined)
      await screen.evaluate(
        `document.querySelector('${surface} #team-section-${section}').scrollIntoView({block:"start"})`,
      );
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      await capture(`pc-${name}-${theme}`);
    }
  };
  const version = async (number) =>
    waitFor(
      () =>
        screen.attribute(
          inTeam("[data-iori-team-version]"),
          "data-iori-team-version",
        ),
      (value) => value === String(number),
      undefined,
      `チームのバージョン${number}`,
    );
  const worker = async () =>
    screen.click(inTeam('[data-iori-action="team-role"]'));
  const waitForSelectedTeam = (teamId) =>
    waitFor(
      () => screen.attribute(inTeam(".team-save-header"), "data-iori-team-id"),
      (value) => value === teamId,
      undefined,
      "選んだチームの編集画面",
    );
  const teamTree = (teamId) =>
    `.team-tree [data-slot="collapsible"]:has(> .team-tree-team[data-iori-team-id="${teamId}"])`;
  const templateWorker = (teamId) =>
    inTeam(
      `${teamTree(teamId)} .team-tree-children [data-iori-action="team-role"]`,
    );
  const readTemplateText = async (teamId) => {
    await screen.click(
      inTeam(
        `[data-iori-action="team-overview"][data-iori-team-id="${teamId}"]`,
      ),
    );
    await waitForSelectedTeam(teamId);
    await screen.wait(inTeam(".team-overview"));
    const name = await screen.value(
      inTeam('.team-overview [data-iori-field="team-name"]'),
    );
    const description = await screen.value(inTeam(".team-overview textarea"));
    await screen.click(
      inTeam(`[data-iori-action="team-parent"][data-iori-team-id="${teamId}"]`),
    );
    await screen.wait(inTeam(".team-parent-execution"));
    const parentInstruction = await screen.value(
      inTeam(".team-content textarea"),
    );
    await screen.click(templateWorker(teamId));
    await screen.wait(inTeam('[data-iori-role-name="Worker"]'));
    return {
      name,
      description,
      parentInstruction,
      workerWhen: await screen.value(inTeam("#team-section-0 textarea")),
      workerInstruction: await screen.value(inTeam("#team-section-2 textarea")),
    };
  };
  const assertTemplateText = async (teamId, expected) => {
    const actual = await readTemplateText(teamId);
    assert.equal(actual.name, expected.name);
    assert.equal(actual.description, expected.description);
    assert.equal(actual.parentInstruction, expected.parentInstruction);
    assert.equal(actual.workerWhen, expected.workerWhen);
    assert.equal(actual.workerInstruction, expected.workerInstruction);
  };
  const candidateModels = () =>
    screen.evaluate(
      `Array.from(document.querySelectorAll('${surface} .team-candidate-row [data-iori-action="candidate-model"]')).map(e=>e.dataset.ioriCli+':'+e.dataset.ioriModel)`,
    );
  // The Start tab exists only in an empty pane; the full run arrives with tabs.
  const splitForStart = !(await screen.visible(launcher));
  if (splitForStart)
    await screen.click(
      '[data-iori-group-id] [data-iori-action="workspace-split-right"]',
    );
  await screen.wait(`${launcher} .cli-launcher[data-iori-teams-loaded="true"]`);
  assert.equal(await screen.visible(launcherTeams), false);
  assert.doesNotMatch(await screen.text(`${launcher} .cli-launcher`), /Team/);
  await captureLauncher("start-teams-off");
  await screen.click(action("settings-open"));
  await screen.wait(`${action("settings-general")}[aria-current="page"]`);
  await shot("settings-initial-general");
  await screen.click(action("settings-display"));
  await screen.click(action("settings-close"));
  await screen.click(action("settings-open"));
  await screen.wait(`${action("settings-general")}[aria-current="page"]`);
  await screen.click(action("settings-close"));
  await record(
    "左下の歯車から設定を開くと、前回の項目によらず一番上の一般を開く",
  );
  await screen.click(action("open-agents-teams"));
  await screen.wait(inTeam(`${action("teams-agents")}.selected`));
  await screen.wait(inTeam(".team-agents-page h1"));
  await shot("agents-initial-agents");
  await record(
    "サイドバーのAIエージェント/チームは一番上のAIエージェントを開く",
  );
  await screen.click(inTeam(action("teams-list")));
  await themes("teams-empty");
  await screen.click(inTeam('[role="switch"]'));
  await returnToWorktree(screen);
  await screen.reveal(launcherTeams);
  assert.match(await screen.text(launcher), /Teamはまだありません/);
  await captureLauncher("start-teams-empty");
  await screen.click(launcherTeams);
  await screen.wait(inTeam('[data-iori-view="teams-editor"]'));
  await screen.click(action("team-new"));
  await screen.click('[data-iori-template="development"]');
  await screen.click(action("team-create"));
  await version(1);
  const teamId = await screen.attribute(
    inTeam('[data-iori-action="team-overview"]'),
    "data-iori-team-id",
  );
  assert.equal(Boolean(teamId), true);
  await worker();
  for (const [query, cli, model] of [
    ["claude sonnet", "claude", "sonnet"],
    ["codex gpt-6.1-sol", "codex", "gpt-6.1-sol"],
  ]) {
    await screen.click(inTeam(action("candidate-add")));
    await screen.input(".model-picker input", query);
    await screen.click(
      `[cmdk-item][data-cli="${cli}"][data-iori-model="${model}"]`,
    );
  }
  await screen.click(action("team-save"));
  await version(2);

  await screen.click(inTeam(action("teams-list")));
  await screen.click(inTeam(action("default-team")));
  await screen.click(`[data-iori-default-team="${teamId}"]`);
  const teamRow = inTeam(`.team-list-row:has([data-iori-team-id="${teamId}"])`);
  await pictures.capture(
    "teams-visible-menu",
    () => screen.click(`${teamRow} ${action("team-actions")}`),
    () => screen.key("Escape"),
  );
  await screen.key("Escape");
  await screen.click(`${teamRow} ${action("team-actions")}`);
  await screen.click('[role="menu"] [data-iori-action="team-hidden-set"]');
  await waitFor(
    () => screen.text(inTeam(action("default-team"))),
    (text) => text === "なし",
  );
  await screen.click(inTeam(action("default-team")));
  assert.equal(
    await screen.visible(`[data-iori-default-team="${teamId}"]`),
    false,
  );
  await screen.key("Escape");
  await returnToWorktree(screen);
  await screen.wait(`${launcher} .cli-launcher[data-iori-teams-loaded="true"]`);
  assert.equal(
    await screen.visible(`${launcher} [data-iori-team-id="${teamId}"]`),
    false,
  );
  await screen.click(action("workspace-add-tab"));
  await screen.wait('.new-items-popover[data-state="open"]');
  assert.equal(
    await screen.visible(`.new-items-popover [data-iori-team-id="${teamId}"]`),
    false,
  );
  await screen.key("Escape");
  await screen.click(action("open-agents-teams"));
  await screen.click(inTeam(action("teams-list")));
  const hiddenTeams = inTeam('.team-list [data-iori-view="hidden-items"]');
  await pictures.capture("teams-hidden-closed", () =>
    screen.reveal(hiddenTeams),
  );
  await screen.click(`${hiddenTeams} ${action("hidden-items-toggle")}`);
  await screen.wait(`${teamRow} ${action("team-actions")}`);
  await pictures.capture("teams-hidden", () => screen.reveal(hiddenTeams));
  await pictures.capture(
    "teams-hidden-menu",
    () => screen.click(`${teamRow} ${action("team-actions")}`),
    () => screen.key("Escape"),
  );
  await screen.key("Escape");
  await screen.click(`${teamRow} ${action("team-actions")}`);
  await screen.click('[role="menu"] [data-iori-action="team-hidden-set"]');
  await waitFor(
    () => screen.text(inTeam(action("default-team"))),
    (text) => text === "なし",
  );
  await screen.click(inTeam(action("default-team")));
  await screen.wait(`[data-iori-default-team="${teamId}"]`);
  await screen.key("Escape");
  await returnToWorktree(screen);
  await screen.click(action("workspace-add-tab"));
  await screen.wait(`.new-items-popover [data-iori-team-id="${teamId}"]`);
  await screen.key("Escape");
  await record(
    "既定チームを隠すと既定がなしとなり、始める画面・＋・既定の選択肢から外れる。戻しても既定はなしのまま",
  );
  await screen.reveal(`${launcher} [data-iori-team-id="${teamId}"]`);
  await captureLauncher("start-teams-present");
  await screen.click(action("open-agents-teams"));
  await worker();
  await screen.wait(inTeam('[data-iori-role-name="Worker"]'));
  await screen.click(inTeam(".team-save-header .page-back button"));
  await screen.wait(
    inTeam('.team-tree-row.selected[data-iori-action="team-overview"]'),
  );
  await screen.wait(inTeam(".team-overview"));
  await worker();
  await screen.click(inTeam(action("teams-agents")));
  await cliMenuAction(screen, "claude", "cli-hidden-set");
  await screen.wait('.team-agents-page [data-iori-view="hidden-items"]');
  await worker();
  const limit = inTeam(".team-basic-settings .team-limit-stepper");
  await step(limit, 1, "1");
  await step(limit, 1, "2");
  await step(limit, 1, "3");
  await screen.click(action("team-save"));
  await version(3);
  await screen.click(inTeam(action("teams-agents")));
  await screen.click(
    '.team-agents-page [data-iori-action="hidden-items-toggle"]',
  );
  await cliMenuAction(screen, "claude", "cli-hidden-set");
  await worker();
  await version(3);
  await record(
    "隠したCLIを既存の候補に含めたままチームを保存でき、隠す・戻すだけではチームの版を増やさない",
  );
  await screen.click(action("team-history"));
  assert.equal(
    await screen.text(
      '[data-iori-history-version="3"] .team-history-select > span',
    ),
    "Workerの同時実行の上限を変更",
  );
  await screen.key("Escape");
  await record("テンプレート作成後の単項目保存は、その項目だけを履歴に記録");
  await screen.click(inTeam(action("teams-list")));
  await screen.click(inTeam('[role="switch"]'));
  await returnToWorktree(screen);
  await waitFor(
    async () =>
      !(await screen.visible(launcherTeams)) &&
      !(await screen.visible(`${launcher} [data-iori-team-id="${teamId}"]`)),
  );
  assert.doesNotMatch(await screen.text(`${launcher} .cli-launcher`), /Team/);
  assert.equal(
    await screen.visible(`${launcher} [data-iori-team-id="${teamId}"]`),
    false,
  );
  await screen.click(action("open-agents-teams"));
  await screen.wait(inTeam('[data-iori-view="teams-editor"]'));
  await record(
    "チーム機能がオフの始める画面にはチームの群を出さず、オンで0件ならAIエージェント/チームへ移れる",
  );
  await screen.click(inTeam(action("teams-list")));
  await screen.click(inTeam(`.team-list [data-iori-team-id="${teamId}"]`));
  await version(3);
  await worker();
  assert.equal(await screen.value(`${limit} input`), "3");
  await record(
    "既定チームの選択後に編集し、チーム機能を切り替えても保存内容を保持",
  );
  await step(limit, -1, "2");
  await themes("worker-basic");
  await waitFor(
    candidateModels,
    (values) =>
      values.some((value) => value === "claude:sonnet") &&
      values.some((value) => value === "codex:gpt-6.1-sol"),
  );
  // Wait for the catalog's display label, then keep IDs for reorder comparisons.
  await waitFor(
    () =>
      screen.text(
        inTeam('[data-iori-action="candidate-model"][data-iori-cli="claude"]'),
      ),
    (text) => /Claude Code\s*›\s*Sonnet/u.test(text),
  );
  await waitFor(
    () =>
      screen.text(
        inTeam('[data-iori-action="candidate-model"][data-iori-cli="codex"]'),
      ),
    (text) => /Codex\s*›\s*GPT/u.test(text),
  );
  await themes("worker-candidates");
  const original = await candidateModels();
  await screen.click(inTeam(action("candidate-add")));
  await screen.wait(".model-picker input");
  await themes("add-candidate");
  await screen.input(".model-picker input", "Pi openai gpt-6-luna");
  await screen.wait(
    '[cmdk-item][data-cli="pi"][data-iori-model="openai/gpt-6-luna"]',
  );
  await themes("model-picker-search");
  await screen.click(
    '[cmdk-item][data-cli="pi"][data-iori-model="openai/gpt-6-luna"]',
  );
  await waitFor(
    candidateModels,
    (values) => values.length === original.length + 1,
  );
  const before = await candidateModels();
  await screen.drag(
    inTeam('[data-iori-candidate-priority="1"]'),
    inTeam('[data-iori-candidate-priority="2"]'),
  );
  await waitFor(
    candidateModels,
    (values) => values[1] === before[0],
    undefined,
    "候補の優先順の入替",
  );
  await step(limit, 1, "3");
  await step(limit, -1, "2");
  await step(limit, 1, "3");
  assert.equal(await screen.value(`${limit} input`), "3");
  await themes("limit-stepper");
  await screen.click(action("team-save"));
  await version(4);
  await screen.click(action("team-history"));
  await screen.wait('[data-iori-history-version="4"]');
  const summary = await screen.text(
    '[data-iori-history-version="4"] .team-history-select > span',
  );
  assert.equal(summary, "Workerの候補を追加・Workerの候補を変更");
  await themes("team-history");
  await screen.click(
    '[data-iori-history-version="4"] ' + action("team-memo-add"),
  );
  await screen.input(
    '[data-iori-field="team-memo"]',
    "候補の優先順と上限を調整",
  );
  await screen.click(action("team-memo-save"));
  await waitFor(
    () => screen.text('[data-iori-history-version="4"]'),
    (text) => text.includes("候補の優先順と上限を調整"),
  );
  await themes("team-history-memo");
  assert.equal(await screen.visible('[data-iori-history-version="5"]'), false);
  await screen.click('[data-iori-history-version="3"] .team-history-select');
  await screen.click(action("team-restore"));
  await version(5);
  await worker();
  assert.deepEqual(await candidateModels(), original);
  await screen.click(inTeam(action("team-parent")));
  await themes("parent");
  await screen.click(inTeam(action("team-overview")));
  await themes("team-overview");
  const teamName = inTeam('[data-iori-field="team-name"]');
  const originalName = await screen.value(teamName);
  const reopenEditedTeam = async () => {
    await screen.click(action("open-agents-teams"));
    await screen.click(inTeam(action("teams-list")));
    await screen.click(inTeam(`.team-list [data-iori-team-id="${teamId}"]`));
    await screen.click(inTeam(action("team-overview")));
  };
  await screen.input(
    inTeam('[data-iori-field="team-name"]'),
    "入力は保持される",
  );
  await returnToWorktree(screen);
  await screen.wait('[data-iori-view="team-save-confirmation"]');
  await themes("save-changes");
  if (process.env.IORI_TEAMS_CAPTURE === "1") {
    await client.browser.viewport({ width: 390, height: 844 });
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      await capture(`mobile-save-changes-${theme}`);
    }
    await client.browser.viewport({ width: 1440, height: 1000 });
  }
  await screen.key("Escape");
  assert.equal(
    await screen.value(inTeam('[data-iori-field="team-name"]')),
    "入力は保持される",
  );
  await returnToWorktree(screen);
  await screen.click(action("team-leave-without-saving"));
  await screen.wait(launcher);
  await reopenEditedTeam();
  assert.equal(await screen.value(teamName), originalName);
  await version(5);
  await screen.input(teamName, "保存して移動する");
  await returnToWorktree(screen);
  await screen.click(action("team-save-and-leave"));
  await screen.wait(launcher);
  await reopenEditedTeam();
  assert.equal(await screen.value(teamName), "保存して移動する");
  await version(6);
  await screen.input(teamName, "");
  await returnToWorktree(screen);
  await screen.click(action("team-save-and-leave"));
  await waitFor(
    () => screen.visible('[data-iori-view="team-save-confirmation"]'),
    (visible) => !visible,
  );
  assert.equal(
    await screen.visible(inTeam('[data-iori-view="teams-editor"]')),
    true,
  );
  assert.equal(await screen.value(teamName), "");
  assert.equal(
    await screen.text(inTeam(".team-save-title .page-description")),
    "保存できませんでした: Team名を入力してください。",
  );
  await screen.input(teamName, originalName);
  await screen.click(action("team-save"));
  await version(7);
  await record(
    "チームから離れる時はEscで入力を保ち、保存しないで破棄、保存で移動し、入力の誤りでは理由と入力を残す",
  );
  await screen.click(inTeam(action("teams-agents")));
  assert.equal(await screen.text(inTeam(".team-agents-page h1")), "AI Agents");
  await screen.click(inTeam('[data-iori-cli-row="pi"] .team-agent-toggle'));
  await screen.click(inTeam('[data-iori-cli-row="codex"] .team-agent-toggle'));
  await screen.click(inTeam('[data-iori-cli-row="claude"] .team-agent-toggle'));
  await saveStartupArguments(screen, "pi", '--model "openai/gpt-6-luna"');
  await screen.wait(
    inTeam('[data-iori-cli-row="pi"] [data-iori-state="saved"]'),
  );
  await themes("ai-agents");
  const piRow = inTeam('[data-iori-cli-row="pi"]');
  await screen.click(`${piRow} .team-add-limit`);
  await themes("ai-agents-limit-picker");
  await screen.input(".model-picker input", "gpt-6-luna");
  await screen.wait(
    '[cmdk-item][data-cli="pi"][data-iori-model="openai/gpt-6-luna"][data-selected="true"]',
  );
  // Observe real save requests while the picker handles Enter; forward every request unchanged.
  await screen.evaluate(`(async()=>{
    const {connection}=await import('/src/connection.ts');
    const original=connection.requestHost;
    const probe={saves:0,restore:()=>{connection.requestHost=original;}};
    window.__ioriLimitPickerProbe=probe;
    connection.requestHost=(...args)=>{
      if(['cli.arguments.set','teams.settings'].includes(args[1]))probe.saves++;
      return original.apply(connection,args);
    };
  })()`);
  const modelLimit = `${piRow} .team-setting-row.model input`;
  try {
    await screen.key("Enter");
    await screen.wait(modelLimit);
    assert.equal(
      await screen.evaluate("window.__ioriLimitPickerProbe.saves"),
      0,
    );
  } finally {
    await screen.evaluate(
      "window.__ioriLimitPickerProbe.restore();delete window.__ioriLimitPickerProbe",
    );
  }
  assert.equal(
    await screen.visible(`${piRow} [data-iori-state="saved"]`),
    false,
  );
  await step(`${piRow} .team-setting-row.model`, 1, "1");
  await screen.click(inTeam(action("teams-list")));
  await screen.wait('[data-iori-view="team-discard-confirmation"]');
  await screen.key("Escape");
  await screen.wait(modelLimit);
  await record(
    "上限のモデルを検索してEnterで選んでも保存せず、未保存の下書きとして保持",
  );
  await step(`${piRow} .team-setting-row.model`, 1, "2");
  assert.equal(await screen.value(modelLimit), "2");
  await step(`${piRow} .team-agent-limits > .team-setting-row`, 1, "1");
  await screen.click(`${piRow} .team-add-limit`);
  await screen.input(".model-picker input", "openai");
  await screen.key("Escape");
  // Save the limits as one section before checking persistence.
  await screen.click(`${piRow} [data-iori-action="save-cli-settings"]`);
  await screen.wait(`${piRow} .team-agent-settings [data-iori-state="saved"]`);
  assert.equal(
    await screen.visible(`${piRow} .team-agent-settings [role="alert"]`),
    false,
  );
  await restartHostLosingTerminals();
  await record(
    "チームの作成、モデル検索・優先順・上限、保存・履歴・メモ・復元とHost設定の保存",
  );
  // Reopen from a fresh Client read so in-memory values cannot satisfy persistence.
  await desktop();
  await screen.wait(action("open-agents-teams"));
  await screen.click(action("open-agents-teams"));
  await screen.wait(inTeam(".team-tree-team"));
  await screen.click(inTeam(action("teams-agents")));
  await screen.click(`${piRow} .team-agent-toggle`);
  assert.equal(await screen.value(modelLimit), "2");
  await screen.click(inTeam(action("teams-list")));
  const updated = await screen.text(inTeam(".team-list"));
  assert.match(updated, /更新日時\s+\d{1,2}\/\d{1,2}\s+\d{2}:\d{2}/u);
  assert.doesNotMatch(updated, /\b(?:AM|PM)\b/u);
  await themes("teams");
  await screen.click(inTeam(`.team-list [data-iori-team-id="${teamId}"]`));
  await waitForSelectedTeam(teamId);
  await screen.click(
    inTeam(`[data-iori-action="team-overview"][data-iori-team-id="${teamId}"]`),
  );
  await version(7);
  await screen.click(action("team-history"));
  assert.match(
    await screen.text('[data-iori-history-version="5"]'),
    /バージョン3|version 3/,
  );
  assert.match(
    await screen.text('[data-iori-history-version="4"]'),
    /候補の優先順と上限を調整/,
  );
  await screen.key("Escape");
  await screen.click(templateWorker(teamId));
  await themes("worker-instructions");
  const japaneseTemplate = {
    name: "Development",
    description: "実装・独立レビュー・調査を分担する、普段の開発チーム。",
    parentInstruction:
      "ユーザーと目的と完了条件を揃え、独立に進められる仕事を役割へ委譲します。\n並列で進められる仕事は、ワークツリーごとに並列で進めます。\n報告の内容と確認結果を自分で照合し、必要な直しを頼んでから受け入れます。\n判断に迷う製品の点はユーザーへ相談してください。\n\n## 委譲の単位と難易度\n\n目的は少ない費用で品質を保って納品すること。性能の低い担当を使うことが目的ではない。\n\n1. 機能は、委譲の前に親がスライスに分ける。スライスは「触ってよいファイル」が他と重ならない単位にする。共有のファイル（翻訳の一覧、起動の登録、依存の宣言など）は、最後の統合のスライスか親が持つ。\n2. スライスの間の約束（関数・API・データの形、状態の名前）は親が依頼に書く。担当に決めさせない。\n3. 難易度は次で振る。\n   - Low: 変更が決まっているもの（文言・設定・文書、既存の形に倣う1か所の追加、原因の分かった1ファイルの修正）。\n   - Medium: 仕様と既存の型があり、1つの層に閉じた実装。既存の helper を使う E2E の操作列と、確立した手順での実機の確認。\n   - High: 原因不明の切り分け、層をまたぐ設計、信頼の境界、初めての OS 境界、性能の調査、Medium で2回止まったもの。\n   目安として、委譲の件数の8割を Medium・Low にする。High が続く時は、スライスが大きすぎないかを先に疑う。\n4. E2E の操作列と実機の確認は、最後の統合のスライス1本にまとめる。実装のスライスは、型検査・lint・既存の試験までで報告させる。\n5. 原因の分からない不具合は、まず Investigator に「小さい再現と原因の特定」だけを頼み、直すのは原因が分かってから Worker の Medium・Low に振る。\n6. Medium の担当が同じ所で2回止まったら、やり直させずに High へ引き継ぐ（delegate の --continue）。\n7. 独立の review は、スライスごとではなく、統合した差分に1回だけ Reviewer に頼む。画面の見た目・配置・言葉を変えた時は、UI Reviewer にも撮影を見せる。",
    workerWhen:
      "実装や修正を進める時。対象の範囲が明確で、作業を独立に任せられる場合に呼びます。",
    workerInstruction:
      "依頼された範囲を最後まで進めてください。\n既存の規則とユーザーの動線を確認し、変更は小さくまとめます。\n判断に迷う点は親へ質問し、続けられる作業は進めてください。\n完了条件を確認し、変更と確認結果を報告してください。\n\n- 依頼の「触ってよいファイル」の外を変えない。外を変える必要が出たら、変えずに ask で親に聞く。\n- 依頼の約束（関数・API・データの形）を変えない。合わないと分かったら ask で親に聞く。\n- 依頼に無い試験・検査・待ち・上限・診断を足さない。足すべきと思うものは報告の「提案」に書く。\n- 依頼にある確認だけを流す。実機の確認は、依頼に回数の上限がある時だけ行う。同じ所で2回止まったら止まって報告する。\n- 報告には、変えたファイル、commit、流した確認と結果、未確認のこと、提案を書く。",
  };
  await assertTemplateText(teamId, japaneseTemplate);
  {
    await screen.click(action("settings-open"));
    await screen.click(action("settings-display"));
    await screen.click(action("display-language"));
    await screen.click('[data-iori-option="language-en"]');
    await screen.click(action("settings-close"));
    assert.match(
      await screen.text(inTeam(".team-save-title .page-description")),
      /^Version 7 · Saved$/u,
    );
    await screen.click(action("team-history"));
    await screen.click(
      '[data-iori-history-version="4"] ' + action("team-memo-add"),
    );
    assert.equal(
      await screen.attribute('[data-iori-field="team-memo"]', "aria-label"),
      "Version 4 Memo",
    );
    await screen.key("Escape");
    await themes("worker-en");
    await screen.click(inTeam(action("teams-list")));
    await screen.click(action("team-new"));
    await screen.click('[data-iori-template="development"]');
    await screen.click(action("team-create"));
    await version(1);
    const englishTeamId = await screen.attribute(
      inTeam(".team-save-header"),
      "data-iori-team-id",
    );
    assert.notEqual(englishTeamId, teamId);
    const englishTemplate = {
      name: "Development",
      description:
        "An everyday development team that splits implementation, independent review, and research.",
      parentInstruction:
        "Agree with the user on the goal and completion criteria, and delegate work that can proceed independently to roles.\nRun work that can proceed in parallel in separate worktrees.\nCheck reports and verification results yourself, and ask for any needed fixes before accepting.\nConsult the user on product questions you are unsure about.\n\n## Delegation units and difficulty\n\nThe goal is to deliver at low cost without lowering quality. Using weaker agents is not a goal in itself.\n\n1. Before delegating a feature, split it into slices. Each slice owns a set of files that no other slice touches. Shared files (translation lists, startup registration, dependency declarations, and so on) belong to the final integration slice or to the parent.\n2. The parent writes the contracts between slices (function, API, and data shapes; state names) in the request. Do not let workers decide them.\n3. Assign difficulty as follows.\n   - Low: changes that are already decided (wording, settings, documents, one addition following an existing pattern, a one-file fix whose cause is known).\n   - Medium: an implementation confined to one layer, with a spec and existing patterns. E2E steps using existing helpers, and device checks with an established procedure.\n   - High: isolating an unknown cause, design across layers, trust boundaries, a first-time OS boundary, performance investigation, and anything that stopped twice at Medium.\n   As a guide, make about 80% of delegations Medium or Low. If High keeps coming up, first ask whether the slices are too large.\n4. Put E2E steps and device checks into one final integration slice. Implementation slices report after type checks, lint, and existing tests.\n5. For a bug with an unknown cause, first ask Investigator only for a small reproduction and the cause. Assign the fix to Worker at Medium or Low once the cause is known.\n6. If a Medium worker stops at the same point twice, do not retry; hand it over to High (delegate --continue).\n7. Ask Reviewer for one independent review of the integrated diff, not one per slice. When the look, layout, or wording of screens changed, also show the screenshots to UI Reviewer.",
      workerWhen:
        "When implementing or fixing something. Use it when the scope is clear and the work can be handed off on its own.",
      workerInstruction:
        'Carry the requested scope through to the end.\nCheck the existing rules and the user\'s flow, and keep changes small.\nAsk the parent about anything you are unsure of, and keep going with work you can continue.\nConfirm the completion criteria, then report your changes and verification results.\n\n- Do not change anything outside the request\'s "files you may change". If you need to, do not change it; ask the parent with ask.\n- Do not change the contracts in the request (function, API, and data shapes). If they do not fit, ask the parent with ask.\n- Do not add tests, checks, waits, limits, or diagnostics that the request does not ask for. Write the ones you think are needed under "Suggestions" in your report.\n- Run only the checks in the request. Run device checks only when the request sets a limit on how many times. If you stop at the same point twice, stop and report.\n- In your report, include the files you changed, the commits, the checks you ran and their results, what you did not verify, and suggestions.',
    };
    await assertTemplateText(englishTeamId, englishTemplate);
    await screen.click(action("settings-open"));
    await screen.click(action("settings-display"));
    await screen.click(action("display-language"));
    await screen.click('[data-iori-option="language-ja"]');
    await screen.click(action("settings-close"));
    await screen.click(inTeam(action("teams-list")));
    await screen.click(
      inTeam(`.team-list [data-iori-team-id="${englishTeamId}"]`),
    );
    await waitForSelectedTeam(englishTeamId);
    await version(1);
    await assertTemplateText(englishTeamId, englishTemplate);
    await screen.click(inTeam(action("teams-list")));
    await screen.click(inTeam(`.team-list [data-iori-team-id="${teamId}"]`));
    await waitForSelectedTeam(teamId);
    await version(7);
    await assertTemplateText(teamId, japaneseTemplate);
    // The later mobile steps open the first team in the tree; keep only the
    // team they expect.
    await screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const host=connection.getSnapshot().host.publicKey;const result=await connection.requestHost(host,'teams.delete',{teamId:${JSON.stringify(englishTeamId)}});if(!result.ok)throw new Error('team delete failed');})()`,
    );
    await screen.click(inTeam(action("teams-list")));
    await screen.click(inTeam(`.team-list [data-iori-team-id="${teamId}"]`));
    await waitForSelectedTeam(teamId);
    await screen.click(templateWorker(teamId));
    await record(
      "英語と日本語のテンプレートの文章を画面で確かめ、言語変更後も保持",
    );
  }

  await mobile({ width: 390, height: 844 });
  await screen.wait('[data-iori-view="mobile-home"]');
  const mobileTarget = await mobileSidebarTarget(screen);
  await openSidebar(screen);
  await screen.click(action("settings-open"));
  await screen.wait(".settings-nav");
  assert.equal(await screen.visible(".settings-content"), false);
  await shot("settings-initial-mobile-list");
  await screen.click(action("settings-close"));
  await openSidebar(screen);
  await screen.click(action("open-agents-teams"));
  await screen.wait(inTeam(".team-tree-team"));
  await screen.wait(inTeam(action("teams-agents")));
  assert.equal(await screen.visible(inTeam(".team-detail")), false);
  await shot("agents-initial-mobile-list");
  await record(
    "スマホの設定とAIエージェント/チームは詳細を開かず一覧から始まる",
  );
  assert.deepEqual(await mobileSidebarTarget(screen), mobileTarget);
  await screen.click(inTeam(".team-tree-team"));
  await worker();
  await screen.evaluate("document.documentElement.classList.add('dark')");
  await screen.wait(inTeam(".team-mobile-location"));
  assert.deepEqual(await mobileSidebarTarget(screen), mobileTarget);
  await screen.click(inTeam(".team-save-header .page-back button"));
  await screen.wait(
    inTeam('.team-tree-row.selected[data-iori-action="team-role"]'),
  );
  await worker();
  await record(
    "チーム名の戻るはPCでは同じチーム全体、Mobileでは選択中の役割を保った木へ戻る",
  );
  await capture("mobile-worker-basic-dark");
  await waitFor(candidateModels, (values) =>
    values.some((value) => value === "claude:sonnet"),
  );
  await capture("mobile-worker-candidates-dark");
  await screen.click(inTeam(action("candidate-add")));
  await capture("mobile-model-picker-dark");
  await screen.key("Escape");
  await screen.click(action("team-history"));
  await screen.wait('[data-iori-history-version="5"]');
  await capture("mobile-team-history-dark");
  await screen.key("Escape");
  await screen.key("Alt+ArrowLeft");
  await capture("mobile-teams-tree-dark");
  await screen.click(inTeam(action("teams-list")));
  await capture("mobile-teams-dark");
  await screen.key("Alt+ArrowLeft");
  await screen.click(inTeam(action("teams-agents")));
  await screen.click(`${piRow} .team-agent-toggle`);
  const savedArguments = `${piRow} [data-iori-field="cli-arguments"]`;
  assert.equal(
    await screen.value(savedArguments),
    '--model "openai/gpt-6-luna"',
    "Host再起動後も起動引数を保持する",
  );
  await capture("mobile-ai-agents-dark");
  const overflow = await screen.evaluate(
    `document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('${surface} .team-execution-cells')].some(e=>e.getBoundingClientRect().right>innerWidth)`,
  );
  assert.equal(overflow, false, "Mobileで画面の横にはみ出さない");
  await desktop();
  await record(
    "Host再起動・Client再読込後もチーム履歴・メモ・モデル上限を保持、Mobileの編集・候補選択",
  );

  // Use saved duplicates so the original team remains available to later scenarios.
  await screen.click(action("open-agents-teams"));
  await screen.click(inTeam(action("teams-list")));
  await screen.click(inTeam(`.team-list [data-iori-team-id="${teamId}"]`));
  const duplicateTeam = async () => {
    const previousId = await screen.attribute(
      inTeam(".team-save-header"),
      "data-iori-team-id",
    );
    await screen.click(inTeam(`.team-save-header ${action("team-actions")}`));
    await screen.click(action("team-duplicate"));
    await waitFor(
      () => screen.attribute(inTeam(".team-save-header"), "data-iori-team-id"),
      (id) => Boolean(id) && id !== previousId,
    );
    const duplicateId = await screen.attribute(
      inTeam(".team-save-header"),
      "data-iori-team-id",
    );
    assert.notEqual(duplicateId, previousId);
    return duplicateId;
  };
  const deleteFromMenu = async (id) => {
    await screen.click(action("team-delete"));
    await screen.click(action("team-delete-confirm"));
    await screen.wait(inTeam(".team-list"));
    await waitFor(
      () =>
        screen.evaluate(
          `document.querySelectorAll('${surface} [data-iori-team-id="${id}"]').length`,
        ),
      (count) => count === 0,
      undefined,
      "削除したチームが一覧と木から消える",
    );
  };
  const treeCopy = await duplicateTeam();
  await screen.contextMenu(
    inTeam(`.team-tree-team[data-iori-team-id="${treeCopy}"]`),
  );
  await deleteFromMenu(treeCopy);
  await record(
    "左の木のチーム名を右クリックし、削除を確認すると一覧と木から消える",
  );

  await screen.click(inTeam(`.team-list [data-iori-team-id="${teamId}"]`));
  const headerCopy = await duplicateTeam();
  await screen.click(inTeam(`.team-save-header ${action("team-actions")}`));
  await deleteFromMenu(headerCopy);
  await record("開いたチーム上部の…から削除を確認すると一覧と木から消える");

  await screen.click(inTeam(`.team-list [data-iori-team-id="${teamId}"]`));
  const touchCopy = await duplicateTeam();
  await mobile({ width: 390, height: 844 });
  await openSidebar(screen);
  await screen.click(action("open-agents-teams"));
  await screen.wait(inTeam(".team-tree-team"));
  await screen.click(
    inTeam(`.team-tree-team[data-iori-team-id="${touchCopy}"]`),
  );
  await screen.click(
    inTeam(`${action("team-overview")}[data-iori-team-id="${touchCopy}"]`),
  );
  await screen.key("Alt+ArrowLeft");
  await screen.longPress(
    inTeam(`.team-tree-team[data-iori-team-id="${touchCopy}"]`),
  );
  await deleteFromMenu(touchCopy);
  await record("Mobileの木のチーム名を長押しして、同じメニューから削除できる");
  await desktop();
  await screen.click(action("open-agents-teams"));
  await screen.wait(inTeam('[data-iori-view="teams-editor"]'));
  await screen.click(inTeam(action("teams-list")));
  await screen.wait(inTeam(".team-list"));

  const longNamePrefix = `Development Claude Code ${"1234567890".repeat(3)}`;
  const saveLongName = async (id, name) => {
    const overview = inTeam(
      `${action("team-overview")}[data-iori-team-id="${id}"]`,
    );
    await screen.click(overview);
    assert.equal(
      await screen.attribute(inTeam(".team-save-header"), "data-iori-team-id"),
      id,
      "複製したチームの概要を開く",
    );
    const versionSelector = inTeam(
      `.team-save-header[data-iori-team-id="${id}"] [data-iori-team-version]`,
    );
    const versionBefore = await screen.attribute(
      versionSelector,
      "data-iori-team-version",
    );
    await screen.input(inTeam('[data-iori-field="team-name"]'), name);
    await screen.click(action("team-save"));
    await waitFor(
      () => screen.attribute(versionSelector, "data-iori-team-version"),
      (value) => value !== versionBefore,
      undefined,
      "長いチーム名を保存",
    );
    assert.equal(
      await screen.text(inTeam(".team-save-header .page-back button")),
      name,
    );
  };
  await screen.click(inTeam(`.team-list [data-iori-team-id="${teamId}"]`));
  const longCopyA = await duplicateTeam();
  const longNameA = `${longNamePrefix} A`;
  await saveLongName(longCopyA, longNameA);
  await screen.click(inTeam(action("teams-list")));
  await screen.click(inTeam(`.team-list [data-iori-team-id="${teamId}"]`));
  const longCopyB = await duplicateTeam();
  const longNameB = `${longNamePrefix} B`;
  await saveLongName(longCopyB, longNameB);
  await screen.click(inTeam(action("teams-list")));
  await screen.click(inTeam(action("default-team")));
  await screen.wait(`[data-iori-default-team="${longCopyA}"]`);
  await screen.click(`[data-iori-default-team="${longCopyA}"]`);
  await waitFor(
    () =>
      screen.text(
        inTeam('[data-iori-action="default-team"] [data-slot="select-value"]'),
      ),
    (value) => value === longNameA,
    undefined,
    "長い名前の複製チームを既定に選択",
  );

  const elementMetrics = async (selector) =>
    screen.evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return;const r=document.createRange();r.selectNodeContents(e);return{text:e.textContent.trim(),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,whiteSpace:getComputedStyle(e).whiteSpace,overflow:getComputedStyle(e).overflow,textOverflow:getComputedStyle(e).textOverflow,textAlign:getComputedStyle(e).textAlign,lineLefts:[...r.getClientRects()].map(x=>x.left)}})()`,
    );
  const assertLeftWrapped = (metrics, name) => {
    assert.equal(metrics?.textAlign, "left", `${name} は左寄せで表示`);
    assert.ok(metrics.lineLefts.length > 1, `${name} は折り返して表示`);
    assert.ok(
      Math.max(...metrics.lineLefts) - Math.min(...metrics.lineLefts) < 1,
      `${name} の折り返し行の左端が揃っている`,
    );
  };
  const assertNamesFit = async () => {
    for (const [id, name] of [
      [longCopyA, longNameA],
      [longCopyB, longNameB],
    ]) {
      const metrics = await elementMetrics(
        inTeam(`[data-iori-team-name="${id}"]`),
      );
      assert.equal(metrics?.text, name);
      assert.ok(
        metrics.scrollWidth <= metrics.clientWidth,
        `チーム名が木からはみ出している: ${name}`,
      );
      assertLeftWrapped(metrics, `木のチーム名 ${name}`);
    }
  };
  const assertDefaultNamesFit = async (capturePrefix) => {
    const selected = await elementMetrics(
      inTeam('[data-iori-action="default-team"] [data-slot="select-value"]'),
    );
    assert.equal(selected?.text, longNameA);
    assert.equal(selected.whiteSpace, "nowrap");
    assert.equal(selected.overflow, "hidden");
    assert.equal(selected.textOverflow, "ellipsis");
    await screen.evaluate(
      `document.querySelector('${inTeam('[data-iori-action="default-team"]')}').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))`,
    );
    assert.equal(
      await screen.attribute(
        inTeam('[data-iori-action="default-team"]'),
        "title",
      ),
      longNameA,
    );
    await screen.click(inTeam(action("default-team")));
    if (capturePrefix === "pc") {
      for (const theme of ["light", "dark"]) {
        await screen.evaluate(
          `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
        );
        await capture(`pc-teams-default-selector-${theme}`);
      }
    } else if (capturePrefix) {
      await screen.evaluate("document.documentElement.classList.add('dark')");
      await capture(`${capturePrefix}-teams-default-selector-dark`);
    }
    for (const [id, name] of [
      [longCopyA, longNameA],
      [longCopyB, longNameB],
    ]) {
      const selector = `[data-iori-default-team="${id}"]`;
      await screen.wait(selector);
      const option = await elementMetrics(`${selector} > span:last-child`);
      assert.equal(option?.text, name);
      assert.ok(
        option.scrollWidth <= option.clientWidth,
        `既定チームの候補名が欄からはみ出している: ${name}`,
      );
      assertLeftWrapped(option, `既定チーム候補 ${name}`);
    }
    await screen.key("Escape");
  };

  await assertNamesFit();
  await themes("teams-tree");
  await assertDefaultNamesFit("pc");
  await mobile({ width: 390, height: 844 });
  await screen.wait('[data-iori-view="mobile-home"]');
  await openSidebar(screen);
  await screen.click(action("open-agents-teams"));
  await screen.wait(inTeam(`[data-iori-team-name="${longCopyA}"]`));
  await screen.evaluate("document.documentElement.classList.add('dark')");
  await capture("mobile-teams-tree-dark");
  await assertNamesFit();
  await screen.click(inTeam(action("teams-list")));
  await assertDefaultNamesFit("mobile");
  await desktop();
  await record(
    "末尾だけ異なる長い複製チーム名がPC・Mobileの木と既定チームの選択欄・候補で全文表示",
  );
  if (splitForStart) {
    await returnToWorktree(screen);
    await screen.click(
      '.dock-tab-header:has([data-iori-tab-kind="start"]) [data-iori-action="workspace-close-tab"]',
    );
    await waitFor(async () => !(await screen.visible(launcher)));
  }
  // Run the new-team start last: starting replaces the start tab with a CLI.
  await returnToWorktree(screen);
  if (splitForStart) {
    await screen.click(
      '[data-iori-group-id] [data-iori-action="workspace-split-right"]',
    );
  }
  await screen.wait(`${launcher} .cli-launcher[data-iori-teams-loaded="true"]`);
  await screen.click(action("open-agents-teams"));
  await screen.click(inTeam(action("teams-list")));
  await screen.click(inTeam('[role="switch"]'));
  await screen.click(action("team-new"));
  await screen.click('[data-iori-template="research"]');
  await screen.click(action("team-create"));
  await version(1);
  const researchId = await screen.attribute(
    inTeam('[data-iori-action="team-overview"]'),
    "data-iori-team-id",
  );
  await screen.click(
    inTeam(
      `[data-iori-action="team-parent"][data-iori-team-id="${researchId}"]`,
    ),
  );
  assert.match(await screen.text(inTeam(".team-parent-execution")), /未設定/);
  await captureUnconfiguredEditor("unconfigured-parent");
  await screen.click(
    inTeam(`${teamTree(researchId)} [data-iori-action="team-role"]`),
  );
  assert.match(
    await screen.text(inTeam("#team-section-1")),
    /候補が設定されていません。/,
  );
  await captureUnconfiguredEditor("unconfigured-candidates");
  await returnToWorktree(screen);
  const researchRow = `${launcher} [data-iori-team-id="${researchId}"]`;
  await screen.wait(researchRow);
  assert.match(await screen.text(researchRow), /親のCLIを選んでください/);
  await captureLauncher("start-unconfigured-team", researchRow);
  await screen.click(researchRow);
  await waitForSelectedTeam(researchId);
  assert.equal(await screen.visible('[data-iori-tab-cli="codex"]'), false);
  await screen.click(
    inTeam(
      `[data-iori-action="team-parent"][data-iori-team-id="${researchId}"]`,
    ),
  );
  await screen.click(
    inTeam('.team-parent-execution [data-iori-action="candidate-model"]'),
  );
  await screen.input(".model-picker input", "codex gpt-6.1-sol");
  await screen.click(
    '[cmdk-item][data-cli="codex"][data-iori-model="gpt-6.1-sol"]',
  );
  await screen.click(action("team-save"));
  await version(2);
  await returnToWorktree(screen);
  await screen.click(researchRow);
  await screen.wait('[data-iori-tab-cli="codex"]');
  await record("未設定の親を編集して保存し、チームを開始");
}
