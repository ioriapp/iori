import type { CliUsage } from "@iori/protocol";
import type { UsageMonitor } from "../usage.ts";
import { modelDialogue } from "../models.ts";
import { object } from "../hooks.ts";

// https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt
function readUsage(value: unknown): CliUsage | undefined {
  const payload = object(value);
  const limits = object(
    object(payload.rateLimitsByLimitId).codex ?? payload.rateLimits,
  );
  const windows: CliUsage["windows"] = [];
  for (const value of [limits.primary, limits.secondary]) {
    const window = object(value);
    const used = window.usedPercent;
    const minutes = window.windowDurationMins;
    if (
      typeof used !== "number" ||
      !Number.isFinite(used) ||
      used < 0 ||
      used > 100 ||
      typeof minutes !== "number" ||
      !Number.isFinite(minutes) ||
      minutes <= 0
    )
      continue;
    windows.push({
      remaining: 100 - used,
      minutes,
      ...(typeof window.resetsAt === "number" &&
      Number.isFinite(window.resetsAt * 1000)
        ? { resetsAt: window.resetsAt * 1000 }
        : {}),
    });
  }
  return windows.length ? { windows } : undefined;
}
export const monitorUsage: UsageMonitor = async (
  shell,
  command,
  signal,
  changed,
  registerRefresh,
) => {
  let nextId = 2;
  let pending: Promise<void> | undefined;
  let resolvePending: (() => void) | undefined;
  let resetTimer: NodeJS.Timeout | undefined;
  let closed = false;
  let refresh: () => void | Promise<void> = () => {};
  const update = (value: unknown) => {
    if (closed || signal.aborted) return;
    const usage = readUsage(value);
    if (resetTimer) clearTimeout(resetTimer);
    changed(usage);
    const nextReset = usage?.windows
      .flatMap((window) =>
        window.resetsAt && window.resetsAt > Date.now()
          ? [window.resetsAt]
          : [],
      )
      .sort((a, b) => a - b)[0];
    if (nextReset)
      // Node delays above 2^31-1 overflow to 1ms. Wake and reread instead.
      // https://nodejs.org/api/timers.html#settimeoutcallback-delay-args
      resetTimer = setTimeout(
        () => refresh(),
        Math.min(2 ** 31 - 1, Math.max(1, nextReset - Date.now())),
      );
  };
  try {
    await modelDialogue(
      shell,
      command + " app-server",
      signal,
      {
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "iori", version: "1" } },
      },
      (value, send, end) => {
        if (value.id === 1) {
          if (value.error) {
            end();
            return;
          }
          send({ method: "initialized", params: {} });
          refresh = () => {
            if (pending) return pending;
            pending = new Promise<void>((resolve) => {
              resolvePending = resolve;
            });
            send({
              id: nextId++,
              method: "account/rateLimits/read",
              params: {},
            });
            return pending;
          };
          registerRefresh(refresh);
          refresh();
        } else if (typeof value.id === "number") {
          update(value.error ? undefined : value.result);
          resolvePending?.();
          resolvePending = undefined;
          pending = undefined;
        } else if (value.method === "account/rateLimits/updated")
          update(value.params);
        else if (value.method === "account/updated") refresh();
      },
    );
  } finally {
    closed = true;
    resolvePending?.();
    if (resetTimer) clearTimeout(resetTimer);
    changed(undefined);
    registerRefresh(undefined);
  }
};
