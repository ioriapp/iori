import { readForgeExpectation } from "../../verification/web/forge-fixture.mjs";
import { forgeCiScenario } from "./forge-ci.mjs";
import { create } from "../terminal/scenario.mjs";
import assert from "node:assert/strict";
import { openFolder } from "../workspace/scenario.mjs";
import {
  openSidebar,
  openSettingsSection,
  openWorkspaceSettings,
} from "../connection/scenario.mjs";
import { waitFor } from "../../verification/ui.mjs";

const action = (name) => `[data-iori-action="${name}"]`;
const row = (path) => `button[data-iori-worktree-path=${JSON.stringify(path)}]`;
const marks = (path) =>
  `${row(path)} ~ .nav-worktree-controls .nav-forge-marks`;

async function nameFits(screen, path, full, expectedCheck) {
  await waitFor(
    () =>
      screen.evaluate(`(()=>{
    const button=document.querySelector(${JSON.stringify(row(path))});
    const name=button?.querySelector('.nav-worktree-name');
    const mark=button?.parentElement.querySelector('[data-iori-forge="ci"]');
    if(!name||!mark)return false;
    const n=name.getBoundingClientRect(),m=mark.getBoundingClientRect(),r=button.parentElement.getBoundingClientRect(),b=button.getBoundingClientRect();
    const toggle=button.parentElement.querySelector('[data-iori-action="worktree-toggle"]')?.getBoundingClientRect();
    return name.textContent.includes('…')&&${JSON.stringify(full)}.startsWith(name.textContent.split('…')[0])&&${JSON.stringify(full)}.endsWith(name.textContent.split('…')[1])&&name.textContent.split('…')[1].length>0&&n.width>0&&n.right<=m.left&&m.right<=r.right&&name.scrollWidth<=name.clientWidth+1&&button.getAttribute('aria-current')==='page'&&Math.abs(b.width-r.width)<1&&m.right<=b.right&&toggle&&toggle.right<=b.right&&toggle.left>=b.left&&mark.getAttribute('aria-label')===${JSON.stringify(expectedCheck)};
  })()`),
    Boolean,
    undefined,
    "長い名前の両端とCIの印が見える",
  );
}

export async function forgeSettingsWithoutWorkspace(screen, record) {
  await openSettingsSection(screen, "open-repository-git");
  await screen.wait('[data-iori-state="no-workspaces"]');
  await screen.key("Escape");
  await record("フォルダーを開く前のGit設定にワークスペースが無いことを表示");
}

async function checkSettingsNavigation(screen, fixture, record) {
  const setup = '[data-iori-field="repository-setup-command"]';
  const baseline = await screen.value(setup);
  await screen.input(setup, baseline + " # unsaved");
  await screen.click(action("open-repository-git"));
  assert.equal(
    await screen.visible('[data-iori-view="settings-discard-confirmation"]'),
    false,
  );
  assert.equal(await screen.value(setup), baseline + " # unsaved");
  await screen.click(action("open-connection"));
  await screen.wait('[data-iori-view="settings-discard-confirmation"]');
  await screen.click(action("settings-discard"));
  await screen.wait('.v9-settings-info-row[data-iori-state="connected"]');

  // Observe the real connection while the ordinary save controls complete.
  await screen.evaluate(`(async()=>{
    const {connection}=await import('/src/connection.ts');
    window.__ioriSettingsDisconnected=false;
    window.__ioriSettingsStop=connection.subscribe(()=>{
      if(!connection.getSnapshot().connected)window.__ioriSettingsDisconnected=true;
    });
  })()`);
  await screen.click(action("save-address"));
  await waitFor(
    () => screen.text('[data-iori-view="connection"] .section-save-result'),
    (text) => text === "保存しました",
  );
  const address = await screen.value('[data-iori-field="address"]');
  await screen.input('[data-iori-field="address"]', address + "\n");
  await screen.key("Control+Enter");
  await waitFor(
    () => screen.text('[data-iori-view="connection"] .section-save-result'),
    (text) => text === "保存しました",
  );
  const relayUrl = '[data-iori-field="relay-url"]';
  const savedUrl = await screen.value(relayUrl);
  await screen.click(action("save-relay"));
  await screen.wait('[data-iori-state="relay-saved"]');
  await screen.input(relayUrl, ` ${savedUrl} `);
  await screen.key("Enter");
  await screen.wait('[data-iori-state="relay-saved"]');
  assert.equal(
    await screen.evaluate(`(()=>{
      window.__ioriSettingsStop();
      return window.__ioriSettingsDisconnected;
    })()`),
    false,
    "同じ接続先・Relayを保存ボタンとEnterで再保存しても接続を切らない",
  );
  await record("接続先とRelayの値が変わらない再保存では接続を保つ");

  await screen.input(relayUrl, "https://unsaved.example.invalid");
  await screen.click(action("open-connection"));
  await screen.click(action("settings-repository-select"));
  await screen.click(
    `[data-iori-repository-path=${JSON.stringify(fixture.sharedRepository)}]`,
  );
  assert.equal(
    await screen.visible('[data-iori-view="settings-discard-confirmation"]'),
    false,
  );
  assert.equal(await screen.value(relayUrl), "https://unsaved.example.invalid");
  await screen.click(action("settings-display"));
  await screen.wait('[data-iori-view="settings-discard-confirmation"]');
  await screen.click(action("settings-discard"));
  await screen.click(action("open-connection"));
  assert.equal(
    await screen.visible('[data-iori-view="settings-discard-confirmation"]'),
    false,
  );
  assert.equal(await screen.value(relayUrl), savedUrl);
  await screen.click(action("settings-repository-select"));
  await screen.click(
    `[data-iori-repository-path=${JSON.stringify(fixture.repository)}]`,
  );
  await screen.click(action("open-repository-git"));
  await screen.wait(setup);
  assert.equal(await screen.value(setup), baseline);
  await record(
    "同じ設定項目と接続画面でのワークスペース選択は下書きを保ち、別の項目への移動で一度だけ破棄を確認",
  );
}

