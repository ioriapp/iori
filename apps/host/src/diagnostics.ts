import { writeSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { watchUdpReceiveQueues } from "./diagnostics-linux.ts";

const SUMMARY_INTERVAL_MS = 60_000;
type Fields = Record<string, string | number | boolean>;

// Native transport errors can contain peer IDs. Keep only a short identifier.
function diagnosticText(value: string): string {
  return value
    .replace(/iori:\/\/pair\?code=\S+/giu, "[redacted invite]")
    .replace(
      /((?:token|password|secret|api[_-]?key|authorization)(?:\s*[=:]\s*|\s+)|Bearer\s+)(?:"[^"]*"|'[^']*'|\S+)/giu,
      "$1[redacted]",
    )
    .replace(/\b[\da-f]{64}\b/gi, (key) => `${key.slice(0, 8)}…`);
}

export function diagnosticError(error: unknown): Fields {
  return error instanceof Error
    ? { message: error.message, stack: error.stack ?? error.message }
    : { message: String(error) };
}

export function writeDiagnostic(event: string, fields: Fields): void {
  const values = Object.entries(fields).map(
    ([key, value]) =>
      `${key}=${typeof value === "string" ? JSON.stringify(diagnosticText(value)) : value}`,
  );
  try {
    // Unlike stream.write(), this cannot emit an unhandled asynchronous error.
    // Windows services can have an absent/closed stderr handle too.
    writeSync(2, `iori-host ${event} ${values.join(" ")}\n`);
  } catch {
    // Observability must not stop the Host when stderr is unavailable.
  }
}

export class HostDiagnostics {
  #summaries = new Map<
    string,
    { count: number; fields: Fields; timer: ReturnType<typeof setTimeout> }
  >();

  record(event: string, fields: Fields, kind = event): void {
    const previous = this.#summaries.get(kind);
    if (previous) {
      previous.count += 1;
      previous.fields = fields;
      return;
    }
    writeDiagnostic(event, { count: 1, ...fields });
    this.#cooldown(event, kind, fields);
  }

  #cooldown(event: string, kind: string, fields: Fields): void {
    const summary = {
      count: 0,
      fields,
      timer: setTimeout(() => {
        this.#summaries.delete(kind);
        if (summary.count === 0) return;
        writeDiagnostic(event, { count: summary.count, ...summary.fields });
        this.#cooldown(event, kind, summary.fields);
      }, SUMMARY_INTERVAL_MS),
    };
    summary.timer.unref();
    this.#summaries.set(kind, summary);
  }

  close(): void {
    for (const summary of this.#summaries.values()) clearTimeout(summary.timer);
    this.#summaries.clear();
  }
}

export async function startHostDiagnostics(
  root: string,
  sockets: string[],
  diagnostics: HostDiagnostics,
): Promise<() => void> {
  const delay = monitorEventLoopDelay({ resolution: 100 });
  delay.enable();
  const timer = setInterval(() => {
    const maxMs = delay.max / 1_000_000;
    delay.reset();
    if (maxMs > 1_000)
      diagnostics.record("event-loop-delayed", { maxMs: Math.round(maxMs) });
  }, 10_000);
  timer.unref();
  const stopUdp = watchUdpReceiveQueues(sockets, diagnostics);

  const report = process.report;
  // Keep these exclusions enabled even after close; diagnostic reports must
  // never include the Host's environment or enumerate network interfaces.
  Object.assign(report, { excludeEnv: true, excludeNetwork: true });
  if (process.platform !== "win32") {
    try {
      const directory = join(root, "diagnostics");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      report.directory = directory;
      report.signal = "SIGUSR2";
      report.reportOnSignal = true;
    } catch (error) {
      diagnostics.record(
        "diagnostic-report-unavailable",
        diagnosticError(error),
      );
    }
  }

  return () => {
    clearInterval(timer);
    delay.disable();
    stopUdp();
    diagnostics.close();
  };
}
