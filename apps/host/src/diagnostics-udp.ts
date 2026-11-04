export interface UdpReceiveQueue {
  port: number;
  inode: string;
  bytes: number;
}

// /proc/net/udp and udp6 use the same columns; the address width differs.
export function parseUdpReceiveQueues(contents: string): UdpReceiveQueue[] {
  const queues: UdpReceiveQueue[] = [];
  for (const line of contents.split("\n")) {
    const fields = line.trim().split(/\s+/);
    const local = /^[\da-f]+:([\da-f]{4})$/i.exec(fields[1] ?? "");
    const queue = /^[\da-f]+:([\da-f]+)$/i.exec(fields[4] ?? "");
    const inode = fields[9];
    if (!local || !queue || !inode || !/^\d+$/.test(inode)) continue;
    queues.push({
      port: parseInt(local[1], 16),
      inode,
      bytes: parseInt(queue[1], 16),
    });
  }
  return queues;
}

export interface ReceiveQueueState {
  nonzeroSamples: number;
  reported: boolean;
}

export function observeReceiveQueue(
  previous: ReceiveQueueState | undefined,
  bytes: number,
): { state: ReceiveQueueState; event?: "stuck" | "drained" } {
  const nonzeroSamples = bytes > 0 ? (previous?.nonzeroSamples ?? 0) + 1 : 0;
  const stuck = nonzeroSamples >= 3 && !previous?.reported;
  const drained = bytes === 0 && previous?.reported;
  return {
    state: {
      nonzeroSamples,
      reported: bytes > 0 && (Boolean(previous?.reported) || stuck),
    },
    event: stuck ? "stuck" : drained ? "drained" : undefined,
  };
}
