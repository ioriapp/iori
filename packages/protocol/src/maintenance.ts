import * as v from "valibot";
import {
  identifier,
  decoded,
  method,
  emptyParams,
  type Params,
  type Results,
  hasMethod,
  paramsOf,
} from "./primitives.ts";
import type { ChildWorkState } from "./teams.ts";
import { ProtocolValidationError } from "./primitives.ts";

export type MaintenanceKind = "update" | "restart" | "uninstall";
export type MaintenancePhase =
  | "downloading"
  | "installing"
  | "restarting"
  | "uninstalling"
  | "removing"
  | "succeeded"
  | "failed";
export interface MaintenanceTarget {
  id: string;
  title: string;
  state: ChildWorkState;
  command?: string;
  generation?: string;
}
export interface MaintenancePlan {
  version?: string;
  canContinue: boolean;
  hasOpenTerminals: boolean;
  targets: MaintenanceTarget[];
  error?: string;
}
export interface MaintenanceStatus {
  operationId: string;
  kind: MaintenanceKind;
  phase: MaintenancePhase;
  version?: string;
  reason?: string;
  stage?: string;
  osError?: string;
  restored?: boolean;
  received?: number;
  total?: number;
  plan?: MaintenancePlan;
  deleteData?: boolean;
  completed?: string[];
  receiptPath?: string;
  rollbackFailed?: string[];
  failedPaths?: string[];
  processErrors?: string[];
  /** Sites whose token stayed in the OS credential store after uninstall. */
  forgeTokensRemaining?: string[];
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProtocolValidationError(
      "invalid_request",
      "Expected maintenance object",
    );
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value)
    throw new ProtocolValidationError(
      "invalid_request",
      "Expected maintenance string",
    );
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new ProtocolValidationError(
      "invalid_request",
      "Expected maintenance boolean",
    );
  return value;
}
export function releaseVersion(value: unknown): string {
  const version = string(value);
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      version,
    )
  )
    throw new ProtocolValidationError(
      "invalid_request",
      "Expected release version",
    );
  return version;
}

const confirmation = {
  canContinue: v.boolean(),
  targets: v.array(identifier),
  hasOpenTerminals: v.optional(v.boolean()),
  generations: v.optional(
    decoded((value) =>
      Object.fromEntries(
        Object.entries(object(value)).map(([key, id]) => [key, string(id)]),
      ),
    ),
  ),
};

export const maintenanceMethods = {
  "host.update.prepare": method(
    v.object({ version: decoded(releaseVersion) }),
    { parse: parseMaintenancePlan },
  ),
  "host.restart.prepare": method(emptyParams, { parse: parseMaintenancePlan }),
  "host.uninstall.prepare": method(emptyParams, {
    parse: parseMaintenancePlan,
  }),
  "host.uninstall": method(
    v.object({ ...confirmation, deleteData: v.boolean() }),
    { parse: parseMaintenanceStatus },
  ),
  "host.update": method(
    v.object({ ...confirmation, version: decoded(releaseVersion) }),
    { parse: parseMaintenanceStatus },
  ),
  "host.restart": method(v.object({ ...confirmation }), {
    parse: parseMaintenanceStatus,
  }),
  "host.maintenance.status": method(v.object({ operationId: identifier }), {
    parse: parseMaintenanceLookup,
  }),
};

export type MaintenanceMethod = keyof typeof maintenanceMethods;
export type MaintenanceParams = Params<typeof maintenanceMethods>;
export type MaintenanceResults = Results<typeof maintenanceMethods>;
export function isMaintenanceMethod(
  value: unknown,
): value is MaintenanceMethod {
  return hasMethod(maintenanceMethods, value);
}
export function parseMaintenanceParams<M extends MaintenanceMethod>(
  key: M,
  value: unknown,
): MaintenanceParams[M] {
  return paramsOf<MaintenanceParams, M>(maintenanceMethods, key, value);
}

