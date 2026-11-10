import { hostHookItems, otherHostUses } from "./hook-hosts.ts";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  editHookFile,
  readConfig,
  removeOwnHookFile,
  targetPath,
  writeOwnHookFile,
  writeText,
} from "./hook-config.ts";
import { removeHookFile } from "./hook-files.ts";
import {
  hookSyntax,
  ownHookFile,
  type HookPlace,
  type HookSyntax,
} from "./hook-documents.ts";
import {
  attention,
  cliFailure,
  text,
  toolActivity,
  toolFinished,
  type CliHooks,
  type HookInstallContext,
  type HookPayload,
  type HookState,
} from "./hooks.ts";
import { readCommonHook } from "./common-hook.ts";
import {
  definitionPath,
  fillArguments,
  type DefinitionFileHooks,
  type DefinitionHooks,
  type DefinitionPluginHooks,
  type DefinitionRule,
} from "./definition-file.ts";

/** The hooks files that this Host wrote for each definition, so only those
 * are cleaned when the definition goes or the Host is removed. Each Host
 * keeps its record in its own storage, beside its `cli-definitions/`. */
export const writtenPath = (root: string) =>
  join(root, "cli-definition-hooks.json");
/** `own`: the `base` of iori's own file, which tells it from the user's.
 * `copy`: the hash of a plugin file that this Host placed. */
type Written = Record<
  string,
  {
    file: string;
    own?: Record<string, unknown>;
    copy?: { sha256: string };
    link?: HookLink & { created: boolean };
  }
>;
interface HookLink {
  file: string;
  base: Record<string, unknown>;
  set: Record<string, unknown>;
}
/** Resolve the settings that point to iori's own hooks file. */
export function hooksLink(
  hooks: DefinitionHooks,
  home: string,
): HookLink | undefined {
  if (hooks.format === "plugin-file" || !hooks.link) return undefined;
  const file = definitionPath(hooks.file, home);
  const fill = (value: unknown): unknown => {
    if (typeof value === "string") return value.replaceAll("{file}", file);
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, fill(item)]),
      );
    return value;
  };
  return {
    file: definitionPath(hooks.link.file, home),
    base: hooks.link.base,
    set: fill(hooks.link.set) as Record<string, unknown>,
  };
}
const digest = (content: string) =>
  createHash("sha256").update(content).digest("hex");
const copyName = (file: string) => file.split(/[\\/]/u).at(-1)!;
/** The file that a definition's hooks change or add, under `home`. */
export function hooksTarget(
  hooks: DefinitionHooks,
  home: string,
  id: string,
): string {
  return hooks.format === "plugin-file"
    ? "args" in hooks.install
      ? join(home, ".iori/hooks", id, hooks.install.copy)
      : join(
          definitionPath(hooks.install.to, home),
          copyName(hooks.install.copy),
        )
    : definitionPath(hooks.file, home);
}
/** The copied bridge's stable path is shared by launch and confirmation. */
export function pluginArguments(
  id: string,
  hooks: DefinitionHooks | undefined,
  home: string,
): string[] {
  return hooks?.format === "plugin-file" && "args" in hooks.install
    ? fillArguments(hooks.install.args, {
        plugin: hooksTarget(hooks, home, id),
      })
    : [];
}
let writing: Promise<void> = Promise.resolve();
/** Settings files that several CLIs write are changed one change at a time. */
function serially(task: () => Promise<void>): Promise<void> {
  const next = writing.then(task);
  writing = next.catch(() => {});
  return next;
}
const readWritten = async (path?: string) =>
  path ? ((await readConfig(path)) as Written) : {};
async function saveWritten(path: string, written: Written) {
  if (Object.keys(written).length)
    await writeText(path, JSON.stringify(written, null, 2) + "\n");
  else await removeHookFile(path);
}

