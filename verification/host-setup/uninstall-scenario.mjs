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
  if (answerPrompt) await answerPrompt();
  await removed();
  let manualRead = false;
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
      if (answerPrompt) await answerPrompt();
    }
  }
  if (deleteData)
    await waitFor(
      () => screen.visible('[data-iori-view="host-version"]'),
      (visible) => !visible,
    );
  else await screen.wait('[data-iori-state="host-succeeded"]');
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