export function parseMaintenancePlan(value: unknown): MaintenancePlan {
  const input = object(value);
  if (!Array.isArray(input.targets))
    throw new ProtocolValidationError(
      "invalid_request",
      "Expected maintenance targets",
    );
  return {
    canContinue: boolean(input.canContinue),
    hasOpenTerminals: boolean(input.hasOpenTerminals),
    targets: input.targets.map((value) => {
      const target = object(value);
      if (
        target.state !== "running" &&
        target.state !== "approval" &&
        target.state !== "question"
      )
        throw new ProtocolValidationError(
          "invalid_request",
          "Invalid maintenance work state",
        );
      return {
        id: string(target.id),
        title: string(target.title),
        state: target.state,
        ...(target.generation === undefined
          ? {}
          : { generation: string(target.generation) }),
        ...(target.command === undefined
          ? {}
          : { command: string(target.command) }),
      };
    }),
    ...(input.version === undefined
      ? {}
      : { version: releaseVersion(input.version) }),
    ...(input.error === undefined ? {} : { error: string(input.error) }),
  };
}
export function parseMaintenanceStatus(value: unknown): MaintenanceStatus {
  const input = object(value);
  if (
    input.kind !== "update" &&
    input.kind !== "restart" &&
    input.kind !== "uninstall"
  )
    throw new ProtocolValidationError(
      "invalid_request",
      "Invalid maintenance kind",
    );
  if (
    ![
      "downloading",
      "installing",
      "restarting",
      "uninstalling",
      "removing",
      "succeeded",
      "failed",
    ].includes(string(input.phase))
  )
    throw new ProtocolValidationError(
      "invalid_request",
      "Invalid maintenance phase",
    );
  const result: MaintenanceStatus = {
    operationId: string(input.operationId),
    kind: input.kind,
    phase: input.phase as MaintenancePhase,
  };
  if (input.deleteData !== undefined)
    result.deleteData = boolean(input.deleteData);
  if (input.completed !== undefined) {
    if (!Array.isArray(input.completed))
      throw new ProtocolValidationError(
        "invalid_request",
        "Expected completed stages",
      );
    result.completed = input.completed.map(string);
  }
  if (input.receiptPath !== undefined)
    result.receiptPath = string(input.receiptPath);
  if (input.rollbackFailed !== undefined) {
    if (!Array.isArray(input.rollbackFailed))
      throw new ProtocolValidationError(
        "invalid_request",
        "Expected rollback stages",
      );
    result.rollbackFailed = input.rollbackFailed.map(string);
  }
  if (input.failedPaths !== undefined) {
    if (!Array.isArray(input.failedPaths))
      throw new ProtocolValidationError(
        "invalid_request",
        "Expected failed paths",
      );
    result.failedPaths = input.failedPaths.map(string);
  }
  if (input.processErrors !== undefined) {
    if (!Array.isArray(input.processErrors))
      throw new ProtocolValidationError(
        "invalid_request",
        "Expected process errors",
      );
    result.processErrors = input.processErrors.map(string);
  }
  if (input.forgeTokensRemaining !== undefined) {
    if (!Array.isArray(input.forgeTokensRemaining))
      throw new ProtocolValidationError(
        "invalid_request",
        "Expected Forge sites",
      );
    result.forgeTokensRemaining = input.forgeTokensRemaining.map(string);
  }
  if (input.version !== undefined)
    result.version = releaseVersion(input.version);
  if (input.reason !== undefined) result.reason = string(input.reason);
  if (input.stage !== undefined) result.stage = string(input.stage);
  if (input.osError !== undefined) result.osError = string(input.osError);
  if (input.restored !== undefined) result.restored = boolean(input.restored);
  if (input.plan !== undefined) result.plan = parseMaintenancePlan(input.plan);
  for (const key of ["received", "total"] as const) {
    if (input[key] === undefined) continue;
    if (
      typeof input[key] !== "number" ||
      !Number.isSafeInteger(input[key]) ||
      input[key] < 0
    )
      throw new ProtocolValidationError(
        "invalid_request",
        "Invalid download size",
      );
    result[key] = input[key];
  }
  return result;
}
export function parseMaintenanceLookup(value: unknown): {
  status?: MaintenanceStatus;
} {
  const input = object(value);
  return input.status === undefined
    ? {}
    : { status: parseMaintenanceStatus(input.status) };
}
