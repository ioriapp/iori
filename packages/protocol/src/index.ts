import {
  isFilesTransferMethod,
  parseFilesTransferParams,
  filesTransferResultSchemas,
  type FilesTransferMethod,
  type FilesTransferParams,
  type FilesTransferResults,
} from "./files-transfer.ts";
export * from "./files-transfer.ts";
export * from "./display-order.ts";
export * from "./worktree-name.ts";
export * from "./automation-time.ts";
import {
  isAutomationMethod,
  parseAutomationParams,
  automationResultSchemas,
  type AutomationMethod,
  type AutomationParams,
  type AutomationResults,
} from "./automations.ts";
export * from "./automations.ts";
import {
  isForgeIntegrationMethod,
  parseForgeIntegrationParams,
  forgeIntegrationResultSchemas,
  type ForgeIntegrationMethod,
  type ForgeReadFailure,
  type ForgeIntegrationParams,
  type ForgeIntegrationResults,
} from "./forge-integration.ts";
export * from "./forge-integration.ts";
import {
  isForgeIssueMethod,
  parseForgeIssueParams,
  forgeIssueResultSchemas,
  type ForgeIssueMethod,
  type ForgeIssueParams,
  type ForgeIssueResults,
} from "./forge-issues.ts";
export * from "./forge-issues.ts";
import {
  isForgeCiMethod,
  parseForgeCiParams,
  forgeCiResultSchemas,
  type ForgeCiMethod,
  type ForgeCiParams,
  type ForgeCiResults,
} from "./forge-ci.ts";
export * from "./forge-ci.ts";
export { compareVersions } from "./version.ts";
import {
  isMaintenanceMethod,
  parseMaintenanceParams,
  parseMaintenancePlan,
  parseMaintenanceStatus,
  parseMaintenanceLookup,
  releaseVersion,
  type MaintenanceMethod,
  type MaintenanceParams,
  type MaintenanceResults,
  type MaintenanceStatus,
} from "./maintenance.ts";
export * from "./maintenance.ts";
export * from "./record-summary.ts";
export * from "./board.ts";
export {
  usageAppliesToModel,
  belowUsageMinimum,
  parseCliUsage,
  type CliUsage,
} from "./cli.ts";
import {
  isTeamMethod,
  parseTeamParams,
  teamResultSchemas,
  type TeamMethod,
  type TeamParamsByMethod,
  type TeamResultByMethod,
} from "./teams.ts";
export * from "./teams.ts";
export * from "./team-text.ts";
import type { CliSummary, CliListResult } from "./cli.ts";
import {
  CLI_FEATURES,
  isCliDefinitionMethod,
  parseCliDefinitionParams,
  parseCliSimpleDefinition,
  cliDefinitionResultSchemas,
  type CliDefinitionFailure,
  type CliDefinitionMethod,
  type CliDefinitionParams,
  type CliDefinitionReason,
  type CliDefinitionResults,
  type CliSupport,
} from "./cli-definitions.ts";
export * from "./cli-definitions.ts";
import { parseCliStatus, parseCliUsage } from "./cli.ts";
export type { CliStatus } from "./cli.ts";
export {
  parseCliNotificationTarget,
  cliNotificationId,
  notificationText,
} from "./cli.ts";
export type {
  CliNotification,
  CliNotificationTarget,
  CliSession,
  CliSummary,
  CliListResult,
} from "./cli.ts";
import {
  MAX_TERMINAL_SNAPSHOT_BYTES,
  MAX_TERMINAL_SNAPSHOT_LINES,
  type TerminalClientMessage,
  type TerminalClosedResult,
  type TerminalCreatedResult,
  type TerminalDefaultShellResult,
  type TerminalEvent,
  type TerminalListResult,
  type TerminalModes,
  type TerminalMouseTrackingMode,
  type TerminalOpenStream,
  type TerminalOscLinkRange,
  type TerminalServerMessage,
  type TerminalShell,
  type TerminalSnapshot,
  type TerminalSize,
  type TerminalState,
  type TerminalSummary,
  type TerminalViewAttributes,
  type TerminalViewRgb,
  type TerminalWindowsPty,
} from "./terminal.ts";

export { buildTerminalSnapshotRestoreSequence } from "./terminal.ts";
export {
  MAX_TERMINAL_SNAPSHOT_BYTES,
  MAX_TERMINAL_SNAPSHOT_LINES,
  MOBILE_TERMINAL_SNAPSHOT_BYTES,
  MOBILE_TERMINAL_SNAPSHOT_LINES,
} from "./terminal.ts";
export type {
  TerminalClientMessage,
  TerminalClosedResult,
  TerminalCreatedResult,
  TerminalDefaultShellResult,
  TerminalEvent,
  TerminalListResult,
  TerminalModes,
  TerminalMouseTrackingMode,
  TerminalOpenStream,
  TerminalOscLinkRange,
  TerminalServerMessage,
  TerminalShell,
  TerminalSnapshot,
  TerminalSize,
  TerminalState,
  TerminalSummary,
  TerminalViewAttributes,
  TerminalViewRgb,
  TerminalWindowsPty,
} from "./terminal.ts";
import {
  isReadMethod,
  parseReadRequest,
  parseReadingChangedEvent,
  parseReadingWatchRequest,
  readResultSchemas,
} from "./reading.ts";
import type {
  ReadMethod,
  ReadParamsByMethod,
  ReadRequest,
  ReadResultByMethod,
  ReadingChangedEvent,
  ReadingWatchRequest,
} from "./reading.ts";

export * from "./reading.ts";

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
export interface WorktreeRemovalResult {
  outcomes: { path: string; removed: boolean; error?: string }[];
}

export const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_DISPLAY_NAME_CODE_POINTS = 63;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const errorCodes = [
  "invalid_request",
  "not_registered",
  "invite_rejected",
  "device_not_found",
  "path_outside_root",
  "path_not_found",
  "not_a_file",
  "not_a_directory",
  "not_git_repository",
  "git_failed",
  "permission_denied",
  "read_failed",
  "put_failed",
  "put_not_a_file",
  "put_exists",
  "internal_error",
  "host_uninstalling",
] as const;

export type ProtocolErrorCode = (typeof errorCodes)[number];
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

export type RequestMethod =
  | AutomationMethod
  | ForgeIntegrationMethod
  | ForgeIssueMethod
  | ForgeCiMethod
  | MaintenanceMethod
  | "pair"
  | "devices.list"
  | "invite.create"
  | "devices.revoke"
  | "host.info"
  | "host.relay.set"
  | "cli.list"
  | "cli.hidden.set"
  | "cli.arguments.set"
  | "cli.launch"
  | "team.launch"
  | "terminal.list"
  | "terminal.create"
  | "terminal.setup"
  | "cli.resume"
  | "terminal.image.write"
  | "terminal.close"
  | "terminal.defaultShell.set"
  | "github.accounts"
  | "repository.git.settings"
  | "repository.git.set"
  | "forge.mapping.set"
  | "forge.mapping.remove"
  | "forge.watch"
  | "worktrees.preview"
  | "worktrees.cleanup"
  | "worktrees.remove"
  | "worktrees.options"
  | "worktrees.create"
  | "worktrees.creation"
  | "folders.browse"
  | "folders.history"
  | "folders.open"
  | "folders.sidebar.reorder"
  | "folders.sidebar.remove"
  | ReadMethod
  | FilesTransferMethod
  | CliDefinitionMethod
  | TeamMethod;

export interface RelaySettings {
  url: string;
  token?: string;
}

export interface Invite {
  version: 1;
  hostKey: string;
  relayUrl?: string;
  addresses: string[];
  secret: string;
  expiresAt: number;
  hostName: string;
}

export interface Device {
  publicKey: string;
  name: string;
  registeredAt: number;
}

