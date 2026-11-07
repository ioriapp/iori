import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openSettingsSection } from "../../e2e/connection/scenario.mjs";
import { openFolder } from "../../e2e/workspace/scenario.mjs";
import {
  create,
  observe,
  observed,
  typeTerminal,
} from "../../e2e/terminal/scenario.mjs";

export async function terminalAfterRemovalFailure(
  client,
  { cwd, record, evidenceDirectory },
) {
  const { screen } = client;
  await screen.wait(
    '[data-iori-view="host-maintenance-confirmation"] [role="alert"]',
  );
  await writeFile(
    join(evidenceDirectory, "removal-failed.png"),
    Buffer.from(await client.browser.screenshot(), "base64"),
  );
  assert.doesNotMatch(await screen.text("body"), /元に戻せませんでした/u);
  await screen.click('[data-iori-action="host-maintenance-close"]');
  await screen.click('[data-iori-action="settings-close"]');
  let usable = false;
  try {
    await openFolder(screen, cwd, false);
    await observe(client);
    await create(client);
    // Do not match the input echo: the output joins two words.
    await typeTerminal(client, 'echo IORI_RECOVERED_"TERMINAL"\r');
    await observed(client, "IORI_RECOVERED_TERMINAL");
    usable = true;
    await writeFile(
      join(evidenceDirectory, "terminal-recovered.png"),
      Buffer.from(await client.browser.screenshot(), "base64"),
    );
  } finally {
    record("terminal-after-failure", { usable });
  }
}

export async function removalFailureRecovery(client, options) {
  await openSettingsSection(client.screen, "open-host-version");
  await client.screen.click('[data-iori-action="host-uninstall"]');
  await client.screen.wait('[data-iori-action="host-maintenance-confirm"]');
  await client.screen.click('[data-iori-action="host-maintenance-confirm"]');
  if (options.answerPrompt) await options.answerPrompt();
  await terminalAfterRemovalFailure(client, options);
}
