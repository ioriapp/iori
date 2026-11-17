import { readFile } from "node:fs/promises";
import { request } from "node:http";

/** A fresh file read per approval lets surviving CLIs find the restarted Host. */
export async function approvalRequest(payload, signal) {
  try {
    const { url } = JSON.parse(
      await readFile(process.env.IORI_CLI_APPROVAL_FILE, "utf8"),
    );
    const target = new URL(url);
    if (target.protocol !== "http:" || target.hostname !== "127.0.0.1") return;
    return await new Promise((resolve) => {
      const req = request(
        target,
        {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.once("end", () => {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve();
            }
          });
          res.once("error", () => resolve({ accepted: true }));
          res.once("aborted", () => resolve({ accepted: true }));
        },
      );
      req.once("error", () => resolve());
      req.end(JSON.stringify(payload));
    });
  } catch {
    /* Outside iori or after shutdown: leave the decision to the CLI. */
  }
}