export async function forgeStatusScenario({
  client,
  fixture,
  mobile,
  desktop,
  shot,
  record,
  reload,
}) {
  const screen = client.screen;
  await openFolder(screen, fixture.plainWorkspace, false);
  await openWorkspaceSettings(screen, fixture.plainWorkspace, () =>
    shot("workspace-plain-menu-desktop"),
  );
  await screen.wait('[data-iori-state="workspace-not-git"]');
  await shot("workspace-plain-git-desktop");
  await screen.key("Escape");
  await openFolder(screen, fixture.sharedRepository, false);
  await openFolder(screen, fixture.repository, false);
  await screen.reveal(row(fixture.repository));
  assert.equal(
    await screen.text(`${row(fixture.repository)} .nav-worktree-name`),
    fixture.branch,
  );
  await openWorkspaceSettings(screen, fixture.repository, () =>
    shot("repository-menu-desktop"),
  );
  const pendingRow = '[data-iori-remote-name="pending"]';
  await screen.reveal(`${pendingRow} [data-iori-state="forge-detecting"]`);
  await screen.wait('[data-iori-field="repository-setup-command"]');
  await shot("workspace-git-pending-desktop");
  const mappingRow = `[data-iori-forge-host=${JSON.stringify(fixture.remoteHost)}]`;
  await screen.wait(`${mappingRow} [data-iori-field="forge-web-url"]`);
  assert.equal(
    await screen.visible(`${marks(fixture.repository)} [data-iori-forge]`),
    false,
  );
  await screen.input(
    `${mappingRow} [data-iori-field="forge-web-url"]`,
    fixture.origin,
  );
  await screen.key("Enter");
  await screen.wait(`${mappingRow} [data-iori-state="saved"]`);
  await screen.wait(`${marks(fixture.repository)} [data-iori-forge="ci"]`);
  await shot("repository-git-desktop");
  await screen.key("Escape");
  await openSidebar(screen);
  const expected = await readForgeExpectation(fixture);
  const checkLabels = {
    passed: "CI通過",
    failed: "CI失敗",
    running: "CI実行中",
  };
  const checkLabel = checkLabels[expected.state];
  await screen.wait(
    `${marks(fixture.repository)} [data-iori-forge="ci"][aria-label=${JSON.stringify(checkLabel)}]`,
  );
  await record(
    "ワークスペースのGitで別名remoteのURLを入力してEnterで保存でき、設定を開いたまま実APIと同じ印が出る",
    { state: expected.state, sha: fixture.sha, remoteHost: fixture.remoteHost },
  );
  await forgeCiScenario({ client, fixture, mobile, desktop, shot, record });

  await openWorkspaceSettings(screen, fixture.sharedRepository);
  await waitFor(
    () => screen.value(`${mappingRow} [data-iori-field="forge-web-url"]`),
    (value) => value === fixture.origin,
  );
  await record("同じホスト名を使う別のワークスペースのGitにも同じURLが出る");
  await openSettingsSection(screen, "open-integrations");
  await screen.wait('[data-iori-state="github-signed-out"]');
  await shot("github-desktop");
  await mobile();
  await openWorkspaceSettings(screen, fixture.plainWorkspace, () =>
    shot("workspace-plain-menu-mobile"),
  );
  await screen.wait('[data-iori-state="workspace-not-git"]');
  await shot("workspace-plain-git-mobile");
  await screen.key("Escape");
  await openWorkspaceSettings(screen, fixture.repository, () =>
    shot("repository-menu-mobile"),
  );
  await waitFor(
    () => screen.value(`${mappingRow} [data-iori-field="forge-web-url"]`),
    (value) => value === fixture.origin,
  );
  await screen.reveal(`${pendingRow} [data-iori-state="forge-detecting"]`);
  await shot("workspace-git-pending-mobile");
  await screen.input(
    `${mappingRow} [data-iori-field="forge-web-url"]`,
    `${fixture.origin}/`,
  );
  await screen.key("Enter");
  await screen.wait(`${mappingRow} [data-iori-state="saved"]`);
  assert.equal(
    await screen.value(`${mappingRow} [data-iori-field="forge-web-url"]`),
    fixture.origin,
  );
  await shot("repository-git-mobile");
  fixture.releaseDetection();
  await screen.wait(`${pendingRow} [data-iori-value="remote-website"]`);
  await record(
    "Gitでないワークスペースにも設定の入口と説明があり、スマホの長押しで開け、判定中も設定値が見え、判定結果が後から届く",
  );
  await openSettingsSection(screen, "open-integrations");
  await screen.wait('[data-iori-state="github-signed-out"]');
  await shot("github-mobile");
  await desktop();
  await openSidebar(screen);

  await screen.reveal(row(fixture.unpushed));
  assert.equal(
    await screen.visible(`${marks(fixture.unpushed)} [data-iori-forge]`),
    false,
  );
  await screen.click(row(fixture.unpushed));
  await screen.wait("[data-iori-current-worktree-path]");
  await screen.click(row(fixture.longPath));
  await waitFor(
    () =>
      screen.attribute(
        "[data-iori-current-worktree-path]",
        "data-iori-current-worktree-path",
      ),
    (value) => value === fixture.longPath,
  );
  await create(client);
  await openSidebar(screen);
  await screen.reveal(row(fixture.longPath));
  await screen.wait(
    `${row(fixture.longPath)} ~ .nav-worktree-controls [data-iori-action="worktree-toggle"]`,
  );
  const currentExpected = await readForgeExpectation(fixture);
  const currentLabel = checkLabels[currentExpected.state];
  await screen.wait(`${marks(fixture.longPath)} [data-iori-forge="ci"]`);
  await nameFits(screen, fixture.longPath, fixture.longName, currentLabel);
  await shot("forge-sidebar-desktop");
  await mobile();
  await openSidebar(screen);
  await screen.click(row(fixture.longPath));
  await openSidebar(screen);
  const mobileExpected = await readForgeExpectation(fixture);
  await nameFits(
    screen,
    fixture.longPath,
    fixture.longName,
    checkLabels[mobileExpected.state],
  );
  await shot("forge-sidebar-mobile");
  await record(
    "未pushブランチには印がなく、PC幅・スマホ幅で長い名前の末尾と印を表示",
  );
  await openWorkspaceSettings(screen, fixture.repository);
  const setupField = '[data-iori-field="repository-setup-command"]';
  await screen.wait(setupField);
  const originalSetup = await screen.value(setupField);
  await screen.input(setupField, originalSetup + " # mobile draft");
  await screen.key("Alt+ArrowLeft");
  await screen.wait('[data-iori-view="settings-discard-confirmation"]');
  await screen.key("Alt+ArrowLeft");
  assert.equal(
    await screen.value(setupField),
    originalSetup + " # mobile draft",
  );
  await screen.key("Alt+ArrowLeft");
  await screen.click(action("settings-discard"));
  await screen.wait(".settings-nav " + action("open-repository-git"));
  await shot("settings-mobile-list");
  await screen.click(action("open-repository-git"));
  assert.equal(await screen.value(setupField), originalSetup);
  await screen.click(action("settings-back"));
  await screen.wait(".settings-nav " + action("open-repository-git"));
  await screen.key("Alt+ArrowLeft");
  assert.equal(await screen.visible('[data-iori-view="settings"]'), false);
  await record(
    "Mobileの設定は一覧と詳細を全画面で移動し、未保存のまま戻ると破棄を確認し、画面の戻るでも一覧へ戻り、端末の戻るで閉じる",
  );
  await desktop();
  await openSettingsSection(screen, "settings-display");
  await screen.click(action("display-forge-status"));
  await screen.key("Escape");
  await openSidebar(screen);
  assert.equal(await screen.visible("[data-iori-forge]"), false);
  await reload();
  await openSidebar(screen);
  await screen.reveal(row(fixture.repository));
  assert.equal(await screen.visible("[data-iori-forge]"), false);
  await openSettingsSection(screen, "settings-display");
  assert.equal(
    await screen.attribute(action("display-forge-status"), "aria-checked"),
    "false",
  );
  await screen.key("Escape");
  await record("表示の設定でPR・CIの印を消し、Client再読込後も設定を保つ");
  await openWorkspaceSettings(screen, fixture.repository);
  await screen.wait('[data-iori-field="repository-setup-command"]');
  await checkSettingsNavigation(screen, fixture, record);
  await screen.key("Escape");
}
