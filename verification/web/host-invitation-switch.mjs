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
  record,
}) {
  const screen = client.screen;
  const picker = '[data-iori-action="settings-host-select"]';
  await register(screen, invitation, "開発用Chromium");
  const hostA = await screen.attribute(picker, "data-iori-host-key");
  await register(screen, await additionalHost(), "追加Host用Chromium");
  const hostB = await screen.attribute(picker, "data-iori-host-key");
  assert.notEqual(hostA, hostB);
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
