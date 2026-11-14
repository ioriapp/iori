import { startHostTest } from "../../../verification/host/process.mjs";
import { startBridge } from "../../../verification/web/bridge.mjs";
import { registerScriptedCli } from "../../../verification/host/scripted-definition.mjs";
import { forgeFixture } from "../../../verification/host/forge-fixture.mjs";
import {
  inviteToText,
  inviteFromText,
} from "../../../packages/protocol/src/index.ts";
import { clientRelease, hostRelease } from "./releases.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const cleanups = [];
const hosts = [],
  devices = [],
  terminals = new Map();
const t = {
  after: (cleanup) => cleanups.push(cleanup),
  diagnostic: (text) => console.error(text),
};
let clientUpdates;

async function addHost({ updates = false } = {}) {
  const update = updates
    ? await hostRelease(join(hosts[0].dataRoot, `release-${hosts.length}`))
    : undefined;
  if (update) cleanups.push(() => update.close());
  const started = performance.now();
  const host = await startHostTest(
    t,
    update
      ? {
          serviceBundle: update.bundle,
          environment: { NODE_EXTRA_CA_CERTS: update.ca },
        }
      : { distribution: process.env.IORI_UI_HOST_DISTRIBUTION },
  );
  const hostMs = performance.now() - started;
  const folder = join(host.dataRoot, "project");
  await mkdir(folder);
  const cliId = await registerScriptedCli(host.client, host.dataRoot);
  const invite = (await host.client.request("invite.create")).invite;
  const id = hosts.length;
  hosts.push({ ...host, source: host, update, folder, cliId, invite });
  return {
    id,
    folder,
    cliId,
    hostMs,
    hostKey: invite.hostKey,
    hostName: invite.hostName,
    updateVersion: update?.version,
    inviteText: inviteToText(invite),
  };
}
async function addDevice() {
  const deviceId = devices.length;
  const received = new Map(),
    displayed = new Map();
  const web = await startBridge({
    storageRoot: join(hosts[0].dataRoot, `client-${deviceId}`),
    origin: process.env.IORI_UI_WEB_URL,
    updateSource: clientUpdates?.source,
    updateDownload: Boolean(clientUpdates),
    onTerminalEvent(event) {
      if (event.stage === "receive") {
        const { frame } = event;
        if (frame.kind === "terminal.snapshot")
          received.set(
            event.streamId,
            frame.snapshot.scrollbackAnsi + frame.snapshot.snapshotAnsi,
          );
        if (frame.kind === "terminal.output")
          received.set(
            event.streamId,
            (received.get(event.streamId) ?? "") + frame.data,
          );
      } else if (event.stage === "ack" && event.waiting)
        displayed.set(event.terminalId, received.get(event.streamId) ?? "");
    },
  });
  devices.push({ web, displayed });
  return {
    deviceId,
    url:
      process.env.IORI_UI_WEB_URL +
      "?iori-bridge=" +
      encodeURIComponent(web.url),
  };
}
async function register({
  hostId = 0,
  deviceId = 0,
  fresh = false,
  text,
  name = "UI test",
} = {}) {
  const host = hosts[hostId];
  const invite = text
    ? inviteFromText(text)
    : fresh
      ? (await host.source.client.request("invite.create")).invite
      : host.invite;
  const ws = new WebSocket(devices[deviceId].web.url, {
    origin: process.env.IORI_UI_WEB_URL,
  });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  let next = 0;
  const call = (command, args) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      const receive = (data) => {
        const message = JSON.parse(String(data));
        if (message.id !== id) return;
        ws.off("message", receive);
        if (message.error) reject(new Error(message.error));
        else resolve(message.result);
      };
      ws.on("message", receive);
      ws.send(JSON.stringify({ id, command, args }));
    });
  try {
    const { connectionId } = await call("native_connect", {
      publicKey: invite.hostKey,
      addresses: invite.addresses,
    });
    const response = JSON.parse(
      await call("native_request", {
        connectionId,
        json: JSON.stringify({
          kind: "request",
          operationId: randomUUID(),
          method: "pair",
          params: { secret: invite.secret, deviceName: name },
        }),
      }),
    );
    if (!response.ok) throw new Error("Client registration failed");
    await call("native_save_host", {
      host: {
        ...response.result.host,
        publicKey: invite.hostKey,
        addresses: invite.addresses,
      },
      select: true,
    });
  } finally {
    ws.close();
    await new Promise((resolve) => ws.once("close", resolve));
  }
}
const methods = {
  async start({ updates = false } = {}) {
    const descriptor = await addHost();
    if (updates) {
      clientUpdates = await clientRelease();
      cleanups.push(() => clientUpdates.close());
    }
    return {
      ...descriptor,
      ...(await addDevice()),
      clientReleaseVersion: clientUpdates?.version,
    };
  },
  addHost,
  addDevice,
  register,
  request: ({ hostId = 0, method, params }) =>
    hosts[hostId].source.client.request(method, params),
  async input({ hostId = 0, terminalId, data }) {
    const key = `${hostId}:${terminalId}`;
    if (!terminals.has(key))
      terminals.set(
        key,
        await hosts[hostId].source.client.terminal(terminalId, {
          claimSize: false,
        }),
      );
    await terminals.get(key).input(data);
  },
  terminalText({ deviceId = 0, terminalId }) {
    return devices[deviceId].displayed.get(terminalId) ?? "";
  },
  async fault({ deviceId = 0, action, args }) {
    await devices[deviceId].web.faults[action](...args);
  },
  offline: ({ deviceId = 0, value }) => devices[deviceId].web.setOffline(value),
  async hostControl({ hostId = 0, action, stopDaemon = false }) {
    const source = hosts[hostId].source;
    for (const key of terminals.keys())
      if (key.startsWith(`${hostId}:`)) terminals.delete(key);
    if (action === "stop") await source.stop({ stopDaemon });
    if (action === "start") await source.start();
    if (action === "restart") {
      await source.stop({ stopDaemon });
      await source.start();
    }
  },
  async forge({ hostId = 0 }) {
    const host = hosts[hostId];
    const forge = await forgeFixture(t, host.dataRoot);
    forge.state.pull = true;
    const worktree = join(host.dataRoot, "feature");
    forge.git("worktree", "add", "-b", "feature", worktree);
    await host.source.client.request("forge.mapping.set", {
      remoteHost: new URL(forge.origin).host,
      webUrl: forge.origin,
    });
    return {
      origin: forge.origin,
      repository: forge.repository,
      worktree,
      token: forge.token,
    };
  },
  async files({ hostId = 0, files }) {
    for (const [name, text] of Object.entries(files))
      await writeFile(join(hosts[hostId].folder, name), text);
  },
  updates({ action, hostId }) {
    if (hostId !== undefined) hosts[hostId].update[action]();
    else clientUpdates[action]();
  },
  async close() {
    try {
      for (const device of devices) await device.web.close();
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup();
    }
  },
};
process.on("message", async ({ id, method, params }) => {
  try {
    process.send({ id, result: await methods[method](params) });
  } catch (error) {
    process.send({ id, error: error.stack });
  }
  if (method === "close") process.disconnect();
});
