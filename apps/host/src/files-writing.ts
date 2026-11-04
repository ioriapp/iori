import { constants } from "node:fs";
import { fileUploadTemporaries } from "./files-upload-temporaries.ts";
import { randomUUID } from "node:crypto";
import {
  lstat,
  realpath,
  open,
  rename,
  rm,
  link,
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type {
  FilesTransferMethod,
  FilesTransferParams,
  FilesTransferResults,
  ProtocolErrorCode,
} from "@iori/protocol";
import { isWithin } from "./files-reading.ts";
import { errorCode } from "./reading-failure.ts";

export class FilePutFailure extends Error {
  readonly code: ProtocolErrorCode;
  constructor(code: ProtocolErrorCode) {
    super(code);
    this.code = code;
  }
}
/** Resolve peer paths with the same separators and names as the Host OS. */
async function destination(root: string, path: string) {
  if (!isAbsolute(root) || path.startsWith("/") || /^[a-z]:/iu.test(path))
    throw new FilePutFailure("path_outside_root");
  if (
    !path ||
    path.includes("\0") ||
    (process.platform === "win32" && path.includes("\\"))
  )
    throw new FilePutFailure("put_failed");
  const parts = path.split("/");
  if (parts.some((part) => part === ".."))
    throw new FilePutFailure("path_outside_root");
  if (parts.some((part) => !part || part === "."))
    throw new FilePutFailure("put_failed");
  if (
    process.platform === "win32" &&
    parts.some(
      (part) =>
        /[<>:"|?*\u0000-\u001f]|[. ]$/u.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part),
    )
  )
    throw new FilePutFailure("put_failed");
  const realRoot = await realpath(root);
  const parent = await realpath(join(realRoot, ...parts.slice(0, -1)));
  if (!isWithin(realRoot, parent))
    throw new FilePutFailure("path_outside_root");
  const target = join(parent, parts.at(-1)!);
  const info = await lstat(target).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  });
  if (info && !info.isFile()) throw new FilePutFailure("put_not_a_file");
  return { target, exists: Boolean(info), mode: info?.mode };
}
type UploadParams = FilesTransferParams[Exclude<
  FilesTransferMethod,
  "files.put.inspect" | "files.put.session"
>];

type Upload = {
  owner: string;
  sessionId: string;
  root: string;
  path: string;
  target: string;
  temp: string;
  file?: FileHandle;
  replace: boolean;
  written: number;
  finished: boolean;
};
/** Transfers belong to the authenticated device and survive a transport reconnect.
 * Every operation on the same transfer is serialized, including cancellation. */
