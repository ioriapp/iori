import * as v from "valibot";
import { decoded, schema } from "./primitives.ts";
import {
  publicKey,
  relayUrl,
  displayName,
  socketAddressArray,
  inviteSchema,
} from "./invite.ts";
import {
  record,
  string,
  fail,
  nonEmptyString,
  boolean,
  hostPath,
  nonNegativeInteger,
  readableItems,
} from "./primitives.ts";
import { releaseVersion } from "./maintenance.ts";
export type WorktreeCreation = {
  state: "pending" | "created" | "failed";
  path?: string;
  branch?: string;
  error?: "name_conflict" | "invalid_name" | "git_failed";
};

export interface WorktreeRemovalItem {
  path: string;
  branch?: string;
  changes: { files: number; added: number; removed: number };
  commits?: number;
  detachedCommits?: number;
  rebasingBranch?: string;
  target?: string;
  merged: boolean;
  /** The branch goes with the worktree without asking: merged or no commits. */
  deleteBranch: boolean;
  /** Stopped with the worktree; the confirmation does not list them. */
  terminals: {
    id: string;
    title: string;
    open: false | "cli" | "terminal" | "team-child";
  }[];
  children: {
    id: string;
    title: string;
    path?: string;
    remove: boolean;
    open: boolean;
  }[];
  worktrees: WorktreeRemovalItem[];
}
/** A CLI or team child whose work the deletion stops. */
export interface WorktreeRemovalWorking {
  id: string;
  name: string;
  state: "running" | "approval" | "question";
}
export interface WorktreeRemovalPreview {
  fetchFailed?: boolean;
  id: string;
  items: WorktreeRemovalItem[];
  /** Work that stops with the deletion, in the order the dialog shows it. */
  working?: WorktreeRemovalWorking[];
}
export interface WorktreeRemovalOutcome {
  path: string;
  removed: boolean;
  error?: string;
  /** Git refused because the worktree is locked; `reason` is the lock's own text. */
  locked?: { reason?: string };
  /** CLIs, Terminals or children were stopped before the failure. */
  stopped?: boolean;
  /** Git's own message for a failure that is not a lock. */
  gitOutput?: string;
  /** The worktree is gone but its branch could not be deleted. */
  branchRemains?: boolean;
}
export interface WorktreeRemovalResult {
  outcomes: WorktreeRemovalOutcome[];
  preview?: WorktreeRemovalPreview;
}

export type RelaySettings = v.InferOutput<typeof relaySettings>;

export interface Device {
  publicKey: string;
  name: string;
  registeredAt: number;
}

export interface HostInfo {
  pushNotifications?: true;
  connectionScope?: "loopback" | "network";
  relay?: RelaySettings;
  publicKey: string;
  hostName: string;
  /** OS name for display, such as "Linux" or "Windows". */
  os?: string;
  addresses: string[];
  version?: string;
  instanceId?: string;
  terminalDaemonCanContinue?: boolean;
  maintenanceAvailable?: boolean;
}

export interface FolderEntry {
  name: string;
  path: string;
}

export type ForgeMapping = v.InferOutput<typeof forgeMapping>;

export interface GitHubAccounts {
  available: boolean;
  accounts: { login: string; active: boolean; verified: boolean }[];
}

export interface RepositoryGitSettings {
  mainPath: string;
  setupCommand: string;
  githubAccount: string;
  githubAutoAccount: string;
  remotes: {
    name: string;
    url: string;
    remoteHost?: string;
    webUrl?: string;
    forge?: { id: string; label: string };
    detecting: boolean;
    mapping?: string;
    sharedRepositories: string[];
  }[];
}

export interface ForgeStatus {
  pullRequest?: {
    number: number;
    state: "open" | "draft" | "merged" | "closed";
    url: string;
  };
  /** `other`: only states iori does not know; `word` is the Forge's word. */
  checks?: {
    state: "passed" | "failed" | "running" | "other";
    url: string;
    word?: string;
  };
}

export interface Worktree {
  path: string;
  branch?: string;
  detached: boolean;
  primary: boolean;
  merged?: boolean;
  /** The Host is deleting this worktree. */
  removing?: boolean;
}

export interface FolderHistoryItem {
  path: string;
  workspacePath: string;
  kind: "folder" | "git";
  openedAt: number;
  inSidebar: boolean;
  sidebarPosition?: number;
  worktrees?: Worktree[];
}

const relaySettings = v.object({
  url: decoded(relayUrl),
  token: v.optional(v.pipe(v.string(), v.regex(/^[\x21-\x7e]+$/u))),
});
const parseRelaySettings = schema(relaySettings).parse;

export function optionalRelay(input: Record<string, unknown>): {
  relay?: RelaySettings;
} {
  return input.relay == null ? {} : { relay: parseRelaySettings(input.relay) };
}

