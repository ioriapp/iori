import type { TerminalSnapshot as SavedSnapshot } from "@iori/protocol";
import type { CommandCaller } from "../../teams/local-command.ts";
import type { CommandResult } from "./command-receiver.ts";
import type { TerminalViewAttributes } from "../shared/terminal-view-attributes.ts";
import type {
  ParserEvent,
  OscEvent,
  ParserSubscriptions,
} from "./parser-events.ts";
import type { TerminalModes } from "./types.ts";
import type { TerminalSnapshot } from "./types.ts";
import type { IPtyForkOptions, IWindowsPtyForkOptions } from "node-pty";
export const DAEMON_PROTOCOL = 21;
export interface DaemonHello {
  version: number;
  pid: number;
}
export interface DaemonDescriptor {
  token: string;
  endpoint: string;
}
export interface PtyScreen {
  id: string;
  pid: number;
  live: boolean;
  exit?: { exitCode: number; signal?: number };
  snapshot: TerminalSnapshot;
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

/** Calls accepted by each endpoint of the authenticated connection. */
export type DaemonRpc = {
  hello: (token: string) => DaemonHello;
  shutdown: () => PtyScreen[] | undefined;
  attach: (subscriptions: ParserSubscriptions) => PtyScreen[];
  activate: () => void;
  commandsReady: () => void;
  pauseCommands: () => void;
  commandRoute: (
    key: string,
    caller: CommandCaller,
    base?: string,
  ) => Record<string, string>;
  retireRoute: (key: string) => void;
  hookRoute: (id: string) => string;
  retireHook: (id: string) => void;
  screen: (
    id: string,
    cols: number,
    rows: number,
    seed: string,
    links?: TerminalSnapshot["oscLinks"],
  ) => PtyState;
  snapshot: (id: string, scrollbackRows?: number) => TerminalSnapshot;
  visibleLines: (id: string) => string[] | undefined;
  visibleLinesFromSnapshot: (snapshot: SavedSnapshot) => string[];
  screenWrite: (id: string, data: string) => PtyState;
  screenCursor: (id: string) => number;
  freeze: (id: string) => void;
  thaw: (id: string) => void;
  spawn: (request: SpawnPty) => { pid: number };
  write: (id: string, data: string) => void;
  resize: (id: string, cols: number, rows: number) => void;
  attributes: (id: string, attributes: TerminalViewAttributes) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  kill: (id: string) => PtyScreen["exit"];
  remove: (id: string) => void;
};
export type HostRpc = {
  data: (pid: number, data: PtyOutput) => void;
  event: (event: PtyEvent) => void;
  command: (caller: CommandCaller, argv: unknown) => CommandResult;
};
