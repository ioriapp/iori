import * as v from "valibot";
import {
  nonNulText,
  method,
  hostResult,
  type ProtocolErrorCode,
  integer,
  chunkBase64,
  type Params,
  type Results,
  hasMethod,
  paramsOf,
  type ResultSchemas,
} from "./primitives.ts";

const sessionId = nonNulText;
const uploadId = v.pipe(v.string(), v.regex(/^[a-f0-9-]{36}$/iu));
export const filesTransferMethods = {
  "files.put.session": method(
    v.object({ sessionId }),
    hostResult<Record<string, never>>(),
  ),
  "files.put.inspect": method(
    v.object({ sessionId, root: nonNulText, paths: v.array(nonNulText) }),
    hostResult<{
      files: { path: string; exists?: boolean; error?: ProtocolErrorCode }[];
    }>(),
  ),
  "files.put.begin": method(
    v.object({
      sessionId,
      root: nonNulText,
      path: nonNulText,
      uploadId,
      replace: v.boolean(),
    }),
    hostResult<{ written: number }>(),
  ),
  "files.put.chunk": method(
    v.object({ sessionId, uploadId, offset: integer(0), data: chunkBase64 }),
    hostResult<{ written: number }>(),
  ),
  "files.put.status": method(
    v.object({ sessionId, uploadId }),
    hostResult<{ written: number; finished: boolean }>(),
  ),
  "files.put.finish": method(
    v.object({ sessionId, uploadId }),
    hostResult<Record<string, never>>(),
  ),
  "files.put.cancel": method(
    v.object({ sessionId, uploadId }),
    hostResult<Record<string, never>>(),
  ),
};

export type FilesTransferMethod = keyof typeof filesTransferMethods;
export type FilesTransferParams = Params<typeof filesTransferMethods>;
export type FilesTransferResults = Results<typeof filesTransferMethods>;
export function isFilesTransferMethod(
  value: unknown,
): value is FilesTransferMethod {
  return hasMethod(filesTransferMethods, value);
}
export function parseFilesTransferParams<M extends FilesTransferMethod>(
  key: M,
  value: unknown,
): FilesTransferParams[M] {
  return paramsOf<FilesTransferParams, M>(filesTransferMethods, key, value);
}
export const filesTransferResultSchemas: ResultSchemas<FilesTransferResults> =
  filesTransferMethods;
