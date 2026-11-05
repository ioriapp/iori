import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import addon from "../../apps/host/native/index.js";
import {
  decodeFrame,
  encodeFrame,
  FrameDecoder,
  inviteFromText,
} from "../../packages/protocol/src/index.ts";
import {
  invite,
  openSettingsSection,
  register,
  registrationNotice,
} from "../../e2e/connection/scenario.mjs";
import { waitFor } from "../ui.mjs";

async function pairDevice(text) {
  const invitation = inviteFromText(text);
  const identity = addon.generateIdentity();
  const endpoint = await addon.Endpoint.bind(identity.secretKey, [
    "127.0.0.1:0",
  ]);
  identity.secretKey.fill(0);
  try {
    const connection = await endpoint.connect(
      Buffer.from(invitation.hostKey, "hex"),
      invitation.addresses,
    );
    const stream = await connection.openBi();
    await stream.write(
      Buffer.from(
        encodeFrame({
          kind: "request",
          method: "pair",
          operationId: randomUUID(),
          params: { secret: invitation.secret, deviceName: "招待した端末" },
        }),
      ),
    );
    await stream.finish();
    const decoder = new FrameDecoder();
    for (;;) {
      const chunk = await stream.read(65536);
      if (chunk === null) throw new Error("登録の応答がありません");
      for (const frame of decoder.push(chunk)) {
        assert.equal(decodeFrame(frame).ok, true);
        return;
      }
    }
  } finally {
    await endpoint.close();
  }
}

export async function hostInvitationSwitch({
  client,
  invitation,
  additionalHost,
  reload,
  record,
}) {
  const screen = client.screen;
  const picker = '[data-iori-action="settings-host-select"]';
  await register(screen, invitation, "開発用Chromium");
  const hostA = await screen.attribute(picker, "data-iori-host-key");
  await register(screen, await additionalHost(), "追加Host用Chromium");
  const hostB = await screen.attribute(picker, "data-iori-host-key");
  assert.notEqual(hostA, hostB);
  // Reload restores the saved registration order before any manual sorting.
  await reload();
  await screen.wait('[data-iori-view="workspace"]');
  const sidebarHosts = () =>
    screen.evaluate(
      `Array.from(document.querySelectorAll('.nav-host-title')).map(e=>e.dataset.ioriHostKey)`,
    );
  const settingsHosts = async () => {
    await screen.click(picker);
    const keys = await screen.evaluate(
      `Array.from(document.querySelectorAll('[role="option"][data-iori-host-key]')).map(e=>e.dataset.ioriHostKey)`,
    );
    await screen.key("Escape");
    return keys;
  };
  const expectedHosts = [hostA, hostB];
  await waitFor(sidebarHosts, (keys) => keys.length === 2);
  assert.deepEqual(await sidebarHosts(), expectedHosts);
  await openSettingsSection(screen, "open-devices");
  assert.deepEqual(await settingsHosts(), expectedHosts);
  await screen.click('[data-iori-action="settings-close"]');
  const savedActiveHost = () =>
    screen.evaluateAsync(
      "import('/src/native-platform-web.ts').then(({invoke}) => invoke('native_initial_state', {language: 'ja', mobile: false})).then(state => state.activeHostKey)",
    );
  await screen.click(
    `[data-iori-action="host-settings-open"][data-iori-host-key=${JSON.stringify(hostA)}]`,
  );
  await waitFor(savedActiveHost, (key) => key === hostA);
  await screen.click('[data-iori-action="settings-close"]');
  await screen.click(
    `[data-iori-action="host-settings-open"][data-iori-host-key=${JSON.stringify(hostB)}]`,
  );
  await waitFor(savedActiveHost, (key) => key === hostB);
  assert.deepEqual(await sidebarHosts(), expectedHosts);
  await openSettingsSection(screen, "open-devices");
  assert.deepEqual(await settingsHosts(), expectedHosts);
  await reload();
  await screen.wait('[data-iori-view="workspace"]');
  await waitFor(sidebarHosts, (keys) => keys.length === 2);
  assert.deepEqual(await sidebarHosts(), expectedHosts);
  await openSettingsSection(screen, "open-devices");
  assert.equal(await screen.attribute(picker, "data-iori-host-key"), hostB);
  assert.deepEqual(await settingsHosts(), expectedHosts);
  await record("未並べ替えのHost順を画面の切替とClient再読込後も保持");
  async function select(key) {
    await screen.click(picker);
    await screen.click(
      `[role="option"][data-iori-host-key=${JSON.stringify(key)}]`,
    );
    await waitFor(
      () => screen.attribute(picker, "data-iori-host-key"),
      (value) => value === key,
    );
  }
  async function noInvitation() {
    assert.equal(await screen.visible('[data-iori-view="invitation"]'), false);
    assert.equal(
      await screen.visible('[data-iori-field="issued-invitation"]'),
      false,
    );
    assert.equal(
      await screen.visible('[data-iori-action="undo-registration"]'),
      false,
    );
  }
  await select(hostA);
  await invite(screen);
  await select(hostB);
  await noInvitation();
  await select(hostA);
  const issued = await invite(screen);
  await pairDevice(issued);
  await registrationNotice(screen, "招待した端末");
  await select(hostB);
  await noInvitation();
  await record("Host切替後は前のHostの招待と登録案内を表示しない");
}
