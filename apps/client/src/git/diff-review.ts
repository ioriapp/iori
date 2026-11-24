import type { GitChangeEntry } from "@iori/protocol";
import type { TextRow } from "../reading/TextRows.tsx";

export type DiffComment = {
  id: string;
  path: string;
  absolutePath: string;
  side: "old" | "new";
  startLine: number;
  endLine: number;
  codeExcerpt: string;
  body: string;
};

export type SplitPair =
  | { kind: "omission"; sourceIndex: number; omitted: number }
  | {
      kind: "pair";
      left?: { sourceIndex: number; row: TextRow };
      right?: { sourceIndex: number; row: TextRow };
    };

export type ChangesTreeNode =
  | {
      kind: "folder";
      path: string;
      label: string;
      depth: number;
      count: number;
    }
  | {
      kind: "file";
      entry: GitChangeEntry;
      depth: number;
      name: string;
    };

function codeFenceFor(excerpt: string): string {
  let maxRun = 0;
  let current = 0;
  for (let i = 0; i < excerpt.length; i += 1) {
    if (excerpt[i] === "`") {
      current += 1;
      if (current > maxRun) maxRun = current;
    } else {
      current = 0;
    }
  }
  return "`".repeat(Math.max(3, maxRun + 1));
}

function formatLineRef(comment: DiffComment): string {
  const line =
    comment.startLine === comment.endLine
      ? `L${comment.startLine}`
      : `L${comment.startLine}-L${comment.endLine}`;
  return `${comment.path}:${line}`;
}

export function formatDiffCommentsForAgent(comments: DiffComment[]): string {
  if (comments.length === 0) return "";

  const grouped = new Map<string, DiffComment[]>();
  for (const comment of comments) {
    const list = grouped.get(comment.path);
    if (list) list.push(comment);
    else grouped.set(comment.path, [comment]);
  }

  const sections: string[] = [];
  for (const [filePath, fileComments] of grouped) {
    const sorted = [...fileComments].sort((a, b) => {
      if (a.startLine !== b.startLine) return a.startLine - b.startLine;
      if (a.endLine !== b.endLine) return a.endLine - b.endLine;
      if (a.side !== b.side) return a.side === "old" ? -1 : 1;
      return 0;
    });

    const items = sorted.map((comment) => {
      const lines: string[] = [
        `- \`${formatLineRef(comment)}\` (${comment.side}):`,
      ];
      const excerpt = comment.codeExcerpt.replace(/\r?\n$/u, "");
      if (excerpt.trim().length > 0) {
        const fence = codeFenceFor(excerpt);
        lines.push(`${fence}\n${excerpt}\n${fence}`);
      }
      lines.push(comment.body.trim());
      return lines.join("\n\n");
    });

    sections.push(`### \`${filePath}\`\n\n${items.join("\n\n")}`);
  }

  return sections.join("\n\n");
}

export function pairDiffRows(
  rows: Array<{ sourceIndex: number; row: TextRow }>,
): SplitPair[] {
  const result: SplitPair[] = [];
  let index = 0;

  while (index < rows.length) {
    const current = rows[index]!;
    const kind = current.row.kind;

    if (kind === "omission") {
      result.push({
        kind: "omission",
        sourceIndex: current.sourceIndex,
        omitted: current.row.omitted ?? 0,
      });
      index += 1;
      continue;
    }

    if (kind === "deleted") {
      const deletedRun: Array<{ sourceIndex: number; row: TextRow }> = [];
      while (index < rows.length && rows[index]!.row.kind === "deleted") {
        deletedRun.push(rows[index]!);
        index += 1;
      }
      const addedRun: Array<{ sourceIndex: number; row: TextRow }> = [];
      while (index < rows.length && rows[index]!.row.kind === "added") {
        addedRun.push(rows[index]!);
        index += 1;
      }
      const pairCount = Math.max(deletedRun.length, addedRun.length);
      for (let offset = 0; offset < pairCount; offset += 1) {
        const left = deletedRun[offset];
        const right = addedRun[offset];
        result.push({
          kind: "pair",
          ...(left ? { left } : {}),
          ...(right ? { right } : {}),
        });
      }
      continue;
    }

    if (kind === "added") {
      result.push({ kind: "pair", right: current });
      index += 1;
      continue;
    }

    result.push({ kind: "pair", left: current, right: current });
    index += 1;
  }

  return result;
}

type TreeDir = {
  name: string;
  path: string;
  dirs: Map<string, TreeDir>;
  files: Array<{ name: string; entry: GitChangeEntry }>;
  count: number;
};

function compareNames(a: string, b: string): number {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA < lowerB) return -1;
  if (lowerA > lowerB) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function buildChangesTreeRows(
  entries: GitChangeEntry[],
  collapsedFolders: ReadonlySet<string>,
  filter: string,
): ChangesTreeNode[] {
  const needle = filter.trim().toLowerCase();
  const filtered = needle
    ? entries.filter(
        (entry) =>
          entry.path.toLowerCase().includes(needle) ||
          Boolean(entry.oldPath?.toLowerCase().includes(needle)),
      )
    : entries;

  if (filtered.length === 0) return [];

  const root: TreeDir = {
    name: "",
    path: "",
    dirs: new Map(),
    files: [],
    count: 0,
  };

  for (const entry of filtered) {
    const segments = entry.path.split("/").filter((part) => part.length > 0);
    if (segments.length === 0) continue;
    let current = root;
    current.count += 1;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i]!;
      const nextPath = current.path ? `${current.path}/${segment}` : segment;
      let child = current.dirs.get(segment);
      if (!child) {
        child = {
          name: segment,
          path: nextPath,
          dirs: new Map(),
          files: [],
          count: 0,
        };
        current.dirs.set(segment, child);
      }
      child.count += 1;
      current = child;
    }
    const fileName = segments[segments.length - 1]!;
    current.files.push({ name: fileName, entry });
  }

  const output: ChangesTreeNode[] = [];

  const visitChildren = (dir: TreeDir, depth: number) => {
    const childDirs = [...dir.dirs.values()].sort((a, b) =>
      compareNames(a.name, b.name),
    );
    for (const child of childDirs) {
      const labelParts = [child.name];
      let target = child;
      while (target.files.length === 0 && target.dirs.size === 1) {
        const only = target.dirs.values().next().value;
        if (!only) break;
        labelParts.push(only.name);
        target = only;
      }
      output.push({
        kind: "folder",
        path: target.path,
        label: labelParts.join("/"),
        depth,
        count: target.count,
      });
      if (!collapsedFolders.has(target.path)) {
        visitChildren(target, depth + 1);
      }
    }

    const childFiles = [...dir.files].sort((a, b) => {
      const nameOrder = compareNames(a.name, b.name);
      if (nameOrder !== 0) return nameOrder;
      return compareNames(a.entry.area, b.entry.area);
    });
    for (const file of childFiles) {
      output.push({
        kind: "file",
        entry: file.entry,
        depth,
        name: file.name,
      });
    }
  };

  visitChildren(root, 0);
  return output;
}
