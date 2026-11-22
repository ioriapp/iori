import {
  encodeFrame,
  MAX_FRAME_BYTES,
  type TerminalOpenStream,
  type TerminalServerMessage,
  type TerminalViewAttributes,
} from "@iori/protocol";
import type { TerminalSession } from "./terminal-session.ts";
export const OVERFLOW_RESET_CODE = 1;
export type NativeConnection = object;
export interface NativeBiStream {
  write(bytes: Buffer): Promise<void>;
  finish(): Promise<void>;
  reset(code: number): Promise<void>;
  stop(code: number): Promise<void>;
}
// The PTY is paced by what the Host has not yet handed to the connections:
// stop reading while every attached view is above the high mark, continue as
// soon as any one is below the low mark (the marks VS Code's terminal flow
// control uses). A view that cannot keep up is reset when its queue overflows,
// so it never holds back the others.
export const OUTPUT_HIGH_WATERMARK = 100_000;
const OUTPUT_LOW_WATERMARK = 5_000;
// Output is sent in frames at most this often and this large: one frame per
// small PTY read costs the receiver a round trip each, which is far slower
// than the PTY can produce (VS Code batches PTY data at 5 ms too).
const OUTPUT_FRAME_INTERVAL_MS = 5;
const OUTPUT_MERGE_LIMIT = 256 * 1024;
// One merged output item is enough backlog. A slower view resumes from the
// current saved screen rather than draining several MiB of obsolete output.
// Snapshot bytes are separate: a large restore must not reset itself.
const MAX_QUEUED_OUTPUT_BYTES = OUTPUT_MERGE_LIMIT;
/** Output waiting for the connection; later output is merged into it. */
interface PendingOutput {
  data: string;
  bytes: number;
  sequence: number;
}

export interface TerminalSubscriber {
  connection: NativeConnection;
  stream: NativeBiStream;
  terminalId: string;
  viewId: string;
  viewAttributes: TerminalViewAttributes;
  deviceClass: TerminalOpenStream["deviceClass"];
  cols: number;
  rows: number;
  frames: (Buffer | PendingOutput)[];
  queuedBytes: number;
  queuedOutputBytes: number;
  writing: boolean;
  finishWhenDrained: boolean;
  detached: boolean;
  sizeSuperseded: boolean;
}

function serializedFrame(message: TerminalServerMessage): Buffer {
  return Buffer.from(encodeFrame(message));
}

function* splitOutput(data: string, sequence: number): Generator<Buffer> {
  try {
    yield serializedFrame({ kind: "terminal.output", data, sequence });
  } catch {
    const points = [...data];
    if (points.length <= 1)
      throw new Error("Terminal output exceeds frame limit");
    const middle = Math.floor(points.length / 2);
    yield* splitOutput(points.slice(0, middle).join(""), sequence);
    yield* splitOutput(points.slice(middle).join(""), sequence);
  }
}

export function queueFrame(
  runtime: TerminalSession,
  subscriber: TerminalSubscriber,
  message: TerminalServerMessage,
): void {
  try {
    queueBytes(runtime, subscriber, serializedFrame(message));
  } catch {
    detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE, true);
  }
}

function queueBytes(
  runtime: TerminalSession,
  subscriber: TerminalSubscriber,
  frame: Buffer,
): void {
  if (subscriber.detached) return;
  if (subscriber.queuedBytes + frame.byteLength > MAX_FRAME_BYTES) {
    detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE, true);
    return;
  }
  subscriber.frames.push(frame);
  subscriber.queuedBytes += frame.byteLength;
  void flush(runtime, subscriber);
}