/** A CLI's hooks file and where its items go in it. */
export interface HookTarget {
  file: string;
  syntax: HookSyntax;
  place: HookPlace;
  /** iori's command names the event: the rules match the events as the
   * file names them, which the CLI's payload may name otherwise. */
  namesEvent: boolean;
  /** iori's own file: what it holds besides iori's items. */
  own?: Record<string, unknown>;
  link?: HookLink;
}
/** Claude Code's settings: `hooks.<event>[].hooks[]`, as Claude Code,
 * Codex, Qoder and CodeBuddy read them. */
const claudeSettings: HookPlace = {
  format: "events",
  at: ["hooks"],
  entry: (event, command) => ({
    hooks: [{ type: "command", command }],
    ...(event.includes("ToolUse") || event === "PermissionRequest"
      ? { matcher: "*" }
      : {}),
  }),
};
export const claudeSettingsTarget = (file: string): HookTarget => ({
  file,
  syntax: "json",
  place: claudeSettings,
  namesEvent: false,
});
/** `{event}` and `{command}` in the strings of a definition's item. */
function filled(value: unknown, event: string, command: string): unknown {
  if (typeof value === "string")
    return value.replace(/\{(event|command)\}/gu, (_match, key: string) =>
      key === "event" ? event : command,
    );
  if (Array.isArray(value))
    return value.map((item) => filled(item, event, command));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      filled(item, event, command),
    ]),
  );
}
export function definitionTarget(
  hooks: DefinitionFileHooks,
  home: string,
): HookTarget {
  const { entry } = hooks;
  return {
    file: definitionPath(hooks.file, home),
    syntax: hooks.syntax,
    place: entry
      ? {
          format: hooks.format === "list" ? "list" : "events",
          at: hooks.at,
          entry: (event, command) => filled(entry, event, command),
        }
      : claudeSettings,
    namesEvent: hooks.format !== "claude-settings",
    ...(hooks.own ? { own: hooks.own } : {}),
    ...(hooks.link ? { link: hooksLink(hooks, home) } : {}),
  };
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function removeFrom(
  id: string,
  entry: Written[string],
  record?: string,
): Promise<void> {
  // A copied plugin file goes only when it is still the file iori placed.
  if (entry.copy) {
    await hostHookItems(record, id, entry.file);
    if (record && (await otherHostUses(dirname(record), undefined, entry.file)))
      return;
    const content = await readText(entry.file);
    if (content !== undefined && digest(content) === entry.copy.sha256)
      await removeHookFile(entry.file);
    return;
  }
  const syntax = hookSyntax(entry.file);
  if (!syntax) return;
  if (
    entry.link &&
    !(record && (await otherHostUses(dirname(record), undefined, entry.file)))
  ) {
    const content = await readText(entry.link.file);
    if (content !== undefined) {
      const value = await readConfig(entry.link.file);
      let changed = false;
      for (const [key, expected] of Object.entries(entry.link.set)) {
        if (
          Object.hasOwn(value, key) &&
          isDeepStrictEqual(value[key], expected)
        ) {
          delete value[key];
          changed = true;
        }
      }
      if (entry.link.created && isDeepStrictEqual(value, entry.link.base)) {
        await removeHookFile(await targetPath(entry.link.file));
        await removeHookFile(entry.link.file + ".iori-created");
      } else if (changed)
        await writeText(entry.link.file, JSON.stringify(value, null, 2) + "\n");
    }
  }
  if (entry.own)
    await removeOwnHookFile(entry.file, syntax, id, entry.own, record);
  else await editHookFile(entry.file, syntax, id, undefined, [], record);
}
/** Copy a definition's bridge into its installation folder. A file of the same
 * name that iori did not place is not overwritten
 * (cli-definitions.md「上書きしない」). */
function writePlugin(
  id: string,
  hooks: DefinitionPluginHooks,
  folder: string,
  ctx: HookInstallContext,
): Promise<void> {
  return serially(async () => {
    const record = ctx.writtenPath;
    // A copy that is never recorded could never be removed.
    if (!record) return;
    const source = join(folder, hooks.install.copy);
    const target = hooksTarget(hooks, ctx.home, id);
    const content = await readText(source);
    if (content === undefined) {
      console.error(`iori-host cli-definition-part-missing: ${id}`);
      return;
    }
    const written = await readWritten(record);
    const previous = written[id];
    const current = await readText(target);
    // Only iori's own earlier copy is replaced.
    if (
      current !== undefined &&
      previous?.copy?.sha256 !== digest(current) &&
      !(
        digest(current) === digest(content) &&
        (await otherHostUses(dirname(record), undefined, target))
      )
    ) {
      console.error(`iori-host cli-definition-part-kept: ${id}`);
      return;
    }
    const next = { file: target, copy: { sha256: digest(content) } };
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      written[id] = next;
      await saveWritten(record, written);
      if (previous && previous.file !== target)
        await removeFrom(id, previous, record);
    }
    await hostHookItems(record, id, target, []);
    await mkdir(dirname(target), { recursive: true });
    await writeText(target, content);
  });
}
/** Write `ctx.id`'s items for `events`. Only `ctx.id`'s items change, so
 * the other CLIs and definitions that write the same file keep theirs.
 * `recorded`: a definition's hooks, which go only with a record. */
