import { startHost } from "./host.ts";
import { diagnosticError, writeDiagnostic } from "./diagnostics.ts";

const signals = ["SIGINT", "SIGTERM"] as const;
let stop: (() => void) | undefined;

try {
  const host = await startHost();
  await new Promise<void>((resolve) => {
    stop = resolve;
    for (const signal of signals) process.once(signal, resolve);
  });
  for (const signal of signals) {
    if (stop) process.off(signal, stop);
  }
  await host.close();
} catch (error) {
  writeDiagnostic("startup-failed", diagnosticError(error));
  process.exitCode = 1;
}