export function parseDevice(value: unknown): Device {
  const input = record(value);
  return {
    publicKey: publicKey(input.publicKey, "publicKey"),
    name: displayName(input.name, "name"),
    registeredAt: nonNegativeInteger(input.registeredAt, "registeredAt"),
  };
}

// The OS name is display-only; a value that cannot be shown is dropped.
function optionalOs(value: unknown): { os?: string } {
  if (value === undefined) return {};
  try {
    return { os: displayName(value, "os") };
  } catch {
    return {};
  }
}

export function parseHostInfo(value: unknown): HostInfo {
  const input = record(value);
  return {
    ...(input.pushNotifications === true ? { pushNotifications: true } : {}),
    ...(input.connectionScope === "loopback" ||
    input.connectionScope === "network"
      ? { connectionScope: input.connectionScope }
      : {}),
    ...optionalRelay(input),
    publicKey: publicKey(input.publicKey, "publicKey"),
    hostName: displayName(input.hostName, "hostName"),
    ...optionalOs(input.os),
    ...(input.version === undefined
      ? {}
      : { version: releaseVersion(input.version) }),
    ...(input.instanceId === undefined
      ? {}
      : { instanceId: nonEmptyString(input.instanceId, "instanceId") }),
    ...(input.terminalDaemonCanContinue === undefined
      ? {}
      : {
          terminalDaemonCanContinue: boolean(
            input.terminalDaemonCanContinue,
            "terminalDaemonCanContinue",
          ),
        }),
    ...(input.maintenanceAvailable === undefined
      ? {}
      : {
          maintenanceAvailable: boolean(
            input.maintenanceAvailable,
            "maintenanceAvailable",
          ),
        }),
    addresses: socketAddressArray(input.addresses, "addresses"),
  };
}

function parseFolderEntry(value: unknown): FolderEntry {
  const input = record(value);
  return {
    name: nonEmptyString(input.name, "name"),
    path: hostPath(input.path, "path"),
  };
}

export function forgeRemoteHost(value: unknown): string {
  return nonEmptyString(
    nonEmptyString(value, "remoteHost").trim(),
    "remoteHost",
  ).toLowerCase();
}
function forgeWebUrl(value: unknown): string {
  const text = nonEmptyString(value, "webUrl").trim();
  try {
    const url = new URL(text);
    // Only the origin is used, so credentials and paths are never stored.
    if (url.protocol === "http:" || url.protocol === "https:")
      return url.origin;
  } catch {
    /* Report the URL input, without testing connectivity. */
  }
  return fail("webUrl must be an http or https URL");
}
export const forgeMapping = v.object({
  remoteHost: decoded(forgeRemoteHost),
  webUrl: decoded(forgeWebUrl),
});
export const parseForgeMapping = schema(forgeMapping).parse;
export function parseGitHubAccounts(value: unknown): GitHubAccounts {
  const input = record(value);
  if (!Array.isArray(input.accounts)) return fail("Invalid GitHub accounts");
  return {
    available: boolean(input.available, "available"),
    accounts: input.accounts.map((value) => {
      const account = record(value);
      return {
        login: nonEmptyString(account.login, "login"),
        active: boolean(account.active, "active"),
        verified: boolean(account.verified, "verified"),
      };
    }),
  };
}
export function parseRepositoryGitValues(value: unknown) {
  const input = record(value);
  return {
    setupCommand: string(input.setupCommand, "setupCommand"),
    githubAccount: string(input.githubAccount, "githubAccount"),
  };
}
export function parseRepositoryGitSettings(
  value: unknown,
): RepositoryGitSettings {
  const input = record(value);
  if (!Array.isArray(input.remotes)) return fail("Invalid repository settings");
  return {
    mainPath: hostPath(input.mainPath, "mainPath"),
    ...parseRepositoryGitValues(input),
    githubAutoAccount: string(input.githubAutoAccount, "githubAutoAccount"),
    remotes: input.remotes.map((value) => {
      const remote = record(value);
      if (!Array.isArray(remote.sharedRepositories))
        return fail("Invalid repositories");
      return {
        name: nonEmptyString(remote.name, "name"),
        url: string(remote.url, "url"),
        ...(remote.remoteHost === undefined
          ? {}
          : { remoteHost: forgeRemoteHost(remote.remoteHost) }),
        ...(remote.webUrl === undefined
          ? {}
          : { webUrl: forgeWebUrl(remote.webUrl) }),
        ...(remote.forge === undefined
          ? {}
          : {
              forge: {
                id: nonEmptyString(record(remote.forge).id, "id"),
                label: nonEmptyString(record(remote.forge).label, "label"),
              },
            }),
        detecting: boolean(remote.detecting, "detecting"),
        ...(remote.mapping === undefined
          ? {}
          : { mapping: forgeWebUrl(remote.mapping) }),
        sharedRepositories: remote.sharedRepositories.map((path) =>
          hostPath(path, "path"),
        ),
      };
    }),
  };
}

