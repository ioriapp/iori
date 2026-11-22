import { timingSafeEqual } from "node:crypto";
import { createSocket } from "node:dgram";
import { isIP, type Socket, type Server } from "node:net";
import { networkInterfaces } from "node:os";
import {
  encodeFrame,
  decodeFrame,
  FrameDecoder,
  FrameError,
  type ProtocolErrorCode,
  type Response,
} from "@iori/protocol";
import type { ConnectionScope } from "./connection-scope.ts";
import type { NativeConnection, NativeBiStream } from "./native.ts";

// pair: UUID + 43-byte secret + 63 Unicode code points (including JSON escapes).
const MAX_PRE_AUTH_FRAME_BYTES = 1024;
const FRAME_READ_CHUNK = 64 * 1024;
export function portFromEnvironment(): number | undefined {
  const value = process.env.IORI_HOST_PORT;
  if (value === undefined || value === "") return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("IORI_HOST_PORT must be a port from 1 to 65535");
  }
  return port;
}

export async function availablePort(scope: ConnectionScope): Promise<number> {
  const socket = createSocket("udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(0, scope === "loopback" ? "127.0.0.1" : "0.0.0.0", resolve);
    });
    return socket.address().port;
  } finally {
    await new Promise<void>((resolve) => socket.close(resolve));
  }
}

export function hostAddresses(port: number): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      const address = entry.address.split("%", 1)[0] ?? "";
      if (entry.internal || isIP(address) === 0) continue;
      if (
        address.startsWith("169.254.") ||
        /^fe[89ab][0-9a-f]:/iu.test(address)
      ) {
        continue;
      }
      addresses.add(
        entry.family === "IPv6" ? `[${address}]:${port}` : `${address}:${port}`,
      );
    }
  }
  return [...addresses].sort();
}

export function bindAddresses(port: number, scope: ConnectionScope): string[] {
  if (scope === "loopback") return [`127.0.0.1:${port}`, `[::1]:${port}`];
  return [`0.0.0.0:${port}`, `[::]:${port}`];
}

export function responseError(code: ProtocolErrorCode): Response<never> {
  return { ok: false, error: { code } };
}

export function frameBytes(value: unknown): Buffer {
  const frame = encodeFrame(value);
  return Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
}

export async function writeStreamFrame(
  stream: NativeBiStream,
  value: unknown,
): Promise<void> {
  try {
    await stream.write(frameBytes(value));
  } catch (error) {
    // STOP_SENDING only notifies the application. Answer with RESET_STREAM;
    // retaining the native wrapper until V8 GC must not retain QUIC credit.
    await stream.reset(0).catch(() => undefined);
    throw error;
  }
}

export async function sendStreamResponse(
  stream: NativeBiStream,
  response: Response<unknown>,
): Promise<void> {
  await writeStreamFrame(stream, response);
  await stream.finish();
}

export function createStreamFrameReader(
  stream: NativeBiStream,
  preAuth = false,
): () => Promise<unknown | undefined> {
  if (preAuth) {
    return async () => {
      const header = Buffer.alloc(4);
      let offset = 0;
      while (offset < 4) {
        const chunk = await stream.read(4 - offset);
        if (chunk === null) {
          if (offset === 0) return undefined;
          throw new FrameError("incomplete request header");
        }
        header.set(chunk, offset);
        offset += chunk.length;
      }
      const length = header.readUInt32BE();
      if (length > MAX_PRE_AUTH_FRAME_BYTES)
        throw new FrameError("pre-auth frame exceeds the maximum size");
      const payload = Buffer.alloc(length);
      offset = 0;
      while (offset < length) {
        const chunk = await stream.read(length - offset);
        if (chunk === null) throw new FrameError("incomplete request frame");
        payload.set(chunk, offset);
        offset += chunk.length;
      }
      return decodeFrame(payload);
    };
  }
  const decoder = new FrameDecoder();
  const frames: Uint8Array[] = [];
  let ended = false;
  return async () => {
    while (frames.length === 0 && !ended) {
      const chunk = await stream.read(FRAME_READ_CHUNK);
      if (chunk === null) {
        decoder.finish();
        ended = true;
        break;
      }
      frames.push(...decoder.push(chunk));
    }
    const payload = frames.shift();
    return payload === undefined ? undefined : decodeFrame(payload);
  };
}

export async function readOneSocketFrame(socket: Socket): Promise<unknown> {
  const decoder = new FrameDecoder();
  let payload: Uint8Array | undefined;
  await new Promise<void>((resolve, reject) => {
    const clean = () => {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onData = (chunk: Buffer) => {
      try {
        const frames = decoder.push(chunk);
        if (
          frames.length > 1 ||
          (payload !== undefined && frames.length !== 0)
        ) {
          throw new FrameError("local request contains more than one frame");
        }
        if (frames.length === 1) payload = frames[0];
      } catch (error) {
        clean();
        reject(error);
      }
    };
    const onEnd = () => {
      try {
        decoder.finish();
        if (payload === undefined)
          throw new FrameError("local request has no frame");
        clean();
        resolve();
      } catch (error) {
        clean();
        reject(error);
      }
    };
    const onError = (error: Error) => {
      clean();
      reject(error);
    };
    const onClose = () => {
      clean();
      reject(new FrameError("local request connection closed"));
    };
    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
  if (payload === undefined) throw new FrameError("local request has no frame");
  return decodeFrame(payload);
}

export function localTokenMatches(value: unknown, token: Buffer): boolean {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value))
    return false;
  const actual = Buffer.from(value, "base64url");
  if (actual.byteLength !== 32 || actual.toString("base64url") !== value)
    return false;
  return timingSafeEqual(actual, token);
}

export async function writeSocketFrame(
  socket: Socket,
  value: unknown,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(frameBytes(value), (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function listenLocal(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Local control server did not bind to TCP");
  }
  return address.port;
}

export interface Session {
  connection: NativeConnection;
  publicKey: string;
  preAuth: boolean;
  inviteAttempts: number;
  closed: boolean;
}
