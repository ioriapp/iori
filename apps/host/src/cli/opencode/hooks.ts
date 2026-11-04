import { otherHostUses } from "../hook-hosts.ts";
import { removeHookFile } from "../hook-files.ts";
// Derived from Orca status-plugin-lifecycle-source.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ../ORCA-LICENSE.txt.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  cliFailure,
  toolActivity,
  toolFinished,
  toolInput,
  patchPath,
  attention,
  object,
  type CliHooks,
} from "../hooks.ts";
const path = (home: string) =>
  join(
    process.env.XDG_CONFIG_HOME ?? join(home, ".config"),
    "opencode",
    "plugins",
    "iori-status.js",
  );
const source = `// Copyright (c) 2026 Lovecast Inc.; MIT license accompanies iori Host (cli/ORCA-LICENSE.txt).
import { request } from 'node:http';
const sender = (waiting = new Set()) => {
  const url = process.env.IORI_CLI_HOOK_URL;
  let serial = Promise.resolve();
  return (hook_event_name, extra = {}) => {
    if (!url) return;
    serial = serial.then(() => new Promise(resolve => {
      const body = JSON.stringify({hook_event_name, iori_cli:'opencode', ...extra, waiting:waiting.size});
      const req = request(url,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
        res.once('end',resolve);res.once('error',resolve);res.once('aborted',resolve);res.once('close',resolve);res.resume();
      });
      req.once('error',resolve);req.once('close',resolve);req.end(body);
    })).catch(()=>{});
  };
};
const v1 = async () => {
  const url = process.env.IORI_CLI_HOOK_URL;
  const waiting = new Set();
  const roots = new Map();
  const errors = new Map();
  const post = sender(waiting);
  return {
    config: async (config) => {
    const directory = process.env.IORI_TEAM_FILES_DIRECTORY;
    if (!directory) return;
    const permission = typeof config.permission === 'string'
      ? { '*': config.permission } : (config.permission ?? {});
    const external = permission.external_directory;
    config.permission = {
      ...permission,
      external_directory: {
        ...(typeof external === 'string' ? { '*': external } : external),
        [directory.replaceAll(String.fromCharCode(92), '/') + '/**']: 'allow',
      },
    };
    },
    'tool.execute.before': async (input, output) => {
      const args = output.args || {};
      post('tool.execute.before', { tool_name:input.tool, callID:input.callID, tool_input:{
        command:args.command, filePath:args.filePath, pattern:args.pattern,
        patchText:typeof args.patchText === 'string' ? args.patchText.split('\\n').filter(line => /^\\*\\*\\* (Add File|Update File|Delete File|Move to): /.test(line)).join('\\n') : undefined,
      }});
    },
    'tool.execute.after': async input => { post('tool.execute.after', {callID:input.callID}); },
    event: ({event}) => {
    if (!url) return;
    const p = event.properties || {};
    const e = event.type;
    if (e === 'session.created' || e === 'session.updated') {
      if (p.info?.id) roots.set(p.info.id, !p.info.parentID);
      return;
    }
    if (e === 'session.error' || e === 'session.status') {
      // Only known subagents are excluded. A resumed session may precede
      // this plugin instance; an unknown lineage must not suppress its idle.
      if (roots.get(p.sessionID) === false) return;
      if (e === 'session.error' && !p.sessionID) return;
      if (e === 'session.error') {
        errors.set(p.sessionID, {name:p.error?.name, data:{message:p.error?.data?.message}});
        return;
      }
      if (p.status?.type === 'busy') errors.delete(p.sessionID);
      if (p.status?.type === 'idle') {
        const error = errors.get(p.sessionID);
        errors.delete(p.sessionID);
        waiting.clear();
        post(e, {sessionID:p.sessionID, status:p.status, error});
        return;
      }
    }
    if (e === 'permission.asked' || e === 'question.asked') waiting.add(p.id);
    if (e === 'permission.replied' || e === 'question.replied' || e === 'question.rejected') waiting.delete(p.requestID);
    if (waiting.size && e === 'session.status' && p.status?.type !== 'idle') return;
    if (e === 'message.part.updated' && p.part?.type === 'tool' && p.part.state?.status === 'error') { post('tool.execute.after', {callID:p.part.callID}); return; }
    if (!['permission.asked','permission.replied','question.asked','question.replied','question.rejected','session.status'].includes(e)) return;
    post(e, p);
  }};
};

export default {
  id: 'iori-status',
  server: v1,
  async setup(ctx) {
    const directory = process.env.IORI_TEAM_FILES_DIRECTORY;
    if (directory) {
      // Session rules take precedence over agent/global defaults in V2.
      const resource = directory.replaceAll(String.fromCharCode(92), '/') + '/**';
      const configured = new Set();
      await ctx.session.hook('prompt', async ({sessionID}) => {
        if (configured.has(sessionID)) return;
        const session = await ctx.session.get({sessionID});
        await ctx.session.update({sessionID, permissions:[
          ...(session.permissions ?? []),
          {action:'external_directory', resource, effect:'allow'},
        ]});
        configured.add(sessionID);
      });
    }
    if (!process.env.IORI_CLI_HOOK_URL) return;
    const legacy = await v1();
    const post = sender();
    const roots = new Map();
    const tools = new Map();
    const commands = new Map();
    const questions = new Set();
    const interrupted = new Set();
    const controller = new AbortController();
    const emit = (type, properties) => legacy.event({event:{type, properties}});
    void (async () => {
      for await (const event of ctx.event.subscribe({signal:controller.signal})) {
        const p = event.data || {};
        const e = event.type;
        if (e === 'session.created') {
          roots.set(p.sessionID, !p.parentID);
          emit('session.created', {info:{id:p.sessionID, parentID:p.parentID}});
        }
        const sessionID = p.sessionID ?? p.form?.sessionID;
        if (roots.get(sessionID) === false) continue;
        if (e === 'session.created' || e === 'session.model.selected' || e === 'session.execution.started') {
          post('session.metadata', {iori:1, sessionId:p.sessionID,
            model:p.model ? p.model.providerID + '/' + p.model.id : undefined});
        }
        if (e === 'session.execution.started') {
          interrupted.delete(sessionID);
          emit('session.status', {sessionID, status:{type:'busy'}});
        }
        if (e === 'session.execution.succeeded') emit('session.status', {sessionID:p.sessionID, status:{type:'idle'}});
        if (e === 'session.execution.failed') {
          emit('session.error', {sessionID:p.sessionID, error:{name:p.error?.type, data:{message:p.error?.message}}});
          emit('session.status', {sessionID:p.sessionID, status:{type:'idle'}});
        }
        if (e === 'session.execution.interrupted') {
          interrupted.add(sessionID);
          emit('session.error', {sessionID, error:{name:'MessageAbortedError'}});
          emit('session.status', {sessionID, status:{type:'idle'}});
        }
        if (e === 'session.status' && !interrupted.has(sessionID)) emit(e, {sessionID, status:{type:p.status?.type}});
        if (e === 'permission.asked') {
          const command = p.action === 'shell' ? commands.get(p.source?.id) : undefined;
          emit(e, {id:p.id, sessionID:p.sessionID, permission:p.action,
            patterns:command === undefined ? p.resources : [command]});
        }
        if (e === 'permission.replied') emit(e, {requestID:p.requestID, sessionID:p.sessionID});
        if (e === 'form.created' && p.form?.metadata?.kind === 'question') {
          questions.add(p.form.id);
          emit('question.asked', {id:p.form.id, sessionID});
        }
        if (e === 'form.replied' && questions.delete(p.id)) emit('question.replied', {requestID:p.id, sessionID});
        if (e === 'form.cancelled' && questions.delete(p.id)) emit('question.rejected', {requestID:p.id, sessionID});
        if (e === 'session.tool.input.started') {
          tools.set(p.id, p.name);
          await legacy['tool.execute.before']({tool:p.name, callID:p.id}, {args:{}});
        }
        if (e === 'session.tool.called') {
          if (typeof p.input?.command === 'string') commands.set(p.id, p.input.command);
          await legacy['tool.execute.before']({tool:tools.get(p.id), callID:p.id}, {args:p.input});
        }
        if (e === 'session.tool.success' || e === 'session.tool.failed') {
          tools.delete(p.id);
          commands.delete(p.id);
          await legacy['tool.execute.after']({callID:p.id});
        }
      }
    })().catch(() => {});
    return () => controller.abort();
  },
};
`;
export const hooks: CliHooks = {
  async install(ctx) {
    const target = path(ctx.home);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source, { mode: 0o600 });
  },
  async remove(ctx) {
    if (
      ctx.writtenPath &&
      (await otherHostUses(dirname(ctx.writtenPath), ctx.id))
    )
      return;
    await removeHookFile(path(ctx.home));
  },
  normalize(payload, previous, cwd) {
    const event = payload.hook_event_name;
    if (event === "permission.asked")
      return attention("approval", payload.permission, {
        command: Array.isArray(payload.patterns)
          ? payload.patterns.join(" · ")
          : undefined,
      });
    if (event === "question.asked")
      return attention("question", undefined, payload);
    if (
      ["permission.replied", "question.replied", "question.rejected"].includes(
        String(event),
      )
    )
      return payload.waiting ? undefined : { state: "active" };
    if (event === "tool.execute.after")
      return previous?.state === "waiting"
        ? undefined
        : toolFinished(payload.callID);
    if (event === "tool.execute.before") {
      if (previous?.state === "waiting") return undefined;
      const tool = payload.tool_name;
      const input = payload.tool_input;
      const fields = toolInput(input);
      return toolActivity(
        tool,
        {
          command: ["bash", "shell"].includes(String(tool))
            ? fields.command
            : undefined,
          path: ["read", "edit", "write", "apply_patch", "patch"].includes(
            String(tool),
          )
            ? (fields.filePath ?? patchPath(fields.patchText))
            : undefined,
          search: ["grep", "glob"].includes(String(tool))
            ? fields.pattern
            : undefined,
        },
        cwd,
        payload.callID,
      );
    }
    if (event === "session.status") {
      const status = object(payload.status).type;
      if (status === "idle" && payload.error) {
        const error = object(payload.error);
        if (error.name === "MessageAbortedError") return { state: "stopped" };
        return cliFailure(object(error.data).message, error.name);
      }
      if (status === "idle" && previous?.outcome === "failure")
        return undefined;
      if (status === "idle")
        return previous ? { state: "done" } : { state: "idle" };
      if (status === "busy" || status === "retry")
        return {
          state: "active",
          activity:
            previous?.state === "active"
              ? (previous.activity ?? { kind: "thinking" })
              : { kind: "thinking" },
        };
    }
    return undefined;
  },
};
