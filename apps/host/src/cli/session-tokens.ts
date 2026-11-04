import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import type { CliSession, TokenUsage } from "@iori/protocol";
import type { ShellDefinition } from "../terminal/platform.ts";
export type SessionTokenReader = {
  /** A definition's script also gets the login shell and the conversation's
   * folder; a CLI's own reader uses the conversation alone. */
  read: (
    session: CliSession,
    shell: ShellDefinition,
    cwd?: string,
  ) => Promise<TokenUsage | undefined>;
  release: (session: CliSession) => Promise<void>;
  /** The value comes from a definition's script, which runs outside iori and
   * may not return. A screen that shows the last value does not wait for it. */
  script?: true;
};
type Entry = { id?: string; usage: TokenUsage };
const fields = [
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
  "reasoning",
] as const;
type Cursor = {
  offset: number;
  dev: number;
  ino: number;
  usage?: TokenUsage;
  messages: Map<string, TokenUsage>;
  counts: Partial<Record<keyof TokenUsage, number>>;
};
function consume(cursor: Cursor, entry: Entry) {
  if (entry.id === undefined) {
    cursor.usage = { ...entry.usage };
    return;
  }
  const previous = cursor.messages.get(entry.id);
  cursor.messages.set(entry.id, entry.usage);
  const total = (cursor.usage ??= { input: 0, output: 0 });
  for (const field of fields) {
    const count =
      (cursor.counts[field] ?? 0) +
      Number(entry.usage[field] !== undefined) -
      Number(previous?.[field] !== undefined);
    cursor.counts[field] = count;
    if (count)
      total[field] =
        (total[field] ?? 0) -
        (previous?.[field] ?? 0) +
        (entry.usage[field] ?? 0);
    else if (field !== "input" && field !== "output") delete total[field];
  }
}
/** Keep positions and measurements only. Incomplete lines are reread from their
 * start next time; conversation bodies never survive a read operation. */
export function sessionTokenReader(
  decode: (record: Record<string, unknown>) => Entry | undefined,
): SessionTokenReader {
  const cursors = new Map<string, Cursor>();
  const pending = new Map<string, Promise<TokenUsage | undefined>>();
  const read = async (file: string) => {
    if (!(await stat(file)).isFile()) return undefined;
    const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile()) return undefined;
      let cursor = cursors.get(file);
      if (
        !cursor ||
        cursor.dev !== info.dev ||
        cursor.ino !== info.ino ||
        info.size < cursor.offset
      ) {
        cursor = {
          offset: 0,
          dev: info.dev,
          ino: info.ino,
          messages: new Map(),
          counts: {},
        };
        cursors.set(file, cursor);
      }
      if (info.size > cursor.offset) {
        const stream = handle.createReadStream({
          start: cursor.offset,
          end: info.size - 1,
          autoClose: false,
        });
        let tail = Buffer.alloc(0);
        for await (const chunk of stream) {
          const bytes = Buffer.concat([tail, chunk]);
          let start = 0;
          for (
            let end = bytes.indexOf(10);
            end !== -1;
            end = bytes.indexOf(10, start)
          ) {
            const line = bytes.subarray(start, end);
            cursor.offset += end - start + 1;
            start = end + 1;
            let record: unknown;
            try {
              record = JSON.parse(line.toString("utf8"));
            } catch {
              continue;
            }
            if (
              record &&
              typeof record === "object" &&
              !Array.isArray(record)
            ) {
              const entry = decode(record as Record<string, unknown>);
              if (entry) consume(cursor, entry);
            }
          }
          tail = bytes.subarray(start);
        }
      }
      return cursor.usage ? { ...cursor.usage } : undefined;
    } finally {
      await handle.close();
    }
  };
  const enqueue = async (
    file: string,
    action: () => Promise<TokenUsage | undefined>,
  ) => {
    const operation = (pending.get(file) ?? Promise.resolve())
      .catch(() => {})
      .then(action);
    pending.set(file, operation);
    try {
      return await operation;
    } finally {
      if (pending.get(file) === operation) pending.delete(file);
    }
  };
  return {
    read: (session) => {
      const file = session.file;
      return file
        ? enqueue(file, () => read(file))
        : Promise.resolve(undefined);
    },
    release: async (session) => {
      const file = session.file;
      if (file)
        await enqueue(file, async () => {
          cursors.delete(file);
          return undefined;
        });
    },
  };
}
export function tokenNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
