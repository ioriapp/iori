import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { waitFor } from "../../verification/ui.mjs";
import { openFolder, selectWorktree } from "../workspace/scenario.mjs";

export async function usageStatusScenario({
  client,
  repository,
  worktree,
  hostData,
  mobile,
  record,
}) {
  const screen = client.screen;
  await openFolder(screen, repository, false);
  await selectWorktree(screen, worktree, false);
  const item = '.usage-status-items .usage-item[aria-label^="Fixture Alpha"]';
  const popup = ".usage-status-popover";
  await screen.wait(item);
  assert.equal(await screen.text(`${item} .usage-number`), "25%");
  await screen.click(item);
  await screen.wait(popup);
  assert.match(await screen.text(popup), /5h.*25% used/su);
  assert.match(await screen.text(popup), /7d.*10% used/su);
  assert.match(await screen.text(`${popup} .usage-updated`), /最終更新/u);
  await screen.click(item);
  await waitFor(async () => !(await screen.visible(popup)));
  await screen.click(item);
  const reads = async () =>
    (await readFile(join(hostData, "fixture-alpha-reads"), "utf8"))
      .trim()
      .split("\n").length;
  const observed = () =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const key=connection.getSnapshot().host.publicKey;const result=await connection.requestHost(key,'cli.list',{});return result.result.clis.find(cli=>cli.id==='fixture-alpha')?.usage?.observedAt})()`,
    );
  const beforeReads = await reads();
  const beforeTime = await observed();
  await screen.click(`${popup} button[aria-label="利用枠を更新"]`);
  await waitFor(reads, (count) => count > beforeReads);
  await waitFor(observed, (at) => at > beforeTime);
  assert.match(await screen.text(`${popup} .usage-updated`), /最終更新/u);
  await screen.key("Escape");
  await screen.click('[data-iori-action="settings-open"]');
  await screen.click('[data-iori-action="settings-display"]');
  await screen.click('[data-iori-action="usage-display"]');
  await screen.key("Home");
  await screen.key("Enter");
  await screen.click('[data-iori-action="settings-close"]');
  await waitFor(
    () => screen.text(`${item} .usage-number`),
    (text) => text === "75%",
  );
  await screen.click(item);
  assert.match(await screen.text(popup), /5h.*75% left/su);
  await screen.key("Escape");
  await mobile({ width: 400, height: 900 });
  await screen.click(".usage-mobile-trigger");
  await screen.wait(popup);
  assert.match(await screen.text(popup), /Fixture Alpha/u);
  assert.match(await screen.text(popup), /Fixture Beta/u);
  await record("利用枠の表示・更新・残量への切替とスマホの全CLI表示");
}