export function parseForgeStatus(value: unknown): ForgeStatus {
  const input = record(value);
  const result: ForgeStatus = {};
  if (input.pullRequest !== undefined) {
    const pull = record(input.pullRequest);
    if (!["open", "draft", "merged", "closed"].includes(String(pull.state)))
      return fail("Invalid PR state");
    result.pullRequest = {
      number: nonNegativeInteger(pull.number, "number"),
      state: pull.state as NonNullable<ForgeStatus["pullRequest"]>["state"],
      url: nonEmptyString(pull.url, "url"),
    };
  }
  if (input.checks !== undefined) {
    const checks = record(input.checks);
    if (
      !["passed", "failed", "running", "other"].includes(String(checks.state))
    )
      return fail("Invalid checks state");
    result.checks = {
      state: checks.state as NonNullable<ForgeStatus["checks"]>["state"],
      url: nonEmptyString(checks.url, "url"),
      ...(checks.word === undefined
        ? {}
        : { word: string(checks.word, "word") }),
    };
  }
  return result;
}

export function parseWorktree(value: unknown): Worktree {
  const input = record(value);
  if (typeof input.detached !== "boolean")
    return fail("detached must be a boolean");
  if (typeof input.primary !== "boolean")
    return fail("primary must be a boolean");
  const branch = input.branch;
  return {
    path: hostPath(input.path, "path"),
    ...(branch === undefined
      ? {}
      : { branch: nonEmptyString(branch, "branch") }),
    detached: input.detached,
    primary: input.primary,
    ...(input.merged === undefined
      ? {}
      : { merged: boolean(input.merged, "merged") }),
    ...(input.removing === undefined
      ? {}
      : { removing: boolean(input.removing, "removing") }),
  };
}

function parseRemovalItem(value: unknown): WorktreeRemovalItem {
  const input = record(value);
  const changes = record(input.changes);
  if (
    !Array.isArray(input.terminals) ||
    !Array.isArray(input.children) ||
    !Array.isArray(input.worktrees)
  )
    return fail("Invalid worktree removal details");
  return {
    path: hostPath(input.path, "path"),
    ...(input.branch === undefined
      ? {}
      : { branch: string(input.branch, "branch") }),
    ...(input.commits === undefined
      ? {}
      : { commits: nonNegativeInteger(input.commits, "commits") }),
    ...(typeof input.detachedCommits === "number" &&
    Number.isInteger(input.detachedCommits) &&
    input.detachedCommits > 0
      ? { detachedCommits: input.detachedCommits }
      : {}),
    ...(input.rebasingBranch === undefined
      ? {}
      : { rebasingBranch: string(input.rebasingBranch, "rebasingBranch") }),
    ...(input.target === undefined
      ? {}
      : { target: string(input.target, "target") }),
    changes: {
      files: nonNegativeInteger(changes.files, "files"),
      added: nonNegativeInteger(changes.added, "added"),
      removed: nonNegativeInteger(changes.removed, "removed"),
    },
    merged: boolean(input.merged, "merged"),
    deleteBranch: boolean(input.deleteBranch, "deleteBranch"),
    terminals: input.terminals.map((value) => {
      const item = record(value);
      if (
        item.open !== false &&
        item.open !== "cli" &&
        item.open !== "terminal" &&
        item.open !== "team-child"
      )
        return fail("Invalid worktree removal process activity");
      return {
        id: string(item.id, "id"),
        title: string(item.title, "title"),
        open: item.open,
      };
    }),
    children: input.children.map((value) => {
      const item = record(value);
      return {
        id: string(item.id, "id"),
        title: string(item.title, "title"),
        ...(item.path === undefined
          ? {}
          : { path: hostPath(item.path, "path") }),
        remove: boolean(item.remove, "remove"),
        open: boolean(item.open, "open"),
      };
    }),
    worktrees: input.worktrees.map(parseRemovalItem),
  };
}
export function parseRemovalPreview(value: unknown): WorktreeRemovalPreview {
  const input = record(value);
  if (!Array.isArray(input.items)) return fail("items must be an array");
  if (input.working !== undefined && !Array.isArray(input.working))
    return fail("working must be an array");
  return {
    id: string(input.id, "id"),
    items: input.items.map(parseRemovalItem),
    ...(input.working === undefined
      ? {}
      : {
          working: input.working.map((value) => {
            const work = record(value);
            if (
              work.state !== "running" &&
              work.state !== "approval" &&
              work.state !== "question"
            )
              return fail("Invalid work in progress state");
            return {
              id: string(work.id, "id"),
              name: string(work.name, "name"),
              state: work.state,
            };
          }),
        }),
    ...(input.fetchFailed === undefined
      ? {}
      : { fetchFailed: boolean(input.fetchFailed, "fetchFailed") }),
  };
}
export function parseRemovalResult(value: unknown): WorktreeRemovalResult {
  const input = record(value);
  if (!Array.isArray(input.outcomes)) return fail("outcomes must be an array");
  return {
    ...(input.preview === undefined
      ? {}
      : { preview: parseRemovalPreview(input.preview) }),
    outcomes: input.outcomes.map((value) => {
      const item = record(value);
      return {
        path: hostPath(item.path, "path"),
        removed: boolean(item.removed, "removed"),
        ...(item.error === undefined
          ? {}
          : { error: string(item.error, "error") }),
        ...(item.locked === undefined
          ? {}
          : {
              locked: (() => {
                const locked = record(item.locked);
                return locked.reason === undefined
                  ? {}
                  : { reason: string(locked.reason, "reason") };
              })(),
            }),
        ...(item.stopped === undefined
          ? {}
          : { stopped: boolean(item.stopped, "stopped") }),
        ...(item.gitOutput === undefined
          ? {}
          : { gitOutput: string(item.gitOutput, "gitOutput") }),
        ...(item.branchRemains === undefined
          ? {}
          : { branchRemains: boolean(item.branchRemains, "branchRemains") }),
      };
    }),
  };
}

