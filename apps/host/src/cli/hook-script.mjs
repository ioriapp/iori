// Lifecycle delivery follows Orca's managed hook scripts, without spool/retry.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ./ORCA-LICENSE.txt.
import { request } from "node:http";

// The event when the CLI does not name it in the payload, a reply that the
// CLI requires, and the `id` of the CLI whose settings hold this hook. An
// argument that is not there is `-`: Windows PowerShell drops an empty
// argument that it passes on to another command, which would move the
// arguments after it into its place (docs/design/cli-definitions.md「hooks」).
// A command written before commands carried the `id` has no third argument.
const [eventArgument, replyArgument, cli] = process.argv.slice(2);
const event = eventArgument === "-" ? undefined : eventArgument;
const reply = replyArgument === "-" ? undefined : replyArgument;
// CLI-owned neutral replies must also work outside iori, before reading stdin.
if (reply)
  process.stdout.write(Buffer.from(reply, "base64url").toString("utf8") + "\n");
// Windows callers can leave stdin open outside iori. POSIX callers close it;
// consume the whole pipe there so a large payload cannot fail with EPIPE.
if (process.platform === "win32" && !process.env.IORI_CLI_HOOK_URL)
  process.exit(0);
let input = "";
for await (const chunk of process.stdin) input += chunk;
if (!process.env.IORI_CLI_HOOK_URL) process.exit(0);
try {
  const payload = JSON.parse(input || "{}");
  if (event) payload.hook_event_name = event;
  // A Terminal takes only its own CLI's hooks: a CLI can also run the hooks
  // that iori wrote for another CLI (Grok reads Claude Code's settings).
  if (cli) payload.iori_cli = cli;
  if (process.env.IORI_CLI_HOOK_ADAPTER) {
    const adapter = await import(process.env.IORI_CLI_HOOK_ADAPTER);
    await adapter.preparePayload(payload);
  }
  await new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = request(
      process.env.IORI_CLI_HOOK_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.once("end", resolve);
        res.once("error", resolve);
        res.once("aborted", resolve);
        res.once("close", resolve);
        res.resume();
      },
    );
    req.once("error", resolve);
    req.once("close", resolve);
    req.end(body);
  });
} catch {
  /* Observing a CLI must never decide its permissions or break it. */
}
