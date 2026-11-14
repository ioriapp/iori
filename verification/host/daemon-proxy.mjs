import { createServer, connect } from "node:net";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

/** Hold replies at the real Host/daemon socket boundary; never replace handlers. */
export async function daemonProxy(dataRoot, { version } = {}) {
  const file = join(dataRoot, "iori-host/terminal-daemon/connection.json");
  const descriptor = JSON.parse(await readFile(file, "utf8"));
  const endpoint = join(dataRoot, "daemon-proxy.sock");
  const sockets = new Set();
  const requests = new Map();
  const events = [];
  const acknowledged = new Map();
  const waiters = new Set();
  let held;
  const server = createServer((host) => {
    const daemon = connect(descriptor.endpoint);
    for (const socket of [host, daemon]) {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => {
        sockets.delete(socket);
        host.destroy();
        daemon.destroy();
      });
    }
    function forward(source, target, fromHost) {
      let pending = Buffer.alloc(0);
      source.on("data", (bytes) => {
        pending = Buffer.concat([pending, bytes]);
        while (pending.length >= 4) {
          const length = pending.readUInt32BE(0);
          if (pending.length < length + 4) return;
          let frame = pending.subarray(0, length + 4);
          pending = pending.subarray(length + 4);
          const message = JSON.parse(frame.subarray(4).toString("utf8"));
          if (message.kind === "request")
            requests.set(`${fromHost}:${message.id}`, message.method);
          if (
            !fromHost &&
            message.kind === "request" &&
            message.method === "event"
          ) {
            events.push(message);
            for (const wake of waiters) wake();
          }
          if (fromHost && message.kind === "response") {
            acknowledged.set(message.id, message);
            for (const wake of waiters) wake();
          }
          if (
            !fromHost &&
            message.kind === "response" &&
            version !== undefined &&
            requests.get(`true:${message.id}`) === "hello"
          ) {
            message.value.version = version;
            const body = Buffer.from(JSON.stringify(message));
            const header = Buffer.alloc(4);
            header.writeUInt32BE(body.length);
            frame = Buffer.concat([header, body]);
          }
          if (
            message.kind === "response" &&
            held &&
            requests.get(`${!fromHost}:${message.id}`) === held.method
          ) {
            held.frame = () => target.write(frame);
            held.ready();
          } else target.write(frame);
        }
      });
    }
    forward(host, daemon, true);
    forward(daemon, host, false);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, resolve);
  });
  await writeFile(file, JSON.stringify({ ...descriptor, endpoint }), {
    mode: 0o600,
  });
  return {
    hold(method) {
      let ready;
      const reached = new Promise((resolve) => {
        ready = resolve;
      });
      held = { method, ready };
      return reached;
    },
    release() {
      const current = held;
      held = undefined;
      current?.frame?.();
    },
    async event(kind) {
      for (;;) {
        const event = events.find((message) => message.args[0].kind === kind);
        if (event)
          return {
            ...event.args[0],
            acknowledged: () => acknowledged.has(event.id),
            async completed() {
              while (!acknowledged.has(event.id))
                await new Promise((resolve) => {
                  const wake = () => {
                    waiters.delete(wake);
                    resolve();
                  };
                  waiters.add(wake);
                });
              return acknowledged.get(event.id);
            },
          };
        await new Promise((resolve) => {
          const wake = () => {
            waiters.delete(wake);
            resolve();
          };
          waiters.add(wake);
        });
      }
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      const current = await readFile(file, "utf8").then(
        JSON.parse,
        () => undefined,
      );
      if (current?.endpoint === endpoint)
        await writeFile(file, JSON.stringify(descriptor), { mode: 0o600 });
      await rm(endpoint, { force: true });
    },
  };
}
