// Lifecycle delivery follows Orca's managed hook scripts, without spool/retry.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ./ORCA-LICENSE.txt.
import { open, readFile, unlink } from "node:fs/promises";
import { request } from "node:http";
import { approvalRequest } from "./approval-client.mjs";

// The event when the CLI does not name it in the payload, a reply that the
// CLI requires, and the `id` of the CLI whose settings hold this hook. An
// argument that is not there is `-`: Windows PowerShell drops an empty
// argument that it passes on to another command, which would move the
// arguments after it into its place (docs/design/cli-definitions.md「hooks」).
// A command written before commands carried the `id` has no third argument.
const [eventArgument, replyArgument, cli] = process.argv.slice(2);
const event = eventArgument === "-" ? undefined : eventArgument;
const reply = replyArgument === "-" ? undefined : replyArgument;
const {
  IORI_CLI_HOOK_URL: url,
  IORI_CLI_HOOK_INSTRUCTION_FILE: instructionFile,
  IORI_CLI_HOOK_INSTRUCTION_EVENT: instructionEvent,
  IORI_CLI_HOOK_INSTRUCTION_FORMAT: format,
  IORI_CLI_HOOK_INSTRUCTION_ONCE: oncePath,
  IORI_CLI_HOOK_INSTRUCTION_CLI: instructionCli,
} = process.env;
const mayDeliver =
  url &&
  instructionFile &&
  instructionEvent &&
  (!event || event === instructionEvent) &&
  (!cli || cli === instructionCli);
const defaultReply = reply && Buffer.from(reply, "base64url").toString("utf8");

const responses = {
  "inject-steps": (text) => ({
    injectSteps: [{ systemMessage: { systemMessage: text } }],
  }),
  "additional-context": (text) => ({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: text,
    },
  }),
  message: (text) => ({ message: text }),
  context: (text) => ({ context: text }),
  "additional-context-snake-case": (text) => ({
    hook_specific_output: { additional_context: text },
  }),
  stdout: (text) => text,
};
async function instructionReply() {
  const formatter = responses[format];
  if (!formatter) return;
  let claimed = false;
  let content;
  try {
    if (oncePath) {
      await (await open(oncePath, "wx")).close();
      claimed = true;
    }
    content = await readFile(instructionFile, "utf8");
    if (!content) return;
    const result = formatter(content);
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch {
    // A concurrent or later hook finds the marker. File errors also leave
    // the CLI's normal reply and status delivery intact.
  } finally {
    if (claimed && !content) await unlink(oncePath).catch(() => {});
  }
}
// Outside team instruction delivery some CLIs need a reply before closing stdin.
if (!mayDeliver && defaultReply) process.stdout.write(defaultReply + "\n");
// Windows callers can leave stdin open outside iori. POSIX callers close it;
// consume the whole pipe there so a large payload cannot fail with EPIPE.
if (process.platform === "win32" && !url) process.exit(0);
let input = "";
for await (const chunk of process.stdin) input += chunk;
if (!url) process.exit(0);
let payload;
try {
  payload = JSON.parse(input || "{}");
} catch {
  if (mayDeliver && defaultReply) process.stdout.write(defaultReply + "\n");
  process.exit(0);
}
try {
  if (mayDeliver) {
    const instruction =
      payload && (event ?? payload.hook_event_name) === instructionEvent
        ? await instructionReply()
        : undefined;
    const output = instruction ?? defaultReply;
    if (output) process.stdout.write(output + "\n");
  }
  if (event) payload.hook_event_name = event;
  // A Terminal takes only its own CLI's hooks: a CLI can also run the hooks
  // that iori wrote for another CLI (Grok reads Claude Code's settings).
  if (cli) payload.iori_cli = cli;
  if (process.env.IORI_CLI_HOOK_ADAPTER) {
    const adapter = await import(process.env.IORI_CLI_HOOK_ADAPTER);
    if ((await adapter.preparePayload(payload)) === false) process.exit(0);
  }
  if (
    payload.hook_event_name === "PermissionRequest" &&
    payload.tool_name !== "AskUserQuestion" &&
    process.env.IORI_CLI_APPROVAL_FILE
  ) {
    const result = await approvalRequest(payload);
    if (result?.decision === "allow" || result?.decision === "deny") {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PermissionRequest",
            decision: { behavior: result.decision },
          },
        }) + "\n",
      );
    }
    if (result?.accepted || result?.decision) process.exit(0);
  }
  await new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = request(
      url,
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
