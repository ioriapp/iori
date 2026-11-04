import assert from "node:assert/strict";
import { cp, readFile, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildHost } from "../../scripts/release/host.mjs";
import { startUpdateHost } from "../updates/host-distribution.mjs";
import { waitFor } from "../ui.mjs";

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
  record,
  shot,
  mobile,
  desktop,
  reload,
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
  // The same screen at PC, WQHD and phone width in both themes, when
  // pictures are asked for.
  const pictures = async (name) => {
    await shot(name);
    if (process.env.IORI_UNINSTALL_CAPTURE !== "1") return;
    const dark = await screen.evaluate(
      "document.documentElement.classList.contains('dark')",
    );
    for (const [device, width, height] of [
      ["pc", 1440, 1000],
      ["wqhd", 2560, 1440],
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
  async function settings() {
    await screen.click('[data-iori-action="settings-open"]');
    await screen.click('[data-iori-action="open-host-version"]');
  }
  async function remove(deleteData) {
    await screen.click('[data-iori-action="host-uninstall"]');
    await screen.wait('[data-iori-view="host-maintenance-confirmation"]');
    assert.equal(
      await screen.attribute(
        '[data-iori-field="host-uninstall-data"]',
        "data-state",
      ),
      "unchecked",
    );
    if (deleteData)
      await screen.click('[data-iori-field="host-uninstall-data"]');
    const warning = await screen.evaluate(`(() => {
      const dialog = document.querySelector('[data-iori-view="host-maintenance-confirmation"]');
      return {
        targets: dialog.querySelectorAll('[data-iori-maintenance-work]').length,
        shown: Boolean(dialog.querySelector('[data-iori-maintenance-working]')),
      };
    })()`);
    assert.equal(warning.shown, warning.targets > 0);
    record(deleteData ? "delete-data-warning" : "keep-data-warning", warning);
    await pictures(
      deleteData ? "delete-data-confirmation" : "keep-data-confirmation",
    );
    await screen.click('[data-iori-action="host-maintenance-confirm"]');
    await screen.key("Escape");
    await waitFor(
      () => present(fixture.bundle),
      (exists) => !exists,
    );
  }
  await settings();
  await screen.click('[data-iori-action="host-uninstall"]');
  await screen.wait('[data-iori-view="host-maintenance-confirmation"]');
  await screen.key("Escape");
  assert.equal(await present(fixture.bundle), true);
  await remove(false);
  await screen.wait(
    `[data-iori-host-key="${key}"][data-iori-removal="succeeded"]`,
  );
  await settings();
  await screen.wait('[data-iori-state="host-succeeded"]');
  for (const action of ["host-update", "host-restart", "host-uninstall"])
    assert.equal(await screen.visible(`[data-iori-action="${action}"]`), false);
  await pictures("keep-data-result");
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
  await reload();
  await screen.wait('[data-iori-action="settings-open"]');
  await settings();
  await screen.wait('[data-iori-action="host-uninstall-connect"]');
  await mobile();
  await reload();
  await settings();
  assert.equal(
    await screen.visible('[data-iori-action="host-uninstall"]'),
    false,
  );
  await shot("mobile-uninstalled");
  if (process.env.IORI_UNINSTALL_CAPTURE === "1")
    await themes("phone-uninstalled");
  await desktop();
  await reload();
  await settings();
  await cp(fixture.pristine, fixture.bundle, { recursive: true });
  await reinstall();
  await screen.click('[data-iori-action="host-uninstall-connect"]');
  await screen.key("Escape");
  await screen.wait(`[data-iori-host-key="${key}"] [data-connected="true"]`);
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
  await screen.click('[data-iori-action="settings-open"]');
  assert.equal(
    await screen.visible('[data-iori-action="settings-host-select"]'),
    false,
  );
  await shot("delete-data-result");
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
