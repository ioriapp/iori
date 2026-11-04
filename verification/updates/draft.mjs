import assert from "node:assert/strict";
import { openSettingsSection } from "../../e2e/connection/scenario.mjs";
const action = (name) => `[data-iori-action="${name}"]`;
const surface = ".team-surface:not([hidden])";
const field = `${surface} [data-iori-field="team-name"]`;
const draft = "更新後にも残す下書き";
export async function writeDraft(screen) {
  await screen.key("Escape");
  await screen.click(action("open-agents-teams"));
  await screen.click(action("team-new"));
  await screen.click('[data-iori-template="development"]');
  await screen.click(action("team-create"));
  await screen.wait(`${surface} [data-iori-team-version="1"]`);
  const teamId = await screen.attribute(
    `${surface} ${action("team-overview")}`,
    "data-iori-team-id",
  );
  await screen.click(`${surface} ${action("team-overview")}`);
  await screen.input(field, draft);
  await openSettingsSection(screen, "settings-general");
  return teamId;
}
export async function assertDraft(screen, teamId) {
  await screen.click(action("open-agents-teams"));
  const overview = `${surface} [data-iori-action="team-overview"][data-iori-team-id="${teamId}"]`;
  if (!(await screen.visible(overview)))
    await screen.click(
      `${surface} .team-tree-team[data-iori-team-id="${teamId}"]`,
    );
  await screen.click(overview);
  assert.equal(await screen.value(field), draft);
}
