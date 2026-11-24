import * as v from "valibot";
import {
  method,
  pathSchema,
  hostResult,
  nonNulText,
  integer,
  hasMethod,
  type Params,
  type Results,
  type ResultSchemas,
} from "./primitives.ts";

export type ForgePrState = "open" | "draft" | "merged" | "closed";
export type ForgePrReviewState =
  "approved" | "changes_requested" | "commented" | "pending";
export type ForgePrFile = {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions?: number;
  deletions?: number;
};
export type ForgePrComment = {
  id: string;
  author: string;
  body: string;
  createdAt: number;
  url?: string;
  path?: string;
  line?: number;
  side?: "old" | "new";
  diffHunk?: string;
  inReplyToId?: string;
};
export type ForgePrDetail = {
  number: number;
  title: string;
  state: ForgePrState;
  author: string;
  body: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  createdAt: number;
  updatedAt: number;
  labels: Array<{ name: string; color?: string }>;
  reviewers: Array<{ login: string; state?: ForgePrReviewState }>;
  files: ForgePrFile[];
  comments: ForgePrComment[];
};
export type ForgePrView = {
  pr?: ForgePrDetail;
  canCreate: boolean;
  currentBranch?: string;
  defaultBranch?: string;
  branches?: string[];
  reason?:
    "no_push_target" | "default_branch" | "detached_head" | "unsupported";
};

const requiredText = v.pipe(
  nonNulText,
  v.check((value) => value.trim().length > 0),
);
export const forgePrMethods = {
  "forge.pr": method(
    v.object({ path: pathSchema, redetect: v.optional(v.boolean()) }),
    hostResult<ForgePrView>(),
  ),
  "forge.pr.create": method(
    v.object({
      path: pathSchema,
      title: requiredText,
      body: v.union([v.literal(""), nonNulText]),
      base: v.optional(requiredText),
      draft: v.optional(v.boolean()),
      issue: v.optional(integer(1)),
    }),
    hostResult<{ url: string; created: boolean }>(),
  ),
};

export type ForgePrMethod = keyof typeof forgePrMethods;
export type ForgePrParams = Params<typeof forgePrMethods>;
export type ForgePrResults = Results<typeof forgePrMethods>;
export function isForgePrMethod(value: unknown): value is ForgePrMethod {
  return hasMethod(forgePrMethods, value);
}
export const forgePrResultSchemas: ResultSchemas<ForgePrResults> =
  forgePrMethods;
