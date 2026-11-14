import type { ParserEvent, OscEvent } from "./parser-events.ts";
import type { TerminalModes } from "./types.ts";
import type { TerminalSnapshot } from "./types.ts";
import type { IPtyForkOptions, IWindowsPtyForkOptions } from "node-pty";
export const DAEMON_PROTOCOL = 17;
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
  cwd: null;
  state: PtyState;
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

export interface PtyModes {
  modes: TerminalModes;
  showCursor: boolean;
}
export interface PtyState extends PtyModes {
  sequence: number;
  osc: OscEvent[];
}
export interface PtyOutput {
  sequence: number;
  data: string;
  events: ParserEvent[];
  modes?: PtyModes;
}
