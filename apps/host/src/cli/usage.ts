import type { CliUsage } from "@iori/protocol";
import type { ShellDefinition } from "../terminal/platform.ts";
export type UsageMonitor = (
  shell: ShellDefinition,
  command: string,
  signal: AbortSignal,
  changed: (usage: CliUsage | undefined) => void,
  registerRefresh: (refresh: (() => void | Promise<void>) | undefined) => void,
) => Promise<void>;

/** One-shot providers refresh on demand and at the next returned reset only. */
export function monitorUsageCommand(
  read: (
    shell: ShellDefinition,
    command: string,
    signal: AbortSignal,
  ) => Promise<CliUsage | undefined>,
  resetPrecisionMs = 0,
): UsageMonitor {
  return async (shell, command, signal, changed, registerRefresh) => {
    let pending: Promise<void> | undefined;
    let queued: Promise<void> | undefined;
    let timer: NodeJS.Timeout | undefined;
    const refresh = (): Promise<void> => {
      if (signal.aborted) return Promise.resolve();
      if (pending) {
        queued ??= pending.then(() => {
          queued = undefined;
          return refresh();
        });
        return queued;
      }
      if (timer) clearTimeout(timer);
      pending = read(shell, command, signal)
        .catch(() => undefined)
        .then((usage) => {
          if (signal.aborted) return;
          changed(usage);
          const reset = usage?.windows
            .flatMap((window) =>
              window.resetsAt && window.resetsAt + resetPrecisionMs > Date.now()
                ? [
                    window.resetsAt > Date.now()
                      ? window.resetsAt
                      : window.resetsAt + resetPrecisionMs,
                  ]
                : [],
            )
            .sort((a, b) => a - b)[0];
          if (reset) {
            const wake = () => {
              const delay = reset - Date.now();
              if (delay > 0)
                timer = setTimeout(wake, Math.min(2 ** 31 - 1, delay));
              else refresh();
            };
            wake();
          }
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    };
    try {
      registerRefresh(refresh);
      refresh();
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      await pending;
    } finally {
      if (timer) clearTimeout(timer);
      registerRefresh(undefined);
      changed(undefined);
    }
  };
}
