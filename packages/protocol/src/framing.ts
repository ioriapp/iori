import { FrameError } from "./primitives.ts";
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export function encodeFrame(value: unknown): Uint8Array {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new FrameError("value cannot be encoded as JSON");
  }
  if (json === undefined)
    throw new FrameError("value cannot be encoded as JSON");
  const payload = encoder.encode(json);
  if (payload.byteLength > MAX_FRAME_BYTES) {
    throw new FrameError("frame exceeds the maximum size");
  }
  const frame = new Uint8Array(4 + payload.byteLength);
  new DataView(frame.buffer).setUint32(0, payload.byteLength, false);
  frame.set(payload, 4);
  return frame;
}

export class FrameDecoder {
  private pending: Uint8Array[] = [];
  private pendingHead = 0;
  private pendingOffset = 0;
  private pendingBytes = 0;
  private readonly header = new Uint8Array(4);

  push(bytes: Uint8Array): Uint8Array[] {
    if (bytes.byteLength !== 0) {
      this.pending.push(new Uint8Array(bytes));
      this.pendingBytes += bytes.byteLength;
    }
    const frames: Uint8Array[] = [];

    while (this.pendingBytes >= 4) {
      this.copyPending(0, this.header);
      const length = new DataView(this.header.buffer).getUint32(0, false);
      if (length > MAX_FRAME_BYTES) {
        this.clearPending();
        throw new FrameError("frame exceeds the maximum size");
      }
      if (this.pendingBytes - 4 < length) break;
      const payload = new Uint8Array(length);
      this.copyPending(4, payload);
      frames.push(payload);
      this.consume(4 + length);
    }

    if (this.pendingBytes > MAX_FRAME_BYTES + 4) {
      this.clearPending();
      throw new FrameError("frame exceeds the maximum size");
    }
    return frames;
  }

  finish(): void {
    if (this.pendingBytes !== 0) {
      this.clearPending();
      throw new FrameError("stream ended in the middle of a frame");
    }
  }

  private copyPending(offset: number, target: Uint8Array): void {
    let chunkIndex = this.pendingHead;
    let chunkOffset = this.pendingOffset + offset;
    while (chunkIndex < this.pending.length) {
      const chunk = this.pending[chunkIndex]!;
      if (chunkOffset < chunk.byteLength) break;
      chunkOffset -= chunk.byteLength;
      chunkIndex += 1;
    }

    let targetOffset = 0;
    while (targetOffset < target.byteLength) {
      const chunk = this.pending[chunkIndex]!;
      const length = Math.min(
        target.byteLength - targetOffset,
        chunk.byteLength - chunkOffset,
      );
      target.set(
        chunk.subarray(chunkOffset, chunkOffset + length),
        targetOffset,
      );
      targetOffset += length;
      chunkIndex += 1;
      chunkOffset = 0;
    }
  }

  private consume(length: number): void {
    this.pendingBytes -= length;
    while (length !== 0) {
      const chunk = this.pending[this.pendingHead]!;
      const consumed = Math.min(length, chunk.byteLength - this.pendingOffset);
      length -= consumed;
      this.pendingOffset += consumed;
      if (this.pendingOffset === chunk.byteLength) {
        delete this.pending[this.pendingHead];
        this.pendingHead += 1;
        this.pendingOffset = 0;
      }
    }

    if (this.pendingHead === this.pending.length) {
      this.pending = [];
      this.pendingHead = 0;
    } else if (
      this.pendingHead >= 1024 &&
      this.pendingHead * 2 >= this.pending.length
    ) {
      this.pending = this.pending.slice(this.pendingHead);
      this.pendingHead = 0;
    }
  }

  private clearPending(): void {
    this.pending = [];
    this.pendingHead = 0;
    this.pendingOffset = 0;
    this.pendingBytes = 0;
  }
}

export function decodeFrame(payload: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(payload)) as unknown;
  } catch {
    throw new FrameError("frame is not valid UTF-8 JSON");
  }
}
