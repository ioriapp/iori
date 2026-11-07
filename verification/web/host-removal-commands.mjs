import { createConnection } from "node:net";
import { readFile, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  FrameDecoder,
  decodeFrame,
  encodeFrame,
} from "../../packages/protocol/src/index.ts";
// Substitute only the desktop local-control/filesystem boundary. Host responses
// and deletion results come from the actual packaged Host and its OS worker.
export function removalCommands(onResponse) {
  return {
    async native_host_setup_status() {
      const root = process.env.XDG_DATA_HOME;
      if (!root) return null;
      const control = await readFile(
        join(root, "iori-host/control.json"),
        "utf8",
      )
        .then(JSON.parse)
        .catch(() => undefined);
      if (!control) return null;
      const socket = createConnection({
        host: "127.0.0.1",
        port: control.port,
      });
      try {
        await new Promise((resolve, reject) => {
          socket.once("connect", resolve);
          socket.once("error", reject);
        });
        socket.end(
          Buffer.from(
            encodeFrame({
              token: control.token,
              operationId: randomUUID(),
              method: "host.info",
              params: {},
            }),
          ),
        );
        const decoder = new FrameDecoder();
        for await (const chunk of socket)
          for (const frame of decoder.push(chunk)) {
            const value = decodeFrame(frame);
            if (value.ok) return { installed: true, host: value.result };
          }
        return null;
      } finally {
        socket.destroy();
      }
    },
    async native_host_uninstall_result({ hostKey, operationId, remove }) {
      const name =
        createHash("sha256")
          .update(JSON.stringify([hostKey, operationId]))
          .digest("hex") + ".json";
      const file = join(process.env.XDG_DATA_HOME, "iori-host-uninstall", name);
      const value = await readFile(file, "utf8")
        .then(JSON.parse)
        .catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      if (!value) return null;
      onResponse?.(
        "host.uninstall.result",
        JSON.stringify({ ok: true, result: value.status }),
      );
      if (remove) await rm(file);
      return value.status;
    },
  };
}
