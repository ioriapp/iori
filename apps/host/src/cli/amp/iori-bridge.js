// iori's bridge for Amp (docs/design/cli-definitions.md「プラグインだけを持つ CLI」).
// Amp runs this plugin in its own process. It sends the state of a thread to
// the hook URL that iori puts in the environment of its Terminal, and does
// nothing when Amp was started outside iori.
import { readFile } from "node:fs/promises";

const url = process.env.IORI_CLI_HOOK_URL;

export default function ioriBridge(amp) {
  if (!url) return;
  let serial = Promise.resolve();
  const send = (state, extra = {}) => {
    // Order is kept, but a slow iori must not hold Amp's turn open.
    serial = serial
      .then(async () => {
        const body = JSON.stringify({
          iori: 1,
          iori_cli: "amp",
          state,
          ...extra,
        });
        await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
      })
      .catch(() => {});
  };
  const thread = (event) =>
    event && event.thread && typeof event.thread.id === "string"
      ? { sessionId: event.thread.id }
      : {};
  amp.on("session.start", (event) => send("idle", thread(event)));
  let delivered = false;
  amp.on("agent.start", async (event) => {
    send("active", thread(event));
    const file = process.env.IORI_CLI_HOOK_INSTRUCTION_FILE;
    if (!file || delivered) return;
    delivered = true;
    try {
      const content = await readFile(file, "utf8");
      if (content) return { message: { content, display: false } };
    } catch {
      // Keep the status notification when the instruction file is unavailable.
    }
  });
  // `tool.call` expects a result; iori does not use that event. `agent.start`
  // already sends the active state.
  amp.on("tool.result", (event) => send("active", thread(event)));
  amp.on("agent.end", (event) =>
    send(
      "done",
      event && event.status === "error"
        ? { ...thread(event), outcome: "failure" }
        : thread(event),
    ),
  );
}
