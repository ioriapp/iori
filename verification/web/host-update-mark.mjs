import assert from "node:assert/strict";
import {
  openSettingsSection,
  register,
} from "../../e2e/connection/scenario.mjs";
import { waitFor } from "../ui.mjs";

export async function hostUpdateMark({
  client,
  invitation,
  additionalHost,
  record,
}) {
  const { screen } = client;
  const picker = '[data-iori-action="settings-host-select"]';
  const mark = '[data-iori-state="update-available"]';
  await register(screen, invitation, "Host A");
  const hostA = await screen.attribute(picker, "data-iori-host-key");
  await register(screen, await additionalHost(), "Host B");
  const hostB = await screen.attribute(picker, "data-iori-host-key");
  assert.notEqual(hostA, hostB);
  await screen.wait(`${picker} ${mark}`);
  await screen.click(picker);
  await screen.click(
    `[role="option"][data-iori-host-key=${JSON.stringify(hostA)}]`,
  );
  await waitFor(
    () => screen.attribute(picker, "data-iori-host-key"),
    (key) => key === hostA,
  );
  assert.equal(
    await screen.visible(`${picker} ${mark}`),
    false,
    "最新のHostの選択欄に更新の点を出さない",
  );
  await screen.click(picker);
  const option = (key) =>
    `[role="option"][data-iori-host-key=${JSON.stringify(key)}] ${mark}`;
  assert.equal(await screen.visible(option(hostA)), false);
  assert.equal(await screen.visible(option(hostB)), true);
  await screen.click(
    `[role="option"][data-iori-host-key=${JSON.stringify(hostB)}]`,
  );
  await screen.click('[data-iori-action="settings-close"]');
  await screen.wait(`[data-iori-action="settings-open"] ${mark}`);
  await openSettingsSection(screen, "open-connection");
  await screen.click('[data-iori-action="host-forget"]');
  await screen.click('[data-iori-action="host-forget-confirm"]');
  await waitFor(
    () => screen.attribute(picker, "data-iori-host-key"),
    (key) => key === hostA,
  );
  await screen.click('[data-iori-action="settings-close"]');
  assert.equal(
    await screen.visible(`[data-iori-action="settings-open"] ${mark}`),
    false,
    "外したHostの更新の点を設定入口に残さない",
  );
  await record("選択したHostと一覧の更新の点、外したHostの点の消去");
}
