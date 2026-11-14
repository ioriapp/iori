import { translator } from "../i18n.ts";
import {
  FileDiff,
  FileInput,
  FileMinus,
  FilePlus,
  FileQuestion,
  FileWarning,
  Files,
  FileType,
} from "lucide-react";
import type { GitChangeArea, GitChangeKind } from "@iori/protocol";

export const areaOrder: GitChangeArea[] = [
  "staged",
  "unstaged",
  "untracked",
  "conflict",
];

export function areaName(area: GitChangeArea, ja: boolean): string {
  const names: Record<GitChangeArea, string> = {
    staged: "Staged",
    unstaged: "Changes",
    untracked: "Untracked",
    conflict: "Conflicts",
  };
  return translator(ja ? "ja" : "en")(names[area]);
}

export function kindName(kind: GitChangeKind, ja: boolean): string {
  const names: Record<GitChangeKind, [string, string]> = {
    added: ["Added", "追加"],
    modified: ["Modified", "変更"],
    deleted: ["Deleted", "削除"],
    renamed: ["Renamed", "名前の変更"],
    copied: ["Copied", "コピー"],
    typechange: ["Type changed", "種類の変更"],
    conflict: ["Conflict", "競合"],
    untracked: ["Untracked", "未追跡"],
  };
  return (names[kind] ?? names.modified)[ja ? 1 : 0];
}

/** Each kind has its own icon and color; the name is in the tooltip and for screen readers. */
export function ChangeIcon({ kind, ja }: { kind: GitChangeKind; ja: boolean }) {
  const Icon =
    kind === "added"
      ? FilePlus
      : kind === "deleted"
        ? FileMinus
        : kind === "renamed"
          ? FileInput
          : kind === "copied"
            ? Files
            : kind === "typechange"
              ? FileType
              : kind === "conflict"
                ? FileWarning
                : kind === "untracked"
                  ? FileQuestion
                  : FileDiff;
  return (
    <Icon
      className="git-kind"
      data-kind={kind}
      aria-label={kindName(kind, ja)}
      role="img"
    />
  );
}

export const parentDirectory = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
};
