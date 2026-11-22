import * as v from "valibot";
import {
  method,
  pathSchema,
  hostResult,
  nonNulText,
  integer,
  type Params,
  type Results,
  hasMethod,
  paramsOf,
  type ResultSchemas,
} from "./primitives.ts";
/**
 * Reading a repository's Issues on its Forge (GitHub, Forgejo, Gitea).
 * `path` is any folder of the repository on the Host; the Host reads the
 * Issues of the remote that `git push` without arguments uses in the main
 * worktree, so every worktree of the repository shows the same Issues.
 */

export type ForgeIssueState = "open" | "closed";

/** The repository whose Issues are read, and the kind of its Forge. */
export type ForgeIssueRepository = {
  forge: { id: string; label: string };
  owner: string;
  repo: string;
  /** The repository's Issues page on the Forge. */
  url: string;
};

/** `color` is `#rrggbb` when the Forge gave a usable color. */
export type ForgeIssueLabel = { name: string; color?: string };

export type ForgeIssueSummary = {
  number: number;
  title: string;
  state: ForgeIssueState;
  author: string;
  labels: ForgeIssueLabel[];
  comments: number;
  createdAt: number;
  updatedAt: number;
  /** The Issue's page on the Forge. */
  url: string;
};

export type ForgeIssueComment = {
  id: string;
  author: string;
  createdAt: number;
  body: string;
};

export type ForgeIssue = ForgeIssueSummary & {
  body: string;
  assignees: string[];
  /** All comments, oldest first. */
  thread: ForgeIssueComment[];
};

export const forgeIssueMethods = {
  "forge.issues.repository": method(
    v.object({ path: pathSchema }),
    hostResult<{ repository?: ForgeIssueRepository }>(),
  ),
  "forge.issues.list": method(
    v.object({
      path: pathSchema,
      state: v.picklist(["open", "closed"]),
      labels: v.array(nonNulText),
      page: integer(1),
    }),
    hostResult<{
      repository: ForgeIssueRepository;
      /** The Forge's page of these Issues. */
      url: string;
      /** False when the repository does not use the Forge's Issues. */
      enabled: boolean;
      /** Newest first; Pull requests are not included. */
      issues: ForgeIssueSummary[];
      hasMore: boolean;
    }>(),
  ),
  "forge.issues.labels": method(
    v.object({ path: pathSchema }),
    hostResult<{ labels: ForgeIssueLabel[] }>(),
  ),
  "forge.issues.show": method(
    v.object({ path: pathSchema, number: integer(1) }),
    hostResult<{ issue?: ForgeIssue }>(),
  ),
};

export type ForgeIssueMethod = keyof typeof forgeIssueMethods;
export type ForgeIssueParams = Params<typeof forgeIssueMethods>;
export type ForgeIssueResults = Results<typeof forgeIssueMethods>;
export function isForgeIssueMethod(value: unknown): value is ForgeIssueMethod {
  return hasMethod(forgeIssueMethods, value);
}
export function parseForgeIssueParams<M extends ForgeIssueMethod>(
  key: M,
  value: unknown,
): ForgeIssueParams[M] {
  return paramsOf<ForgeIssueParams, M>(forgeIssueMethods, key, value);
}
export const forgeIssueResultSchemas: ResultSchemas<ForgeIssueResults> =
  forgeIssueMethods;