export function queueOutput(
  runtime: TerminalSession,
  subscriber: TerminalSubscriber,
  data: string,
  sequence: number,
): void {
  if (subscriber.detached) return;
  const bytes = Buffer.byteLength(data);
  if (
    subscriber.queuedBytes + bytes > MAX_FRAME_BYTES ||
    subscriber.queuedOutputBytes + bytes > MAX_QUEUED_OUTPUT_BYTES
  ) {
    detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE, true);
    return;
  }
  // The item being written has left the queue; the ones behind it can grow.
  const last = subscriber.frames.at(-1);
  if (
    last &&
    !Buffer.isBuffer(last) &&
    last.bytes + bytes <= OUTPUT_MERGE_LIMIT
  ) {
    last.data += data;
    last.bytes += bytes;
    last.sequence = sequence;
  } else {
    subscriber.frames.push({ data, bytes, sequence });
  }
  subscriber.queuedBytes += bytes;
  subscriber.queuedOutputBytes += bytes;
  void flush(runtime, subscriber);
}

/** Whether every attached view has more than `mark` waiting. */
export function allBehind(runtime: TerminalSession, mark: number): boolean {
  if (runtime.subscribers.size === 0) return false;
  for (const subscriber of runtime.subscribers) {
    if (subscriber.queuedBytes <= mark) return false;
  }
  return true;
}

export function resumeIfCaughtUp(runtime: TerminalSession): void {
  if (!runtime.backpressured || allBehind(runtime, OUTPUT_LOW_WATERMARK))
    return;
  runtime.backpressured = false;
  if (!runtime.stopped) runtime.pty?.resume();
}

async function flush(
  runtime: TerminalSession,
  subscriber: TerminalSubscriber,
): Promise<void> {
  if (subscriber.writing || subscriber.detached) return;
  subscriber.writing = true;
  try {
    while (subscriber.frames.length > 0 && !subscriber.detached) {
      const item = subscriber.frames.shift()!;
      const size = Buffer.isBuffer(item) ? item.byteLength : item.bytes;
      try {
        if (Buffer.isBuffer(item)) await subscriber.stream.write(item);
        else {
          for (const frame of splitOutput(item.data, item.sequence))
            await subscriber.stream.write(frame);
          // Output arriving meanwhile joins the next frame.
          await new Promise((resolve) =>
            setTimeout(resolve, OUTPUT_FRAME_INTERVAL_MS),
          );
        }
      } catch {
        detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE, true);
        return;
      } finally {
        subscriber.queuedBytes = Math.max(0, subscriber.queuedBytes - size);
        if (!Buffer.isBuffer(item))
          subscriber.queuedOutputBytes = Math.max(
            0,
            subscriber.queuedOutputBytes - size,
          );
        resumeIfCaughtUp(runtime);
      }
    }
    if (subscriber.finishWhenDrained && !subscriber.detached) {
      subscriber.detached = true;
      runtime.subscribers.delete(subscriber);
      await subscriber.stream.finish().catch(() => undefined);
      await subscriber.stream.stop(0).catch(() => undefined);
    }
  } finally {
    subscriber.writing = false;
  }
}

export function detachSubscriber(
  runtime: TerminalSession,
  subscriber: TerminalSubscriber,
  errorCode: number,
  preserveInput = false,
): void {
  if (subscriber.detached) return;
  subscriber.detached = true;
  subscriber.frames = [];
  subscriber.queuedBytes = 0;
  subscriber.queuedOutputBytes = 0;
  runtime.subscribers.delete(subscriber);
  resumeIfCaughtUp(runtime);
  if (preserveInput) {
    subscriber.sizeSuperseded = true;
    void subscriber.stream.reset(errorCode).catch(() => undefined);
  } else void abortStream(subscriber.stream, errorCode);
}

export async function abortStream(
  stream: NativeBiStream,
  errorCode: number,
): Promise<void> {
  await stream.reset(errorCode).catch(() => undefined);
  await stream.stop(errorCode).catch(() => undefined);
}

export async function sendTerminalError(
  stream: NativeBiStream,
  message: string,
): Promise<void> {
  try {
    await stream.write(serializedFrame({ kind: "terminal.error", message }));
    await stream.finish();
    await stream.stop(0);
  } catch {
    await stream.reset(OVERFLOW_RESET_CODE).catch(() => undefined);
  }
}