export class FileUploads {
  readonly #uploads = new Map<string, Upload>();
  readonly #queues = new Map<string, Promise<unknown>>();
  readonly #sessions = new Map<string, string>();
  readonly #changes = new Map<string, Promise<unknown>>();
  readonly #active = new Map<string, Set<Promise<unknown>>>();
  readonly #journal = new Set<string>();
  readonly #journalFile: string;
  readonly #ready: Promise<void>;
  #journalQueue = Promise.resolve();
  constructor(storageRoot: string) {
    this.#journalFile = join(storageRoot, "files-uploads.json");
    this.#ready = this.#recover();
  }
  async #recover() {
    // Recovery is best effort: an old, unreadable journal or an undeletable
    // temporary must not prevent the user from starting a new transfer.
    try {
      const paths = JSON.parse(
        await readFile(this.#journalFile, "utf8"),
      ) as string[];
      await Promise.all(
        paths.map((path) => rm(path, { force: true }).catch(() => undefined)),
      );
    } catch {
      // Forget an unreadable recovery record and continue with this Host.
    }
    await this.#persist().catch(() => undefined);
  }
  #persist() {
    const pending = this.#journalQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.#journalFile), { recursive: true });
        const temporary = this.#journalFile + ".tmp";
        await writeFile(temporary, JSON.stringify([...this.#journal]), {
          mode: 0o600,
        });
        await rename(temporary, this.#journalFile);
      });
    this.#journalQueue = pending;
    return pending;
  }
  #session(owner: string, sessionId: string) {
    const pending = (this.#changes.get(owner) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        if (this.#sessions.get(owner) === sessionId) return;
        await Promise.allSettled(this.#active.get(owner) ?? []);
        for (const [key, upload] of this.#uploads)
          if (upload.owner === owner) {
            await this.#discard(upload);
            this.#uploads.delete(key);
          }
        this.#sessions.set(owner, sessionId);
      });
    this.#changes.set(owner, pending);
    return pending;
  }
  async request<M extends FilesTransferMethod>(
    owner: string,
    method: M,
    params: FilesTransferParams[M],
  ): Promise<FilesTransferResults[M]> {
    try {
      await this.#ready;
      if (method === "files.put.session") {
        await this.#session(owner, params.sessionId);
        return {} as FilesTransferResults[M];
      }
      await this.#changes.get(owner);
      if (this.#sessions.get(owner) !== params.sessionId)
        throw new FilePutFailure("put_failed");
      if (method === "files.put.inspect") {
        const value = params as FilesTransferParams["files.put.inspect"];
        const files = await Promise.all(
          value.paths.map(async (path) => {
            try {
              return {
                path,
                exists: (await destination(value.root, path)).exists,
              };
            } catch (error) {
              return { path, error: this.#failure(error).code };
            }
          }),
        );
        return { files } as FilesTransferResults[M];
      }
      const value = params as UploadParams;
      const key = JSON.stringify([owner, value.sessionId, value.uploadId]);
      const pending = (this.#queues.get(key) ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => this.#operate(owner, key, method, value));
      this.#queues.set(key, pending);
      let active = this.#active.get(owner);
      if (!active) {
        active = new Set();
        this.#active.set(owner, active);
      }
      active.add(pending);
      try {
        return (await pending) as FilesTransferResults[M];
      } finally {
        active.delete(pending);
        if (this.#queues.get(key) === pending) this.#queues.delete(key);
      }
    } catch (error) {
      throw this.#failure(error);
    }
  }
  #failure(error: unknown) {
    if (error instanceof FilePutFailure) return error;
    return new FilePutFailure(
      ["EPERM", "EACCES"].includes(errorCode(error))
        ? "permission_denied"
        : errorCode(error) === "EEXIST"
          ? "put_exists"
          : "put_failed",
    );
  }

  async #discard(upload: Upload) {
    await upload.file?.close();
    upload.file = undefined;
    await rm(upload.temp, { force: true });
    fileUploadTemporaries.delete(upload.temp);
    this.#journal.delete(upload.temp);
    await this.#persist();
  }
  async #operate(
    owner: string,
    key: string,
    method: FilesTransferMethod,
    value: UploadParams,
  ) {
    let upload = this.#uploads.get(key);
    if (method === "files.put.cancel") {
      if (upload) await this.#discard(upload);
      this.#uploads.delete(key);
      return {};
    }
    if (method === "files.put.begin" && "root" in value) {
      if (upload) return { written: upload.written };
      const { target, exists } = await destination(value.root, value.path);
      if (exists && !value.replace) throw new FilePutFailure("put_exists");
      const temp = join(dirname(target), `.iori-put-${randomUUID()}`);
      this.#journal.add(temp);
      await this.#persist();
      fileUploadTemporaries.add(temp);
      let file: FileHandle;
      try {
        file = await open(temp, "wx");
      } catch (error) {
        fileUploadTemporaries.delete(temp);
        this.#journal.delete(temp);
        await this.#persist();
        throw error;
      }
      upload = {
        owner,
        sessionId: value.sessionId,
        root: value.root,
        path: value.path,
        target,
        temp,
        file,
        replace: value.replace,
        written: 0,
        finished: false,
      };
      this.#uploads.set(key, upload);
      return { written: 0 };
    }
    if (!upload) throw new FilePutFailure("put_failed");
    if (method === "files.put.status")
      return { written: upload.written, finished: upload.finished };
    try {
      if (method === "files.put.chunk" && "offset" in value) {
        // Offset addresses the bytes; a replay after a lost response cannot append twice.
        if (value.offset === upload.written && !upload.finished) {
          const bytes = Buffer.from(value.data, "base64");
          let written = 0;
          while (written < bytes.length) {
            const part = await upload.file!.write(
              bytes,
              written,
              bytes.length - written,
              upload.written,
            );
            written += part.bytesWritten;
            upload.written += part.bytesWritten;
          }
        }
        return { written: upload.written };
      }
      if (method === "files.put.finish") {
        if (upload.finished) return {};
        const { target, exists, mode } = await destination(
          upload.root,
          upload.path,
        );
        if (target !== upload.target)
          throw new FilePutFailure("path_outside_root");
        if (exists && !upload.replace) throw new FilePutFailure("put_exists");
        if (upload.replace && mode !== undefined)
          await upload.file!.chmod(mode & 0o777);
        await upload.file!.sync();
        await upload.file!.close();
        upload.file = undefined;
        if (upload.replace) await rename(upload.temp, target);
        else {
          try {
            await link(upload.temp, target);
          } catch (error) {
            if (["EEXIST", "EACCES"].includes(errorCode(error))) throw error;
            await copyFile(upload.temp, target, constants.COPYFILE_EXCL);
          }
          await rm(upload.temp);
        }
        fileUploadTemporaries.delete(upload.temp);
        this.#journal.delete(upload.temp);
        await this.#persist();
        upload.finished = true;
        return {};
      }
      throw new FilePutFailure("invalid_request");
    } catch (error) {
      await this.#discard(upload);
      this.#uploads.delete(key);
      throw error;
    }
  }
  async close() {
    await this.#ready;
    await Promise.allSettled(this.#changes.values());
    await Promise.allSettled(this.#queues.values());
    await Promise.all(
      [...this.#uploads.values()].map((upload) => this.#discard(upload)),
    );
    this.#uploads.clear();
  }
}
