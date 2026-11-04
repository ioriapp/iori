import { readdir, readFile, readlink } from "node:fs/promises";
import type { HostDiagnostics } from "./diagnostics.ts";
import {
  observeReceiveQueue,
  parseUdpReceiveQueues,
  type ReceiveQueueState,
} from "./diagnostics-udp.ts";

export function watchUdpReceiveQueues(
  sockets: string[],
  diagnostics: HostDiagnostics,
): () => void {
  if (process.platform !== "linux") return () => {};
  const ports = new Set(
    sockets.map((socket) => Number(socket.slice(socket.lastIndexOf(":") + 1))),
  );
  const states = new Map<string, ReceiveQueueState>();
  let reading = false;
  let closed = false;
  async function sample(): Promise<void> {
    if (reading || closed) return;
    reading = true;
    try {
      const descriptors = await readdir("/proc/self/fd");
      const links = await Promise.all(
        descriptors.map((fd) =>
          readlink(`/proc/self/fd/${fd}`).catch(() => ""),
        ),
      );
      const inodes = new Set(
        links.flatMap((link) => {
          const match = /^socket:\[(\d+)\]$/.exec(link);
          return match ? [match[1]] : [];
        }),
      );
      for (const [family, path] of [
        ["ipv4", "/proc/net/udp"],
        ["ipv6", "/proc/net/udp6"],
      ]) {
        const contents = await readFile(path, "utf8").catch(() => undefined);
        if (contents === undefined || closed) continue;
        for (const queue of parseUdpReceiveQueues(contents)) {
          if (!inodes.has(queue.inode) || !ports.has(queue.port)) continue;
          const observation = observeReceiveQueue(
            states.get(queue.inode),
            queue.bytes,
          );
          states.set(queue.inode, observation.state);
          if (observation.event)
            diagnostics.record(
              `udp-receive-queue-${observation.event}`,
              {
                family,
                port: queue.port,
                bytes: queue.bytes,
              },
              `udp-receive-queue-${observation.event}-${family}`,
            );
        }
      }
    } catch {
      // /proc may be unavailable or restricted. This is only an observation.
    } finally {
      reading = false;
    }
  }
  const timer = setInterval(() => void sample(), 10_000);
  timer.unref();
  return () => {
    closed = true;
    clearInterval(timer);
  };
}
