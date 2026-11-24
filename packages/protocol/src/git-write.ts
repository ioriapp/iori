import * as v from "valibot";
import { relativeFilePath } from "./files-manage.ts";
import {
  hasMethod,
  hostResult,
  integer,
  method,
  nonNulText,
  type Params,
  type Results,
  type ResultSchemas,
} from "./primitives.ts";

export type GitWriteResult =
  | { ok: true; hash?: string; summary?: string }
  | { ok: false; message: string };

const root = nonNulText;
const paths = v.pipe(v.array(relativeFilePath), v.minLength(1));
const selection = v.pipe(
  v.object({ root, paths: v.optional(paths), all: v.optional(v.boolean()) }),
  v.check((value) => value.all === true || value.paths !== undefined),
);
const result = hostResult<GitWriteResult>();
const remote = method(v.object({ root }), result);
export const gitWriteMethods = {
  "git.stage": method(selection, result),
  "git.unstage": method(selection, result),
  "git.discard": method(
    v.object({ root, paths, untracked: v.optional(v.boolean()) }),
    result,
  ),
  "git.applyHunk": method(
    v.object({
      root,
      action: v.picklist(["stage", "unstage", "discard"]),
      path: relativeFilePath,
      hunkIndex: integer(0, 4095),
      expectedFingerprint: v.optional(
        v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u)),
      ),
    }),
    result,
  ),
  "git.createCommit": method(
    v.object({
      root,
      message: v.pipe(
        nonNulText,
        v.check((s) => s.trim().length > 0),
      ),
      amend: v.optional(v.boolean()),
    }),
    result,
  ),
  "git.fetch": remote,
  "git.pull": remote,
  "git.push": remote,
};

export type GitWriteMethod = keyof typeof gitWriteMethods;
export type GitWriteParams = Params<typeof gitWriteMethods>;
export type GitWriteResults = Results<typeof gitWriteMethods>;
export function isGitWriteMethod(value: unknown): value is GitWriteMethod {
  return hasMethod(gitWriteMethods, value);
}
export const gitWriteResultSchemas: ResultSchemas<GitWriteResults> =
  gitWriteMethods;
