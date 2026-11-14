import { translator } from "../i18n.ts";
import { MAX_FRAME_BYTES } from "@iori/protocol";
import { connection } from "../connection.ts";
import {
  createReadingTransport,
  ReadConnectionLost,
  ReadError,
  type ReadingTransport,
} from "../reading/transport.ts";
import { saveFile } from "./save-file.ts";

const CHUNK_BYTES = Math.floor(MAX_FRAME_BYTES / 2 / 3) * 3;
const sessionId = crypto.randomUUID();
export type Transfer = {
  id: string;
  host: string;
  root: string;
  path: string;
  kind: "put" | "save";
  size?: number;
  written: number;
  controller: AbortController;
};
type Failure = {
  folder?: string;
  host: string;
  root: string;
  path: string;
  message: string;
  kind: "put" | "save";
};
export const failureFolder = (failure: Failure) =>
  failure.folder ?? failure.path.split("/").slice(0, -1).join("/");
type Confirmation = {
  names: string[];
  locale: string;
  answer: (replace: boolean) => void;
};
type Snapshot = {
  transfers: Transfer[];
  failures: Failure[];
  confirmation?: Confirmation;
};

export function putErrorCopy(error: unknown, locale: string) {
  const t = translator(locale);
  const code = error instanceof ReadError ? error.code : "";
  if (code === "path_outside_root")
    return t("This path is outside the open folder.");
  if (code === "put_not_a_file")
    return t("A folder or link with the same name already exists.");
  if (code === "permission_denied")
    return t("You do not have permission to write to this folder.");
  return t("Could not upload the file.");
}
async function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () =>
      resolve((reader.result as string).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });
}
/** No polling or deadline: reconnection wakes the outstanding transfer. */
async function afterReconnect(host: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (connection.getSnapshot().connectedHosts.includes(host)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      stop();
      signal?.removeEventListener("abort", abort);
    };
    const stop = connection.subscribe(() => {
      if (connection.getSnapshot().connectedHosts.includes(host)) {
        cleanup();
        resolve();
      }
    });
    const abort = () => {
      cleanup();
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** App lifetime, independent of the workspace frame and its mounted Views. */
class FileTransfers {
  #snapshot: Snapshot = { transfers: [], failures: [] };
  readonly #listeners = new Set<() => void>();
  readonly #sessions = new Map<
    string,
    { connection: string; ready: Promise<unknown> }
  >();
  #confirmationQueue = Promise.resolve();
  getSnapshot = () => this.#snapshot;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  #update(change: Partial<Snapshot> = {}) {
    this.#snapshot = { ...this.#snapshot, ...change };
    for (const listener of this.#listeners) listener();
  }
  start() {
    const connected = () => {
      for (const host of connection.getSnapshot().connectedHosts)
        void this.#session(host, createReadingTransport(host)).catch(
          () => undefined,
        );
    };
    const stop = connection.subscribe(connected);
    connected();
    return stop;
  }
  #session(host: string, transport: ReadingTransport) {
    const id = connection.connectionIdOf(host);
    if (!id || !connection.getSnapshot().connectedHosts.includes(host))
      return Promise.reject(new ReadConnectionLost());
    const existing = this.#sessions.get(host);
    if (existing?.connection === id) return existing.ready;
    const entry = {
      connection: id,
      ready: transport.request("files.put.session", { sessionId }),
    };
    this.#sessions.set(host, entry);
    void entry.ready.catch(() => {
      if (this.#sessions.get(host) === entry) this.#sessions.delete(host);
    });
    return entry.ready;
  }
  async #recover<T>(
    host: string,
    task: () => Promise<T>,
    signal?: AbortSignal,
    reconnected?: () => Promise<void>,
  ): Promise<T> {
    for (;;) {
      signal?.throwIfAborted();
      try {
        return await task();
      } catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof ReadConnectionLost)) throw error;
        await afterReconnect(host, signal);
        if (reconnected) await this.#recover(host, reconnected, signal);
      }
    }
  }
  #remove(transfer: Transfer) {
    this.#update({
      transfers: this.#snapshot.transfers.filter((item) => item !== transfer),
    });
  }
  cancel(transfer: Transfer) {
    transfer.controller.abort();
    this.#remove(transfer);
  }
  clearFailure(failure: Failure) {
    this.#update({
      failures: this.#snapshot.failures.filter((item) => item !== failure),
    });
  }
  fail(failure: Failure) {
    this.#update({
      failures: [
        ...this.#snapshot.failures.filter(
          (item) =>
            !(
              item.host === failure.host &&
              item.root === failure.root &&
              item.kind === failure.kind &&
              (failure.kind === "put"
                ? failureFolder(item) === failureFolder(failure) &&
                  item.message === failure.message
                : item.path === failure.path)
            ),
        ),
        failure,
      ],
    });
  }
  #confirm(
    names: string[],
    locale: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const queued = this.#confirmationQueue.then(async () => {
      if (signal.aborted) return false;
      return new Promise<boolean>((resolve) => {
        let answered = false;
        const answer = (replace: boolean) => {
          if (answered) return;
          answered = true;
          signal.removeEventListener("abort", aborted);
          this.#update({ confirmation: undefined });
          resolve(replace);
        };
        const aborted = () => answer(false);
        signal.addEventListener("abort", aborted, { once: true });
        this.#update({ confirmation: { names, locale, answer } });
      });
    });
    this.#confirmationQueue = queued.then(() => undefined);
    return queued;
  }
  put(
    transport: ReadingTransport,
    host: string,
    root: string,
    locale: string,
    files: File[],
    folder: string,
  ) {
    const batch = files.map((file) => ({
      file,
      transfer: {
        id: crypto.randomUUID(),
        host,
        root,
        path: [folder, file.name].filter(Boolean).join("/"),
        kind: "put" as const,
        size: file.size,
        written: 0,
        controller: new AbortController(),
      },
    }));
    // Publish synchronously: a second drop is visible even while another is writing.
    this.#update({
      transfers: [
        ...this.#snapshot.transfers,
        ...batch.map((item) => item.transfer),
      ],
    });
    void (async () => {
      const confirmation = new AbortController();
      for (const { transfer } of batch)
        transfer.controller.signal.addEventListener(
          "abort",
          () => {
            if (batch.every((item) => item.transfer.controller.signal.aborted))
              confirmation.abort();
          },
          { once: true },
        );
      let inspected: { path: string; exists?: boolean; error?: string }[];
      try {
        await this.#recover(
          host,
          () => this.#session(host, transport),
          confirmation.signal,
        );
        inspected = (
          await this.#recover(
            host,
            () =>
              transport.request("files.put.inspect", {
                sessionId,
                root,
                paths: batch.map((item) => item.transfer.path),
              }),
            confirmation.signal,
          )
        ).files;
        const existing = inspected
          .filter((item) => item.exists)
          .map((item) => item.path);
        if (
          existing.length &&
          !(await this.#confirm(existing, locale, confirmation.signal))
        ) {
          for (const { transfer } of batch) this.#remove(transfer);
          return;
        }
      } catch (error) {
        for (const { transfer } of batch) {
          if (!transfer.controller.signal.aborted)
            this.fail({
              host,
              root,
              path: transfer.path,
              kind: "put",
              message: putErrorCopy(error, locale),
            });
          this.#remove(transfer);
        }
        return;
      }
      for (const [index, { file, transfer }] of batch.entries()) {
        const signal = transfer.controller.signal;
        const params = { sessionId, uploadId: transfer.id };
        const recover = <T>(
          task: () => Promise<T>,
          reconnected?: () => Promise<void>,
        ) => this.#recover(host, task, signal, reconnected);
        try {
          const inspectedFile = inspected[index];
          if (inspectedFile.error) throw new ReadError(inspectedFile.error);
          signal.throwIfAborted();
          await recover(() =>
            transport.request("files.put.begin", {
              ...params,
              root,
              path: transfer.path,
              replace: Boolean(inspectedFile.exists),
            }),
          );
          const status = async () => {
            await this.#session(host, transport);
            transfer.written = (
              await transport.request("files.put.status", params)
            ).written;
            this.#update();
          };
          await recover(status);
          while (transfer.written < file.size) {
            await recover(async () => {
              const offset = transfer.written;
              const data = await base64(
                file.slice(offset, offset + CHUNK_BYTES),
              );
              signal.throwIfAborted();
              transfer.written = (
                await transport.request("files.put.chunk", {
                  ...params,
                  offset,
                  data,
                })
              ).written;
              this.#update();
            }, status);
          }
          signal.throwIfAborted();
          await recover(
            () => transport.request("files.put.finish", params),
            status,
          );
        } catch (error) {
          if (!signal.aborted)
            this.fail({
              host,
              root,
              path: transfer.path,
              kind: "put",
              message: putErrorCopy(error, locale),
            });
        } finally {
          this.#remove(transfer);
          await this.#recover(host, async () => {
            await this.#session(host, transport);
            await transport.request("files.put.cancel", params);
          }).catch(() => undefined);
        }
      }
    })();
  }

  save(
    transport: ReadingTransport,
    host: string,
    root: string,
    locale: string,
    path: string,
  ) {
    const transfer: Transfer = {
      id: crypto.randomUUID(),
      host,
      root,
      path,
      kind: "save",
      written: 0,
      controller: new AbortController(),
    };
    this.#update({ transfers: [...this.#snapshot.transfers, transfer] });
    void saveFile(
      transport,
      root,
      path,
      transfer.controller.signal,
      (size, written) => {
        transfer.size = size;
        transfer.written = written;
        this.#update();
      },
      (task) => this.#recover(host, task, transfer.controller.signal),
    )
      .catch(() => {
        if (!transfer.controller.signal.aborted)
          this.fail({
            host,
            root,
            path,
            kind: "save",
            message: locale.startsWith("ja")
              ? "ダウンロードできませんでした。"
              : "Could not download the file.",
          });
      })
      .finally(() => this.#remove(transfer));
  }
}
export const fileTransfers = new FileTransfers();
