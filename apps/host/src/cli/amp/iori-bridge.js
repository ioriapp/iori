// iori's bridge for Amp (docs/design/cli-definitions.md「プラグインだけを持つ CLI」).
// Amp runs this plugin in its own process. It sends the state of a thread to
// the hook URL that iori puts in the environment of its Terminal, and does
// nothing when Amp was started outside iori.
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
  amp.on("agent.start", (event) => send("active", thread(event)));
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
