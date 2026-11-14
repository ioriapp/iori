import {
  parseResult,
  type ForgeCi,
  type ForgeCiLog,
} from "../../packages/protocol/src/index.ts";
import type { ReadingTransport } from "../../apps/client/src/reading/transport.ts";

export const readingRoot = "/workspace/project-header";
export const readingPath = "apps/client/src/reading/WorktreePicker.tsx";
export const readingLongBranch =
  "feature/align-reading-view-headers-and-preserve-mobile-navigation-for-files-git-and-continuous-integration-results";
export const readingChoices = [
  { path: "/workspace/project", label: "main", primary: true },
  { path: readingRoot, label: "feature/reading-header" },
  { path: "/workspace/project-files", label: "fix/file-navigation" },
];
const code = [
  'import { ChevronDown, GitBranch } from "lucide-react";',
  'import { Button } from "../components/ui/button";',
  "",
  "export function ReadingHeader() {",
  "  return (",
  '    <div className="reading-header">',
  '      <Button variant="ghost" size="sm">',
  "        <GitBranch />",
  "        <span>feature/reading-header</span>",
  "        <ChevronDown />",
  "      </Button>",
  "    </div>",
  "  );",
  "}",
];
const directories: Record<string, string[]> = {
  "": ["apps/", "README.md", "package.json"],
  apps: ["client/"],
  "apps/client": ["src/"],
  "apps/client/src": ["components/", "forge/", "reading/"],
  "apps/client/src/reading": ["WorktreePicker.tsx", "reading.css"],
  "apps/client/src/forge": ["CiPane.tsx", "ci.css"],
};
const fileEntries = (path: string) =>
  (directories[path] ?? []).map((name) => {
    const folder = name.endsWith("/");
    const plain = folder ? name.slice(0, -1) : name;
    const relative = [path, plain].filter(Boolean).join("/");
    return {
      name: plain,
      path: relative,
      absolutePath: `${readingRoot}/${relative}`,
      kind: folder ? "directory" : "file",
    };
  });
const changes = ["reading.css", "WorktreePicker.tsx", "ci.css"].map(
  (name, index) => {
    const path = `apps/client/src/${index === 2 ? "forge" : "reading"}/${name}`;
    return {
      path,
      absolutePath: `${readingRoot}/${path}`,
      kind: "modified" as const,
      area: "unstaged" as const,
      addedLines: index ? 4 : 12,
      removedLines: index ? 1 : 3,
    };
  },
);
export const readingChange = changes[0];
const diff = [
  ".reading-list-header {",
  "  display: flex;",
  "  align-items: center;",
  "  height: 35px;",
  "  padding: 0 6px;",
  "  border-bottom: 1px solid var(--border);",
  "  border-bottom: 0;",
  "}",
];
function readingResult(method: string, params: object) {
  const path =
    "path" in params && typeof params.path === "string" ? params.path : "";
  const start =
    "start" in params && typeof params.start === "number" ? params.start : 0;
  const count =
    "count" in params && typeof params.count === "number" ? params.count : 128;
  const revision = "reading-preview";
  switch (method) {
    case "files.list": {
      const entries = fileEntries(path);
      const located =
        "locate" in params
          ? entries.findIndex((entry) => entry.name === params.locate)
          : -1;
      return {
        entries: entries.slice(start, start + count),
        total: entries.length,
        ...(located >= 0 ? { located } : {}),
      };
    }
    case "files.info":
      return {
        path,
        absolutePath: `${readingRoot}/${path}`,
        kind: "text",
        lineCount: code.length,
        sizeBytes: 512,
        revision,
      };
    case "files.lineRange": {
      const first =
        "startLine" in params && typeof params.startLine === "number"
          ? params.startLine
          : 1;
      const length =
        "lineCount" in params && typeof params.lineCount === "number"
          ? params.lineCount
          : code.length;
      let offset = 0;
      const lines = code.map((text, index) => {
        const byteOffset = offset;
        offset += new TextEncoder().encode(text + "\n").length;
        return {
          line: index + 1,
          text,
          byteOffset,
          nextByteOffset: offset,
          complete: true,
        };
      });
      return {
        lines: lines.slice(first - 1, first - 1 + length),
        totalLines: code.length,
        sizeBytes: offset,
        revision,
      };
    }
    case "files.syntax":
      return { lines: [], startLine: 1, endLine: code.length + 1, revision };
    case "git.status":
      return {
        isRepository: true,
        repository: {
          root: readingRoot,
          branch: readingChoices[1].label,
          upstream: "origin/main",
          ahead: 1,
          behind: 0,
        },
        counts: { staged: 0, unstaged: 3, untracked: 0, conflict: 0 },
        entries: changes.slice(start, start + count),
      };
    case "git.diffOpen":
      return { revision, totalRows: diff.length, info: {}, collapsed: [] };
    case "git.diffRows":
      return {
        revision,
        totalRows: diff.length,
        rows: diff.map((text, row) => ({
          row,
          text,
          kind: row === 5 ? "deleted" : row === 6 ? "added" : "context",
          oldLine: row === 6 ? undefined : row + 1,
          newLine: row === 5 ? undefined : row + 1,
          byteOffset: 0,
          nextByteOffset: text.length,
          complete: true,
        })),
      };
    case "git.imageInfo":
      return { present: false, path, revision };
    default:
      throw new Error(`No reading preview for ${method}`);
  }
}
export const readingTransport: ReadingTransport = {
  async request(method, params) {
    return parseResult(method, readingResult(method, params));
  },
  watch: () => () => {},
};
export function readingCi(long: boolean): ForgeCi {
  const url = "https://forge.example.invalid/project/actions";
  return {
    commit: {
      sha: "a7c93e2c953708e54dbd5c68542a796b036ab7e8",
      subject: long
        ? "Align reading view headers and preserve navigation when switching between files, changes, and continuous integration results"
        : "Align reading view headers",
      url,
    },
    url,
    logs: true,
    results: [],
    runs: ["checks", "lint"].map((name, run) => ({
      id: name,
      name,
      event: "push",
      status: "passed",
      url,
      jobs: (run === 0
        ? ["build-client", "typecheck", "unit-tests"]
        : ["format", "lint"]
      ).map((name) => ({
        id: name,
        name,
        status: "passed",
        startedAt: 0,
        completedAt: 84000,
        url,
      })),
    })),
  };
}
export const readingLog: ForgeCiLog = {
  start: 0,
  end: 185,
  size: 185,
  text: "$ pnpm build\n\nvite building for production…\ntransforming…\n✓ 128 modules transformed.\nrendering chunks…\n✓ built in 2.4s\n\nProcess completed with exit code 0.",
};