function parseFolderHistoryItem(value: unknown): FolderHistoryItem {
  const input = record(value);
  if (input.kind !== "folder" && input.kind !== "git") {
    return fail("unsupported folder kind");
  }
  if (typeof input.inSidebar !== "boolean") {
    return fail("inSidebar must be a boolean");
  }
  const worktrees = input.worktrees;
  if (worktrees !== undefined && !Array.isArray(worktrees)) {
    return fail("worktrees must be an array");
  }
  return {
    path: hostPath(input.path, "path"),
    workspacePath: hostPath(input.workspacePath, "workspacePath"),
    kind: input.kind,
    openedAt: nonNegativeInteger(input.openedAt, "openedAt"),
    inSidebar: input.inSidebar,
    ...(input.sidebarPosition === undefined
      ? {}
      : {
          sidebarPosition: nonNegativeInteger(
            input.sidebarPosition,
            "sidebarPosition",
          ),
        }),
    ...(worktrees === undefined
      ? {}
      : { worktrees: worktrees.map(parseWorktree) }),
  };
}

export function parsePairResult(value: unknown) {
  const input = record(value);
  return {
    device: parseDevice(input.device),
    host: parseHostInfo(input.host),
  };
}

export function parseDevicesListResult(value: unknown) {
  const input = record(value);
  if (!Array.isArray(input.devices)) return fail("devices must be an array");
  return {
    devices: readableItems(parseDevice, input.devices),
    currentDevicePublicKey: publicKey(
      input.currentDevicePublicKey,
      "currentDevicePublicKey",
    ),
  };
}

export function parseInviteCreateResult(value: unknown) {
  const input = record(value);
  return { invite: inviteSchema.parse(input.invite) };
}

export function parseRevokeResult(value: unknown) {
  const input = record(value);
  return { publicKey: publicKey(input.publicKey, "publicKey") };
}

export function parseFoldersBrowseResult(value: unknown) {
  const input = record(value);
  if (!Array.isArray(input.entries)) return fail("entries must be an array");
  return {
    homePath: hostPath(input.homePath, "homePath"),
    ...(input.path === undefined ? {} : { path: hostPath(input.path, "path") }),
    ...(input.parentPath === undefined
      ? {}
      : { parentPath: hostPath(input.parentPath, "parentPath") }),
    entries: input.entries.map(parseFolderEntry),
  };
}

export function parseFoldersHistoryResult(value: unknown) {
  const input = record(value);
  if (!Array.isArray(input.folders)) return fail("folders must be an array");
  return { folders: input.folders.map(parseFolderHistoryItem) };
}

export function parseFoldersOpenResult(value: unknown) {
  const input = record(value);
  return { folder: parseFolderHistoryItem(input.folder) };
}

export function parseFoldersSidebarRemoveResult(value: unknown) {
  const input = record(value);
  return { path: hostPath(input.path, "path") };
}

export function parseWorktreeCreation(value: unknown): WorktreeCreation {
  const input = record(value);
  const state = input.state;
  if (state !== "pending" && state !== "created" && state !== "failed")
    return fail("invalid creation state");
  const error = input.error;
  if (
    error !== undefined &&
    error !== "name_conflict" &&
    error !== "invalid_name" &&
    error !== "git_failed"
  )
    return fail("invalid creation error");
  return {
    state,
    ...(input.path === undefined ? {} : { path: hostPath(input.path, "path") }),
    ...(input.branch === undefined
      ? {}
      : { branch: string(input.branch, "branch") }),
    ...(error === undefined ? {} : { error }),
  };
}
