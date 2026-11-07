import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openSettingsSection } from "../../e2e/connection/scenario.mjs";
import { waitFor, waitForOperation } from "../ui.mjs";

// Completion can close Settings in the same frame as the user's close gesture.
// Resolve and click in one browser task, including a completed, absent dialog.
export async function closeSettingsIfOpen(screen) {
  await screen.evaluate(
    `document.querySelector('[data-iori-action="settings-close"]')?.click()`,
  );
}

async function waitForUninstallNotice(screen, hostKey, expected) {
  const selector = `[data-iori-view="host-notice"][data-iori-notice-key="${hostKey}"]`;
  await waitForOperation(
    "Host uninstall result notice",
    () => screen.text(selector),
    (text) => expected.test(text),
    async () => {
      const text = await screen.text(selector);
      return /Could not uninstall|アンインストールできませんでした/u.test(text)
        ? text
        : screen.text(
            '[data-iori-view="host-maintenance-confirmation"] .host-notice.is-error',
          );
    },
  );
  return selector;
}

// Shared native UI flow. The OS runner separately verifies actual file removal.
export async function uninstallFromSettings(
  client,
  {
    deleteData,
    activeTerminal,
    answerPrompt,
    removed,
    record,
    evidenceDirectory,
  },
) {
  const { screen } = client;
  const dialog = '[data-iori-view="host-maintenance-confirmation"]';
  const capture = async (name) =>
    writeFile(
      join(evidenceDirectory, name + ".png"),
      Buffer.from(await client.browser.screenshot(), "base64"),
    );
  await openSettingsSection(screen, "open-host-version");
  const hostKey = await screen.attribute(
    '[data-iori-action="settings-host-select"]',
    "data-iori-host-key",
  );
  let confirmationNumber = 0;
  async function confirm() {
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
    if (deleteData)
      await screen.click('[data-iori-field="host-uninstall-data"]');
    if (activeTerminal) await screen.wait("[data-iori-maintenance-working]");
    await capture(
      `${deleteData ? "delete-data" : "keep-data"}-confirmation-${++confirmationNumber}`,
    );
    await screen.click('[data-iori-action="host-maintenance-confirm"]');
  }
  await confirm();
  if (answerPrompt) {
    await screen.wait(`${dialog} [data-iori-field="ssh-answer"]`);
    assert.equal(
      await screen.attribute('[data-iori-field="ssh-answer"]', "type"),
      "password",
    );
    assert.equal(
      await screen.visible('[data-iori-view="host-progress"]'),
      false,
    );
    // Cancelling before SSH authentication must not start the uninstall.
    await screen.click('[data-iori-action="host-maintenance-close"]');
    await waitFor(
      () => screen.visible(dialog),
      (visible) => !visible,
    );
    record("uninstall-ssh-cancelled-before-start", true);
    await confirm();
    await screen.wait(`${dialog} [data-iori-field="ssh-answer"]`);
    await capture(
      `${deleteData ? "delete-data" : "keep-data"}-ssh-before-start`,
    );
    await answerPrompt();
  }
  await screen.wait('[data-iori-view="host-progress"]');
  const stages = await screen.evaluate(
    `[...document.querySelectorAll('[data-iori-view="host-progress"] li')].map(row => row.textContent)`,
  );
  assert.equal(stages.length, 4);
  record("uninstall-progress-stages", stages);
  await capture(`${deleteData ? "delete-data" : "keep-data"}-progress`);
  await screen.click('[data-iori-action="host-maintenance-close"]');
  await waitFor(
    () => screen.visible(dialog),
    (visible) => !visible,
  );
  await closeSettingsIfOpen(screen);
  await waitForUninstallNotice(
    screen,
    hostKey,
    deleteData
      ? /Deleted iori Host and its saved data|iori Hostと保存データを削除しました/u
      : /Uninstalled iori Host|iori Hostをアンインストールしました/u,
  );
  assert.equal(
    await screen.visible('[data-iori-action="settings-close"]'),
    false,
  );
  assert.equal(
    await screen.visible('[data-iori-action="host-notice-details"]'),
    false,
  );
  await capture(deleteData ? "delete-data-result" : "keep-data-result");
  await removed();
  assert.equal(await screen.visible('[data-iori-view="host-version"]'), false);
  assert.equal(
    await screen.visible(`[data-iori-host-key="${hostKey}"]`),
    false,
  );
  record("ssh-uninstall-result-source", {
    deleteData,
    source: answerPrompt ? "same-ssh" : "local",
  });
  record(
    deleteData ? "uninstalled-with-data" : "uninstalled-keeping-data",
    true,
  );
}

// The caller revokes this run's SSH key on the real destination. The Host's
// authenticated iori connection remains usable for the explicit fallback.
export async function uninstallWithoutSsh(
  client,
  { deleteData, removed, record, evidenceDirectory },
) {
  const { screen } = client;
  await openSettingsSection(screen, "open-host-version");
  const hostKey = await screen.attribute(
    '[data-iori-action="settings-host-select"]',
    "data-iori-host-key",
  );
  await screen.click('[data-iori-action="host-uninstall"]');
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector('[data-iori-action="host-maintenance-confirm"]')?.disabled === false`,
    ),
  );
  if (deleteData) await screen.click('[data-iori-field="host-uninstall-data"]');
  await screen.click('[data-iori-action="host-maintenance-confirm"]');
  const skip = '[data-iori-action="host-uninstall-without-ssh"]';
  const password = '[data-iori-field="ssh-answer"]';
  await waitFor(
    async () =>
      (await screen.visible(skip)) || (await screen.visible(password)),
  );
  if (!(await screen.visible(skip))) {
    // Some SSH servers offer password authentication after rejecting the key.
    await screen.input(password, "iori-verification-incorrect-password");
    await screen.click('[data-iori-action="ssh-answer"]');
    await screen.wait(skip);
  }
  assert.equal(await screen.visible('[data-iori-view="host-progress"]'), false);
  await writeFile(
    join(evidenceDirectory, "ssh-unavailable-before-uninstall.png"),
    Buffer.from(await client.browser.screenshot(), "base64"),
  );
  await screen.click('[data-iori-action="host-uninstall-without-ssh"]');
  await waitForUninstallNotice(
    screen,
    hostKey,
    /Started uninstalling|アンインストールを開始しました/u,
  );
  assert.equal(
    await screen.visible('[data-iori-action="host-notice-details"]'),
    false,
  );
  await writeFile(
    join(evidenceDirectory, "uninstall-started-without-ssh.png"),
    Buffer.from(await client.browser.screenshot(), "base64"),
  );
  await removed();
  assert.equal(
    await screen.visible(`[data-iori-host-key="${hostKey}"]`),
    false,
  );
  record("SSH authentication failed and uninstall started without SSH", {
    deleteData,
    removedFromList: true,
  });
}
