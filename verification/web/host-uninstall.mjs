import assert from "node:assert/strict";
import { cp, readFile, access, readdir, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildHost } from "../../scripts/release/host.mjs";
import { startUpdateHost } from "../updates/host-distribution.mjs";
import { waitFor } from "../ui.mjs";
import { closeSettingsIfOpen } from "../host-setup/uninstall-scenario.mjs";
import {
  openSettingsSection,
  register,
} from "../../e2e/connection/scenario.mjs";

export async function prepareRemovalHost(runRoot, home) {
  const bundle = join(home, ".local/lib/iori-host");
  const pristine = join(runRoot, "host-distribution");
  if (process.env.IORI_WEB_HOST_DISTRIBUTION)
    await cp(process.env.IORI_WEB_HOST_DISTRIBUTION, pristine, {
      recursive: true,
    });
  else await buildHost(pristine);
  await cp(pristine, bundle, { recursive: true });
  return { bundle, ca: "", pristine, async close() {} };
}
export async function hostUninstallScenario({
  client,
  fixture,
  dataRoot,
  worktree,
  cliHome,
  uninstallStatuses,
  reinstall,
  disconnect,
  record,
  shot,
  mobile,
  desktop,
  reload,
  invitation,
}) {
  const { screen } = client;
  const themes = async (name) => {
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      await shot(`${name}-${theme}`);
    }
  };
  // The same screen at PC and phone width in both themes, when
  // pictures are asked for.
  const pictures = async (name) => {
    await shot(name);
    if (process.env.IORI_UNINSTALL_CAPTURE !== "1") return;
    const dark = await screen.evaluate(
      "document.documentElement.classList.contains('dark')",
    );
    for (const [device, width, height] of [
      ["pc", 1440, 1000],
      ["mobile", 390, 844],
    ]) {
      await client.browser.viewport({ width, height });
      await themes(`${device}-${name}`);
    }
    await client.browser.viewport({ width: 1440, height: 1000 });
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${dark})`,
    );
  };
  const key = await screen.evaluate(
    "(async () => (await import('/src/connection.ts')).connection.getSnapshot().host.publicKey)()",
  );
  const present = (file) =>
    access(file).then(
      () => true,
      () => false,
    );
  const conversations = join(cliHome.home, ".claude/projects");
  const conversationFiles = [];
  for (const name of await readdir(conversations, { recursive: true })) {
    if (!name.endsWith(".jsonl")) continue;
    const file = join(conversations, name);
    if (
      (await readFile(file, "utf8")).includes(
        "What shell command prints the current working directory?",
      )
    )
      conversationFiles.push(file);
  }
  assert.ok(
    conversationFiles.length,
    "Claude saved the conversation used before uninstall",
  );
  async function cliFilesRetained() {
    for (const file of conversationFiles)
      assert.ok(
        (await readFile(file, "utf8")).includes(
          "What shell command prints the current working directory?",
        ),
      );
    const settings = JSON.parse(
      await readFile(join(cliHome.home, ".claude/settings.json"), "utf8"),
    );
    assert.equal(settings.model, "claude-haiku-4-5");
    assert.equal(JSON.stringify(settings).includes("iori-cli-hook"), false);
  }
  const expectedFile = await readFile(join(worktree, "sample.txt"), "utf8");
  const root = join(dataRoot, "iori-host");
  const dialog = '[data-iori-view="host-maintenance-confirmation"]';
  const notice = '[data-iori-view="host-notice"]';
  async function settings() {
    await openSettingsSection(screen, "open-host-version");
  }
  async function remove(deleteData) {
    await screen.click('[data-iori-action="host-uninstall"]');
    await screen.wait(dialog);
    await waitFor(() =>
      screen.evaluate(
        `document.querySelector('[data-iori-action="host-maintenance-confirm"]')?.disabled === false`,
      ),
    );
    assert.equal(
      await screen.attribute(
        '[data-iori-field="host-uninstall-data"]',
        "data-state",
      ),
      "unchecked",
    );
    const text = await screen.text(dialog);
    assert.match(
      text,
      /All devices using this Host|すべてのデバイスから接続できなくなります/u,
    );
    assert.match(
      text,
      /Development files and CLI conversations|開発ファイルと、CLIの会話/u,
    );
    if (deleteData)
      await screen.click('[data-iori-field="host-uninstall-data"]');
    const warning = await screen.evaluate(`(() => {
      const dialog = document.querySelector('${dialog}');
      return { targets: dialog.querySelectorAll('[data-iori-maintenance-work]').length,
        shown: Boolean(dialog.querySelector('[data-iori-maintenance-working]')) };
    })()`);
    assert.equal(warning.shown, warning.targets > 0);
    record(deleteData ? "delete-data-warning" : "keep-data-warning", warning);
    await pictures(deleteData ? "B2-data" : "B2");
    await screen.evaluate(`(() => {
      window.uninstallNoticeTimes = {};
      const observer = new MutationObserver(() => {
        const shown = Boolean(document.querySelector('${notice}'));
        if (shown && !window.uninstallNoticeTimes.shown) window.uninstallNoticeTimes.shown = Date.now();
        if (!shown && window.uninstallNoticeTimes.shown) {
          window.uninstallNoticeTimes.closed = Date.now(); observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    })()`);
    await screen.click('[data-iori-action="host-maintenance-confirm"]');
    await screen.wait('[data-iori-view="host-progress"]');
    assert.equal(
      await screen.evaluate(
        `document.querySelectorAll('[data-iori-view="host-progress"] li').length`,
      ),
      4,
    );
    await shot(
      deleteData ? "delete-data-B3-uninstall" : "keep-data-B3-uninstall",
    );
    await screen.click('[data-iori-action="host-maintenance-close"]');
    await waitFor(
      () => screen.visible(dialog),
      (visible) => !visible,
    );
    await closeSettingsIfOpen(screen);
    // Completion is observed in the Client before checking the actual files.
    await screen.wait(notice);
    assert.equal(
      await screen.visible('[data-iori-view="host-version"]'),
      false,
    );
    if (deleteData) {
      assert.match(
        await screen.text(notice),
        /Some items need your attention|確認が必要な項目があります/u,
      );
      assert.equal(
        await screen.visible('[data-iori-action="host-notice-close"]'),
        false,
      );
      await pictures("B9-closed-warning");
      await screen.click('[data-iori-action="host-notice-details"]');
      await screen.wait(dialog);
      const text = await screen.text(dialog);
      assert.match(
        text,
        /Deleted iori Host and its saved data|iori Hostをアンインストールし、保存データを削除しました/u,
      );
      const instruction = text.search(
        /Could not delete the tokens|次のサイトのトークンを削除できませんでした/u,
      );
      const site = text.indexOf("https://forgejo.example.invalid");
      const revoke = text.search(/Revoke each token|各サイトでトークンを無効/u);
      assert.ok(instruction >= 0 && site > instruction && revoke > instruction);
      await pictures("B9-detail-warning");
      await screen.click('[data-iori-action="host-maintenance-close"]');
    } else {
      assert.match(
        await screen.text(notice),
        /Uninstalled iori Host|iori Hostをアンインストールしました/u,
      );
      assert.equal(
        await screen.visible('[data-iori-action="host-notice-details"]'),
        false,
      );
      await pictures("B5-last");
      await waitFor(
        () => screen.visible(notice),
        (visible) => !visible,
      );
      record(
        "normal-notice-auto-dismissed",
        await screen.evaluate(`({
        durationMilliseconds: window.uninstallNoticeTimes.closed - window.uninstallNoticeTimes.shown,
      })`),
      );
    }
    await waitFor(
      () => present(fixture.bundle),
      (exists) => !exists,
    );
    await waitFor(
      () => screen.visible(`[data-iori-host-key="${key}"]`),
      (visible) => !visible,
    );
  }
  await screen.contextMenu(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await screen.click('[data-iori-action="worktree-delete"]');
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector('[data-iori-action="worktree-removal-confirm"]')?.disabled === false`,
    ),
  );
  await pictures("worktree-removal-confirmation");
  await screen.key("Escape");
  await settings();
  await pictures("B0");
  await mobile();
  await reload();
  await settings();
  assert.equal(
    await screen.visible('[data-iori-action="host-uninstall"]'),
    false,
  );
  await pictures("B8");
  await desktop();
  await reload();
  await settings();
  for (const [action, name] of [
    ["host-restart", "restart-confirmation"],
    ["host-uninstall", "active-uninstall-confirmation"],
  ]) {
    await screen.click(`[data-iori-action="${action}"]`);
    await screen.wait('[data-iori-view="host-maintenance-confirmation"]');
    await waitFor(() =>
      screen.evaluate(
        `document.querySelector('[data-iori-action="host-maintenance-confirm"]')?.disabled === false`,
      ),
    );
    if (action === "host-uninstall") {
      assert.ok(
        await screen.evaluate(
          `document.querySelectorAll('[data-iori-maintenance-work]').length > 0`,
        ),
      );
      assert.match(
        await screen.text('[data-iori-action="host-maintenance-confirm"]'),
        /Stop and uninstall|停止してアンインストールする/u,
      );
      assert.match(
        await screen.text(dialog),
        /All devices using this Host|すべてのデバイスから接続できなくなります/u,
      );
    }
    await pictures(action === "host-uninstall" ? "B2b" : name);
    await screen.key("Escape");
  }
  await disconnect();
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector('[data-iori-action="host-uninstall"]')?.disabled === true`,
    ),
  );
  assert.match(
    await screen.text('[data-iori-view="settings"]'),
    /Connecting|接続中/u,
  );
  await pictures("B1");
  await reinstall();
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector('[data-iori-action="host-uninstall"]')?.disabled === false`,
    ),
  );
  await screen.click('[data-iori-action="host-uninstall"]');
  await screen.wait('[data-iori-view="host-maintenance-confirmation"]');
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector('[data-iori-action="host-maintenance-confirm"]')?.disabled === false`,
    ),
  );
  await disconnect();
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector('[data-iori-action="host-maintenance-confirm"]')?.disabled === true`,
    ),
  );
  assert.match(
    await screen.text(`${dialog} [data-slot="dialog-description"]`),
    /Connecting|接続中/u,
  );
  await pictures("B2-disconnected");
  await screen.key("Escape");
  assert.equal(await present(fixture.bundle), true);
  await reinstall();
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector('[data-iori-action="host-uninstall"]')?.disabled === false`,
    ),
  );
  // A directory where a hook file should be makes its removal fail while the
  // Host remains available. Remove the obstruction before trying again.
  const blockedHook = join(cliHome.home, ".iori/hooks/iori-cli-hook.cmd");
  await mkdir(blockedHook);
  try {
    await screen.click('[data-iori-action="host-uninstall"]');
    await screen.wait(dialog);
    await waitFor(() =>
      screen.evaluate(
        `document.querySelector('[data-iori-action="host-maintenance-confirm"]')?.disabled === false`,
      ),
    );
    await screen.click('[data-iori-action="host-maintenance-confirm"]');
    await screen.wait('[data-iori-view="host-progress"]');
    await screen.click('[data-iori-action="host-maintenance-close"]');
    await screen.wait(notice);
    assert.match(
      await screen.text(notice),
      /Could not uninstall iori Host|iori Hostをアンインストールできませんでした/u,
    );
    await closeSettingsIfOpen(screen);
    await screen.click('[data-iori-action="host-notice-close"]');
  } finally {
    await rm(blockedHook, { recursive: true, force: true });
  }
  await reload();
  await settings();
  assert.equal(await screen.visible(notice), false);
  record("dismissed-failure-stays-absent-after-reload", {});
  await remove(false);
  await reload();
  await screen.wait('[data-iori-view="first-run"]');
  record("removed-host-stays-absent-after-reload", {});
  assert.equal(await present(join(root, "host.sqlite")), true);
  assert.equal(await present(join(root, "terminal-daemon/runtime")), false);
  assert.equal(
    await present(join(cliHome.home, ".iori/hooks/iori-cli-hook.mjs")),
    false,
  );
  assert.equal(
    await readFile(join(worktree, "sample.txt"), "utf8"),
    expectedFile,
  );
  await cliFilesRetained();
  record("uninstall-keeps-data", {
    programRemoved: true,
    savedDataRetained: true,
    developmentFilesRetained: true,
    cliSettingsRetained: true,
    cliConversationRetained: true,
    ioriHookSettingsRemoved: true,
  });

  await cp(fixture.pristine, fixture.bundle, { recursive: true });
  await reinstall();
  await register(screen, await invitation(), "開発用Chromium");
  await settings();
  assert.equal(
    await screen.evaluate(
      "(async () => (await import('/src/connection.ts')).connection.getSnapshot().host.publicKey)()",
    ),
    key,
  );
  // A token the Host keeps in the OS credential store. This machine has no
  // such store, so the uninstall cannot remove it: it must go on and name the
  // site in its result. Windows removes it (token-vault.integration.test.ts).
  const tokenSite = "https://forgejo.example.invalid";
  const database = new DatabaseSync(join(root, "host.sqlite"), {
    timeout: 10_000,
  });
  try {
    database
      .prepare(
        "INSERT INTO forge_tokens (origin, storage, account) VALUES (?, 'os', '')",
      )
      .run(tokenSite);
  } finally {
    database.close();
  }
  await remove(true);
  await reload();
  await screen.wait('[data-iori-view="first-run"]');
  assert.equal(await screen.visible(notice), false);
  record("dismissed-warning-stays-absent-after-reload", {});
  await waitFor(
    () => screen.visible(`[data-iori-host-key="${key}"]`),
    (visible) => !visible,
  );
  const deleting = uninstallStatuses.findLast((status) => status.deleteData);
  // This machine has no OS credential store: the token cannot be removed
  // there, so the uninstall goes on and names its site in the result.
  assert.deepEqual(
    deleting?.forgeTokensRemaining,
    [tokenSite],
    "撤去の結果に、OSの保管所から消せなかったサイトが出る",
  );
  assert.equal(deleting.completed.includes("forge-tokens"), false);

  await cliFilesRetained();
  assert.equal(await present(root), false);
  assert.equal(
    await readFile(join(worktree, "sample.txt"), "utf8"),
    expectedFile,
  );
  record("uninstall-deletes-data", {
    forgeTokensRemaining: deleting.forgeTokensRemaining ?? [],
    forgeTokensRemoved: deleting.completed.includes("forge-tokens"),
    savedDataRemoved: true,
    cliConversationRetained: true,
    ioriHookSettingsRemoved: true,
    removedFromList: true,
    developmentFilesRetained: true,
  });
}
export { startUpdateHost as startRemovalHost };
