import type { ForgeReadFailure } from "./forge-integration.ts";
import { parseCandidate, type Candidate } from "./teams.ts";
export type AutomationSchedule =
  | { kind: "manual" }
  | { kind: "once"; at: number }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; time: string; days: number[] };
// "lan" accepts loopback and private (LAN/VPN) senders; "local" loopback only.
export type AutomationWebhook = { scope: "lan" | "local" };
// Runs for issues of the folder's repository labeled with this label.
export type AutomationIssueTrigger = { label: string };
export type AutomationDefinition = {
  name: string;
  instruction: string;
  cwd: string;
  target:
    { kind: "team"; teamId: string } | { kind: "cli"; candidate: Candidate };
  schedule: AutomationSchedule;
  webhook?: AutomationWebhook;
  issue?: AutomationIssueTrigger;
  missed: "latest" | "skip";
  enabled: boolean;
};
export type Automation = AutomationDefinition & {
  id: string;
  nextAt?: number;
  // Created by the Host when the webhook is first saved; never part of a save.
  webhookToken?: string;
};
export type AutomationRun = {
  id: string;
  automationId: string;
  scheduledAt: number;
  trigger: "schedule" | "manual" | "webhook" | "issue";
  startedAt?: number;
  terminalId?: string;
  reason?: "busy" | "offline" | "disabled";
  launchError?: string;
  // Sender address of a webhook run.
  from?: string;
  // The issue of an issue run.
  issue?: { number: number; title: string; url: string };
};
export type AutomationReceived = {
  receivedAt: number;
  from: string;
  query: Record<string, string[]>;
  // Without Authorization, Cookie and Proxy-Authorization.
  headers: Record<string, string>;
  body: string;
};
export type AutomationWebhookListener = {
  port: number;
  // Private addresses of the Host, for showing the URL.
  addresses: string[];
  error?: "port";
};
export type AutomationList = {
  timeZone: string;
  automations: (Automation & {
    lastRun?: AutomationRun;
    // Why the last look for labeled issues failed; cleared when a look succeeds.
    // "no-forge": the folder is not a repository with a known Forge.
    issueError?: ForgeReadFailure | "no-forge";
  })[];
  // Present while any automation runs from a webhook.
  webhook?: AutomationWebhookListener;
};
export interface AutomationParams {
  "automation.list": Record<string, never>;
  "automation.save": { id?: string; definition: AutomationDefinition };
  "automation.delete": { id: string };
  "automation.run": { id: string };
  "automation.history": { id: string };
  "automation.regenerateToken": { id: string };
  // id is a webhook run's id.
  "automation.received": { id: string };
}
export interface AutomationResults {
  "automation.list": AutomationList;
  "automation.save": { automation: Automation };
  "automation.delete": { id: string };
  "automation.run": { run: AutomationRun };
  "automation.history": { runs: AutomationRun[] };
  "automation.regenerateToken": { automation: Automation };
  "automation.received": { received: AutomationReceived };
}
export type AutomationMethod = keyof AutomationParams;
const methods: AutomationMethod[] = [
  "automation.list",
  "automation.save",
  "automation.delete",
  "automation.run",
  "automation.history",
  "automation.regenerateToken",
  "automation.received",
];
export function isAutomationMethod(value: unknown): value is AutomationMethod {
  return methods.includes(value as AutomationMethod);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected text");
  return value;
}
function id(value: unknown): string {
  const result = text(value);
  if (!result.trim()) throw new Error("Expected a name or identifier");
  return result;
}
function schedule(value: unknown): AutomationSchedule {
  const v = object(value);
  if (v.kind === "manual") return { kind: "manual" };
  if (v.kind === "once") {
    if (
      typeof v.at !== "number" ||
      !Number.isFinite(v.at) ||
      Number.isNaN(new Date(v.at).getTime())
    )
      throw new Error("Expected a date");
    return { kind: "once", at: v.at };
  }
  const time = text(v.time);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(time))
    throw new Error("Expected a time");
  if (v.kind === "daily") return { kind: "daily", time };
  if (
    v.kind === "weekly" &&
    Array.isArray(v.days) &&
    v.days.length &&
    v.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  )
    return { kind: "weekly", time, days: [...new Set(v.days as number[])] };
  throw new Error("Expected a schedule");
}
function webhook(value: unknown): AutomationWebhook {
  const v = object(value);
  if (v.scope !== "lan" && v.scope !== "local")
    throw new Error("Expected a webhook scope");
  return { scope: v.scope };
}
function issueTrigger(value: unknown): AutomationIssueTrigger {
  const label = id(object(value).label).trim();
  return { label };
}
export function parseAutomationParams<M extends AutomationMethod>(
  method: M,
  value: unknown,
): AutomationParams[M] {
  const v = object(value);
  if (method === "automation.list") return {} as AutomationParams[M];
  if (method !== "automation.save")
    return { id: id(v.id) } as AutomationParams[M];
  const d = object(v.definition);
  const target = object(d.target);
  if (target.kind !== "team" && target.kind !== "cli")
    throw new Error("Expected a team or CLI");
  if (
    typeof d.enabled !== "boolean" ||
    (d.missed !== "latest" && d.missed !== "skip")
  )
    throw new Error("Expected automation settings");
  return {
    ...(v.id === undefined ? {} : { id: id(v.id) }),
    definition: {
      name: id(d.name),
      instruction: id(d.instruction),
      cwd: id(d.cwd),
      target:
        target.kind === "team"
          ? { kind: "team", teamId: id(target.teamId) }
          : { kind: "cli", candidate: parseCandidate(target.candidate) },
      enabled: d.enabled,
      missed: d.missed,
      schedule: schedule(d.schedule),
      ...(d.webhook === undefined ? {} : { webhook: webhook(d.webhook) }),
      ...(d.issue === undefined ? {} : { issue: issueTrigger(d.issue) }),
    },
  } as AutomationParams[M];
}
// Responses are iori's own saved values; only requests cross a trust boundary.
export const automationResultSchemas = Object.fromEntries(
  methods.map((method) => [method, { parse: (value: unknown) => value }]),
) as {
  [M in AutomationMethod]: { parse: (value: unknown) => AutomationResults[M] };
};
