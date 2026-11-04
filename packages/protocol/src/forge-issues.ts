/**
 * Reading a repository's Issues on its Forge (GitHub, Forgejo, Gitea).
 * `path` is any folder of the repository on the Host; the Host reads the
 * Issues of the remote that `git push` without arguments uses in the main
 * worktree, so every worktree of the repository shows the same Issues.
 */

import { ProtocolValidationError, hostPath } from "./index.ts";
import type { ValueSchema } from "./index.ts";

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

export interface ForgeIssueParams {
  "forge.issues.repository": { path: string };
  "forge.issues.list": {
    path: string;
    state: ForgeIssueState;
    /** Only Issues that have every one of these labels. */
    labels: string[];
    /** Pages count from 1, as on the Forges. */
    page: number;
  };
  "forge.issues.labels": { path: string };
  "forge.issues.show": { path: string; number: number };
}

export interface ForgeIssueResults {
  /** No repository: the repository's Forge is not known. */
  "forge.issues.repository": { repository?: ForgeIssueRepository };
  "forge.issues.list": {
    repository: ForgeIssueRepository;
    /** The Forge's page of these Issues. */
    url: string;
    /** False when the repository does not use the Forge's Issues. */
    enabled: boolean;
    /** Newest first; Pull requests are not included. */
    issues: ForgeIssueSummary[];
    hasMore: boolean;
  };
  "forge.issues.labels": { labels: ForgeIssueLabel[] };
  /** No issue: the repository reads, but the Issue was removed or moved. */
  "forge.issues.show": { issue?: ForgeIssue };
}

export type ForgeIssueMethod = keyof ForgeIssueParams;
const methods: ForgeIssueMethod[] = [
  "forge.issues.repository",
  "forge.issues.list",
  "forge.issues.labels",
  "forge.issues.show",
];

export function isForgeIssueMethod(value: unknown): value is ForgeIssueMethod {
  return methods.includes(value as ForgeIssueMethod);
}

function fail(message: string): never {
  throw new ProtocolValidationError("invalid_request", message);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    return fail(`${field} must be a positive integer`);
  return value;
}

/** The Host's entry check for values received from a Client. */
export function parseForgeIssueParams<M extends ForgeIssueMethod>(
  method: M,
  value: unknown,
): ForgeIssueParams[M] {
  const input = object(value, "params");
  const path = hostPath(input.path, "path");
  if (method === "forge.issues.show")
    return {
      path,
      number: positiveInteger(input.number, "number"),
    } as ForgeIssueParams[M];
  if (method !== "forge.issues.list") return { path } as ForgeIssueParams[M];
  if (input.state !== "open" && input.state !== "closed")
    return fail("state must be open or closed");
  if (!Array.isArray(input.labels)) return fail("labels must be an array");
  return {
    path,
    state: input.state,
    labels: input.labels.map((label) => {
      if (typeof label !== "string" || !label || label.includes("\0"))
        return fail("labels must be names");
      return label;
    }),
    page: positiveInteger(input.page, "page"),
  } as ForgeIssueParams[M];
}

// The Host checks what the Forge returned before it answers; the Client reads
// its registered Host's answer as is.
export const forgeIssueResultSchemas = Object.fromEntries(
  methods.map((method) => [method, { parse: (value: unknown) => value }]),
) as {
  [M in ForgeIssueMethod]: ValueSchema<ForgeIssueResults[M]>;
};
