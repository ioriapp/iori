import {
  type MaintenanceStatus,
  parseMaintenanceStatus,
} from "./maintenance.ts";
import { parseCliUsage } from "./cli.ts";
import {
  type HostInfo,
  type Device,
  type RelaySettings,
  type ForgeStatus,
  type Worktree,
  parseHostInfo,
  parseDevice,
  optionalRelay,
  parseForgeStatus,
  parseWorktree,
} from "./host-values.ts";
import { publicKey, socketAddressArray } from "./invite.ts";
import {
  type ReadingChangedEvent,
  parseReadingChangedEvent,
} from "./reading.ts";
import { type TerminalEvent } from "./terminal.ts";
import {
  record,
  fail,
  string,
  nonEmptyString,
  boolean,
  readableItems,
  hostPath,
  type ValueSchema,
} from "./primitives.ts";
import {
  parseChildrenResult,
  parseChildSummary,
  parseTerminalSummary,
} from "./terminal-values.ts";
export type Event =
  | { type: "automation.changed" }
  | { type: "host.maintenance.changed"; status: MaintenanceStatus }
  | { type: "teams.children.removed"; ids: string[] }
  | { type: "teams.children"; children: import("./teams.ts").ChildSummary[] }
  | { type: "teams.child.updated"; child: import("./teams.ts").ChildSummary }
  | { type: "cli.order.changed"; order: string[] }
  | { type: "cli.hidden.changed"; cliId: string; hidden: boolean }
  | { type: "cli.usage"; cliId: string; usage?: import("./cli.ts").CliUsage }
  | {
      type: "cli.version";
      shell: string;
      cliId: string;
      version: string;
      launchEffort?: boolean;
    }
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
    case "cli.order.changed":
      if (!Array.isArray(input.order)) return fail("order must be an array");
      return {
        type: "cli.order.changed",
        order: input.order.map((id) => string(id, "id")),
      };
    case "cli.hidden.changed":
      return {
        type: "cli.hidden.changed",
        cliId: nonEmptyString(input.cliId, "cliId"),
        hidden: boolean(input.hidden, "hidden"),
      };
    case "cli.usage": {
      const usage = parseCliUsage(input.usage);
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
        ...(typeof input.launchEffort === "boolean"
          ? { launchEffort: input.launchEffort }
          : {}),
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
