import { statSync, watch, type FSWatcher } from "node:fs";
import { sep, relative, isAbsolute } from "node:path";
import { parentPort } from "node:worker_threads";
import { errorCode } from "./reading-failure.ts";
import type { WatchCommand, WatchEvent } from "./directory-watch.ts";

type Shared = {
  watcher: FSWatcher;
  ids: Set<number>;
  key: string;
  directory: string;
};
const shared = new Map<string, Shared>();
const subscriptions = new Map<number, Shared>();
const send = (event: WatchEvent) => parentPort!.postMessage(event);

parentPort!.on("message", (command: WatchCommand) => {
  if (command.kind === "stop-path") {
    for (const [key, entry] of shared) {
      const rel = relative(command.path, entry.directory);
      if (
        rel === "" ||
        (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
      ) {
        entry.watcher.close();
        shared.delete(key);
        for (const id of entry.ids) subscriptions.delete(id);
      }
    }
    send({ kind: "stopped", id: command.id });
    return;
  }
  if (command.kind === "close") {
    const entry = subscriptions.get(command.id);
    if (!entry) return;
    subscriptions.delete(command.id);
    entry.ids.delete(command.id);
    if (entry.ids.size === 0) {
      shared.delete(entry.key);
      entry.watcher.close();
    }
    return;
  }
  const { id, directory, recursive } = command;
  try {
    // A deleted and recreated folder at the same path gets a new OS watcher.
    const { dev, ino } = statSync(directory);
    const key = `${recursive ? "r" : "n"}:${dev}:${ino}:${directory}`;
    let entry = shared.get(key);
    if (!entry) {
      const ids = new Set<number>();
      const watcher = watch(directory, { recursive }, (_event, filename) => {
        const path =
          typeof filename === "string" && filename
            ? filename.split(sep).join("/")
            : undefined;
        for (const watchedId of ids)
          send({ kind: "change", id: watchedId, path });
      });
      watcher.on("error", (error) => {
        shared.delete(key);
        watcher.close();
        for (const watchedId of ids) {
          subscriptions.delete(watchedId);
          send({ kind: "failed", id: watchedId, code: errorCode(error) });
        }
      });
      entry = { watcher, ids, key, directory };
      shared.set(key, entry);
    }
    entry.ids.add(id);
    subscriptions.set(id, entry);
    send({ kind: "ready", id });
  } catch (error) {
    send({ kind: "failed", id, code: errorCode(error) });
  }
});
