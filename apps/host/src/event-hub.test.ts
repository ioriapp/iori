import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { decodeFrame, type Event } from "@iori/protocol";
import { EventHub } from "./event-hub.ts";

function receiver(hub: EventHub, writable?: Promise<void>) {
  const received: unknown[] = [];
  let resets = 0;
  const subscription = hub.addSubscription(
    {},
    {
      async write(frame) {
        received.push(decodeFrame(frame.subarray(4)));
        await writable;
      },
      async reset() {
        resets++;
      },
    },
  );
  return { subscription, received, resets: () => resets };
}

const change = (id: string): Event => ({
  type: "cli.order.changed",
  order: [id],
});

test("a subscription receives snapshots and published changes in send order", async () => {
  const hub = new EventHub();
  const firstWrite = Promise.withResolvers<void>();
  const client = receiver(hub, firstWrite.promise);
  const snapshot: Event = {
    type: "snapshot",
    host: { hostName: "test", publicKey: "host", addresses: [] },
    currentDevicePublicKey: "client",
    devices: [],
  };
  const first = hub.send(client.subscription, snapshot);
  hub.publish(change("two"));
  const last = hub.send(client.subscription, change("three"));
  await setImmediate();
  assert.deepEqual(client.received, [snapshot]);
  firstWrite.resolve();
  await Promise.all([first, last]);
  assert.deepEqual(client.received, [snapshot, change("two"), change("three")]);
});

for (const [limit, burst, value] of [
  ["event count", 300, "small"],
  ["frame bytes", 8, "長".repeat(260_000)],
] as const) {
  test(`a blocked subscription exceeding the ${limit} limit drops its backlog while its peer keeps receiving`, async () => {
    const hub = new EventHub();
    const blocked = Promise.withResolvers<void>();
    const slow = receiver(hub, blocked.promise);
    const fast = receiver(hub);
    const event = change(value);
    for (let i = 0; i < burst; i++) {
      hub.publish(event);
      await setImmediate();
    }
    assert.equal(slow.resets(), 1);
    blocked.resolve();
    hub.publish(change("after overflow"));
    await setImmediate();
    assert.equal(slow.received.length, 1);
    assert.equal(fast.resets(), 0);
    assert.equal(fast.received.length, burst + 1);
    assert.deepEqual(fast.received.at(-1), change("after overflow"));
  });
}

test("invite status is sent once per subscription and local waiters see only their invite", async () => {
  const hub = new EventHub();
  const first = receiver(hub);
  const notifications: Event[] = [];
  const status: Event = {
    type: "invite.status",
    operationId: "a",
    status: "expired",
  };
  const remove = hub.waitForInvite("a", (event) => notifications.push(event));
  hub.publish(status);
  const later = receiver(hub);
  await hub.send(later.subscription, status);
  await hub.send(first.subscription, status);
  hub.publish({ ...status, operationId: "b" });
  const registered: Event = {
    type: "device.registered",
    inviteOperationId: "a",
    device: { publicKey: "client", name: "Client", registeredAt: 1 },
  };
  hub.publish(registered);
  remove();
  hub.publish(status);
  await setImmediate();
  assert.deepEqual(notifications, [status, registered]);
  assert.deepEqual(first.received, [
    status,
    { ...status, operationId: "b" },
    registered,
  ]);
  assert.deepEqual(later.received, first.received);
});
