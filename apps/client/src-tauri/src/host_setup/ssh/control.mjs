// Runs with the destination Host's bundled Node. Never print the control token.
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const method = process.argv[1];
try {
  const { port, token } = JSON.parse(
    await readFile(
      join(
        process.env.XDG_DATA_HOME || join(homedir(), ".local/share"),
        "iori-host/control.json",
      ),
      "utf8",
    ),
  );
  const result = await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let received = Buffer.alloc(0);
    socket.on("error", reject);
    socket.on("connect", () => {
      const body = Buffer.from(
        JSON.stringify({
          token,
          operationId: randomUUID(),
          method,
          params: {},
        }),
      );
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length);
      socket.end(Buffer.concat([header, body]));
    });
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.length < 4 || received.length < received.readUInt32BE(0) + 4)
        return;
      try {
        resolve(
          JSON.parse(
            received.subarray(4, received.readUInt32BE(0) + 4).toString(),
          ),
        );
      } catch (error) {
        reject(error);
      }
      socket.destroy();
    });
    socket.on("end", () =>
      reject(new Error("Host closed the connection without a response")),
    );
  });
  process.stdout.write(
    `IORI_SETUP ${JSON.stringify({ type: "control", ...result })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `IORI_SETUP ${JSON.stringify({ type: "control", ok: false, error: { message: error.message } })}\n`,
  );
}
