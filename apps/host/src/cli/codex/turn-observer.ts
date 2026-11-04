import { watch, type FSWatcher } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
  cliFailure,
  object,
  type CliObserver,
  type HookState,
} from "../hooks.ts";

// Codex 0.162.1 writes task_complete.error even when API failure skips Stop.
// Like Orca's JSONL cursor/native watcher, read only appended complete records.
// No output/quiet-time heuristics: only Codex's lifecycle ends observation.
function lifecycle(line: Buffer): Record<string, unknown> | undefined {
  try {
    const item = object(JSON.parse(line.toString("utf8")));
    const payload = object(item.payload);
    return item.type === "event_msg" &&
      ["task_started", "task_complete", "turn_aborted"].includes(
        String(payload.type),
      )
      ? payload
      : undefined;
  } catch {
    return undefined;
  }
}
function failure(event: Record<string, unknown>): HookState | undefined {
  const error = object(event.error);
  if (event.type !== "task_complete" || typeof error.message !== "string")
    return undefined;
  let message: unknown = error.message;
  // Codex sometimes wraps the API error JSON in its message. Select only the
  // provider's message, never headers, request bodies or the entire error object.
  if (typeof message === "string") {
    try {
      const parsed = object(JSON.parse(message));
      message = object(parsed.error).message ?? parsed.message ?? message;
    } catch {
      /* Plain error text is already the CLI's display message. */
    }
  }
  return cliFailure(message);
}
async function latest(file: FileHandle, end: number) {
  let position = end;
  let fragments: Buffer[] = [];
  while (position > 0) {
    const length = Math.min(position, 64 * 1024);
    position -= length;
    const chunk = Buffer.alloc(length);
    await file.read(chunk, 0, length, position);
    let lineEnd = chunk.length;
    for (let i = chunk.length - 1; i >= 0; i--) {
      if (chunk[i] !== 10) continue;
      fragments.push(chunk.subarray(i + 1, lineEnd));
      const event = lifecycle(Buffer.concat(fragments.reverse()));
      if (event) return event;
      fragments = [];
      lineEnd = i;
    }
    fragments.push(chunk.subarray(0, lineEnd));
    if (position === 0) return lifecycle(Buffer.concat(fragments.reverse()));
  }
  return undefined;
}
export function observeTurns(emit: (state: HookState) => void): CliObserver {
  let watcher: FSWatcher | undefined;
  let generation = 0;
  let recovered: { path: string; offset: number } | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    generation++;
    watcher?.close();
    watcher = undefined;
    clearInterval(poll);
    poll = undefined;
  };
  const start = async (path: string, restoring = false, from?: number) => {
    stop();
    const current = generation;
    let offset = 0;
    let fragments: Buffer[] = [];
    let serial = Promise.resolve();
    let initialized = false;
    const accept = (event: Record<string, unknown>, restoring = false) => {
      if (current !== generation || event.type === "task_started") return;
      const state: HookState | undefined =
        failure(event) ??
        (restoring
          ? { state: event.type === "turn_aborted" ? "stopped" : "done" }
          : undefined);
      if (restoring) recovered = { path, offset };
      stop();
      if (state) emit(state);
    };
    const read = async () => {
      if (!initialized || current !== generation) return;
      const file = await open(path, "r");
      try {
        const size = (await file.stat()).size;
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
            fragments.push(data.subarray(from, i));
            const event = lifecycle(Buffer.concat(fragments));
            fragments = [];
            from = i + 1;
            if (event) accept(event, restoring);
          }
          if (from < data.length) fragments.push(data.subarray(from));
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
    try {
      watcher = watch(dirname(path), (_event, name) => {
        if (name === null || name.toString() === basename(path)) changed();
      });
      watcher.on("error", () => {
        if (current === generation) stop();
      });
      const file = await open(path, "r");
      try {
        offset = from ?? (await file.stat()).size;
        if (restoring) {
          const event = await latest(file, offset);
          if (event) accept(event, true);
        }
      } finally {
        await file.close();
      }
      initialized = true;
      if (current === generation) {
        // Orca AgentTranscriptPollScheduler ROOT_RECONCILIATION_MS: 5 seconds.
        // File events may precede flushed writes on Windows; only read records.
        poll = setInterval(changed, 5_000);
        poll.unref();
        changed();
      }
    } catch {
      if (current === generation) stop();
    }
  };
  return {
    async onHook(payload) {
      // The daemon replays tool hooks after restore has read the end of the
      // same turn. Keep that terminal result until a newer prompt or a new
      // task_started record establishes the next turn; do not use quiet time.
      if (
        payload.hook_event_name === "SessionStart" &&
        payload.transcript_path !== recovered?.path
      )
        recovered = undefined;
      if (recovered && payload.transcript_path === recovered.path) {
        if (
          payload.hook_event_name === "UserPromptSubmit" &&
          typeof payload.iori_rollout_offset === "number" &&
          payload.iori_rollout_offset >= recovered.offset
        )
          recovered = undefined;
        else {
          let file: FileHandle | undefined;
          try {
            file = await open(recovered.path, "r");
            const end = (await file.stat()).size;
            const event = await latest(file, end);
            if (event?.type === "task_started") recovered = undefined;
            else if (event) {
              if (end > recovered.offset) {
                recovered.offset = end;
                emit(
                  failure(event) ?? {
                    state: event.type === "turn_aborted" ? "stopped" : "done",
                  },
                );
              }
              return false;
            }
          } catch {
            // A missing transcript cannot establish that this hook is old.
            recovered = undefined;
          } finally {
            await file?.close();
          }
        }
      }
      if (
        ["SessionStart", "Stop", "Interrupt"].includes(
          String(payload.hook_event_name),
        )
      )
        stop();
      if (payload.hook_event_name === "UserPromptSubmit") {
        stop();
        if (typeof payload.transcript_path === "string")
          await start(
            payload.transcript_path,
            false,
            typeof payload.iori_rollout_offset === "number" &&
              Number.isSafeInteger(payload.iori_rollout_offset) &&
              payload.iori_rollout_offset >= 0
              ? payload.iori_rollout_offset
              : undefined,
          );
      }
    },
    async restore(file, status) {
      if (file && status && ["active", "waiting"].includes(status.state))
        await start(file, true);
    },
    dispose: stop,
  };
}