export interface HostInfo {
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

export interface ForgeMapping {
  remoteHost: string;
  webUrl: string;
}

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

export interface RequestParamsByMethod
  extends
    ReadParamsByMethod,
    FilesTransferParams,
    TeamParamsByMethod,
    MaintenanceParams,
    AutomationParams,
    ForgeIntegrationParams,
    ForgeIssueParams,
    ForgeCiParams,
    CliDefinitionParams {
  pair: { secret: string; deviceName: string };
  "devices.list": Record<string, never>;
  "invite.create": Record<string, never>;
  "devices.revoke": { publicKey: string };
  "host.info": Record<string, never>;
  "host.relay.set": { relay?: RelaySettings };
  "cli.list": { refreshUsage?: boolean };
  "cli.hidden.set": { cliId: string; hidden: boolean };
  "cli.arguments.set": { cliId: string; arguments: string };
  /** `instruction`: the first input, sent as a file the CLI reads (worktrees.md). */
  "cli.launch": {
    cliId: string;
    cwd: string;
    setupWorktree?: boolean;
    instruction?: string;
  };
  "team.launch": {
    teamId: string;
    cwd: string;
    setupWorktree?: boolean;
    instruction?: string;
  };
  "terminal.list": Record<string, never>;
  "terminal.create": { cwd: string; shell?: string };
  "terminal.setup": { terminalId: string; action: "retry" | "skip" };
  "cli.resume": { terminalId: string };
  "terminal.image.write": {
    terminalId: string;
    imageId: string;
    extension: TerminalImageExtension;
    data: string;
    first: boolean;
    last: boolean;
  };
  "terminal.close": { terminalId: string; confirm?: boolean };
  "terminal.defaultShell.set": { shell: string };
  "github.accounts": Record<string, never>;
  "repository.git.settings": { path: string };
  "repository.git.set": {
    path: string;
    setupCommand?: string;
    githubAccount?: string;
  };
  "forge.mapping.set": ForgeMapping;
  "forge.mapping.remove": { remoteHost: string };
  "forge.watch": { paths: string[]; selected?: string };
  "worktrees.preview": { path: string };
  "worktrees.cleanup": { path: string };
  "worktrees.remove": {
    previewId: string;
    paths: string[];
    branches: string[];
  };
  "worktrees.options": { path: string };
  "worktrees.create": {
    path: string;
    name: string;
    baseBranch: string;
    setupCommand: string;
  };
  "worktrees.creation": { creationId: string };
  "folders.browse": { path?: string };
  "folders.history": Record<string, never>;
  "folders.open": { path: string };
  "folders.sidebar.reorder": { paths: string[] };
  "folders.sidebar.remove": { path: string };
}

export interface ResultByMethod
  extends
    ReadResultByMethod,
    FilesTransferResults,
    TeamResultByMethod,
    MaintenanceResults,
    AutomationResults,
    ForgeIntegrationResults,
    ForgeIssueResults,
    ForgeCiResults,
    CliDefinitionResults {
  pair: { device: Device; host: HostInfo };
  "devices.list": { devices: Device[]; currentDevicePublicKey: string };
  "invite.create": { invite: Invite };
  "devices.revoke": { publicKey: string };
  "host.info": HostInfo;
  "host.relay.set": { relay?: RelaySettings };
  "cli.list": CliListResult;
  "cli.hidden.set": { cliId: string; hidden: boolean };
  "cli.arguments.set": { cliId: string; arguments: string };
  "cli.launch": TerminalCreatedResult;
  "team.launch": TerminalCreatedResult;
  "terminal.list": TerminalListResult;
  "terminal.create": TerminalCreatedResult;
  "terminal.setup": TerminalCreatedResult;
  "cli.resume": TerminalCreatedResult;
  "terminal.image.write": { path: string };
  "terminal.close": TerminalClosedResult;
  "terminal.defaultShell.set": TerminalDefaultShellResult;
  "github.accounts": GitHubAccounts;
  "repository.git.settings": RepositoryGitSettings;
  "repository.git.set": { setupCommand: string; githubAccount: string };
  "forge.mapping.set": { mapping: ForgeMapping };
  "forge.mapping.remove": { remoteHost: string };
  "forge.watch": Record<string, never>;
  "worktrees.preview": WorktreeRemovalPreview;
  "worktrees.cleanup": WorktreeRemovalPreview;
  "worktrees.remove": WorktreeRemovalResult;
  "worktrees.options": {
    mainPath: string;
    branches: string[];
    defaultBranch: string;
    setupCommand: string;
  };
  "worktrees.create": WorktreeCreation;
  "worktrees.creation": { creation?: WorktreeCreation };
  "folders.browse": {
    homePath: string;
    path?: string;
    parentPath?: string;
    entries: FolderEntry[];
  };
  "folders.history": { folders: FolderHistoryItem[] };
  "folders.open": { folder: FolderHistoryItem };
  "folders.sidebar.reorder": { paths: string[] };
  "folders.sidebar.remove": { path: string };
}

export type RequestByMethod = {
  [M in RequestMethod]: {
    kind: "request";
    operationId: string;
    method: M;
    params: RequestParamsByMethod[M];
  };
}[RequestMethod];

export type Request = RequestByMethod | SubscribeRequest | ReadRequest;

export type SubscribeRequest =
  | {
      kind: "subscribe";
      operationId: string;
      method: "events";
      params: Record<string, never>;
    }
  | ReadingWatchRequest;

/** A Forge read that failed also says why (forge.md「失敗の示し方」). */
export type Response<T = unknown> =
  | { ok: true; result: T }
  | {
      ok: false;
      error: { code: ProtocolErrorCode; forge?: ForgeReadFailure };
    };

export type ReceivedResponse<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: { code: string; forge?: ForgeReadFailure } };

export type Event =
  | { type: "automation.changed" }
  | { type: "host.maintenance.changed"; status: MaintenanceStatus }
  | { type: "teams.children.removed"; ids: string[] }
  | { type: "teams.children"; children: import("./teams.ts").ChildSummary[] }
  | { type: "teams.child.updated"; child: import("./teams.ts").ChildSummary }
  | { type: "cli.usage"; cliId: string; usage?: import("./cli.ts").CliUsage }
  | { type: "cli.version"; shell: string; cliId: string; version: string }
  | {
      type: "snapshot";
      host: HostInfo;
      devices: Device[];
      currentDevicePublicKey: string;
    }
  | {
      type: "device.registered";
      device: Device;
      inviteOperationId?: string;
    }
  | { type: "device.revoked"; publicKey: string }
  | { type: "host.addresses"; addresses: string[] }
  | { type: "host.relay"; relay?: RelaySettings }
  | ReadingChangedEvent
  | {
      type: "invite.status";
      operationId: string;
      status: "expired" | "invalidated";
    }
  | TerminalEvent
  | { type: "forge.settings.changed" }
  /** A Forgejo/Gitea token was registered, replaced or removed on the Host. */
  | { type: "forge.token.changed"; origin: string }
  | { type: "forge.changed"; path: string; status: ForgeStatus }
  | { type: "folders.changed" }
  | {
      type: "worktrees.changed";
      repositoryPath: string;
      worktrees: Worktree[];
    };

export class ProtocolValidationError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = "ProtocolValidationError";
    this.code = code;
  }
}

export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameError";
  }
}

export interface ValueSchema<T> {
  parse(value: unknown): T;
}

function fail(message: string): never {
  throw new ProtocolValidationError("invalid_request", message);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("expected object");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string") return fail(`${field} must be a string`);
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  const parsed = string(value, field);
  if (parsed.length === 0) return fail(`${field} must not be empty`);
  return parsed;
}

/** A blank first instruction sends nothing, as an empty field does. */
function launchInstruction(value: unknown): { instruction?: string } {
  if (value === undefined) return {};
  const instruction = string(value, "instruction");
  return instruction.trim() ? { instruction } : {};
}

export function hostPath(value: unknown, field: string): string {
  const parsed = nonEmptyString(value, field);
  if (
    parsed.includes("\0") ||
    (!parsed.startsWith("/") &&
      !/^[A-Za-z]:[\\/]/u.test(parsed) &&
      !/^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/u.test(parsed))
  ) {
    return fail(`${field} must be an absolute path`);
  }
  return parsed;
}

function displayName(value: unknown, field: string): string {
  const parsed = string(value, field).trim();
  if (parsed.length === 0) return fail(`${field} must not be empty`);
  if ([...parsed].length > MAX_DISPLAY_NAME_CODE_POINTS) {
    return fail(
      `${field} must be at most ${MAX_DISPLAY_NAME_CODE_POINTS} characters`,
    );
  }
  if (/[\p{Cc}\p{Bidi_Control}]/u.test(parsed)) {
    return fail(`${field} must not contain control characters`);
  }
  return parsed;
}

function socketAddress(value: unknown, field: string): string {
  const parsed = nonEmptyString(value, field);
  const ipv4 = /^((?:\d{1,3}\.){3}\d{1,3}):(\d+)$/u.exec(parsed);
  if (ipv4) {
    const octets = ipv4[1]!.split(".").map(Number);
    const port = Number(ipv4[2]);
    if (octets.every((octet) => octet <= 255) && port >= 1 && port <= 65_535) {
      return parsed;
    }
    return fail(`${field} must be an IP address and port`);
  }
  const ipv6 = /^\[([0-9a-fA-F:.]+)\]:(\d+)$/u.exec(parsed);
  if (ipv6) {
    const port = Number(ipv6[2]);
    try {
      const url = new URL(`http://[${ipv6[1]}]/`);
      if (url.hostname && port >= 1 && port <= 65_535) return parsed;
    } catch {
      return fail(`${field} must be an IP address and port`);
    }
  }
  return fail(`${field} must be an IP address and port`);
}

function socketAddressArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) return fail(`${field} must be an array`);
  return value.map((item, index) => socketAddress(item, `${field}[${index}]`));
}

function publicKey(value: unknown, field: string): string {
  const parsed = string(value, field);
  if (!/^[0-9a-fA-F]{64}$/.test(parsed)) {
    return fail(`${field} must be a 32-byte hex key`);
  }
  return parsed.toLowerCase();
}

function secret(value: unknown): string {
  const parsed = string(value, "secret");
  if (!/^[A-Za-z0-9_-]{43}$/.test(parsed)) {
    return fail("secret must be a 32-byte base64url value");
  }
  const decoded = base64UrlDecode(parsed);
  if (decoded.length !== 32 || base64UrlEncode(decoded) !== parsed) {
    return fail("secret must be a canonical 32-byte base64url value");
  }
  return parsed;
}

function timestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail(`${field} must be a non-negative integer`);
  }
  return value;
}

