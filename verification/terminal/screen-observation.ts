import type { TerminalServerMessage } from "../../packages/protocol/src/index.ts";
import { buildTerminalSnapshotRestoreSequence } from "../../packages/protocol/src/index.ts";
import { HeadlessEmulator } from "../../apps/host/src/terminal/daemon/headless-emulator.ts";

class ObservedScreen extends HeadlessEmulator {
  logicalLines(): string[] {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < buffer.length; row++) {
      const line = buffer.getLine(row);
      if (!line) continue;
      // Keep spaces at an automatic wrap, and remove only terminal padding at
      // the end of a logical line. Unicode widths match the production screen.
      const text = line.translateToString(!buffer.getLine(row + 1)?.isWrapped);
      if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    return lines;
  }
}

/** Observe parsed screen rows, never append cursor-addressed PTY bytes as text. */
export class TerminalScreenObservation {
  readonly #streams = new Map<
    string,
    { screen: ObservedScreen; previous: string[]; text: string }
  >();

  async apply(stream: string, frame: TerminalServerMessage): Promise<void> {
    let state = this.#streams.get(stream);
    if (frame.kind === "terminal.snapshot") {
      state?.screen.dispose();
      state = {
        screen: new ObservedScreen({
          cols: frame.snapshot.cols,
          rows: frame.snapshot.rows,
        }),
        previous: [],
        text: "",
      };
      this.#streams.set(stream, state);
      state.screen.setRestoredOscLinks(frame.snapshot.oscLinks);
      await state.screen.write(
        buildTerminalSnapshotRestoreSequence(frame.snapshot),
      );
    } else {
      // A partial stream cannot establish what is actually on the screen.
      if (!state) return;
      if (frame.kind === "terminal.output")
        await state.screen.write(frame.data);
      else if (frame.kind === "terminal.size")
        state.screen.resize(frame.cols, frame.rows);
      else return;
    }
    const lines = state.screen.logicalLines();
    const changed = lines.filter((line, row) => line !== state.previous[row]);
    if (changed.length)
      state.text = (state.text + "\n" + changed.join("\n")).slice(-524288);
    state.previous = lines;
  }

  text(stream: string): string {
    return this.#streams.get(stream)?.text ?? "";
  }

  currentText(stream: string): string {
    return this.#streams.get(stream)?.screen.logicalLines().join("\n") ?? "";
  }

  snapshot(stream: string) {
    return this.#streams.get(stream)?.screen.getSnapshot();
  }

  modes(stream: string) {
    return this.#streams.get(stream)?.screen.getModes();
  }

  clear(): void {
    // Preserve the screen and parser (including unfinished escape sequences).
    // Only rows that change after this point can satisfy a new observation.
    for (const state of this.#streams.values()) state.text = "";
  }

  dispose(): void {
    for (const state of this.#streams.values()) state.screen.dispose();
    this.#streams.clear();
  }
}
