import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { openFolder, selectWorktree } from "../workspace/scenario.mjs";
import { create } from "../terminal/scenario.mjs";
import { openAgents, returnToWorktree } from "./agents-navigation.mjs";

const alpha = "fixture-alpha";
const beta = "fixture-beta";
const matches = (screen, selector, attribute, expected) =>
  waitFor(
    () =>
      screen.evaluate(
        `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map(e=>e.getAttribute(${JSON.stringify(attribute)})).filter(id=>${JSON.stringify([alpha, beta])}.includes(id))`,
      ),
    (actual) => JSON.stringify(actual) === JSON.stringify(expected),
  );

export async function cliOrderScenario({
  client,
  repository,
  worktree,
  phone,
  restartHostLosingTerminals,
  reload,
  record,
}) {
  const screen = client.screen;
  await openFolder(screen, repository, false);
  await selectWorktree(screen, worktree, false);
  await create(client);
  const other = await phone();
  await other.browser.viewport({ width: 1440, height: 1000 });
  await openFolder(other.screen, repository, false);
  await selectWorktree(other.screen, worktree, false);
  await openAgents(other.screen);
  await openAgents(screen);
  const rows = "[data-iori-cli-row]";
  await matches(other.screen, rows, "data-iori-cli-row", [alpha, beta]);
  const grip = `[data-iori-cli-row="${beta}"] [data-iori-action="cli-reorder"]`;
  await screen.reveal(grip);
  await screen.evaluate(
    `document.querySelector(${JSON.stringify(grip)}).focus()`,
  );
  await screen.key("ArrowUp");
  await matches(other.screen, rows, "data-iori-cli-row", [beta, alpha]);
  await returnToWorktree(other.screen, worktree);
  const statusOrder = () =>
    other.screen.evaluate(
      `Array.from(document.querySelectorAll('.usage-status-items .usage-item')).map(e=>e.getAttribute('aria-label')).filter(v=>v?.startsWith('Fixture ')).map(v=>v.startsWith('Fixture Alpha')?'${alpha}':'${beta}')`,
    );
  await waitFor(
    statusOrder,
    (order) => JSON.stringify(order) === JSON.stringify([beta, alpha]),
  );
  await other.screen.click('[data-iori-action="workspace-add-tab"]');
  await matches(
    other.screen,
    '.new-items-popover[data-state="open"] [data-iori-cli-id]',
    "data-iori-cli-id",
    [beta, alpha],
  );
  await other.screen.key("Escape");
  await restartHostLosingTerminals();
  await reload();
  await openAgents(screen);
  await matches(screen, rows, "data-iori-cli-row", [beta, alpha]);
  assert.deepEqual(await statusOrder(), [beta, alpha]);
  await record("CLIのキーボード並べ替えを別画面とHost再起動後に保持");
}