export function relayUrl(value: unknown): string {
  const text = string(value, "Relay URL");
  try {
    const url = new URL(text);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return fail("Invalid Relay URL");
    return url.href;
  } catch {
    return fail("Invalid Relay URL");
  }
}

function parseRelaySettings(value: unknown): RelaySettings {
  const input = record(value);
  const token =
    input.token === undefined ? undefined : string(input.token, "Relay token");
  if (token !== undefined && !/^[\x21-\x7e]+$/.test(token))
    return fail("Invalid Relay token");
  return {
    url: relayUrl(input.url),
    ...(token === undefined ? {} : { token }),
  };
}

function optionalRelay(input: Record<string, unknown>): {
  relay?: RelaySettings;
} {
  return input.relay == null ? {} : { relay: parseRelaySettings(input.relay) };
}

function parseInvite(value: unknown): Invite {
  const input = record(value);
  if (input.version !== 1) return fail("unsupported invite version");
  return {
    version: 1,
    hostKey: publicKey(input.hostKey, "hostKey"),
    ...(input.relayUrl === undefined
      ? {}
      : { relayUrl: relayUrl(input.relayUrl) }),
    addresses: socketAddressArray(input.addresses, "addresses"),
    secret: secret(input.secret),
    expiresAt: timestamp(input.expiresAt, "expiresAt"),
    hostName: displayName(input.hostName, "hostName"),
  };
}

