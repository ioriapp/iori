// Derived from Orca line-editor-ready-output-scanner.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ./ORCA-LICENSE.txt.
const sequences = [
  "\u001b[?2004h",
  "\u001b[?1034h",
  "\u001b]133;A\u0007",
  "\u001b]133;A\u001b\\",
];
const tailLength = Math.max(...sequences.map((value) => value.length)) - 1;
export class LineEditorReady {
  #tail = "";
  scan(data: string): boolean {
    const previousLength = this.#tail.length;
    const combined = this.#tail + data;
    this.#tail = combined.slice(-tailLength);
    return sequences.some((sequence) => {
      let index = combined.indexOf(sequence);
      while (index >= 0) {
        if (index + sequence.length > previousLength) return true;
        index = combined.indexOf(sequence, index + 1);
      }
      return false;
    });
  }
}
