import { parentPort } from "node:worker_threads";
import { createHighlighterCore, guessEmbeddedLanguages } from "shiki/core";
import { bundledLanguages } from "shiki/langs";
import { createOnigurumaEngine } from "@shikijs/engine-oniguruma";
import {
  MAX_PAGE_RESPONSE_BYTES,
  type SyntaxLine,
  type SyntaxSpan,
} from "@iori/protocol";
import { EncodedTokenMetadata, type StateStack } from "shiki/textmate";
import { syntaxKindByColor, syntaxTheme } from "./files-syntax-theme.ts";
import { decodeTextLine } from "./text-lines.ts";
import type {
  SyntaxCommand,
  SyntaxReply,
  SyntaxResult,
} from "./files-syntax.ts";

// The checkpoint interval follows the measured Shiki page size. It changes
// replay work and memory only; no file or request is cut off at this interval.
const CHECKPOINT_LINES = 128;
const MAX_LINE_LENGTH = 20_000;
const entries = new Map<string, Entry>();
const highlighter = createHighlighterCore({
  themes: [syntaxTheme],
  langs: [],
  engine: createOnigurumaEngine(import("shiki/wasm")),
});
type Entry = {
  revision: string;
  lines: string[];
  language?: string;
  ready: Promise<void>;
  cancelled: Int32Array<SharedArrayBuffer>;
  // The grammar state immediately before each checkpoint line (1-based).
  checkpoints: Map<number, StateStack | undefined>;
  scannedTo: number;
};

function newEntry(command: Extract<SyntaxCommand, { kind: "load" }>): Entry {
  const { revision, language, replaceFrom, cancelled } = command;
  const previous = entries.get(command.key);
  const resume =
    previous?.revision === command.previousRevision &&
    previous?.language === language
      ? previous
      : undefined;
  if (!resume && replaceFrom > 1) {
    const ready = Promise.reject(
      new Error("Syntax append base is unavailable"),
    );
    void ready.catch(() => undefined);
    return {
      revision,
      language,
      cancelled,
      lines: [],
      ready,
      checkpoints: new Map(),
      scannedTo: 1,
    };
  }
  const lines = resume?.lines ?? [];
  lines.length = replaceFrom - 1;
  const bytes = command.bytes;
  for (let cursor = 0; cursor < bytes.length;) {
    const newline = bytes.indexOf(10, cursor);
    const end = newline < 0 ? bytes.length : newline;
    lines.push(decodeTextLine(bytes.subarray(cursor, end)));
    cursor = newline < 0 ? bytes.length : newline + 1;
  }
  const checkpoint =
    Math.floor((replaceFrom - 1) / CHECKPOINT_LINES) * CHECKPOINT_LINES + 1;
  const checkpoints = resume?.checkpoints ?? new Map([[1, undefined]]);
  for (const line of checkpoints.keys())
    if (line > checkpoint) checkpoints.delete(line);
  const entry: Entry = {
    revision,
    lines,
    language,
    cancelled,
    ready: Promise.resolve(),
    checkpoints,
    scannedTo: Math.min(resume?.scannedTo ?? 1, checkpoint),
  };
  entry.ready = highlighter.then(async (instance) => {
    // Only preload explicitly named embedded grammars (fences, lang=, etc.).
    const declarations = guessEmbeddedLanguages(
      // With an append, unchanged declarations are already loaded.
      lines.slice(replaceFrom - 1).join("\n"),
      language,
    ).filter((id) => id in bundledLanguages);
    const before = instance.getLoadedLanguages();
    await instance.loadLanguage(
      ...[language, ...declarations].map(
        (id) => bundledLanguages[id as keyof typeof bundledLanguages],
      ),
    );
    // Loading a new grammar recompiles parents; already loaded grammars do not.
    if (instance.getLoadedLanguages().some((id) => !before.includes(id))) {
      for (const cached of entries.values()) {
        cached.checkpoints = new Map([[1, undefined]]);
        cached.scannedTo = 1;
      }
    }
  });
  void entry.ready.catch(() => undefined);
  return entry;
}

