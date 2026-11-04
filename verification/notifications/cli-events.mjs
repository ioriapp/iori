import { execFile } from "node:child_process";
import { promisify } from "node:util";
// Native notification E2E fixture. Emits recorded hook shapes through the real
// loopback receiver; no model or simulated OS notification is involved.
import { request } from "node:http";
import { watch, readFile, writeFileSync } from "node:fs";
const folder = process.argv[2];
const url = process.env.IORI_CLI_HOOK_URL;
let serial = Promise.resolve();
const post = (payload) =>
  new Promise((resolve) => {
    if (!url) {
      resolve();
      return;
    }
    // The fixture stands in for Codex, whose hooks carry its id.
    const body = JSON.stringify({ ...payload, iori_cli: "codex" });
    const call = request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        res.once("end", () => {
          writeFileSync(
            folder + "/last-post.json",
            JSON.stringify({
              event: payload.hook_event_name,
              status: res.statusCode,
            }),
          );
          resolve();
        });
      },
    );
    call.once("error", resolve);
    call.end(body);
  });
await post({
  hook_event_name: "SessionStart",
  session_id: "native-notification-fixture",
});
process.stdout.write("iori notification fixture ready\r\n");
watch(folder, (_event, filename) => {
  if (filename !== "event.json") return;
  serial = serial.then(
    () =>
      new Promise((resolve) => {
        readFile(folder + "/event.json", "utf8", async (_error, content) => {
          if (content) {
            let payload;
            try {
              payload = JSON.parse(content);
            } catch {
              /* The next fixture write completes the JSON. */
              resolve();
              return;
            }
            if (payload.delegation) {
              try {
                const output = await promisify(execFile)("iori", [
                  "delegate",
                  "--role",
                  "Worker",
                  "--difficulty",
                  "low",
                  "--title",
                  "Candidate notification",
                  "--worktree",
                  "parent",
                  "--body",
                  "Check candidate availability.",
                  "--json",
                ]);
                writeFileSync(folder + "/delegation.json", output.stdout);
              } catch (error) {
                writeFileSync(
                  folder + "/delegation-error.json",
                  JSON.stringify({
                    failed: true,
                    code: error.code ?? null,
                    stderr: error.stderr ?? "",
                    stdout: error.stdout ?? "",
                  }),
                );
              }
            } else await post(payload);
          }
          resolve();
        });
      }),
  );
});
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", (data) => {
  if (data.includes(3)) process.exit(0);
});
