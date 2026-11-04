import { watch, type FSWatcher } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import {
  object,
  toolFinished,
  type CliObserver,
  type HookState,
} from "../hooks.ts";

type TurnRecord =
  | { kind: "interrupted" }
  | { kind: "rejected"; toolUseId: string }
  | { kind: "continued" };

// Claude Code does not emit a hook for a user's interruption or rejection.
// Its transcript distinguishes these from text typed into the input prompt.
export function turnRecord(line: Buffer): TurnRecord | undefined {
  try {
    const item = object(JSON.parse(line.toString("utf8")));
    const message = object(item.message);
    if (item.isSidechain !== false) return undefined;
    if (item.type === "assistant" && message.role === "assistant")
      return { kind: "continued" };
    if (item.type !== "user" || message.role !== "user") return undefined;
    if (Array.isArray(message.content)) {
      const blocks = message.content.map(object);
      if (
        blocks.some(
          (block) =>
            block.type === "text" &&
            typeof block.text === "string" &&
            block.text.startsWith("[Request interrupted by user"),
        )
      )
        return { kind: "interrupted" };
      const denied = blocks.find(
        (block) =>
          block.type === "tool_result" &&
          block.is_error === true &&
          typeof block.tool_use_id === "string",
      );
      if (item.toolDenialKind === "user-rejected" && denied)
        return { kind: "rejected", toolUseId: String(denied.tool_use_id) };
    }
    // A later user/assistant record prevents recovery from replaying an old
    // interruption. Ordinary input never changes the live status here.
    if (typeof message.content === "string" || Array.isArray(message.content))
      return { kind: "continued" };
  } catch {
    // Only complete JSONL records in Claude's own format carry turn state.
  }
  return undefined;
}

// A new conversation's hooks can arrive before Claude creates its JSONL.
// Keep watching the directory until that file is created and appended to.
async function openTranscript(path: string) {
  try {
    return await open(path, "r");
  } catch (error) {
    if (object(error).code === "ENOENT") return undefined;
    throw error;
  }
}

// Scan backwards over complete lines only, without loading the conversation.
async function latest(file: FileHandle, end: number) {
  let position = end;
  let fragments: Buffer[] = [];
  let trailing = true;
  while (position > 0) {
    const length = Math.min(position, 64 * 1024);
    position -= length;
    const chunk = Buffer.alloc(length);
    await file.read(chunk, 0, length, position);
    let lineEnd = chunk.length;
    for (let i = chunk.length - 1; i >= 0; i--) {
      if (chunk[i] !== 10) continue;
      if (!trailing) {
        fragments.push(chunk.subarray(i + 1, lineEnd));
        const event = turnRecord(Buffer.concat(fragments.reverse()));
        if (event) return event;
      }
      trailing = false;
      fragments = [];
      lineEnd = i;
    }
    if (!trailing) fragments.push(chunk.subarray(0, lineEnd));
    if (position === 0 && !trailing)
      return turnRecord(Buffer.concat(fragments.reverse()));
  }
  return undefined;
}

// Like Codex's observer, follow appended complete records with a byte cursor
// and the native directory watcher. No terminal-output or quiet-time guesses.
export function observeTurns(emit: (state: HookState) => void): CliObserver {
  let watcher: FSWatcher | undefined;
  let generation = 0;
  const stop = () => {
    generation++;
    watcher?.close();
    watcher = undefined;
  };
  const start = async (path: string, restoring = false) => {
    stop();
    const current = generation;
    let offset = 0;
    let fragments: Buffer[] = [];
    let skipPartialLine = false;
    let serial = Promise.resolve();
    let initialized = false;
    let watchedDirectory: string | undefined;
    const accept = (event: TurnRecord) => {
      if (current !== generation) return;
      if (event.kind === "interrupted") emit({ state: "stopped" });
      else if (event.kind === "rejected") emit(toolFinished(event.toolUseId));
    };
    const read = async () => {
      if (!initialized || current !== generation) return;
      watchDirectory();
      const file = await openTranscript(path);
      if (!file) return;
      try {
        const size = (await file.stat()).size;
        if (current !== generation) return;
        if (size < offset) {
          stop();
          return;
        }
        while (offset < size && current === generation) {
          const chunk = Buffer.alloc(Math.min(size - offset, 64 * 1024));
          const { bytesRead } = await file.read(chunk, 0, chunk.length, offset);
          if (!bytesRead) return;
          offset += bytesRead;
          const data = chunk.subarray(0, bytesRead);
          let from = 0;
          for (let i = 0; i < data.length; i++) {
            if (data[i] !== 10) continue;
            if (!skipPartialLine) {
              fragments.push(data.subarray(from, i));
              const event = turnRecord(Buffer.concat(fragments));
              if (event) accept(event);
            }
            skipPartialLine = false;
            fragments = [];
            from = i + 1;
          }
          if (!skipPartialLine && from < data.length)
            fragments.push(data.subarray(from));
        }
      } finally {
        await file.close();
      }
    };
    const changed = () => {
      serial = serial.then(read).catch(() => {
        if (current === generation) stop();
      });
    };
    // On the first conversation in a folder, Claude may create the project
    // directory along with the transcript. Follow that creation from its
    // existing parent, then watch the transcript's own directory.
    function watchDirectory() {
      if (current !== generation || watchedDirectory === dirname(path)) return;
      let directory = dirname(path);
      for (;;) {
        try {
          const entry = relative(directory, path).split(sep)[0];
          const next = watch(directory, (_event, name) => {
            if (name === null || name.toString() === entry) changed();
          });
          next.on("error", () => {
            if (current === generation) stop();
          });
          watcher?.close();
          watcher = next;
          watchedDirectory = directory;
          return;
        } catch (error) {
          const parent = dirname(directory);
          if (object(error).code !== "ENOENT" || parent === directory)
            throw error;
          directory = parent;
        }
      }
    }
    try {
      watchDirectory();
      const file = await openTranscript(path);
      if (file) {
        try {
          offset = (await file.stat()).size;
          if (offset) {
            const lastByte = Buffer.alloc(1);
            await file.read(lastByte, 0, 1, offset - 1);
            skipPartialLine = lastByte[0] !== 10;
          }
          if (restoring) {
            const event = await latest(file, offset);
            if (event?.kind === "interrupted") accept(event);
          }
        } finally {
          await file.close();
        }
      }
      initialized = true;
      changed();
    } catch {
      if (current === generation) stop();
    }
  };
  return {
    async onHook(payload) {
      const event = payload.hook_event_name;
      if (["Stop", "StopFailure", "SessionEnd"].includes(String(event))) stop();
      if (
        ["SessionStart", "UserPromptSubmit"].includes(String(event)) &&
        typeof payload.transcript_path === "string"
      )
        await start(payload.transcript_path);
    },
    async restore(file, status) {
      if (file && status && ["active", "waiting"].includes(status.state))
        await start(file, true);
    },
    dispose: stop,
  };
}
