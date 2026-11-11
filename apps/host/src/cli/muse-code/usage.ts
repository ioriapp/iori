import { fileURLToPath } from "node:url";
import { parseCliUsage, type CliUsage } from "@iori/protocol";
import { object } from "../hooks.ts";
import { modelDialogue } from "../models.ts";
import { quoteShell, runInLoginShell, shellCommand } from "../shell-command.ts";
import { monitorUsageCommand, type UsageMonitor } from "../usage.ts";

// https://meta-models.github.io/muse-code-sdk/next/generated/msp/types/subscriptionusage/
export function readUsage(value: unknown): CliUsage | undefined {
  const usage = object(value);
  const windows: CliUsage["windows"] = [];
  for (const [value, minutes] of [
    [usage.window, 300],
    [usage.weekly, 10080],
  ] as const) {
    const window = object(value);
    const used = window.usedPercent;
    if (typeof used !== "number" || used < 0 || used > 100) continue;
    windows.push({
      remaining: 100 - used,
      minutes,
      ...(typeof window.resetsAtMs === "number"
        ? { resetsAt: window.resetsAtMs }
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
  let nextId = 3;
  let pending:
    { id: number; resolve: () => void; promise: Promise<void> } | undefined;
  let fallbackPending: Promise<void> | undefined;
  let resetTimer: NodeJS.Timeout | undefined;
  let lastRefresh = 0;
  let fallback = false;
  let closed = false;
  let dialogueFinished = false;
  let receivedUsage = false;
  let receivedError = false;
  let fallbackOnExit = false;
  let refresh = async () => {};
  const update = (usage: CliUsage | undefined) => {
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
      resetTimer = setTimeout(
        () => void refresh(),
        Math.min(2 ** 31 - 1, Math.max(1, nextReset - Date.now())),
      );
  };
  const readLegacy = async (): Promise<CliUsage | undefined> => {
    try {
      const script = fileURLToPath(new URL("./usage.mjs", import.meta.url));
      const line = await shellCommand(
        quoteShell(process.execPath, shell),
        [script],
        shell,
        {
          commandLine: true,
        },
      );
      const result = await runInLoginShell(shell, line, "{}", signal);
      const output = result.output.trim().split(/\r?\n/u).at(-1) ?? "";
      return result.code === 0 && output
        ? parseCliUsage(JSON.parse(output))
        : undefined;
    } catch {
      return undefined;
    }
  };
  const readFallback = async () => {
    const usage = await readLegacy();
    if (!closed && !dialogueFinished && !signal.aborted) update(usage);
  };
  const refreshFallback = () => {
    if (fallbackPending) return fallbackPending;
    if (signal.aborted || Date.now() - lastRefresh < 60_000)
      return Promise.resolve();
    lastRefresh = Date.now();
    fallbackPending = readFallback().finally(() => {
      fallbackPending = undefined;
    });
    return fallbackPending;
  };
  try {
    try {
      await modelDialogue(
        shell,
        command + " serve",
        signal,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            clientInfo: { name: "iori", version: "1" },
            capabilities: { experimentalApi: true },
          },
        },
        (value, send, end) => {
          if (value.error) receivedError = true;
          if (value.id === 1) {
            if (value.error) {
              const error = object(value.error);
              if (
                error.code === -32601 ||
                error.code === -32602 ||
                error.code === -32010 ||
                object(error.data).kind === "experimentalRequired"
              ) {
                fallbackOnExit = true;
                end();
                return;
              }
              end();
              return;
            }
            fallback = object(value.result).experimentalApi === false;
            send({ jsonrpc: "2.0", method: "initialized" });
            send({ jsonrpc: "2.0", id: 2, method: "usage/read", params: {} });
            refresh = () => {
              if (pending) return pending.promise;
              if (fallback) return refreshFallback();
              if (Date.now() - lastRefresh < 60_000 || signal.aborted)
                return Promise.resolve();
              lastRefresh = Date.now();
              let resolve!: () => void;
              const promise = new Promise<void>((done) => {
                resolve = done;
              });
              const id = nextId++;
              pending = { id, resolve, promise };
              send({ jsonrpc: "2.0", id, method: "usage/refresh", params: {} });
              return promise;
            };
            registerRefresh(refresh);
          } else if (value.id === 2) {
            if (value.error) changed(undefined);
            else {
              const usage = object(value.result).usage;
              if (usage) receivedUsage = true;
              update(readUsage(usage));
              if (!usage) void refresh();
            }
          } else if (pending && value.id === pending.id) {
            const request = pending;
            const error = object(value.error);
            const kind = object(error.data).kind;
            if (
              error.code === -32601 ||
              error.code === -32010 ||
              error.code === -32081 ||
              kind === "experimentalRequired" ||
              kind === "capabilityRequired"
            ) {
              fallback = true;
              void readFallback().finally(() => {
                pending = undefined;
                request.resolve();
              });
            } else {
              pending = undefined;
              if (!value.error) {
                const usage = object(value.result).usage;
                if (usage) receivedUsage = true;
                update(readUsage(usage));
              }
              request.resolve();
            }
          } else if (value.method === "usage/changed") {
            receivedUsage = true;
            update(readUsage(value.params));
          }
        },
      );
    } catch (error) {
      if (!signal.aborted && !receivedUsage && !receivedError)
        fallbackOnExit = true;
      else throw error;
    } finally {
      dialogueFinished = true;
      if (resetTimer) clearTimeout(resetTimer);
      pending?.resolve();
    }
    if (
      !signal.aborted &&
      (fallbackOnExit || fallback || (!receivedUsage && !receivedError))
    )
      await monitorUsageCommand(readLegacy)(
        shell,
        command,
        signal,
        changed,
        registerRefresh,
      );
  } finally {
    closed = true;
    changed(undefined);
    registerRefresh(undefined);
  }
};
