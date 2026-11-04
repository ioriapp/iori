import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** Read only consumed text inputs, not shell output or terminal echoes.
 * Preserve the CLI attribution and sandbox policy without conversation data. */
export async function teamDeliverySummary(
  codexHome,
  claudeHome,
  notice,
  worker,
) {
  const workerNotice = worker && `[iori] ${worker.role} "${worker.title}" `;
  const summary = {
    initialHookDone: worker?.initialHookDone ?? false,
    claude: {
      initialReply: false,
      questionNotice: false,
      reportNotice: false,
      unreportedNotices: 0,
      pendingNotices: 0,
      ...(notice ? { noticeReceived: false } : {}),
    },
    codex: {
      initialReply: false,
      finalReplies: 0,
      childAnswer: false,
      policies: [],
    },
  };
  for (const [cli, root] of [
    ["claude", join(claudeHome, "projects")],
    ["codex", join(codexHome, "sessions")],
  ]) {
    const files = await readdir(root, { recursive: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const file of files.filter((name) => name.endsWith(".jsonl"))) {
      let pendingNotice = false;
      let workerSession = false;
      let initialRequest = false;
      let initialRequestSeen = false;
      for (const line of (await readFile(join(root, file), "utf8")).split(
        "\n",
      )) {
        let item;
        try {
          item = JSON.parse(line);
        } catch {
          continue; // The CLI can still be appending its final record.
        }
        if (cli === "codex" && item.type === "session_meta")
          workerSession = Boolean(
            worker?.sessionId && item.payload?.id === worker.sessionId,
          );
        if (cli === "claude" && item.sessionId)
          workerSession = Boolean(
            worker?.sessionId && item.sessionId === worker.sessionId,
          );
        if (
          cli === "claude" &&
          item.type === "assistant" &&
          !item.isSidechain &&
          item.message?.stop_reason === "end_turn"
        ) {
          pendingNotice = false;
        }
        if (cli === "codex" && item.type === "turn_context") {
          const policy = {
            sandbox: item.payload?.sandbox_policy?.type,
            networkAccess: item.payload?.sandbox_policy?.network_access,
            approval: item.payload?.approval_policy,
          };
          if (
            !summary.codex.policies.some(
              (p) => JSON.stringify(p) === JSON.stringify(policy),
            )
          )
            summary.codex.policies.push(policy);
        }
        const message =
          cli === "claude"
            ? ["user", "api-request-blob"].includes(item.type)
              ? item.message
              : undefined
            : item.type === "response_item" && item.payload?.type === "message"
              ? item.payload
              : undefined;
        if (
          cli === "codex" &&
          message?.role === "assistant" &&
          message.phase === "final_answer"
        ) {
          summary.codex.finalReplies++;
        }
        const reply = cli === "claude" ? item.message : message;
        const finalReply =
          cli === "claude"
            ? item.type === "assistant" &&
              !item.isSidechain &&
              reply?.stop_reason === "end_turn"
            : reply?.role === "assistant" && reply.phase === "final_answer";
        // Match the completed turn, not the model's spelling or punctuation.
        if (workerSession && initialRequest && finalReply)
          summary[cli].initialReply = true;
        if (message?.role !== "user") continue;
        const text =
          typeof message.content === "string"
            ? message.content
            : (message.content
                ?.filter((part) => ["text", "input_text"].includes(part.type))
                .map((part) => part.text)
                .join("\n") ?? "");
        const toolResultOnly =
          cli === "claude" &&
          item.type === "user" &&
          Array.isArray(message.content) &&
          message.content.length > 0 &&
          message.content.every((part) => part.type === "tool_result");
        if (
          workerSession &&
          (cli === "codex" || (item.type === "user" && !toolResultOnly))
        ) {
          initialRequest =
            !initialRequestSeen &&
            /^Open the file \S*delegation-[^\s]+\.md with your file-reading tool/u.test(
              text,
            ) &&
            text.includes("and follow the delegated request.");
          initialRequestSeen ||= initialRequest;
        }
        if (cli === "claude") {
          if (
            item.type === "user" &&
            text.includes("[iori] ") &&
            /\brun iori tasks\b/iu.test(text)
          )
            pendingNotice = true;
          if (
            notice &&
            item.type === "user" &&
            text.includes(notice.line) &&
            Date.parse(item.timestamp) >= notice.since
          ) {
            summary.claude.noticeReceived = true;
          }
          if (
            item.type === "user" &&
            workerNotice &&
            text.includes(
              workerNotice + "is idle without a report or question.",
            )
          )
            summary.claude.unreportedNotices++;
          if (workerNotice && text.includes(workerNotice + "asked a question."))
            summary.claude.questionNotice = true;
          if (workerNotice && text.includes(workerNotice + "reported."))
            summary.claude.reportNotice = true;
        } else if (text.includes("[iori] Parent answer: Open the file "))
          summary.codex.childAnswer = true;
      }
      if (cli === "claude" && pendingNotice) summary.claude.pendingNotices++;
    }
  }
  return summary;
}

/** Keep only CLI settings and acquisition counts; no prompt, response or auth data. */
export async function cliRecordSummary(
  codexHome,
  piSessions,
  { since = 0, claudeHome } = {},
) {
  const summary = {};
  for (const [cli, root] of [
    ["codex", join(codexHome, "sessions")],
    ["pi", piSessions],
    ["claude", claudeHome && join(claudeHome, "projects")],
  ]) {
    if (!root) continue;
    let files;
    try {
      files = await readdir(root, { recursive: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      files = [];
    }
    const models = new Set();
    const efforts = new Set();
    const turns = new Set();
    const policies = new Map();
    const tools = new Set();
    let records = 0;
    for (const file of files.filter((name) => name.endsWith(".jsonl"))) {
      if ((await stat(join(root, file))).birthtimeMs < since) continue;
      const content = await readFile(join(root, file), "utf8");
      if (!content.trim()) continue;
      records++;
      for (const line of content.trim().split("\n")) {
        let item;
        try {
          item = JSON.parse(line);
        } catch {
          continue; // An interrupted CLI can leave its last line incomplete.
        }
        if (cli === "codex" && item.type === "turn_context") {
          if (item.payload?.model) models.add(item.payload.model);
          if (item.payload?.effort) efforts.add(item.payload.effort);
          if (item.payload?.turn_id) turns.add(item.payload.turn_id);
          const policy = {
            sandbox: item.payload?.sandbox_policy?.type,
            approval: item.payload?.approval_policy,
          };
          policies.set(JSON.stringify(policy), policy);
        }
        if (
          cli === "codex" &&
          item.type === "response_item" &&
          ["function_call", "custom_tool_call"].includes(item.payload?.type)
        )
          tools.add(item.payload.name);
        if (cli === "claude") {
          // Claude writes zero-token <synthetic> assistant records on resume
          // and interruption. They identify a local message, not a model call.
          if (
            item.type === "assistant" &&
            item.message?.model &&
            item.message.model !== "<synthetic>"
          )
            models.add(item.message.model);
          if (
            item.type === "user" &&
            (typeof item.message?.content === "string" ||
              item.message?.content?.some?.((part) => part.type === "text"))
          )
            turns.add(item.uuid);
        }
        if (cli === "pi" && item.type === "message") {
          if (item.message?.role === "user") turns.add(item.id);
          if (item.message?.model)
            models.add(`${item.message.provider}/${item.message.model}`);
        }
      }
    }
    summary[cli] = { records, turns: turns.size, models: [...models] };
    if (cli === "codex") {
      summary[cli].efforts = [...efforts];
      summary[cli].policies = [...policies.values()];
      summary[cli].tools = [...tools];
    }
  }
  return summary;
}
