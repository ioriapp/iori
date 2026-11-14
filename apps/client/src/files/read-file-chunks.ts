import { decodeBytes, type ReadingTransport } from "../reading/transport.ts";

const CHUNK_BYTES = 1_048_576;

export async function readFileChunks(
  transport: ReadingTransport,
  root: string,
  path: string,
  signal: AbortSignal,
) {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (;;) {
    const result = await transport.request(
      "files.read",
      { root, path, offset, length: CHUNK_BYTES },
      signal,
    );
    parts.push(decodeBytes(result.bytesBase64));
    offset = result.nextOffset;
    if (result.eof) return parts;
  }
}
