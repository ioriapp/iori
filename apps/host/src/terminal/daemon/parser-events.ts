import { readTerminalModes } from "./headless-emulator-modes.ts";
import type { TerminalModes } from "./types.ts";
import type { Terminal } from "@xterm/headless";

export type ParserSubscriptions = {
  osc: number[];
  csi: { prefix?: string; intermediates?: string; final: string }[];
};
export type ParserEvent =
  | { kind: "osc"; number: number; data: string }
  | {
      kind: "csi";
      prefix?: string;
      intermediates?: string;
      final: string;
      params: (number | number[])[];
      modes: TerminalModes;
    };
export type OscEvent = Extract<ParserEvent, { kind: "osc" }>;

/** Observe completed parser sequences without assigning shell or CLI meaning. */
export class ParserEvents {
  readonly latest = new Map<number, OscEvent>();
  pending: ParserEvent[] = [];
  #handlers: { dispose(): void }[] = [];
  readonly terminal: Terminal;
  constructor(terminal: Terminal) {
    this.terminal = terminal;
  }
  subscribe(value: ParserSubscriptions) {
    for (const handler of this.#handlers) handler.dispose();
    this.#handlers = [];
    const numbers = new Set(value.osc);
    for (const number of this.latest.keys())
      if (!numbers.has(number)) this.latest.delete(number);
    for (const number of numbers)
      this.#handlers.push(
        this.terminal.parser.registerOscHandler(number, (data) => {
          const event: OscEvent = { kind: "osc", number, data };
          this.latest.delete(number);
          this.latest.set(number, event);
          this.pending.push(event);
          return false;
        }),
      );
    for (const id of value.csi)
      this.#handlers.push(
        this.terminal.parser.registerCsiHandler(id, (params) => {
          this.pending.push({
            kind: "csi",
            ...id,
            params,
            modes: readTerminalModes(this.terminal),
          });
          return false;
        }),
      );
  }
  take(): ParserEvent[] {
    return this.pending.splice(0);
  }
}
