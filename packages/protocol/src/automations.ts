import * as v from "valibot";
import {
  integer,
  method,
  emptyParams,
  hostResult,
  type Params,
  type Results,
  hasMethod,
  paramsOf,
  type ResultSchemas,
} from "./primitives.ts";
import type { ForgeReadFailure } from "./forge-integration.ts";
import { candidate } from "./teams.ts";
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
    // "no-remote": the folder is a repository without a remote.
    // "no-forge": the folder is not a repository with a known Forge.
    issueError?: ForgeReadFailure | "no-remote" | "no-forge";
  })[];
  // Present while any automation runs from a webhook.
  webhook?: AutomationWebhookListener;
};

const name = v.pipe(
  v.string(),
  v.check((text) => text.trim().length > 0),
);
const time = v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/u));
const schedule = v.variant("kind", [
  v.object({ kind: v.literal("manual") }),
  v.object({
    kind: v.literal("once"),
    at: v.pipe(
      v.number(),
      v.check((at) => !Number.isNaN(new Date(at).getTime())),
    ),
  }),
  v.object({ kind: v.literal("daily"), time }),
  v.object({
    kind: v.literal("weekly"),
    time,
    days: v.pipe(
      v.array(integer(0, 6)),
      v.nonEmpty(),
      v.transform((days) => [...new Set(days)]),
    ),
  }),
]);
const webhook = v.object({ scope: v.picklist(["lan", "local"]) });
const issueTrigger = v.object({ label: v.pipe(name, v.trim()) });
export type AutomationSchedule = v.InferOutput<typeof schedule>;
export type AutomationWebhook = v.InferOutput<typeof webhook>;
export type AutomationIssueTrigger = v.InferOutput<typeof issueTrigger>;
const definition = v.object({
  name,
  instruction: name,
  cwd: name,
  target: v.variant("kind", [
    v.object({ kind: v.literal("team"), teamId: name }),
    v.object({ kind: v.literal("cli"), candidate }),
  ]),
  enabled: v.boolean(),
  missed: v.picklist(["latest", "skip"]),
  schedule,
  webhook: v.optional(webhook),
  issue: v.optional(issueTrigger),
});

export type AutomationDefinition = v.InferOutput<typeof definition>;
export const automationMethods = {
  "automation.list": method(emptyParams, hostResult<AutomationList>()),
  "automation.save": method(
    v.object({ id: v.optional(name), definition }),
    hostResult<{ automation: Automation }>(),
  ),
  "automation.delete": method(
    v.object({ id: name }),
    hostResult<{ id: string }>(),
  ),
  "automation.run": method(
    v.object({ id: name }),
    hostResult<{ run: AutomationRun }>(),
  ),
  "automation.history": method(
    v.object({ id: name }),
    hostResult<{ runs: AutomationRun[] }>(),
  ),
  "automation.regenerateToken": method(
    v.object({ id: name }),
    hostResult<{ automation: Automation }>(),
  ),
  "automation.received": method(
    v.object({ id: name }),
    hostResult<{ received: AutomationReceived }>(),
  ),
};

export type AutomationMethod = keyof typeof automationMethods;
export type AutomationParams = Params<typeof automationMethods>;
export type AutomationResults = Results<typeof automationMethods>;
export function isAutomationMethod(value: unknown): value is AutomationMethod {
  return hasMethod(automationMethods, value);
}
export function parseAutomationParams<M extends AutomationMethod>(
  key: M,
  value: unknown,
): AutomationParams[M] {
  return paramsOf<AutomationParams, M>(automationMethods, key, value);
}
export const automationResultSchemas: ResultSchemas<AutomationResults> =
  automationMethods;
