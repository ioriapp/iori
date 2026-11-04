import { MAX_READ_BYTES } from "@iori/protocol";
import { native } from "../native.ts";
import type { ReadingTransport } from "../reading/transport.ts";

/** OS selection precedes transfer; only one finite read range is held at once. */
export async function saveFile(
  transport: ReadingTransport,
  root: string,
  path: string,
  signal: AbortSignal,
  progress: (size: number, written: number) => void,
  recover: <T>(task: () => Promise<T>) => Promise<T>,
) {
  const id = await native.fileSaveBegin(path.split("/").at(-1) ?? path);
  if (id === null) return;
  try {
    let offset = 0;
    for (;;) {
      signal.throwIfAborted();
      const page = await recover(() =>
        transport.request(
          "files.read",
          { root, path, offset, length: MAX_READ_BYTES },
          signal,
        ),
      );
      progress(page.sizeBytes, offset);
      signal.throwIfAborted();
      await native.fileSaveWrite(id, page.bytesBase64);
      progress(page.sizeBytes, page.nextOffset);
      if (page.eof) break;
      offset = page.nextOffset;
    }
    signal.throwIfAborted();
    await native.fileSaveFinish(id);
  } catch (cause) {
    await native.fileSaveCancel(id);
    throw cause;
  }
}
