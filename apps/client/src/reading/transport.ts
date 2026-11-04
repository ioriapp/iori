import {
  parseResult,
  parseReadingChangedEvent,
  responseSchema,
  type ForgeReadFailure,
  type ReadMethod,
  type FilesTransferMethod,
  type FilesTransferParams,
  type FilesTransferResults,
  type ReadParamsByMethod,
  type ReadResultByMethod,
} from "@iori/protocol";
import { native } from "../native.ts";
import { connection, type ConnectionController } from "../connection.ts";

/**
 * A change notice for one watched folder. `paths` are relative to the watched
 * base; without them anything may have changed (including after a reconnect).
 */
export type ReadingChange = { paths?: string[] };

type ReadingMethod = ReadMethod | FilesTransferMethod;
type ReadingParams = ReadParamsByMethod & FilesTransferParams;
type ReadingResults = ReadResultByMethod & FilesTransferResults;

export interface ReadingTransport {
  request<M extends ReadingMethod>(
    method: M,
    params: ReadingParams[M],
    signal?: AbortSignal,
  ): Promise<ReadingResults[M]>;
  watch(
    root: string,
    scope: "files" | "file" | "git",
    listener: (change: ReadingChange) => void,
    failed: (error: ReadError) => void,
  ): () => void;
}

/** The Host answered and the read failed. */
export class ReadError extends Error {
  readonly code: string;
  /** Why a Forge could not be read, when the Host could tell. */
  readonly forge?: ForgeReadFailure;
  constructor(code: string, forge?: ForgeReadFailure) {
    super(code);
    this.code = code;
    this.forge = forge;
  }
}

/** The Host is not reachable now. The view keeps what it shows and reads again after reconnecting. */
export class ReadConnectionLost extends Error {}

export const isAbort = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

/** The shell shares its authenticated connection. It never exposes an unauthenticated read port. */
export function createReadingTransport(
  hostKey: string,
  controller: ConnectionController = connection,
): ReadingTransport {
  const currentConnection = () =>
    controller.getSnapshot().connectedHosts.includes(hostKey)
      ? controller.connectionIdOf(hostKey)
      : undefined;
  return {
    async request<M extends ReadingMethod>(
      method: M,
      params: ReadingParams[M],
      signal?: AbortSignal,
    ): Promise<ReadingResults[M]> {
      const connectionId = currentConnection();
      if (!connectionId) throw new ReadConnectionLost();
      signal?.throwIfAborted();
      const cancelKey = crypto.randomUUID();
      const abort = () => {
        void native.cancelStream(cancelKey).catch(() => undefined);
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const json = await native.request(
          connectionId,
          JSON.stringify({
            kind: "request",
            operationId: cancelKey,
            method,
            params,
          }),
          cancelKey,
        );
        signal?.throwIfAborted();
        const response = responseSchema.parse(JSON.parse(json));
        if (!response.ok) throw new ReadError(response.error.code);
        return parseResult(method, response.result);
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (error instanceof ReadError) throw error;
        if (currentConnection() !== connectionId)
          throw new ReadConnectionLost();
        throw new ReadError("read_failed");
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
    watch(root, scope, listener, failed) {
      let disposed = false;
      let connectionId: string | undefined;
      let subscription: string | undefined;
      let foreground = true;
      let stopEvents: (() => void) | undefined;
      let stopForeground: (() => void) | undefined;
      const release = () => {
        if (subscription)
          void native.cancelStream(subscription).catch(() => undefined);
        subscription = undefined;
        connectionId = undefined;
      };
      const update = () => {
        const id = foreground ? currentConnection() : undefined;
        if (id === connectionId || disposed) return;
        release();
        if (!id) return;
        connectionId = id;
        const operationId = crypto.randomUUID();
        subscription = operationId;
        void native
          .subscribe(
            id,
            JSON.stringify({
              kind: "subscribe",
              operationId,
              method: "reading.watch",
              params: { root, scope },
            }),
            operationId,
          )
          .then(() => {
            // Anything may have changed while the view was not watching.
            if (!disposed && subscription === operationId) listener({});
          })
          .catch(() => {
            if (disposed || subscription !== operationId) return;
            if (currentConnection() === id)
              failed(new ReadError("read_failed"));
          });
      };
      const stopConnection = controller.subscribe(update);
      void native
        .onStream((event) => {
          if (
            disposed ||
            event.connectionId !== connectionId ||
            event.subscriptionId !== subscription
          )
            return;
          try {
            const value: unknown = JSON.parse(event.json);
            if (
              typeof value === "object" &&
              value !== null &&
              "ok" in value &&
              value.ok === false
            ) {
              const response = responseSchema.parse(value);
              if (!response.ok) failed(new ReadError(response.error.code));
              return;
            }
            const changed = parseReadingChangedEvent(value);
            if (changed.operationId === subscription)
              listener(changed.paths ? { paths: changed.paths } : {});
          } catch {
            // A notice that cannot be read still means something changed.
            listener({});
          }
        })
        .then((stop) => {
          if (disposed) stop();
          else {
            stopEvents = stop;
            update();
          }
        });
      void native
        .onForeground((value) => {
          foreground = value;
          update();
        })
        .then((stop) => {
          if (disposed) stop();
          else stopForeground = stop;
        });
      return () => {
        disposed = true;
        release();
        stopConnection();
        stopEvents?.();
        stopForeground?.();
      };
    },
  };
}

export function decodeBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
}

/** Text for a failed read, or undefined when nothing failed that the user can act on. */
export function readErrorCopy(
  error: unknown,
  locale: string,
): string | undefined {
  if (!(error instanceof ReadError)) return undefined;
  const ja = locale.startsWith("ja");
  const copy: Record<string, [string, string]> = {
    path_outside_root: [
      "This path is outside the open folder.",
      "このパスは開いたフォルダーの外にあります。",
    ],
    path_not_found: [
      "This file was deleted or moved.",
      "ファイルが削除または移動されました。",
    ],
    not_a_directory: [
      "This path is not a folder.",
      "このパスはフォルダーではありません。",
    ],
    not_a_file: ["Choose a file to read.", "読むファイルを選んでください。"],
    not_git_repository: [
      "This folder is not in a Git repository.",
      "このフォルダーは Git リポジトリに属していません。",
    ],
    git_failed: [
      "Git could not read this repository.",
      "Git で読み取れませんでした。",
    ],
    permission_denied: [
      "Permission to read this was denied.",
      "読み取る権限がありません。",
    ],
  };
  return (
    copy[error.code]?.[ja ? 1 : 0] ??
    (ja ? "読み取れませんでした。" : "Could not read this.")
  );
}
