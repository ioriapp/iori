// iori's hook for omp (docs/design/cli-definitions.md「プラグインだけを持つ CLI」).
// omp loads this module in its own process. It sends the state of a session to
// the hook URL that iori puts in the environment of its Terminal, and does
// nothing when omp was started outside iori.
const url = process.env.IORI_CLI_HOOK_URL;

export default function ioriBridge(pi) {
  if (!url) return;
  let serial = Promise.resolve();
  const toolInputs = new Map();
  const send = (state, extra = {}) => {
    // Order is kept, but a slow iori must not hold omp's turn open.
    serial = serial
      .then(async () => {
        const body = JSON.stringify({
          iori: 1,
          iori_cli: "omp",
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
  const conversation = (ctx) => {
    const manager = ctx && ctx.sessionManager;
    if (!manager) return {};
    const id = manager.getSessionId();
    const file = manager.getSessionFile();
    return {
      ...(typeof id === "string" && id ? { sessionId: id } : {}),
      ...(typeof file === "string" && file ? { transcript: file } : {}),
    };
  };
  // The session's usage is cumulative over its assistant messages, which is
  // what iori shows for a conversation.
  const usage = (ctx) => {
    const stats =
      ctx && ctx.sessionManager && ctx.sessionManager.getUsageStatistics
        ? ctx.sessionManager.getUsageStatistics()
        : undefined;
    const counts = {};
    for (const field of ["input", "output", "cacheRead", "cacheWrite"]) {
      const value = stats ? stats[field] : undefined;
      if (typeof value === "number" && Number.isFinite(value) && value >= 0)
        counts[field] = value;
    }
    return typeof counts.input === "number" && typeof counts.output === "number"
      ? { tokens: counts }
      : {};
  };
  const model = (event) => {
    const messages =
      event && Array.isArray(event.messages) ? event.messages : [];
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (
        message &&
        message.role === "assistant" &&
        typeof message.model === "string" &&
        message.model
      )
        return { model: message.model };
    }
    return {};
  };
  pi.on("session_start", (_event, ctx) =>
    send("idle", { ...conversation(ctx) }),
  );
  pi.on("agent_start", (_event, ctx) =>
    send("active", { ...conversation(ctx) }),
  );
  pi.on("tool_call", (event) => {
    if (event && typeof event.toolCallId === "string")
      toolInputs.set(event.toolCallId, event.input);
  });
  pi.on("tool_execution_end", (event) => {
    if (event) toolInputs.delete(event.toolCallId);
  });
  pi.on("tool_approval_requested", (event, ctx) =>
    send("waiting", {
      ...conversation(ctx),
      attention: {
        kind: "approval",
        ...(event && typeof event.toolName === "string"
          ? { tool: event.toolName }
          : {}),
        ...(event && toolInputs.has(event.toolCallId)
          ? { input: toolInputs.get(event.toolCallId) }
          : {}),
      },
    }),
  );
  pi.on("tool_approval_resolved", (event, ctx) => {
    if (event) toolInputs.delete(event.toolCallId);
    send("active", { ...conversation(ctx) });
  });
  pi.on("agent_end", (event, ctx) => {
    toolInputs.clear();
    // An automatic continuation is still the same response.
    if (event && event.willContinue) {
      send("active", { ...conversation(ctx) });
      return;
    }
    send("done", {
      ...conversation(ctx),
      ...usage(ctx),
      ...model(event),
    });
  });
  pi.on("session_shutdown", (_event, ctx) => {
    toolInputs.clear();
    send("stopped", { ...conversation(ctx) });
  });
}
