import * as v from "valibot";
import {
  chunkBase64,
  hasMethod,
  hostResult,
  method,
  nonNulText,
  paramsOf,
  type Params,
  type Results,
  type ResultSchemas,
} from "./primitives.ts";

export const MAX_WRITE_BYTES = 2_500_000;

export const relativeFilePath = v.pipe(
  nonNulText,
  v.check(
    (path) =>
      !path.includes("\\") &&
      !/^[a-z]:/iu.test(path) &&
      path
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
  ),
);
const item = { root: nonNulText, path: relativeFilePath };
type Location = { path: string; absolutePath: string };
export const filesManageMethods = {
  "files.create": method(
    v.object({ ...item, kind: v.picklist(["file", "directory"]) }),
    hostResult<Location & { kind: "file" | "directory" }>(),
  ),
  "files.write": method(
    v.object({
      ...item,
      contentBase64: chunkBase64,
      expectedRevision: v.optional(nonNulText),
      force: v.optional(v.boolean()),
    }),
    hostResult<{ revision: string; sizeBytes: number; modifiedAtMs: number }>(),
  ),
  "files.rename": method(
    v.object({
      root: nonNulText,
      from: relativeFilePath,
      to: relativeFilePath,
    }),
    hostResult<Location>(),
  ),
  "files.duplicate": method(
    v.object(item),
    hostResult<Location & { kind: "file" | "directory" | "symlink" }>(),
  ),
  "files.delete": method(v.object(item), hostResult<Record<string, never>>()),
};

export type FilesManageMethod = keyof typeof filesManageMethods;
export type FilesManageParams = Params<typeof filesManageMethods>;
export type FilesManageResults = Results<typeof filesManageMethods>;
export function isFilesManageMethod(
  value: unknown,
): value is FilesManageMethod {
  return hasMethod(filesManageMethods, value);
}
export function parseFilesManageParams<M extends FilesManageMethod>(
  key: M,
  value: unknown,
): FilesManageParams[M] {
  return paramsOf<FilesManageParams, M>(filesManageMethods, key, value);
}
export const filesManageResultSchemas: ResultSchemas<FilesManageResults> =
  filesManageMethods;
