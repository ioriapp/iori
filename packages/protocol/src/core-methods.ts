import * as v from "valibot";
import {
  record,
  fail,
  boolean,
  string,
  identifier,
  method,
  decoded,
  emptyParams,
  nonEmptyString,
  pathSchema,
  hostPath,
} from "./primitives.ts";
import { pushSettings } from "./push-notifications.ts";
import { secret, displayName, publicKey } from "./invite.ts";
import {
  parsePairResult,
  parseDevicesListResult,
  parseInviteCreateResult,
  parseRevokeResult,
  parseHostInfo,
  optionalRelay,
  parseGitHubAccounts,
  parseRepositoryGitSettings,
  parseRepositoryGitValues,
  parseForgeMapping,
  forgeMapping,
  forgeRemoteHost,
  parseRemovalPreview,
  parseRemovalResult,
  parseWorktreeCreation,
  parseFoldersBrowseResult,
  parseFoldersHistoryResult,
  parseFoldersOpenResult,
  parseFoldersSidebarRemoveResult,
} from "./host-values.ts";
import {
  parseCliListResult,
  cliStartupArguments,
  parseTerminalCreatedResult,
  parseTerminalListResult,
  parseTerminalClosedResult,
  parseTerminalDefaultShellResult,
} from "./terminal-values.ts";
import { type TerminalApprovalResponse } from "./cli.ts";
export const TERMINAL_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "heif",
  "avif",
  "bmp",
] as const;
export type TerminalImageExtension = (typeof TERMINAL_IMAGE_EXTENSIONS)[number];
export function isTerminalImageExtension(
  value: unknown,
): value is TerminalImageExtension {
  return TERMINAL_IMAGE_EXTENSIONS.some((extension) => extension === value);
}

