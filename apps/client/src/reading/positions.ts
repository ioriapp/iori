import { native } from "../native.ts";
import type { TextPosition } from "./TextRows.tsx";
import type { MarkdownPosition } from "../files/MarkdownSurface.tsx";

/** Where the user was in one file: kept per Host, folder and path. */
export type FilePosition = TextPosition & {
  wrap: boolean;
  /** A Markdown file shown as source instead of drawn. */
  source: boolean;
  markdown: MarkdownPosition;
};

export const emptyPosition = (): FilePosition => ({
  top: 0,
  query: "",
  wrap: false,
  source: false,
  markdown: { line: 1, query: "" },
});

export const positionKey = (hostKey: string, root: string, path: string) =>
  `files-position:${JSON.stringify([hostKey, root, path])}`;

export interface ReadingPositions {
  load(key: string): Promise<FilePosition | null>;
  save(key: string, value: FilePosition): Promise<void>;
}

// Saved like the workspace layout: encrypted with the OS-protected key.
export const nativeReadingPositions: ReadingPositions = {
  async load(key) {
    const value = await native.loadView<Partial<FilePosition>>(key);
    return value && typeof value === "object"
      ? { ...emptyPosition(), ...value }
      : null;
  },
  save(key, value) {
    return native.saveView(key, value);
  },
};