function spansFor(
  tokens: Uint32Array,
  length: number,
  colorMap: string[],
): SyntaxSpan[] {
  const spans: SyntaxSpan[] = [];
  for (let at = 0; at < tokens.length; at += 2) {
    const offset = tokens[at];
    const end = tokens[at + 2] ?? length;
    const color = colorMap[EncodedTokenMetadata.getForeground(tokens[at + 1])];
    const kind = syntaxKindByColor.get(color?.toLowerCase() ?? "");
    if (!kind || end === offset) continue;
    const previous = spans.at(-1);
    if (previous?.[2] === kind && previous[0] + previous[1] === offset)
      previous[1] += end - offset;
    else spans.push([offset, end - offset, kind]);
  }
  return spans;
}

async function read(
  entry: Entry,
  startLine: number,
  lineCount: number,
  cancelled: Int32Array<SharedArrayBuffer>,
): Promise<SyntaxResult> {
  const checkCancelled = () => {
    if (Atomics.load(cancelled, 0) || Atomics.load(entry.cancelled, 0))
      throw new Error("Syntax read cancelled");
  };
  checkCancelled();
  await entry.ready;
  checkCancelled();
  const requestedEnd = Math.max(
    startLine,
    Math.min(entry.lines.length + 1, startLine + lineCount),
  );
  const result: SyntaxResult = {
    ...(entry.language ? { language: entry.language } : {}),
    lines: [],
    startLine,
    endLine: requestedEnd,
    revision: entry.revision,
  };
  if (!entry.language) return result;
  const instance = await highlighter;
  const grammar = instance.getLanguage(entry.language);
  const { colorMap } = instance
    .getInternalContext()
    .setTheme("iori-syntax-kinds");
  const checkpoint = Math.min(
    entry.scannedTo,
    Math.floor((startLine - 1) / CHECKPOINT_LINES) * CHECKPOINT_LINES + 1,
  );
  let state = entry.checkpoints.get(checkpoint);
  let responseBytes = Buffer.byteLength(JSON.stringify(result));
  for (let line = checkpoint; line < requestedEnd; line += 1) {
    checkCancelled();
    const text = entry.lines[line - 1];
    if (text === undefined) break;
    // Preserve the grammar state when a long line is skipped. VS Code also
    // stops tokenization of a pathological line after 500ms.
    let spans: SyntaxSpan[] = [];
    if (text.length <= MAX_LINE_LENGTH) {
      const colored = grammar.tokenizeLine2(text, state ?? null, 500);
      // Shiki's convenience API does not expose stoppedEarly. Use its public
      // TextMate grammar so a stopped line cannot advance a partial state.
      if (!colored.stoppedEarly) {
        state = colored.ruleStack;
        if (line >= startLine)
          spans = spansFor(colored.tokens, text.length, colorMap);
      }
    }
    if (line % CHECKPOINT_LINES === 0) {
      entry.checkpoints.set(line + 1, state);
      entry.scannedTo = Math.max(entry.scannedTo, line + 1);
    }
    if (line < startLine) continue;
    if (spans.length === 0) continue;
    const value: SyntaxLine = { line, spans };
    const bytes = Buffer.byteLength(JSON.stringify(value)) + 1;
    // Keep one logical line whole even if that single line exceeds the page
    // budget slightly; the 20,000-unit limit bounds it below a transport frame.
    if (
      result.lines.length > 0 &&
      responseBytes + bytes > MAX_PAGE_RESPONSE_BYTES
    ) {
      result.endLine = line;
      break;
    }
    responseBytes += bytes;
    result.lines.push(value);
  }
  return result;
}

parentPort!.on("message", (command: SyntaxCommand) => {
  if (command.kind === "forget") {
    entries.delete(command.key);
    return;
  }
  if (command.kind === "load") {
    entries.set(command.key, newEntry(command));
    return;
  }
  const entry = entries.get(command.key)!;
  void read(
    entry,
    command.startLine,
    command.lineCount,
    command.cancelled,
  ).then(
    (result) =>
      parentPort!.postMessage({ id: command.id, result } satisfies SyntaxReply),
    (error: unknown) =>
      parentPort!.postMessage({
        id: command.id,
        error: error instanceof Error ? error.message : "Syntax failed",
      } satisfies SyntaxReply),
  );
});
