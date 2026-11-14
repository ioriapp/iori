import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "../../fs/atomic-write.ts";
import { object } from "../hooks.ts";
import { modelDialogue } from "../models.ts";
import { quoteShell, runInLoginShell, shellCommand } from "../shell-command.ts";
import type { UsageMonitor } from "../usage.ts";
import { displayUsage, savedUsage } from "./display-usage.ts";

export const monitorUsage: UsageMonitor = async (
  shell,
  command,
  signal,
  changed,
  registerRefresh,
  dataRoot,
) => {
  const path = dataRoot
    ? join(dataRoot, "cli-usage", "muse-code.json")
    : undefined;
  let saved = path
    ? await readFile(path, "utf8")
        .then((text) => savedUsage(JSON.parse(text)))
        .catch(() => undefined)
    : undefined;
  let writes = Promise.resolve();
  let nextId = 3;
  let pending:
    | {
        id: number;
        reading: boolean;
        resolve: () => void;
        promise: Promise<void>;
      }
    | undefined;
  let fallbackPending: Promise<void> | undefined;
  let resetTimer: NodeJS.Timeout | undefined;
  let lastRefresh = 0;
  let fallback = false;
  let closed = false;
  let receivedUsage = false;
  let receivedError = false;
  let fallbackOnExit = false;
  let refresh = async () => {};
  const update = (value: unknown, subscription: boolean | undefined) => {
    if (closed || signal.aborted) return;
    if (value === undefined && subscription === undefined && !saved) return;
    const previous = saved;
    const result = displayUsage(value, saved, subscription, Date.now());
    saved = result.saved;
    if (path && saved !== previous) {
      const snapshot = saved;
      writes = writes
        .then(async () => {
          if (snapshot) {
            await mkdir(join(dataRoot!, "cli-usage"), { recursive: true });
            await writeFileAtomic(path, JSON.stringify(snapshot));
          } else await rm(path, { force: true });
        })
        .catch(() => {});
    }
    if (resetTimer) clearTimeout(resetTimer);
    changed(result.usage);
    const nextReset = result.usage?.windows
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
  const readFallback = async () => {
    try {
      const script = fileURLToPath(new URL("./usage.mjs", import.meta.url));
      const line = await shellCommand(
        quoteShell(process.execPath, shell),
        [script],
        shell,
        { commandLine: true },
      );
      const result = await runInLoginShell(shell, line, "{}", signal);
      const output = result.output.trim().split(/\r?\n/u).at(-1) ?? "";
      if (result.code !== 0 || !output || closed || signal.aborted) return;
      const data = object(JSON.parse(output));
      const subscription =
        data.reason === "server_sent_no_usage"
          ? true
          : data.reason === "no_allowance" || data.reason === "api_key"
            ? false
            : undefined;
      if (data.allowance || subscription !== undefined)
        update(data.allowance ?? undefined, subscription);
      await writes;
    } catch {
      // Failure does not change the displayed value.
    }
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
              )
                fallbackOnExit = true;
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
              pending = { id, reading: false, resolve, promise };
              send({ jsonrpc: "2.0", id, method: "usage/refresh", params: {} });
              return promise;
            };
            registerRefresh(refresh);
          } else if (value.id === 2) {
            if (!value.error) {
              const usage = object(value.result).usage;
              if (usage) receivedUsage = true;
              update(usage, undefined);
              if (!usage) void refresh();
            }
          } else if (pending && value.id === pending.id) {
            const request = pending;
            const error = object(value.error);
            const kind = object(error.data).kind;
            if (
              !request.reading &&
              (error.code === -32601 ||
                error.code === -32010 ||
                error.code === -32081 ||
                kind === "experimentalRequired" ||
                kind === "capabilityRequired")
            ) {
              fallback = true;
              void readFallback().finally(() => {
                pending = undefined;
                request.resolve();
              });
            } else if (!request.reading && !value.error) {
              const result = object(value.result);
              if (result.usage) receivedUsage = true;
              if (
                result.usage ||
                typeof result.subscriptionActive === "boolean"
              )
                update(
                  result.usage,
                  typeof result.subscriptionActive === "boolean"
                    ? result.subscriptionActive
                    : undefined,
                );
              if (result.subscriptionActive === false || result.usage) {
                pending = undefined;
                void writes.finally(request.resolve);
              } else {
                request.id = nextId++;
                request.reading = true;
                send({
                  jsonrpc: "2.0",
                  id: request.id,
                  method: "usage/read",
                  params: {},
                });
              }
            } else {
              pending = undefined;
              if (!value.error) {
                const usage = object(value.result).usage;
                if (usage) {
                  receivedUsage = true;
                  update(usage, undefined);
                }
              }
              void writes.finally(request.resolve);
            }
          } else if (value.method === "usage/changed") {
            receivedUsage = true;
            update(value.params, undefined);
          }
        },
      );
    } catch (error) {
      if (!signal.aborted && !receivedUsage && !receivedError)
        fallbackOnExit = true;
      else throw error;
    } finally {
      pending?.resolve();
    }
    if (
      !signal.aborted &&
      (fallbackOnExit || fallback || (!receivedUsage && !receivedError))
    ) {
      refresh = refreshFallback;
      registerRefresh(refresh);
      await readFallback();
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  } finally {
    closed = true;
    if (resetTimer) clearTimeout(resetTimer);
    await writes;
    changed(undefined);
    registerRefresh(undefined);
  }
};
