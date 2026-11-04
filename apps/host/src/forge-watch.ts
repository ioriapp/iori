import type { HostStore } from "./store.ts";
import type { ForgeStatus } from "@iori/protocol";
import { readForgeStatus, readPushTarget } from "./forge-status.ts";
import { ForgeDetection } from "./forge/adapters.ts";
import { repositoryMainPath } from "./repository-git-settings.ts";

type Visibility = { paths: string[]; selected?: string };
type Entry = {
  active: boolean;
  remoteHost?: string;
  origin?: string;
  mainPath?: string;
  force?: boolean;
  status?: ForgeStatus;
  target?: string;
  identity?: string;
  attempted: number;
  controller?: AbortController;
  pending?: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

/** One shared observation per visible worktree, across all connected Clients. */
export class ForgeWatcher {
  readonly #clients = new Map<object, Visibility>();
  readonly #entries = new Map<string, Entry>();
  readonly #store: HostStore;
  readonly detection: ForgeDetection;
  readonly #onSettingsChange: () => void;
  readonly #publish: (path: string, status: ForgeStatus) => void;
  constructor(
    store: HostStore,
    publish: (path: string, status: ForgeStatus) => void,
    onSettingsChange: () => void,
  ) {
    this.detection = new ForgeDetection(onSettingsChange);
    this.#store = store;
    this.#publish = publish;
    this.#onSettingsChange = onSettingsChange;
  }
  mappingsChanged(hosts: string[]): void {
    for (const [path, entry] of this.#entries) {
      if (
        !entry.remoteHost ||
        !hosts.includes(entry.remoteHost) ||
        !entry.active
      )
        continue;
      entry.controller?.abort();
      this.#refresh(path, entry, true);
    }
    this.#onSettingsChange();
  }
  /**
   * Read a site's marks again. A new or removed token changes what can be
   * read, so its marks start empty; a retry keeps the last marks meanwhile.
   */
  siteChanged(origin: string, tokenChanged: boolean): void {
    for (const [path, entry] of this.#entries) {
      if (entry.active && entry.origin === origin) {
        if (tokenChanged) {
          entry.status = undefined;
          this.#publish(path, {});
        }
        entry.controller?.abort();
        this.#refresh(path, entry, true);
      }
    }
  }
  repositoryChanged(mainPath: string): void {
    for (const [path, entry] of this.#entries) {
      if (entry.active && entry.mainPath === mainPath) {
        entry.status = undefined;
        this.#publish(path, {});
        entry.controller?.abort();
        this.#refresh(path, entry, true);
      }
    }
    this.#onSettingsChange();
  }

  watch(client: object, visibility: Visibility): void {
    this.#clients.set(client, visibility);
    const visible = new Set(
      [...this.#clients.values()].flatMap((value) => value.paths),
    );
    for (const [path, entry] of this.#entries) {
      entry.active = visible.has(path);
      if (entry.active) continue;
      clearTimeout(entry.timer);
      entry.timer = undefined;
      entry.controller?.abort();
    }
    for (const path of visible) {
      let entry = this.#entries.get(path);
      if (!entry) {
        entry = { active: true, attempted: 0 };
        this.#entries.set(path, entry);
      }
      if (visibility.paths.includes(path) && entry.status)
        this.#publish(path, entry.status);
      const due = Date.now() - entry.attempted >= this.#interval(path);
      if (due || !entry.status || (!entry.timer && !entry.controller))
        this.#refresh(path, entry, due);
      else if (!entry.controller) this.#schedule(path, entry);
    }
  }
  remove(client: object): void {
    this.#clients.delete(client);
    this.watch(this, { paths: [] });
    this.#clients.delete(this);
  }
  changed(paths: string[]): void {
    for (const path of paths) {
      const entry = this.#entries.get(path);
      if (entry?.active) this.#refresh(path, entry, false);
    }
  }
  close(): void {
    for (const entry of this.#entries.values()) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
      entry.controller?.abort();
    }
    this.#entries.clear();
    this.#clients.clear();
  }
  #interval(path: string): number {
    return [...this.#clients.values()].some(
      (client) => client.paths.includes(path) && client.selected === path,
    )
      ? 60_000
      : 120_000;
  }
  #schedule(path: string, entry: Entry): void {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(
      () => this.#refresh(path, entry, true),
      Math.max(0, entry.attempted + this.#interval(path) - Date.now()),
    );
    entry.timer.unref();
  }
  #refresh(path: string, entry: Entry, force: boolean): void {
    if (entry.controller) {
      entry.pending = true;
      entry.force ||= force;
      return;
    }
    clearTimeout(entry.timer);
    const controller = new AbortController();
    entry.controller = controller;
    void (async () => {
      try {
        const pushed = await readPushTarget(path, controller.signal);
        entry.remoteHost = pushed?.remoteHost;
        const mapping = pushed
          ? this.#store.forgeMapping(pushed.remoteHost)
          : undefined;
        const mainPath = pushed ? await repositoryMainPath(path) : undefined;
        entry.mainPath = mainPath;
        const target = pushed
          ? {
              ...pushed,
              origin: mapping ? new URL(mapping.webUrl).origin : pushed.origin,
            }
          : undefined;
        if (controller.signal.aborted) return;
        entry.origin = target?.origin;
        const key = JSON.stringify(target);
        const changed = key !== entry.target;
        const identity = target
          ? JSON.stringify([
              target.origin,
              target.owner,
              target.repo,
              target.branch,
            ])
          : undefined;
        if (identity !== entry.identity) {
          entry.identity = identity;
          entry.status = undefined;
          this.#publish(path, {});
        }
        entry.target = key;
        if (force || changed || !entry.status) {
          entry.attempted = Date.now();
          const adapter = target
            ? await this.detection.resolve(
                target.origin,
                controller.signal,
                true,
              )
            : undefined;
          if (target && !adapter) throw new Error("Forge unavailable");
          const status =
            target && adapter
              ? await readForgeStatus(
                  target,
                  mainPath
                    ? (adapter.forRepository?.(
                        this.#store,
                        mainPath,
                        this.#onSettingsChange,
                      ) ?? adapter)
                    : adapter,
                  controller.signal,
                )
              : {};
          if (controller.signal.aborted) return;
          entry.status = status;
          this.#publish(path, status);
        }
      } catch {
        // Keep the last successful marks. CLI output/errors never enter events.
        entry.attempted = Date.now();
      } finally {
        entry.controller = undefined;
        if (!entry.active || this.#entries.get(path) !== entry) return;
        if (entry.pending) {
          entry.pending = false;
          const force = entry.force ?? false;
          entry.force = false;
          this.#refresh(path, entry, force);
        } else {
          this.#schedule(path, entry);
        }
      }
    })();
  }
}