function launch<const T extends v.ObjectEntries>(id: T) {
  return v.pipe(
    v.object({
      ...id,
      cwd: identifier,
      setupWorktree: v.optional(v.unknown()),
      instruction: v.optional(v.string()),
    }),
    v.transform(({ setupWorktree, instruction, ...rest }) => ({
      ...rest,
      ...(setupWorktree === true ? { setupWorktree: true } : {}),
      ...(instruction?.trim() ? { instruction } : {}),
    })),
  );
}
export const coreMethods = {
  pair: method(
    v.object({
      secret: decoded(secret),
      deviceName: decoded((value) => displayName(value, "deviceName")),
    }),
    { parse: parsePairResult },
  ),
  "devices.list": method(emptyParams, { parse: parseDevicesListResult }),
  "invite.create": method(emptyParams, { parse: parseInviteCreateResult }),
  "devices.revoke": method(
    v.object({ publicKey: decoded((value) => publicKey(value, "publicKey")) }),
    { parse: parseRevokeResult },
  ),
  "notifications.push.set": method(pushSettings, { parse: () => ({}) }),
  "host.info": method(emptyParams, { parse: parseHostInfo }),
  "host.relay.set": method(
    decoded((value) => optionalRelay(record(value))),
    { parse: (value) => optionalRelay(record(value)) },
  ),
  "cli.list": method(v.object({ refreshUsage: v.optional(v.boolean()) }), {
    parse: parseCliListResult,
  }),
  "cli.usage.refresh": method(v.object({ cliId: v.optional(identifier) }), {
    parse: () => ({}),
  }),
  "cli.order.set": method(v.object({ order: v.array(v.string()) }), {
    parse: (value: unknown) => {
      const order = record(value).order;
      if (!Array.isArray(order)) return fail("order must be an array");
      return { order: order.map((id) => string(id, "id")) };
    },
  }),
  "cli.hidden.set": method(
    v.object({ cliId: identifier, hidden: v.boolean() }),
    {
      parse: (value: unknown) => ({
        cliId: nonEmptyString(record(value).cliId, "cliId"),
        hidden: boolean(record(value).hidden, "hidden"),
      }),
    },
  ),
  "cli.arguments.set": method(
    v.object({ cliId: identifier, arguments: decoded(cliStartupArguments) }),
    {
      parse: (value: unknown) => ({
        cliId: nonEmptyString(record(value).cliId, "cliId"),
        arguments: string(record(value).arguments, "arguments"),
      }),
    },
  ),
  "cli.launch": method(launch({ cliId: identifier }), {
    parse: parseTerminalCreatedResult,
  }),
  "team.launch": method(launch({ teamId: identifier }), {
    parse: parseTerminalCreatedResult,
  }),
  "terminal.list": method(emptyParams, { parse: parseTerminalListResult }),
  "terminal.create": method(
    v.object({ cwd: identifier, shell: v.optional(identifier) }),
    { parse: parseTerminalCreatedResult },
  ),
  "terminal.setup": method(
    v.object({ terminalId: identifier, action: v.picklist(["retry", "skip"]) }),
    { parse: parseTerminalCreatedResult },
  ),
  "cli.resume": method(v.object({ terminalId: identifier }), {
    parse: parseTerminalCreatedResult,
  }),
  "terminal.image.write": method(
    v.object({
      terminalId: identifier,
      extension: v.picklist(TERMINAL_IMAGE_EXTENSIONS),
      imageId: v.pipe(
        v.string(),
        v.regex(
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u,
        ),
      ),
      data: v.pipe(
        identifier,
        v.check(
          (data) =>
            data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/u.test(data),
        ),
      ),
      first: v.boolean(),
      last: v.boolean(),
    }),
    {
      parse: (value) => ({ path: string(record(value).path, "path") }),
    },
  ),
  "terminal.approval.respond": method(
    v.object({
      terminalId: identifier,
      approvalId: identifier,
      decision: v.picklist(["allow", "deny"]),
    }),
    {
      parse: (value: unknown): TerminalApprovalResponse => {
        const status = record(value).status;
        if (status !== "sent" && status !== "stale" && status !== "unavailable")
          return fail("Invalid approval response status");
        return { status };
      },
    },
  ),
  "terminal.close": method(
    v.object({ terminalId: identifier, confirm: v.optional(v.boolean()) }),
    { parse: parseTerminalClosedResult },
  ),
  "terminal.defaultShell.set": method(v.object({ shell: identifier }), {
    parse: parseTerminalDefaultShellResult,
  }),
  "github.accounts": method(emptyParams, { parse: parseGitHubAccounts }),
  "repository.git.settings": method(v.object({ path: pathSchema }), {
    parse: parseRepositoryGitSettings,
  }),
  "repository.git.set": method(
    v.object({
      path: pathSchema,
      setupCommand: v.optional(v.string()),
      githubAccount: v.optional(v.string()),
    }),
    { parse: parseRepositoryGitValues },
  ),
  "forge.mapping.set": method(forgeMapping, {
    parse: (value) => ({ mapping: parseForgeMapping(record(value).mapping) }),
  }),
  "forge.mapping.remove": method(
    v.object({ remoteHost: decoded(forgeRemoteHost) }),
    {
      parse: (value) => ({
        remoteHost: forgeRemoteHost(record(value).remoteHost),
      }),
    },
  ),
  "forge.watch": method(
    v.object({ paths: v.array(pathSchema), selected: v.optional(pathSchema) }),
    { parse: (): Record<string, never> => ({}) },
  ),
  "worktrees.preview": method(v.object({ path: pathSchema }), {
    parse: parseRemovalPreview,
  }),
  "worktrees.cleanup": method(v.object({ path: pathSchema }), {
    parse: parseRemovalPreview,
  }),
  "worktrees.remove": method(
    v.object({
      previewId: identifier,
      paths: v.array(pathSchema),
      branches: v.array(identifier),
      recheck: v.optional(v.boolean()),
    }),
    { parse: parseRemovalResult },
  ),
  "worktrees.options": method(v.object({ path: pathSchema }), {
    parse: (value) => {
      const input = record(value);
      if (!Array.isArray(input.branches))
        return fail("branches must be an array");
      return {
        mainPath: string(input.mainPath, "mainPath"),
        branches: input.branches.map((v) => string(v, "branch")),
        defaultBranch: string(input.defaultBranch, "defaultBranch"),
        setupCommand: string(input.setupCommand, "setupCommand"),
        ...(input.noCommits === true ? { noCommits: true as const } : {}),
      };
    },
  }),
  "worktrees.create": method(
    v.object({
      path: pathSchema,
      name: v.string(),
      baseBranch: identifier,
      setupCommand: v.string(),
    }),
    { parse: parseWorktreeCreation },
  ),
  "worktrees.creation": method(v.object({ creationId: identifier }), {
    parse: (value) => {
      const input = record(value);
      return input.creation === undefined
        ? {}
        : { creation: parseWorktreeCreation(input.creation) };
    },
  }),
  "folders.browse": method(v.object({ path: v.optional(pathSchema) }), {
    parse: parseFoldersBrowseResult,
  }),
  "folders.history": method(emptyParams, {
    parse: (value) => parseFoldersHistoryResult(value),
  }),
  "folders.open": method(v.object({ path: pathSchema }), {
    parse: parseFoldersOpenResult,
  }),
  "folders.sidebar.reorder": method(v.object({ paths: v.array(pathSchema) }), {
    parse: (value) => {
      const input = record(value);
      if (!Array.isArray(input.paths)) return fail("paths must be an array");
      return { paths: input.paths.map((path) => hostPath(path, "path")) };
    },
  }),
  "folders.sidebar.remove": method(v.object({ path: pathSchema }), {
    parse: parseFoldersSidebarRemoveResult,
  }),
};
