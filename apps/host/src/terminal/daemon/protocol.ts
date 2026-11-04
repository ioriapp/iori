import type { TerminalSnapshot } from "./types.ts";
import type { IPtyForkOptions, IWindowsPtyForkOptions } from "node-pty";
export const DAEMON_PROTOCOL = 15;
export interface DaemonHello {
  version: number;
  pid: number;
}
export interface DaemonDescriptor extends DaemonHello {
  token: string;
  endpoint: string;
}
export interface PtyScreen {
  id: string;
  pid: number;
  live: boolean;
  exit?: { exitCode: number; signal?: number };
  snapshot: TerminalSnapshot;
  title?: string;
  cwd: string | null;
}
export interface SpawnPty {
  id: string;
  executable: string;
  args: string[] | string;
  options: IPtyForkOptions | IWindowsPtyForkOptions;
  seed: string;
}
export type PtyEvent =
  | { id: string; kind: "hook"; payload: Record<string, unknown> }
  | {
      id: string;
      kind: "exit";
      pid: number;
      exitCode: number;
      signal?: number;
    };