function parseDevice(value: unknown): Device {
  const input = record(value);
  return {
    publicKey: publicKey(input.publicKey, "publicKey"),
    name: displayName(input.name, "name"),
    registeredAt: timestamp(input.registeredAt, "registeredAt"),
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

function parseHostInfo(value: unknown): HostInfo {
  const input = record(value);
  return {
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

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") return fail(`${field} must be a boolean`);
  return value;
}

function terminalDimension(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 65_535
  ) {
    return fail(`${field} must be an integer from 1 to 65535`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail(`${field} must be a non-negative integer`);
  }
  return value;
}

function terminalState(value: unknown): TerminalState | undefined {
  if (value === "running" || value === "exited" || value === "error") {
    return value;
  }
  return undefined;
}

function parseTerminalSize(value: unknown, field: string): TerminalSize {
  const input = record(value);
  return {
    cols: terminalDimension(input.cols, `${field}.cols`),
    rows: terminalDimension(input.rows, `${field}.rows`),
  };
}

function parseTerminalViewRgb(value: unknown, field: string): TerminalViewRgb {
  if (!Array.isArray(value) || value.length !== 3) {
    return fail(`${field} must contain three RGB channels`);
  }
  const channels = value.map((channel, index) => {
    if (
      typeof channel !== "number" ||
      !Number.isInteger(channel) ||
      channel < 0 ||
      channel > 255
    ) {
      return fail(`${field}[${index}] must be an integer from 0 to 255`);
    }
    return channel;
  });
  return channels as TerminalViewRgb;
}

function parseTerminalViewAttributes(value: unknown): TerminalViewAttributes {
  const input = record(value);
  if (!Array.isArray(input.ansi) || input.ansi.length !== 256) {
    return fail("viewAttributes.ansi must contain 256 RGB colors");
  }
  if (input.colorSchemeMode !== "dark" && input.colorSchemeMode !== "light") {
    return fail("viewAttributes.colorSchemeMode must be dark or light");
  }
  if (
    input.cursorStyle !== "bar" &&
    input.cursorStyle !== "block" &&
    input.cursorStyle !== "underline"
  ) {
    return fail("viewAttributes.cursorStyle is unsupported");
  }
  if (typeof input.cursorBlink !== "boolean") {
    return fail("viewAttributes.cursorBlink must be a boolean");
  }
  return {
    foreground: parseTerminalViewRgb(
      input.foreground,
      "viewAttributes.foreground",
    ),
    background: parseTerminalViewRgb(
      input.background,
      "viewAttributes.background",
    ),
    cursor: parseTerminalViewRgb(input.cursor, "viewAttributes.cursor"),
    ansi: input.ansi.map((color, index) =>
      parseTerminalViewRgb(color, `viewAttributes.ansi[${index}]`),
    ),
    colorSchemeMode: input.colorSchemeMode,
    cursorStyle: input.cursorStyle,
    cursorBlink: input.cursorBlink,
  };
}

function readable<T>(
  parse: (value: unknown) => T,
  value: unknown,
): T | undefined {
  try {
    return parse(value);
  } catch {
    return undefined;
  }
}
function readableItems<T>(
  parse: (value: unknown) => T,
  values: unknown[],
): T[] {
  return values.flatMap((value) => {
    const item = readable(parse, value);
    return item === undefined ? [] : [item];
  });
}

function parseCliSummary(value: unknown): CliSummary {
  const input = record(value);
  const usage = parseCliUsage(input.usage);
  const icon = readable(record, input.icon);
  const support = parseCliSupport(input.support);
  const simple = readable(parseCliSimpleDefinition, input.simple);
  return {
    id: nonEmptyString(input.id, "cli.id"),
    name: nonEmptyString(input.name, "cli.name"),
    ...(typeof input.hidden === "boolean" ? { hidden: input.hidden } : {}),
    ...(typeof icon?.light === "string"
      ? {
          icon: {
            light: icon.light,
            ...(icon.source === "host" ? { source: "host" as const } : {}),
            ...(typeof icon.dark === "string" ? { dark: icon.dark } : {}),
          },
        }
      : {}),
    ...(typeof input.version === "string" && input.version
      ? { version: input.version }
      : {}),
    ...(typeof input.supportsUsage === "boolean"
      ? { supportsUsage: input.supportsUsage }
      : {}),
    ...(usage ? { usage } : {}),
    ...(typeof input.startupArguments === "string"
      ? { startupArguments: input.startupArguments }
      : {}),
    ...(input.source === "official" ||
    input.source === "bundled" ||
    input.source === "user" ||
    input.source === "override"
      ? { source: input.source }
      : {}),
    ...(input.missing === true ? { missing: true } : {}),
    ...(input.customIcon === true ? { customIcon: true } : {}),
    ...(support ? { support } : {}),
    ...(typeof input.definition === "string"
      ? { definition: input.definition }
      : {}),
    ...(simple ? { simple } : {}),
  };
}
const supportValues: CliSupport[] = ["available", "unavailable", "undefined"];
function parseCliSupport(value: unknown): CliSummary["support"] {
  const input = readable(record, value);
  if (!input) return undefined;
  const entries = CLI_FEATURES.map(
    (feature) => [feature, input[feature]] as const,
  );
  return entries.every(([, support]) =>
    supportValues.includes(support as CliSupport),
  )
    ? (Object.fromEntries(entries) as CliSummary["support"])
    : undefined;
}
function parseCliDefinitionFailure(value: unknown): CliDefinitionFailure {
  const input = record(value);
  return {
    folder: nonEmptyString(input.folder, "folder"),
    reason: record(input.reason) as CliDefinitionReason,
    definition: string(input.definition, "definition"),
  };
}
function parseChildSummary(value: unknown): import("./teams.ts").ChildSummary {
  const input = record(value);
  const state = input.state;
  if (
    state !== "waiting" &&
    state !== "starting" &&
    state !== "running" &&
    state !== "reported" &&
    state !== "question" &&
    state !== "stopped" &&
    state !== "failed" &&
    state !== "finished"
  )
    return fail("invalid child state");
  if (
    input.waiting !== undefined &&
    input.waiting !== "capacity" &&
    input.waiting !== "candidates"
  )
    return fail("invalid child waiting reason");
  if (
    input.stoppedBy !== undefined &&
    input.stoppedBy !== "parent" &&
    input.stoppedBy !== "user" &&
    input.stoppedBy !== "host_restart" &&
    input.stoppedBy !== "parent_exit"
  )
    return fail("invalid child stop reason");
  if (
    input.decision !== undefined &&
    input.decision !== "accept" &&
    input.decision !== "reject"
  )
    return fail("invalid child decision");
  const optionalNumber = (field: string) => {
    const value = input[field];
    if (value === undefined) return {};
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      return fail(`invalid child ${field}`);
    return { [field]: value };
  };
  const optionalText = (field: string) =>
    input[field] === undefined
      ? {}
      : { [field]: string(input[field], `child.${field}`) };
  const cliStatus = parseCliStatus(input.cliStatus);
  return {
    id: nonEmptyString(input.id, "child.id"),
    createdAt: timestamp(input.createdAt, "child.createdAt"),
    conversation: nonEmptyString(input.conversation, "child.conversation"),
    parentTerminalId: nonEmptyString(
      input.parentTerminalId,
      "child.parentTerminalId",
    ),
    parentCwd: hostPath(input.parentCwd, "child.parentCwd"),
    teamId: nonEmptyString(input.teamId, "child.teamId"),
    role: string(input.role, "child.role"),
    title: string(input.title, "child.title"),
    state,
    ...optionalText("terminalId"),
    ...(input.worktreeRemoved === undefined
      ? {}
      : {
          worktreeRemoved: boolean(
            input.worktreeRemoved,
            "child.worktreeRemoved",
          ),
        }),
    ...optionalText("repositoryName"),
    ...optionalText("branch"),
    ...(input.cwd === undefined
      ? {}
      : { cwd: hostPath(input.cwd, "child.cwd") }),
    ...(input.cli === undefined
      ? {}
      : { cli: readable(parseCliSummary, input.cli) }),
    ...(cliStatus ? { cliStatus } : {}),
    ...optionalText("model"),
    ...optionalText("reason"),
    ...optionalText("failure"),
    ...optionalNumber("startedAt"),
    ...optionalNumber("elapsedMs"),
    ...(input.waiting === undefined ? {} : { waiting: input.waiting }),
    ...(input.stoppedBy === undefined ? {} : { stoppedBy: input.stoppedBy }),
    ...(input.decision === undefined ? {} : { decision: input.decision }),
    ...(input.notified === undefined
      ? {}
      : {
          notified:
            typeof input.notified === "boolean"
              ? input.notified
              : fail("invalid child.notified"),
        }),
  };
}
function parseChildrenResult(value: unknown): {
  children: import("./teams.ts").ChildSummary[];
} {
  const input = record(value);
  if (!Array.isArray(input.children)) return fail("children must be an array");
  return { children: readableItems(parseChildSummary, input.children) };
}
function parseCliListResult(value: unknown): CliListResult {
  const input = record(value);
  if (!Array.isArray(input.clis)) return fail("clis must be an array");
  return {
    ...(typeof input.shell === "string" ? { shell: input.shell } : {}),
    clis: readableItems(parseCliSummary, input.clis).map((cli) => ({
      ...cli,
      hidden: cli.hidden === true,
    })),
    ...(typeof input.lastUsedId === "string"
      ? { lastUsedId: input.lastUsedId }
      : {}),
    ...(Array.isArray(input.failed)
      ? { failed: readableItems(parseCliDefinitionFailure, input.failed) }
      : {}),
  };
}
function cliStartupArguments(value: unknown): string {
  const text = string(value, "arguments");
  if (text.length > 4096 || /[\u0000-\u001f\u007f]/u.test(text))
    return fail("arguments is invalid");
  return text;
}

function parseSetupState(
  value: unknown,
): NonNullable<TerminalSummary["setup"]> {
  const input = record(value);
  if (input.state !== "running" && input.state !== "failed")
    return fail("Unsupported setup state");
  if (
    input.exitCode !== undefined &&
    (typeof input.exitCode !== "number" ||
      !Number.isSafeInteger(input.exitCode))
  )
    return fail("Invalid setup exit code");
  return {
    state: input.state,
    ...(input.exitCode === undefined
      ? {}
      : { exitCode: input.exitCode as number }),
  };
}

function parseTerminalSummary(value: unknown): TerminalSummary {
  const input = record(value);
  const cliStatus =
    input.cliStatus === undefined ? undefined : parseCliStatus(input.cliStatus);
  return {
    id: nonEmptyString(input.id, "terminal.id"),
    createdAt: timestamp(input.createdAt, "terminal.createdAt"),
    shell: nonEmptyString(input.shell, "terminal.shell"),
    cwd: nonEmptyString(input.cwd, "terminal.cwd"),
    ...(typeof input.worktreePath === "string"
      ? { worktreePath: input.worktreePath }
      : {}),
    ...(input.cwdFromShell === true ? { cwdFromShell: true } : {}),
    title: string(input.title, "terminal.title"),
    ...(input.cli === undefined
      ? {}
      : { cli: readable(parseCliSummary, input.cli) }),
    ...(cliStatus ? { cliStatus } : {}),
    ...(input.setup === undefined
      ? {}
      : { setup: parseSetupState(input.setup) }),
    state: terminalState(input.state),
    ...(input.exitCode === null ||
    (typeof input.exitCode === "number" && Number.isSafeInteger(input.exitCode))
      ? { exitCode: input.exitCode }
      : {}),
    cols: terminalDimension(input.cols, "terminal.cols"),
    rows: terminalDimension(input.rows, "terminal.rows"),
    lastDesktopSize: parseTerminalSize(
      input.lastDesktopSize,
      "terminal.lastDesktopSize",
    ),
    ...(typeof input.teamConversation === "string"
      ? { teamConversation: input.teamConversation }
      : {}),
    ...(typeof input.teamChild === "string" && input.teamChild
      ? { teamChild: input.teamChild }
      : {}),
    ...(input.cliResumeReason === "exit"
      ? { cliResumeReason: "exit" as const }
      : {}),
    ...(input.cliResumePending === true ? { cliResumePending: true } : {}),
    ...(input.restartPending === true ? { restartPending: true } : {}),
  };
}

function parseTerminalShell(value: unknown): TerminalShell {
  const input = record(value);
  return {
    id: nonEmptyString(input.id, "shell.id"),
    label: nonEmptyString(input.label, "shell.label"),
  };
}

function parseTerminalWindowsPty(value: unknown): TerminalWindowsPty {
  const input = record(value);
  if (input.backend !== "conpty" && input.backend !== "winpty") {
    return fail("windowsPty.backend is unsupported");
  }
  return {
    backend: input.backend,
    ...(typeof input.buildNumber === "number" &&
    Number.isSafeInteger(input.buildNumber) &&
    input.buildNumber > 0
      ? { buildNumber: input.buildNumber }
      : {}),
  };
}

function parseTerminalListResult(value: unknown): TerminalListResult {
  const input = record(value);
  if (!Array.isArray(input.terminals))
    return fail("terminals must be an array");
  if (!Array.isArray(input.shells)) return fail("shells must be an array");
  return {
    terminals: readableItems(parseTerminalSummary, input.terminals),
    shells: readableItems(parseTerminalShell, input.shells),
    defaultShell: nonEmptyString(input.defaultShell, "defaultShell"),
    homeDirectory: nonEmptyString(input.homeDirectory, "homeDirectory"),
    ...(input.windowsPty === undefined
      ? {}
      : { windowsPty: readable(parseTerminalWindowsPty, input.windowsPty) }),
  };
}

function parseTerminalCreatedResult(value: unknown): TerminalCreatedResult {
  const input = record(value);
  return { terminal: parseTerminalSummary(input.terminal) };
}

function parseTerminalClosedResult(value: unknown): TerminalClosedResult {
  const input = record(value);
  return {
    terminalId: nonEmptyString(input.terminalId, "terminalId"),
    ...(input.command === undefined
      ? {}
      : { command: nonEmptyString(input.command, "command") }),
    ...(input.confirmationRequired === true
      ? { confirmationRequired: true }
      : {}),
  };
}

function parseTerminalDefaultShellResult(
  value: unknown,
): TerminalDefaultShellResult {
  const input = record(value);
  return { shell: nonEmptyString(input.shell, "shell") };
}

function parseTerminalModes(value: unknown): TerminalModes {
  const input = record(value);
  const trackingMode = input.mouseTrackingMode;
  return {
    bracketedPaste: input.bracketedPaste === true,
    mouseTracking: input.mouseTracking === true,
    ...(["none", "x10", "vt200", "drag", "any"].includes(String(trackingMode))
      ? { mouseTrackingMode: trackingMode as TerminalMouseTrackingMode }
      : {}),
    sgrMouseMode: input.sgrMouseMode === true,
    sgrMousePixelsMode: input.sgrMousePixelsMode === true,
    applicationCursor: input.applicationCursor === true,
    alternateScreen: input.alternateScreen === true,
    kittyKeyboardFlags:
      typeof input.kittyKeyboardFlags === "number" &&
      Number.isSafeInteger(input.kittyKeyboardFlags)
        ? input.kittyKeyboardFlags
        : 0,
  };
}

function parseTerminalOscLinkRange(value: unknown): TerminalOscLinkRange {
  const input = record(value);
  return {
    row: nonNegativeInteger(input.row, "oscLink.row"),
    startCol: nonNegativeInteger(input.startCol, "oscLink.startCol"),
    endCol: nonNegativeInteger(input.endCol, "oscLink.endCol"),
    uri: nonEmptyString(input.uri, "oscLink.uri"),
  };
}

export function parseTerminalSnapshot(value: unknown): TerminalSnapshot {
  const input = record(value);
  const snapshot: TerminalSnapshot = {
    snapshotAnsi: string(input.snapshotAnsi, "snapshotAnsi"),
    scrollbackAnsi: string(input.scrollbackAnsi, "scrollbackAnsi"),
    rehydrateSequences: string(input.rehydrateSequences, "rehydrateSequences"),
    modes: parseTerminalModes(input.modes),
    cols: terminalDimension(input.cols, "snapshot.cols"),
    rows: terminalDimension(input.rows, "snapshot.rows"),
    ...(typeof input.frameRestoreAnsi === "string"
      ? { frameRestoreAnsi: input.frameRestoreAnsi }
      : {}),
    ...(typeof input.pendingEscapeTailAnsi === "string"
      ? { pendingEscapeTailAnsi: input.pendingEscapeTailAnsi }
      : {}),
  };
  if (Array.isArray(input.oscLinks)) {
    snapshot.oscLinks = readableItems(
      parseTerminalOscLinkRange,
      input.oscLinks,
    );
  }
  if (input.scrollbackTruncated === true) snapshot.scrollbackTruncated = true;
  return snapshot;
}

function parseTerminalOpenStream(value: unknown): TerminalOpenStream {
  const input = record(value);
  if (input.kind !== "terminal" || input.action !== "open") {
    return fail("unsupported terminal stream action");
  }
  const maxLines = input.snapshotMaxLines;
  const maxBytes = input.snapshotMaxBytes;
  if (
    typeof maxLines !== "number" ||
    !Number.isSafeInteger(maxLines) ||
    maxLines < 1 ||
    maxLines > MAX_TERMINAL_SNAPSHOT_LINES
  ) {
    return fail("snapshotMaxLines is out of range");
  }
  if (
    typeof maxBytes !== "number" ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_TERMINAL_SNAPSHOT_BYTES
  ) {
    return fail("snapshotMaxBytes is out of range");
  }
  if (input.claimSize !== undefined && typeof input.claimSize !== "boolean") {
    return fail("claimSize must be a boolean");
  }
  return {
    kind: "terminal",
    operationId: nonEmptyString(input.operationId, "operationId"),
    action: "open",
    terminalId: nonEmptyString(input.terminalId, "terminalId"),
    viewId: nonEmptyString(input.viewId, "viewId"),
    viewAttributes: parseTerminalViewAttributes(input.viewAttributes),
    deviceClass:
      input.deviceClass === "desktop" || input.deviceClass === "mobile"
        ? input.deviceClass
        : fail("deviceClass must be desktop or mobile"),
    ...(input.claimSize === undefined ? {} : { claimSize: input.claimSize }),
    cols: terminalDimension(input.cols, "cols"),
    rows: terminalDimension(input.rows, "rows"),
    snapshotMaxLines: maxLines,
    snapshotMaxBytes: maxBytes,
  };
}

function parseTerminalClientMessage(
  value: unknown,
): TerminalClientMessage | undefined {
  const input = record(value);
  switch (input.kind) {
    case "terminal.input":
      return {
        kind: "terminal.input",
        data: string(input.data, "data"),
        ...(input.origin === "scroll" ? { origin: "scroll" as const } : {}),
      };
    case "terminal.submit":
      return { kind: "terminal.submit", data: string(input.data, "data") };
    case "terminal.seen":
      return { kind: "terminal.seen" };
    case "terminal.resize":
    case "terminal.focus":
      return {
        kind: input.kind,
        cols: terminalDimension(input.cols, "cols"),
        rows: terminalDimension(input.rows, "rows"),
      };
    case "terminal.theme":
      return {
        kind: "terminal.theme",
        viewAttributes: parseTerminalViewAttributes(input.viewAttributes),
      };
    default:
      return undefined;
  }
}

function parseTerminalServerMessage(
  value: unknown,
): TerminalServerMessage | undefined {
  const input = record(value);
  switch (input.kind) {
    case "terminal.snapshot":
      return {
        kind: "terminal.snapshot",
        terminal: parseTerminalSummary(input.terminal),
        snapshot: parseTerminalSnapshot(input.snapshot),
        sequence: typeof input.sequence === "number" ? input.sequence : 0,
        // No view has claimed a restarted PTY yet; Host represents that as "".
        sizeOwnerViewId: string(input.sizeOwnerViewId, "sizeOwnerViewId"),
      };
    case "terminal.output":
      return {
        kind: "terminal.output",
        data: string(input.data, "data"),
        sequence: typeof input.sequence === "number" ? input.sequence : 0,
      };
    case "terminal.size":
      return {
        kind: "terminal.size",
        cols: terminalDimension(input.cols, "cols"),
        rows: terminalDimension(input.rows, "rows"),
        lastDesktopSize: parseTerminalSize(
          input.lastDesktopSize,
          "lastDesktopSize",
        ),
        sizeOwnerViewId: string(input.sizeOwnerViewId, "sizeOwnerViewId"),
      };
    case "terminal.exit":
      return {
        kind: "terminal.exit",
        code: typeof input.code === "number" ? input.code : null,
        signal: typeof input.signal === "number" ? input.signal : null,
      };
    case "terminal.error":
      return {
        kind: "terminal.error",
        message: nonEmptyString(input.message, "message"),
      };
    default:
      return undefined;
  }
}

function parseFolderEntry(value: unknown): FolderEntry {
  const input = record(value);
  return {
    name: nonEmptyString(input.name, "name"),
    path: hostPath(input.path, "path"),
  };
}

function forgeRemoteHost(value: unknown): string {
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
function parseForgeMapping(value: unknown): ForgeMapping {
  const input = record(value);
  return {
    remoteHost: forgeRemoteHost(input.remoteHost),
    webUrl: forgeWebUrl(input.webUrl),
  };
}
function parseGitHubAccounts(value: unknown): GitHubAccounts {
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
function parseRepositoryGitValues(value: unknown) {
  const input = record(value);
  return {
    setupCommand: string(input.setupCommand, "setupCommand"),
    githubAccount: string(input.githubAccount, "githubAccount"),
  };
}
function parseRepositoryGitSettings(value: unknown): RepositoryGitSettings {
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

function parseForgeStatus(value: unknown): ForgeStatus {
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

function parseWorktree(value: unknown): Worktree {
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
      : { commits: timestamp(input.commits, "commits") }),
    ...(typeof input.detachedCommits === "number" &&
    Number.isInteger(input.detachedCommits) &&
    input.detachedCommits > 0
      ? { detachedCommits: input.detachedCommits }
      : {}),
    ...(input.target === undefined
      ? {}
      : { target: string(input.target, "target") }),
    changes: {
      files: timestamp(changes.files, "files"),
      added: timestamp(changes.added, "added"),
      removed: timestamp(changes.removed, "removed"),
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
function parseRemovalPreview(value: unknown): WorktreeRemovalPreview {
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
function parseRemovalResult(value: unknown): WorktreeRemovalResult {
  const input = record(value);
  if (!Array.isArray(input.outcomes)) return fail("outcomes must be an array");
  return {
    outcomes: input.outcomes.map((value) => {
      const item = record(value);
      return {
        path: hostPath(item.path, "path"),
        removed: boolean(item.removed, "removed"),
        ...(item.error === undefined
          ? {}
          : { error: string(item.error, "error") }),
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
    openedAt: timestamp(input.openedAt, "openedAt"),
    inSidebar: input.inSidebar,
    ...(input.sidebarPosition === undefined
      ? {}
      : {
          sidebarPosition: timestamp(input.sidebarPosition, "sidebarPosition"),
        }),
    ...(worktrees === undefined
      ? {}
      : { worktrees: worktrees.map(parseWorktree) }),
  };
}

function parsePairResult(value: unknown): ResultByMethod["pair"] {
  const input = record(value);
  return {
    device: parseDevice(input.device),
    host: parseHostInfo(input.host),
  };
}

function parseDevicesListResult(
  value: unknown,
): ResultByMethod["devices.list"] {
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

function parseInviteCreateResult(
  value: unknown,
): ResultByMethod["invite.create"] {
  const input = record(value);
  return { invite: parseInvite(input.invite) };
}

function parseRevokeResult(value: unknown): ResultByMethod["devices.revoke"] {
  const input = record(value);
  return { publicKey: publicKey(input.publicKey, "publicKey") };
}

function parseFoldersBrowseResult(
  value: unknown,
): ResultByMethod["folders.browse"] {
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

function parseFoldersHistoryResult(
  value: unknown,
): ResultByMethod["folders.history"] {
  const input = record(value);
  if (!Array.isArray(input.folders)) return fail("folders must be an array");
  return { folders: input.folders.map(parseFolderHistoryItem) };
}

function parseFoldersOpenResult(
  value: unknown,
): ResultByMethod["folders.open"] {
  const input = record(value);
  return { folder: parseFolderHistoryItem(input.folder) };
}

function parseFoldersSidebarRemoveResult(
  value: unknown,
): ResultByMethod["folders.sidebar.remove"] {
  const input = record(value);
  return { path: hostPath(input.path, "path") };
}

function parseWorktreeCreation(value: unknown): WorktreeCreation {
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

export const inviteSchema: ValueSchema<Invite> = { parse: parseInvite };

export const resultSchemas: {
  [M in RequestMethod]: ValueSchema<ResultByMethod[M]>;
} = {
  ...readResultSchemas,
  ...filesTransferResultSchemas,
  ...automationResultSchemas,
  ...forgeIntegrationResultSchemas,
  ...forgeIssueResultSchemas,
  ...forgeCiResultSchemas,
  ...teamResultSchemas,
  "teams.children": { parse: parseChildrenResult },
  pair: { parse: parsePairResult },
  "devices.list": { parse: parseDevicesListResult },
  "invite.create": { parse: parseInviteCreateResult },
  "devices.revoke": { parse: parseRevokeResult },
  "host.info": { parse: parseHostInfo },
  "host.relay.set": { parse: (value) => optionalRelay(record(value)) },
  "host.update.prepare": { parse: parseMaintenancePlan },
  "host.restart.prepare": { parse: parseMaintenancePlan },
  "host.update": { parse: parseMaintenanceStatus },
  "host.restart": { parse: parseMaintenanceStatus },
  "host.uninstall.prepare": { parse: parseMaintenancePlan },
  "host.uninstall": { parse: parseMaintenanceStatus },
  "host.maintenance.status": { parse: parseMaintenanceLookup },
  "cli.list": { parse: parseCliListResult },
  ...cliDefinitionResultSchemas,
  "cli.hidden.set": {
    parse: (value: unknown) => ({
      cliId: nonEmptyString(record(value).cliId, "cliId"),
      hidden: boolean(record(value).hidden, "hidden"),
    }),
  },
  "cli.arguments.set": {
    parse: (value: unknown) => ({
      cliId: nonEmptyString(record(value).cliId, "cliId"),
      arguments: string(record(value).arguments, "arguments"),
    }),
  },
  "cli.launch": { parse: parseTerminalCreatedResult },
  "team.launch": { parse: parseTerminalCreatedResult },
  "terminal.list": { parse: parseTerminalListResult },
  "terminal.create": { parse: parseTerminalCreatedResult },
  "terminal.setup": { parse: parseTerminalCreatedResult },
  "cli.resume": { parse: parseTerminalCreatedResult },
  "terminal.image.write": {
    parse: (value) => ({ path: string(record(value).path, "path") }),
  },
  "terminal.close": { parse: parseTerminalClosedResult },
  "terminal.defaultShell.set": { parse: parseTerminalDefaultShellResult },
  "github.accounts": { parse: parseGitHubAccounts },
  "repository.git.settings": { parse: parseRepositoryGitSettings },
  "repository.git.set": { parse: parseRepositoryGitValues },
  "forge.mapping.set": {
    parse: (value) => ({ mapping: parseForgeMapping(record(value).mapping) }),
  },
  "forge.mapping.remove": {
    parse: (value) => ({
      remoteHost: forgeRemoteHost(record(value).remoteHost),
    }),
  },
  "forge.watch": { parse: () => ({}) },
  "worktrees.preview": { parse: parseRemovalPreview },
  "worktrees.cleanup": { parse: parseRemovalPreview },
  "worktrees.remove": { parse: parseRemovalResult },
  "worktrees.options": {
    parse: (value) => {
      const input = record(value);
      if (!Array.isArray(input.branches))
        return fail("branches must be an array");
      return {
        mainPath: string(input.mainPath, "mainPath"),
        branches: input.branches.map((v) => string(v, "branch")),
        defaultBranch: string(input.defaultBranch, "defaultBranch"),
        setupCommand: string(input.setupCommand, "setupCommand"),
      };
    },
  },
  "worktrees.create": { parse: parseWorktreeCreation },
  "worktrees.creation": {
    parse: (value) => {
      const input = record(value);
      return input.creation === undefined
        ? {}
        : { creation: parseWorktreeCreation(input.creation) };
    },
  },
  "folders.browse": { parse: parseFoldersBrowseResult },
  "folders.history": {
    parse: (value) => parseFoldersHistoryResult(value),
  },
  "folders.open": { parse: parseFoldersOpenResult },
  "folders.sidebar.reorder": {
    parse: (value) => {
      const input = record(value);
      if (!Array.isArray(input.paths)) return fail("paths must be an array");
      return { paths: input.paths.map((path) => hostPath(path, "path")) };
    },
  },
  "folders.sidebar.remove": { parse: parseFoldersSidebarRemoveResult },
};

export function parseResult<M extends RequestMethod>(
  method: M,
  value: unknown,
): ResultByMethod[M] {
  return resultSchemas[method].parse(value);
}

function emptyParams(value: unknown): Record<string, never> {
  record(value);
  return {};
}

export function parseRequest(value: unknown): Request {
  const input = record(value);
  if (input.kind === "subscribe" && input.method === "reading.watch") {
    return parseReadingWatchRequest(input);
  }
  if (input.kind === "request" && isReadMethod(input.method)) {
    return parseReadRequest(input);
  }
  const operationId = nonEmptyString(input.operationId, "operationId");
  const params = record(input.params);

  if (input.kind === "subscribe" && input.method === "events") {
    return {
      kind: "subscribe",
      operationId,
      method: "events",
      params: emptyParams(params),
    };
  }
  if (input.kind !== "request") return fail("unsupported stream kind");

  if (isMaintenanceMethod(input.method))
    return {
      kind: "request",
      operationId,
      method: input.method,
      params: parseMaintenanceParams(input.method, params),
    } as RequestByMethod;

  if (isAutomationMethod(input.method))
    return {
      kind: "request",
      operationId,
      method: input.method,
      params: parseAutomationParams(input.method, params),
    } as RequestByMethod;

  if (isForgeIntegrationMethod(input.method))
    return {
      kind: "request",
      operationId,
      method: input.method,
      params: parseForgeIntegrationParams(input.method, params),
    } as RequestByMethod;

  if (isForgeIssueMethod(input.method))
    return {
      kind: "request",
      operationId,
      method: input.method,
      params: parseForgeIssueParams(input.method, params),
    } as RequestByMethod;

  if (isForgeCiMethod(input.method))
    return {
      kind: "request",
      operationId,
      method: input.method,
      params: parseForgeCiParams(input.method, params),
    } as RequestByMethod;

  if (isTeamMethod(input.method))
    return {
      kind: "request",
      operationId,
      method: input.method,
      params: parseTeamParams(input.method, params),
    } as RequestByMethod;

  if (isFilesTransferMethod(input.method))
    return {
      kind: "request",
      operationId,
      method: input.method,
      params: parseFilesTransferParams(input.method, params),
    } as Request;
  if (isCliDefinitionMethod(input.method))
    return {
      kind: "request",
      operationId,
      method: input.method,
      params: parseCliDefinitionParams(input.method, params),
    } as RequestByMethod;

  switch (input.method) {
    case "pair":
      return {
        kind: "request",
        operationId,
        method: "pair",
        params: {
          secret: secret(params.secret),
          deviceName: displayName(params.deviceName, "deviceName"),
        },
      };
    case "devices.list":
    case "invite.create":
    case "host.info":
      return {
        kind: "request",
        operationId,
        method: input.method,
        params: emptyParams(params),
      };
    case "host.relay.set":
      return {
        kind: "request",
        operationId,
        method: "host.relay.set",
        params: optionalRelay(params),
      };
    case "devices.revoke":
      return {
        kind: "request",
        operationId,
        method: "devices.revoke",
        params: { publicKey: publicKey(params.publicKey, "publicKey") },
      };
    case "cli.list":
      return {
        kind: "request",
        operationId,
        method: "cli.list",
        params:
          params.refreshUsage === undefined
            ? {}
            : { refreshUsage: boolean(params.refreshUsage, "refreshUsage") },
      };
    case "cli.hidden.set":
      return {
        kind: "request",
        operationId,
        method: input.method,
        params: {
          cliId: nonEmptyString(params.cliId, "cliId"),
          hidden: boolean(params.hidden, "hidden"),
        },
      };
    case "cli.arguments.set":
      return {
        kind: "request",
        operationId,
        method: input.method,
        params: {
          cliId: nonEmptyString(params.cliId, "cliId"),
          arguments: cliStartupArguments(params.arguments),
        },
      };
    case "team.launch":
      return {
        kind: "request",
        operationId,
        method: "team.launch",
        params: {
          teamId: nonEmptyString(params.teamId, "teamId"),
          cwd: nonEmptyString(params.cwd, "cwd"),
          ...(params.setupWorktree === true ? { setupWorktree: true } : {}),
          ...launchInstruction(params.instruction),
        },
      };
    case "cli.launch":
      return {
        kind: "request",
        operationId,
        method: "cli.launch",
        params: {
          cliId: nonEmptyString(params.cliId, "cliId"),
          cwd: nonEmptyString(params.cwd, "cwd"),
          ...(params.setupWorktree === true ? { setupWorktree: true } : {}),
          ...launchInstruction(params.instruction),
        },
      };
    case "terminal.list":
      return {
        kind: "request",
        operationId,
        method: "terminal.list",
        params: emptyParams(params),
      };
    case "terminal.create":
      return {
        kind: "request",
        operationId,
        method: "terminal.create",
        params: {
          cwd: nonEmptyString(params.cwd, "cwd"),
          ...(params.shell === undefined
            ? {}
            : { shell: nonEmptyString(params.shell, "shell") }),
        },
      };
    case "terminal.setup":
      if (params.action !== "retry" && params.action !== "skip")
        return fail("Unsupported setup action");
      return {
        kind: "request",
        operationId,
        method: "terminal.setup",
        params: {
          terminalId: nonEmptyString(params.terminalId, "terminalId"),
          action: params.action,
        },
      };
    case "cli.resume":
      return {
        kind: "request",
        operationId,
        method: "cli.resume",
        params: {
          terminalId: nonEmptyString(params.terminalId, "terminalId"),
        },
      };
    case "terminal.image.write": {
      if (!isTerminalImageExtension(params.extension))
        return fail("invalid image extension");
      const imageId = nonEmptyString(params.imageId, "imageId");
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
          imageId,
        )
      )
        return fail("invalid imageId");
      const data = nonEmptyString(params.data, "data");
      if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(data))
        return fail("invalid image data");
      if (typeof params.first !== "boolean" || typeof params.last !== "boolean")
        return fail("invalid image chunk");
      return {
        kind: "request",
        operationId,
        method: "terminal.image.write",
        params: {
          terminalId: nonEmptyString(params.terminalId, "terminalId"),
          imageId,
          extension: params.extension,
          data,
          first: params.first,
          last: params.last,
        },
      };
    }
    case "terminal.close":
      if (params.confirm !== undefined && typeof params.confirm !== "boolean") {
        return fail("confirm must be a boolean");
      }
      return {
        kind: "request",
        operationId,
        method: "terminal.close",
        params: {
          terminalId: nonEmptyString(params.terminalId, "terminalId"),
          ...(params.confirm === undefined ? {} : { confirm: params.confirm }),
        },
      };
    case "terminal.defaultShell.set":
      return {
        kind: "request",
        operationId,
        method: "terminal.defaultShell.set",
        params: { shell: nonEmptyString(params.shell, "shell") },
      };
    case "github.accounts":
      return {
        kind: "request",
        operationId,
        method: "github.accounts",
        params: {},
      };
    case "repository.git.settings":
      return {
        kind: "request",
        operationId,
        method: "repository.git.settings",
        params: { path: hostPath(params.path, "path") },
      };
    case "repository.git.set":
      return {
        kind: "request",
        operationId,
        method: "repository.git.set",
        params: {
          path: hostPath(params.path, "path"),
          ...(params.setupCommand === undefined
            ? {}
            : { setupCommand: string(params.setupCommand, "setupCommand") }),
          ...(params.githubAccount === undefined
            ? {}
            : { githubAccount: string(params.githubAccount, "githubAccount") }),
        },
      };
    case "forge.mapping.set":
      return {
        kind: "request",
        operationId,
        method: "forge.mapping.set",
        params: {
          ...parseForgeMapping(params),
        },
      };
    case "forge.mapping.remove":
      return {
        kind: "request",
        operationId,
        method: "forge.mapping.remove",
        params: { remoteHost: forgeRemoteHost(params.remoteHost) },
      };
    case "forge.watch":
      if (!Array.isArray(params.paths)) return fail("paths must be an array");
      return {
        kind: "request",
        operationId,
        method: "forge.watch",
        params: {
          paths: params.paths.map((path) => hostPath(path, "path")),
          ...(params.selected === undefined
            ? {}
            : { selected: hostPath(params.selected, "selected") }),
        },
      };
    case "worktrees.preview":
    case "worktrees.cleanup":
      return {
        kind: "request",
        operationId,
        method: input.method,
        params: { path: hostPath(params.path, "path") },
      };
    case "worktrees.remove":
      if (!Array.isArray(params.paths)) return fail("paths must be an array");
      if (!Array.isArray(params.branches))
        return fail("branches must be an array");
      return {
        kind: "request",
        operationId,
        method: "worktrees.remove",
        params: {
          previewId: nonEmptyString(params.previewId, "previewId"),
          paths: params.paths.map((path) => hostPath(path, "path")),
          branches: params.branches.map((branch) =>
            nonEmptyString(branch, "branch"),
          ),
        },
      };
    case "worktrees.options":
      return {
        kind: "request",
        operationId,
        method: "worktrees.options",
        params: { path: hostPath(params.path, "path") },
      };
    case "worktrees.create":
      return {
        kind: "request",
        operationId,
        method: "worktrees.create",
        params: {
          path: hostPath(params.path, "path"),
          name: string(params.name, "name"),
          baseBranch: nonEmptyString(params.baseBranch, "baseBranch"),
          setupCommand: string(params.setupCommand, "setupCommand"),
        },
      };
    case "worktrees.creation":
      return {
        kind: "request",
        operationId,
        method: "worktrees.creation",
        params: { creationId: nonEmptyString(params.creationId, "creationId") },
      };
    case "folders.browse":
      return {
        kind: "request",
        operationId,
        method: "folders.browse",
        params: {
          ...(params.path === undefined
            ? {}
            : { path: hostPath(params.path, "path") }),
        },
      };
    case "folders.history":
      return {
        kind: "request",
        operationId,
        method: "folders.history",
        params: emptyParams(params),
      };
    case "folders.open":
      return {
        kind: "request",
        operationId,
        method: "folders.open",
        params: { path: hostPath(params.path, "path") },
      };
    case "folders.sidebar.reorder":
      if (!Array.isArray(params.paths)) return fail("paths must be an array");
      return {
        kind: "request",
        operationId,
        method: "folders.sidebar.reorder",
        params: { paths: params.paths.map((path) => hostPath(path, "path")) },
      };
    case "folders.sidebar.remove":
      return {
        kind: "request",
        operationId,
        method: "folders.sidebar.remove",
        params: { path: hostPath(params.path, "path") },
      };
    default:
      return fail("unsupported request method");
  }
}

export const requestSchema: ValueSchema<Request> = { parse: parseRequest };

export const terminalOpenStreamSchema: ValueSchema<TerminalOpenStream> = {
  parse: parseTerminalOpenStream,
};

export const terminalClientMessageSchema: ValueSchema<
  TerminalClientMessage | undefined
> = {
  parse: parseTerminalClientMessage,
};

export const terminalServerMessageSchema: ValueSchema<
  TerminalServerMessage | undefined
> = {
  parse: parseTerminalServerMessage,
};

export const responseSchema: ValueSchema<ReceivedResponse> = {
  parse(value) {
    const input = record(value);
    if (input.ok === true) return { ok: true, result: input.result };
    if (input.ok === false) {
      const error = record(input.error);
      return {
        ok: false,
        error: {
          code: string(error.code, "error.code"),
          // The registered Host's own reason for a Forge read, taken as is.
          ...(error.forge === undefined
            ? {}
            : { forge: error.forge as ForgeReadFailure }),
        },
      };
    }
    return fail("response must contain ok");
  },
};

export function parseResponse<M extends RequestMethod>(
  method: M,
  value: unknown,
): ReceivedResponse<ResultByMethod[M]> {
  const response = responseSchema.parse(value);
  if (!response.ok) return response;
  return { ok: true, result: parseResult(method, response.result) };
}

function parseEvent(value: unknown): Event | undefined {
  const input = record(value);
  switch (input.type) {
    case "automation.changed":
      return { type: "automation.changed" };
    case "host.maintenance.changed":
      return {
        type: "host.maintenance.changed",
        status: parseMaintenanceStatus(input.status),
      };
    case "teams.children.removed":
      if (!Array.isArray(input.ids)) return fail("ids must be an array");
      return {
        type: "teams.children.removed",
        ids: input.ids.map((id) => string(id, "id")),
      };
    case "teams.children":
      return { type: "teams.children", ...parseChildrenResult(input) };
    case "teams.child.updated":
      return {
        type: "teams.child.updated",
        child: parseChildSummary(input.child),
      };
    case "cli.usage": {
      const usage = parseCliUsage(input.usage);
      if (input.usage !== undefined && !usage) return undefined;
      return {
        type: "cli.usage",
        cliId: nonEmptyString(input.cliId, "cliId"),
        ...(usage ? { usage } : {}),
      };
    }
    case "cli.version":
      return {
        type: "cli.version",
        shell: nonEmptyString(input.shell, "shell"),
        cliId: nonEmptyString(input.cliId, "cliId"),
        version: nonEmptyString(input.version, "version"),
      };
    case "snapshot": {
      if (!Array.isArray(input.devices))
        return fail("devices must be an array");
      return {
        type: "snapshot",
        host: parseHostInfo(input.host),
        devices: readableItems(parseDevice, input.devices),
        currentDevicePublicKey: publicKey(
          input.currentDevicePublicKey,
          "currentDevicePublicKey",
        ),
      };
    }
    case "device.registered": {
      const inviteOperationId = input.inviteOperationId;
      return {
        type: "device.registered",
        device: parseDevice(input.device),
        ...(inviteOperationId === undefined
          ? {}
          : {
              inviteOperationId: nonEmptyString(
                inviteOperationId,
                "inviteOperationId",
              ),
            }),
      };
    }
    case "device.revoked":
      return {
        type: "device.revoked",
        publicKey: publicKey(input.publicKey, "publicKey"),
      };
    case "host.relay":
      return { type: "host.relay", ...optionalRelay(input) };
    case "host.addresses":
      return {
        type: "host.addresses",
        addresses: socketAddressArray(input.addresses, "addresses"),
      };
    case "invite.status":
      if (input.status !== "expired" && input.status !== "invalidated") {
        return undefined;
      }
      return {
        type: "invite.status",
        operationId: nonEmptyString(input.operationId, "operationId"),
        status: input.status,
      };
    case "terminal.created":
    case "terminal.updated":
      return {
        type: input.type,
        terminal: parseTerminalSummary(input.terminal),
      };
    case "terminal.closed":
      return {
        type: "terminal.closed",
        terminalId: nonEmptyString(input.terminalId, "terminalId"),
        ...(input.processExited === true ? { processExited: true } : {}),
      };
    case "folders.changed":
      return { type: "folders.changed" };
    case "forge.settings.changed":
      return { type: "forge.settings.changed" };
    case "forge.token.changed":
      return {
        type: "forge.token.changed",
        origin: nonEmptyString(input.origin, "origin"),
      };
    case "forge.changed":
      return {
        type: "forge.changed",
        path: hostPath(input.path, "path"),
        status: parseForgeStatus(input.status),
      };
    case "worktrees.changed": {
      if (!Array.isArray(input.worktrees)) {
        return fail("worktrees must be an array");
      }
      return {
        type: "worktrees.changed",
        repositoryPath: hostPath(input.repositoryPath, "repositoryPath"),
        worktrees: input.worktrees.map(parseWorktree),
      };
    }
    case "reading.changed":
      return parseReadingChangedEvent(input);
    default:
      return undefined;
  }
}

export const eventSchema: ValueSchema<Event | undefined> = {
  parse: parseEvent,
};

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const INVITE_PREFIX = "iori://pair/";

export function inviteToCode(invite: Invite): string {
  const value = inviteSchema.parse(invite);
  const bytes: number[] = [1];
  const append = (data: Uint8Array) => {
    for (const byte of data) bytes.push(byte);
  };
  const integer = (n: number, size: number) => {
    let remaining = BigInt(n);
    const result = new Uint8Array(size);
    for (let i = size - 1; i >= 0; i--) {
      result[i] = Number(remaining & 255n);
      remaining >>= 8n;
    }
    append(result);
  };
  const text = (str: string) => {
    const encoded = encoder.encode(str);
    integer(encoded.length, 4);
    append(encoded);
  };
  append(
    Uint8Array.from(value.hostKey.match(/../gu)!, (part) => parseInt(part, 16)),
  );
  append(
    Uint8Array.from(base64UrlDecode(value.secret), (c) => c.charCodeAt(0)),
  );
  integer(value.expiresAt, 8);
  text(value.relayUrl ?? "");
  text(value.hostName);
  integer(value.addresses.length, 4);
  for (const address of value.addresses) {
    const ipv6 = address.startsWith("[");
    const split = address.lastIndexOf(":");
    const host = address.slice(0, split);
    integer(ipv6 ? 6 : 4, 1);
    if (ipv6) {
      const canonical = new URL(`http://${host}/`).hostname.slice(1, -1);
      const [left, right = ""] = canonical.split("::");
      const before = left ? left.split(":") : [];
      const after = right ? right.split(":") : [];
      const groups = [
        ...before,
        ...Array<string>(8 - before.length - after.length).fill("0"),
        ...after,
      ];
      for (const group of groups) integer(parseInt(group, 16), 2);
    } else {
      for (const octet of host.split(".")) integer(Number(octet), 1);
    }
    integer(Number(address.slice(split + 1)), 2);
  }
  let result = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32[(buffer >>> bits) & 31];
    }
  }
  if (bits) result += BASE32[(buffer << (5 - bits)) & 31];
  return result;
}

export function inviteToText(invite: Invite): string {
  return INVITE_PREFIX + inviteToCode(invite);
}

export function inviteQrSegments(
  invite: Invite,
): (
  { data: Uint8Array; mode: "byte" } | { data: string; mode: "alphanumeric" }
)[] {
  return [
    { data: encoder.encode(INVITE_PREFIX), mode: "byte" },
    { data: inviteToCode(invite), mode: "alphanumeric" },
  ];
}

export function inviteFromText(text: string): Invite {
  let code = text.trim();
  if (code.includes("://")) {
    if (!code.toLowerCase().startsWith(INVITE_PREFIX))
      return fail("unsupported invite URL");
    code = code.slice(INVITE_PREFIX.length);
  }
  code = code.toUpperCase();
  if (!/^[A-Z2-7]+$/u.test(code)) return fail("invalid invite code");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of code) {
    buffer = (buffer << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
    }
  }
  if (bits >= 5 || (buffer & ((1 << bits) - 1)) !== 0)
    return fail("invalid invite code");
  let offset = 0;
  const take = (size: number): Uint8Array => {
    if (size > bytes.length - offset) return fail("invalid invite content");
    const result = Uint8Array.from(bytes.slice(offset, offset + size));
    offset += size;
    return result;
  };
  const integer = (size: number): number => {
    let result = 0n;
    for (const byte of take(size)) result = (result << 8n) | BigInt(byte);
    if (result > BigInt(Number.MAX_SAFE_INTEGER))
      return fail("invalid invite content");
    return Number(result);
  };
  const readText = (): string => {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(take(integer(4)));
    } catch {
      return fail("invalid invite content");
    }
  };
  if (integer(1) !== 1) return fail("unsupported invite version");
  const hostKey = Array.from(take(32), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const secret = base64UrlEncode(
    Array.from(take(32), (byte) => String.fromCharCode(byte)).join(""),
  );
  const expiresAt = integer(8);
  const relay = readText();
  const hostName = readText();
  const count = integer(4);
  const addresses: string[] = [];
  for (let i = 0; i < count; i++) {
    const family = integer(1);
    if (family !== 4 && family !== 6) return fail("invalid invite content");
    const address = take(family === 4 ? 4 : 16);
    const host =
      family === 4
        ? Array.from(address).join(".")
        : new URL(
            `http://[${Array.from({ length: 8 }, (_, j) => ((address[j * 2]! << 8) | address[j * 2 + 1]!).toString(16)).join(":")}]/`,
          ).hostname;
    addresses.push(`${host}:${integer(2)}`);
  }
  if (offset !== bytes.length) return fail("invalid invite content");
  return inviteSchema.parse({
    version: 1,
    hostKey,
    secret,
    expiresAt,
    ...(relay ? { relayUrl: relay } : {}),
    hostName,
    addresses,
  });
}

function base64UrlEncode(binary: string): string {
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlDecode(code: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return fail("invalid invite code");
  const base64 = code.replaceAll("-", "+").replaceAll("_", "/");
  try {
    return atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  } catch {
    return fail("invalid invite code");
  }
}

export function encodeFrame(value: unknown): Uint8Array {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new FrameError("value cannot be encoded as JSON");
  }
  if (json === undefined)
    throw new FrameError("value cannot be encoded as JSON");
  const payload = encoder.encode(json);
  if (payload.byteLength > MAX_FRAME_BYTES) {
    throw new FrameError("frame exceeds the maximum size");
  }
  const frame = new Uint8Array(4 + payload.byteLength);
  new DataView(frame.buffer).setUint32(0, payload.byteLength, false);
  frame.set(payload, 4);
  return frame;
}

export class FrameDecoder {
  private pending: Uint8Array[] = [];
  private pendingHead = 0;
  private pendingOffset = 0;
  private pendingBytes = 0;
  private readonly header = new Uint8Array(4);

  push(bytes: Uint8Array): Uint8Array[] {
    if (bytes.byteLength !== 0) {
      this.pending.push(new Uint8Array(bytes));
      this.pendingBytes += bytes.byteLength;
    }
    const frames: Uint8Array[] = [];

    while (this.pendingBytes >= 4) {
      this.copyPending(0, this.header);
      const length = new DataView(this.header.buffer).getUint32(0, false);
      if (length > MAX_FRAME_BYTES) {
        this.clearPending();
        throw new FrameError("frame exceeds the maximum size");
      }
      if (this.pendingBytes - 4 < length) break;
      const payload = new Uint8Array(length);
      this.copyPending(4, payload);
      frames.push(payload);
      this.consume(4 + length);
    }

    if (this.pendingBytes > MAX_FRAME_BYTES + 4) {
      this.clearPending();
      throw new FrameError("frame exceeds the maximum size");
    }
    return frames;
  }

  finish(): void {
    if (this.pendingBytes !== 0) {
      this.clearPending();
      throw new FrameError("stream ended in the middle of a frame");
    }
  }

  private copyPending(offset: number, target: Uint8Array): void {
    let chunkIndex = this.pendingHead;
    let chunkOffset = this.pendingOffset + offset;
    while (chunkIndex < this.pending.length) {
      const chunk = this.pending[chunkIndex]!;
      if (chunkOffset < chunk.byteLength) break;
      chunkOffset -= chunk.byteLength;
      chunkIndex += 1;
    }

    let targetOffset = 0;
    while (targetOffset < target.byteLength) {
      const chunk = this.pending[chunkIndex]!;
      const length = Math.min(
        target.byteLength - targetOffset,
        chunk.byteLength - chunkOffset,
      );
      target.set(
        chunk.subarray(chunkOffset, chunkOffset + length),
        targetOffset,
      );
      targetOffset += length;
      chunkIndex += 1;
      chunkOffset = 0;
    }
  }

  private consume(length: number): void {
    this.pendingBytes -= length;
    while (length !== 0) {
      const chunk = this.pending[this.pendingHead]!;
      const consumed = Math.min(length, chunk.byteLength - this.pendingOffset);
      length -= consumed;
      this.pendingOffset += consumed;
      if (this.pendingOffset === chunk.byteLength) {
        delete this.pending[this.pendingHead];
        this.pendingHead += 1;
        this.pendingOffset = 0;
      }
    }

    if (this.pendingHead === this.pending.length) {
      this.pending = [];
      this.pendingHead = 0;
    } else if (
      this.pendingHead >= 1024 &&
      this.pendingHead * 2 >= this.pending.length
    ) {
      this.pending = this.pending.slice(this.pendingHead);
      this.pendingHead = 0;
    }
  }

  private clearPending(): void {
    this.pending = [];
    this.pendingHead = 0;
    this.pendingOffset = 0;
    this.pendingBytes = 0;
  }
}

export function decodeFrame(payload: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(payload)) as unknown;
  } catch {
    throw new FrameError("frame is not valid UTF-8 JSON");
  }
}
