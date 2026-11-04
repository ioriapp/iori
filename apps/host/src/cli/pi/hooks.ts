import { otherHostUses } from "../hook-hosts.ts";
import { removeHookFile } from "../hook-files.ts";
// Derived from Orca agent-status-handler-source.ts / ui-prompt-source.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ../ORCA-LICENSE.txt.
import { dirname, join } from "node:path";
import { writeText } from "../hook-config.ts";
import {
  cliFailure,
  toolActivity,
  toolFinished,
  toolInput,
  attention,
  text,
  type CliHooks,
} from "../hooks.ts";
const path = (home: string) =>
  join(
    process.env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent"),
    "extensions",
    "iori-agent-status.ts",
  );
const source = `// Copyright (c) 2026 Lovecast Inc.; MIT license accompanies iori Host (cli/ORCA-LICENSE.txt).
import { request } from 'node:http';
export default function(pi) {
  const url = process.env.IORI_CLI_HOOK_URL;
  if (!url) return;
  let serial = Promise.resolve();
  let running = false;
  let prompts = 0;
  let model;
  let response;
  let failed = false;
  let errorMessage;
  let stopReason;
  const post = (hook_event_name, extra = {}) => {
    serial = serial.then(() => new Promise(resolve => {
      const body = JSON.stringify({hook_event_name, iori_cli:'pi', ...(model ? {model:model.provider+"/"+model.id} : {}), ...extra});
      const req = request(url, {method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}}, res => {
        res.once('end',resolve);res.once('error',resolve);res.once('aborted',resolve);res.once('close',resolve);res.resume();
      });
      req.once('error',resolve);req.once('close',resolve);req.end(body);
    })).catch(() => {});
  };
  pi.on('session_start', (event, ctx) => { model = ctx.model; if (event.reason !== 'reload') { running = false; prompts = 0; post('session_start', {session_id:ctx.sessionManager.getSessionId(),session_file:ctx.sessionManager.getSessionFile()}); } });
  pi.on('model_select', (event, ctx) => { model = ctx.model ?? event.model; post('model_select'); });
  pi.on('before_agent_start', () => { running = true; response = undefined; failed = false; errorMessage = undefined; stopReason = undefined; post('before_agent_start'); });
  pi.on('agent_start', () => { running = true; prompts = 0; post('agent_start'); });
  pi.on('tool_call', event => post('tool_call', {tool_name:event.toolName,tool_input:event.input,toolCallId:event.toolCallId}));
  pi.on('tool_execution_end', event => { if (!prompts) post('tool_execution_end', {toolCallId:event.toolCallId}); });
  pi.on('ui_prompt_start', event => { if (++prompts === 1) post('ui_prompt_start', {tool_input:{question:event.title},prompt_kind:event.kind}); });
  pi.on('ui_prompt_end', (_event, ctx) => { if (prompts && --prompts === 0) post('ui_prompt_end', {is_idle:ctx.isIdle()}); });
  pi.on('message_end', event => {
    if (event.message?.role !== 'assistant') return;
    response = event.message.content?.filter(part => part.type === 'text').map(part => part.text).join('');
    stopReason = event.message.stopReason;
    failed = stopReason === 'error';
    errorMessage = event.message.errorMessage;
  });
  pi.on('agent_settled', event => { running = false; if (!prompts) post(event.aborted ? 'agent_aborted' : 'agent_end', {last_assistant_message:response, failed, errorMessage, stopReason}); });
  pi.on('session_shutdown', () => post('session_shutdown'));
}
`;
export const hooks: CliHooks = {
  isSessionStart: (payload) => payload.hook_event_name === "session_start",
  async install(ctx) {
    const target = path(ctx.home);
    await writeText(target, source);
  },
  async remove(ctx) {
    if (
      ctx.writtenPath &&
      (await otherHostUses(dirname(ctx.writtenPath), ctx.id))
    )
      return;
    await removeHookFile(path(ctx.home));
  },
  normalize(payload, _previous, cwd) {
    const event = payload.hook_event_name;
    if (event === "session_start") return { state: "idle" };
    if (event === "agent_end" && payload.failed === true)
      return cliFailure(payload.errorMessage);
    if (event === "agent_aborted") return { state: "stopped" };
    if (event === "session_shutdown") return { state: "stopped" };
    if (
      event === "ui_prompt_start" ||
      (event === "tool_call" &&
        ["ask", "ask_user_question", "AskUserQuestion"].includes(
          String(payload.tool_name),
        ))
    )
      return attention(
        payload.prompt_kind === "confirm" ? "approval" : "question",
        payload.tool_name,
        payload.tool_input,
      );
    if (event === "tool_execution_end") return toolFinished(payload.toolCallId);
    if (event === "tool_call") {
      const tool = payload.tool_name;
      const input = payload.tool_input;
      const fields = toolInput(input);
      return toolActivity(
        tool,
        {
          command: tool === "bash" ? fields.command : undefined,
          path: ["read", "edit", "write"].includes(String(tool))
            ? fields.path
            : undefined,
          search: ["grep", "find"].includes(String(tool))
            ? fields.pattern
            : undefined,
        },
        cwd,
        payload.toolCallId,
      );
    }
    if (
      event === "agent_end" ||
      (event === "ui_prompt_end" && payload.is_idle === true)
    )
      return {
        state: "done",
        response: text(payload.last_assistant_message),
      };
    if (
      [
        "before_agent_start",
        "agent_start",
        "tool_call",
        "tool_execution_end",
        "ui_prompt_end",
      ].includes(String(event))
    )
      return { state: "active", activity: { kind: "thinking" } };
    return undefined;
  },
};
