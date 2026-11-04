import { platform } from "node:os";
import type { IPty } from "node-pty";
type PtyWithWindowsInternals = IPty & {
  _pty?: unknown;
  _agent?: {
    _ptyNative?: {
      terminateJob?: (ptyId: number, shellPid: number) => boolean;
    };
  };
};

export function killPty(terminal: IPty): void {
  if (platform() === "win32") {
    const internal = terminal as PtyWithWindowsInternals;
    const ptyId = internal._pty;
    const terminateJob = internal._agent?._ptyNative?.terminateJob;
    if (
      typeof terminateJob === "function" &&
      typeof ptyId === "number" &&
      Number.isInteger(ptyId) &&
      Number.isInteger(terminal.pid) &&
      terminal.pid > 0
    ) {
      try {
        // The native API checks that this pty id still owns the supplied shell pid.
        // False or unavailable means node-pty's normal kill path remains the fallback.
        terminateJob.call(internal._agent?._ptyNative, ptyId, terminal.pid);
      } catch {
        // Preserve node-pty's ordinary handle and console cleanup below.
      }
    }
  }
  terminal.kill();
}
