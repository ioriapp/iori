import {
  ProtocolValidationError,
  type ProtocolErrorCode,
  type ValueSchema,
} from "./index.ts";

type TransferSession = { sessionId: string };
export interface FilesTransferParams {
  "files.put.session": TransferSession;
  "files.put.inspect": TransferSession & { root: string; paths: string[] };
  "files.put.begin": TransferSession & {
    root: string;
    path: string;
    uploadId: string;
    replace: boolean;
  };
  "files.put.chunk": TransferSession & {
    uploadId: string;
    offset: number;
    data: string;
  };
  "files.put.status": TransferSession & { uploadId: string };
  "files.put.finish": TransferSession & { uploadId: string };
  "files.put.cancel": TransferSession & { uploadId: string };
}
export interface FilesTransferResults {
  "files.put.session": Record<string, never>;
  "files.put.inspect": {
    files: { path: string; exists?: boolean; error?: ProtocolErrorCode }[];
  };
  "files.put.begin": { written: number };
  "files.put.chunk": { written: number };
  "files.put.status": { written: number; finished: boolean };
  "files.put.finish": Record<string, never>;
  "files.put.cancel": Record<string, never>;
}
export type FilesTransferMethod = keyof FilesTransferParams;
const methods = [
  "files.put.session",
  "files.put.inspect",
  "files.put.begin",
  "files.put.chunk",
  "files.put.status",
  "files.put.finish",
  "files.put.cancel",
];
export const isFilesTransferMethod = (v: unknown): v is FilesTransferMethod =>
  typeof v === "string" && methods.includes(v);
const fail = (): never => {
  throw new ProtocolValidationError(
    "invalid_request",
    "Invalid file transfer request",
  );
};
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  return v as Record<string, unknown>;
}
function text(v: unknown): string {
  if (typeof v !== "string" || !v || v.includes("\0")) return fail();
  return v;
}
export function parseFilesTransferParams<M extends FilesTransferMethod>(
  method: M,
  value: unknown,
): FilesTransferParams[M] {
  const v = object(value);
  const sessionId = text(v.sessionId);
  if (method === "files.put.session")
    return { sessionId } as FilesTransferParams[M];
  if (method === "files.put.inspect") {
    if (!Array.isArray(v.paths)) return fail();
    return {
      sessionId,
      root: text(v.root),
      paths: v.paths.map(text),
    } as FilesTransferParams[M];
  }
  const uploadId = text(v.uploadId);
  if (!/^[a-f0-9-]{36}$/iu.test(uploadId)) return fail();
  if (method === "files.put.begin") {
    if (typeof v.replace !== "boolean") return fail();
    return {
      sessionId,
      root: text(v.root),
      path: text(v.path),
      uploadId,
      replace: v.replace,
    } as FilesTransferParams[M];
  }
  if (method === "files.put.chunk") {
    if (
      typeof v.offset !== "number" ||
      !Number.isSafeInteger(v.offset) ||
      v.offset < 0 ||
      typeof v.data !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
        v.data,
      )
    )
      return fail();
    return {
      sessionId,
      uploadId,
      offset: v.offset,
      data: v.data,
    } as FilesTransferParams[M];
  }
  return { sessionId, uploadId } as FilesTransferParams[M];
}
// Results are values emitted by our Host; no second field-by-field validation.
const result = <T>(): ValueSchema<T> => ({
  parse: (value: unknown) => value as T,
});
export const filesTransferResultSchemas: {
  [M in FilesTransferMethod]: ValueSchema<FilesTransferResults[M]>;
} = {
  "files.put.session": result(),
  "files.put.inspect": result(),
  "files.put.begin": result(),
  "files.put.chunk": result(),
  "files.put.status": result(),
  "files.put.finish": result(),
  "files.put.cancel": result(),
};