export function writeHooks(
  ctx: HookInstallContext,
  target: HookTarget,
  events: readonly string[],
  recorded = false,
): Promise<void> {
  return serially(async () => {
    const record = ctx.writtenPath;
    // A write that is never recorded could never be removed, so a definition
    // writes only with a record, and records first.
    if (recorded && !record) return;
    const link = target.link;
    const linkText = link ? await readText(link.file) : undefined;
    const linkValue = link ? await readConfig(link.file) : undefined;
    if (
      link &&
      linkValue &&
      Object.entries(link.set).some(
        ([key, value]) =>
          Object.hasOwn(linkValue, key) &&
          !isDeepStrictEqual(linkValue[key], value),
      )
    )
      return;
    if (link && target.own) {
      const content = await readText(target.file);
      if (
        content !== undefined &&
        !ownHookFile(content, target.syntax, ctx.id, target.own)
      )
        return;
    }
    if (recorded && record) {
      const written = await readWritten(record);
      const previous = written[ctx.id];
      const next = {
        file: target.file,
        ...(target.own ? { own: target.own } : {}),
        ...(link
          ? {
              link: {
                ...link,
                created:
                  linkText === undefined ||
                  (await readText(link.file + ".iori-created")) !== undefined ||
                  !!(
                    previous?.link?.file === link.file && previous.link.created
                  ),
              },
            }
          : {}),
      };
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        written[ctx.id] = next;
        await saveWritten(record, written);
        if (previous) await removeFrom(ctx.id, previous, record);
      }
    }
    const items = events.map((event) => ({
      event,
      command: target.namesEvent ? ctx.commandForEvent(event) : ctx.command,
    }));
    if (target.own)
      await writeOwnHookFile(
        target.file,
        target.syntax,
        ctx.id,
        target.own,
        target.place,
        items,
        record,
      );
    else
      await editHookFile(
        target.file,
        target.syntax,
        ctx.id,
        target.place,
        items,
        record,
      );
    if (link) {
      // Read again: replacing an earlier installation may have removed keys.
      const missing = (await readText(link.file)) === undefined;
      const value = missing ? { ...link.base } : await readConfig(link.file);
      if (
        missing ||
        Object.entries(link.set).some(
          ([key, expected]) =>
            !Object.hasOwn(value, key) ||
            !isDeepStrictEqual(value[key], expected),
        )
      ) {
        if (missing) await writeText(link.file + ".iori-created", "\n");
        await writeText(
          link.file,
          JSON.stringify({ ...value, ...link.set }, null, 2) + "\n",
        );
      }
    }
  });
}
/** Remove the hooks that `remove` selects in the record at `path`. */
export function removeWrittenHooks(
  path: string,
  remove: (id: string, entry: Written[string]) => boolean,
): Promise<void> {
  return serially(async () => {
    const written = await readWritten(path);
    const removed = Object.entries(written).filter(([id, entry]) =>
      remove(id, entry),
    );
    if (!removed.length) return;
    for (const [id, entry] of removed) {
      await removeFrom(id, entry, path);
      delete written[id];
    }
    await saveWritten(path, written);
  });
}

