import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openSettingsSection } from "../../e2e/connection/scenario.mjs";
import { waitFor } from "../ui.mjs";

// Both native runners use this exact UI operation; filesystem assertions stay
// with the OS runner and never substitute a success response into the Client.
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
  // The real Windows Client WebView captures iori even behind an OS dialog.
  const capture = async (name) =>
    writeFile(
      join(evidenceDirectory, name + ".png"),
      Buffer.from(await client.browser.screenshot(), "base64"),
    );
  await openSettingsSection(screen, "open-host-version");
  await screen.click('[data-iori-action="host-uninstall"]');
  await screen.wait('[data-iori-view="host-maintenance-confirmation"]');
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
  if (deleteData) await screen.click('[data-iori-field="host-uninstall-data"]');
  if (activeTerminal) await screen.wait("[data-iori-maintenance-working]");
  await capture(
    deleteData ? "delete-data-confirmation" : "keep-data-confirmation",
  );
  await screen.click('[data-iori-action="host-maintenance-confirm"]');
  let cancelledRead = false;
  let manualRead = false;
  async function answerRemovalPrompt() {
    await screen.wait('[data-iori-field="ssh-answer"]');
    assert.equal(
      await screen.visible(
        '[data-iori-view="host-maintenance-confirmation"] [data-iori-field="ssh-answer"]',
      ),
      true,
    );
    assert.match(
      await screen.attribute('[data-iori-field="ssh-answer"]', "aria-label"),
      /Password for|Passphrase for|のパスワード|のパスフレーズ/u,
    );
    assert.match(
      await screen.text('[data-iori-action="ssh-cancel"]'),
      /Cancel|キャンセル/u,
    );
    if (!cancelledRead) {
      await screen.click('[data-iori-action="ssh-cancel"]');
      await waitFor(
        () => screen.visible('[data-iori-field="ssh-answer"]'),
        (visible) => !visible,
      );
      await waitFor(() =>
        screen.evaluate(
          `document.querySelector('[data-iori-action="host-uninstall-result"]')?.disabled === false`,
        ),
      );
      record("uninstall-ssh-read-cancelled", true);
      cancelledRead = true;
      manualRead = true;
      await screen.click('[data-iori-action="host-uninstall-result"]');
      await screen.wait('[data-iori-field="ssh-answer"]');
    }
    await answerPrompt();
    await waitFor(
      () => screen.visible('[data-iori-field="ssh-answer"]'),
      (visible) => !visible,
    );
    record("uninstall-ssh-answer-closed", true);
  }
  if (answerPrompt) await answerRemovalPrompt();
  await removed();
  let guidanceShown = false;
  // A read that raced with the final OS write is explicitly repeatable.
  if (
    answerPrompt &&
    (await screen.visible('[data-iori-action="host-uninstall-result"]'))
  ) {
    await waitFor(() =>
      screen.evaluate(
        `document.querySelector('[data-iori-action="host-uninstall-result"]')?.disabled !== true`,
      ),
    );
    if (
      answerPrompt &&
      (await screen.visible('[data-iori-action="host-uninstall-result"]'))
    ) {
      guidanceShown = await screen.visible(
        '[data-iori-state="host-uninstall-result-missing"]',
      );
      manualRead = true;
      await screen.click('[data-iori-action="host-uninstall-result"]');
      if (answerPrompt) await answerRemovalPrompt();
    }
  }
  await screen.wait('[data-iori-state="uninstall-complete"]');
  assert.equal(
    await screen.visible('[data-iori-action="settings-close"]'),
    false,
  );
  assert.equal(await screen.visible('[data-iori-view="host-version"]'), false);
  if (answerPrompt)
    record("ssh-uninstall-result-source", {
      deleteData,
      source: manualRead ? "manual" : "automatic",
      guidanceShown,
    });
  await capture(deleteData ? "delete-data-result" : "keep-data-result");
  record(
    deleteData ? "uninstalled-with-data" : "uninstalled-keeping-data",
    true,
  );
}
