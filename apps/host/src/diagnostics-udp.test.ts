import assert from "node:assert/strict";
import { test } from "node:test";
import {
  observeReceiveQueue,
  parseUdpReceiveQueues,
  type ReceiveQueueState,
} from "./diagnostics-udp.ts";

test("/proc/net/udp と udp6 の実際の列から port・rx_queue・inode を読む", () => {
  // Captured from Linux /proc/net/udp and udp6. Non-zero queue bytes use
  // the same hexadecimal tx_queue:rx_queue column as the kernel output.
  assert.deepEqual(
    parseUdpReceiveQueues(`
   sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops
12118: 0100007F:A52D 00000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 47400346 2 00000000f040dba7 0
19004: 00000000:C013 00000000:0000 07 00000000:00000A00 00:00000000 00000000     0        0 234861511 2 00000000f7b0df87 0
`),
    [
      { port: 42285, inode: "47400346", bytes: 0 },
      { port: 49171, inode: "234861511", bytes: 2560 },
    ],
  );
  assert.deepEqual(
    parseUdpReceiveQueues(`
  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops
19004: 00000000000000000000000000000000:C013 00000000000000000000000000000000:0000 07 00000000:000003C0 00:00000000 00000000     0        0 234861512 2 00000000ec03a69b 0
`),
    [{ port: 49171, inode: "234861512", bytes: 960 }],
  );
  assert.deepEqual(
    parseUdpReceiveQueues("\nnot a proc row\n19004: 00000000:C013"),
    [],
  );
});

test("正の受信量が横ばい・減少でも3回続いたら通知し、0への復帰で再び観測する", () => {
  let state: ReceiveQueueState | undefined;
  const observations = [
    0, 69184, 69184, 69184, 69184, 69184, 960, 0, 0, 2880, 1920, 960,
  ].map((bytes) => {
    const next = observeReceiveQueue(state, bytes);
    state = next.state;
    return next.event;
  });
  assert.deepEqual(observations, [
    undefined,
    undefined,
    undefined,
    "stuck",
    undefined,
    undefined,
    undefined,
    "drained",
    undefined,
    undefined,
    undefined,
    "stuck",
  ]);
});

test("0を挟むと正の受信量の連続回数を数え直し、通知前の0復帰は記録しない", () => {
  let state: ReceiveQueueState | undefined;
  const events = [960, 960, 0, 960, 0, 0, 960, 960, 960].map((bytes) => {
    const next = observeReceiveQueue(state, bytes);
    state = next.state;
    return next.event;
  });
  assert.deepEqual(events, [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "stuck",
  ]);
});