function matches(rule: DefinitionRule, payload: HookPayload): boolean {
  return (
    payload.hook_event_name === rule.event &&
    Object.entries(rule.when).every(
      ([key, expected]) => (payload[key] === expected.value) !== expected.not,
    )
  );
}
function state(
  rule: DefinitionRule,
  payload: HookPayload,
  hooks: DefinitionFileHooks,
  cwd?: string,
): HookState | undefined {
  const field = (key?: string) => (key ? payload[key] : undefined);
  if (rule.ignore) return undefined;
  if (rule.toolFinished) return toolFinished(field(hooks.toolId));
  if (rule.state === "active")
    return rule.tool
      ? toolActivity(field(rule.tool), {}, cwd, field(hooks.toolId))
      : { state: "active", activity: { kind: "thinking" } };
  // Approval is never inferred: only a rule naming it makes the CLI wait.
  if (rule.state === "waiting")
    return rule.attention
      ? attention(rule.attention, field(rule.tool), undefined)
      : { state: "waiting" };
  const response = text(field(rule.response));
  if (rule.outcome === "failure")
    return {
      ...cliFailure(...(rule.failure ?? []).map(field)),
      ...(response ? { response } : {}),
    };
  return rule.state
    ? { state: rule.state, ...(response ? { response } : {}) }
    : undefined;
}

/** A definition's hooks: iori's items in the CLI's settings, and its rules.
 * A plugin-file definition's bridge sends the common shape instead, so the
 * Host only places and removes it. */
export function definitionHooks(
  id: string,
  hooks: DefinitionHooks,
  folder: string,
): CliHooks {
  if (hooks.format === "plugin-file")
    return {
      install: (ctx) => writePlugin(id, hooks, folder, ctx),
      remove: async (ctx) => {
        if (ctx.writtenPath)
          await removeWrittenHooks(
            ctx.writtenPath,
            (written) => written === id,
          );
      },
      normalize: () => undefined,
    };
  const events = [...new Set(hooks.rules.map((rule) => rule.event))];
  return {
    install: (ctx) =>
      writeHooks(ctx, definitionTarget(hooks, ctx.home), events, true),
    remove: async (ctx) => {
      if (ctx.writtenPath)
        await removeWrittenHooks(ctx.writtenPath, (written) => written === id);
    },
    normalize(payload, _previous, cwd) {
      const rule = hooks.rules.find((rule) => matches(rule, payload));
      return rule ? state(rule, payload, hooks, cwd) : undefined;
    },
  };
}

/** The conversation that a resume opens, from the hooks that the rules
 * take: one that they drop, as a subagent's, does not move it. A plugin-file
 * CLI sends the conversation in the common shape instead. */
export function hookSession(hooks: DefinitionHooks) {
  if (hooks.format === "plugin-file")
    return (payload: HookPayload) => readCommonHook(payload)?.session;
  return (payload: HookPayload) => {
    const rule = hooks.rules.find((rule) => matches(rule, payload));
    if (!rule || rule.ignore) return undefined;
    const id = hooks.sessionId ? payload[hooks.sessionId] : undefined;
    const file = hooks.transcript ? payload[hooks.transcript] : undefined;
    return typeof id === "string" && id.trim()
      ? { id, ...(typeof file === "string" ? { file } : {}) }
      : undefined;
  };
}
