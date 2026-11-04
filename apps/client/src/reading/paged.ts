import { useEffect, useReducer, useState } from "react";
import { ReadConnectionLost, isAbort } from "./transport.ts";

export type Page<T> = { items: T[]; total?: number; hasMore?: boolean };
export type PageFetcher<T> = (
  start: number,
  count: number,
  signal: AbortSignal,
) => Promise<Page<T>>;

type Stored<T> = { items: T[]; generation: number };

/**
 * A list read by position, a page at a time. Pages outside the wanted range
 * are dropped past a fixed number; a refresh keeps showing the old pages
 * until each is replaced, and at most one request is in flight.
 */
export class PagedList<T> {
  readonly pageSize: number;
  #fetch: PageFetcher<T>;
  #maxPages: number;
  #pages = new Map<number, Stored<T>>();
  #generation = 0;
  #wanted = { first: 0, last: 0 };
  #running?: AbortController;
  #listeners = new Set<() => void>();
  #paused = false;
  #waitingForConnection = false;
  #failedPage?: number;
  total: number | undefined;
  hasMore = true;
  error: unknown;

  constructor(fetch: PageFetcher<T>, pageSize = 128, maxPages = 16) {
    this.#fetch = fetch;
    this.pageSize = pageSize;
    this.#maxPages = maxPages;
  }

  /** Rows to show: the known total, or what is loaded plus one row while more may follow. */
  get count(): number {
    if (this.total !== undefined) return this.total;
    let loaded = 0;
    for (const [start, page] of this.#pages)
      loaded = Math.max(loaded, start + page.items.length);
    return loaded + (this.hasMore ? 1 : 0);
  }

  get loaded(): boolean {
    return this.#pages.size > 0 || !this.hasMore;
  }

  get(index: number): T | undefined {
    const start = index - (index % this.pageSize);
    return this.#pages.get(start)?.items[index - start];
  }

  /** Loads the pages that cover rows `first`..`last`. */
  ensure(first: number, last: number): void {
    this.#wanted = { first: Math.max(0, first), last: Math.max(first, last) };
    this.#paused = false;
    this.#kick();
  }

  /** Something changed: read the wanted pages again while showing the current ones. */
  refresh(): void {
    this.#generation += 1;
    this.#waitingForConnection = false;
    this.#failedPage = undefined;
    this.error = undefined;
    this.#kick();
  }

  retry(): void {
    this.#failedPage = undefined;
    this.error = undefined;
    this.#notify();
    this.#kick();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Stops reading until rows are wanted again (a hidden or unmounted view). */
  pause(): void {
    this.#paused = true;
    this.#running?.abort();
  }

  #notify() {
    for (const listener of this.#listeners) listener();
  }

  #nextPage(): number | undefined {
    const first = this.#wanted.first - (this.#wanted.first % this.pageSize);
    for (
      let start = first;
      start <= this.#wanted.last;
      start += this.pageSize
    ) {
      if (this.total !== undefined && start >= this.total && start > 0) break;
      const page = this.#pages.get(start);
      if (page && page.generation === this.#generation) continue;
      if (!page && this.total === undefined && !this.hasMore && start > 0)
        break;
      if (start === this.#failedPage) return undefined;
      return start;
    }
    return undefined;
  }

  #kick() {
    if (this.#running || this.#paused || this.#waitingForConnection) return;
    const start = this.#nextPage();
    if (start === undefined) return;
    const controller = new AbortController();
    this.#running = controller;
    const generation = this.#generation;
    void this.#fetch(start, this.pageSize, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        this.#pages.set(start, { items: page.items, generation });
        if (page.total !== undefined) this.total = page.total;
        else {
          this.total = undefined;
          if (page.hasMore === false) {
            this.hasMore = false;
            for (const key of [...this.#pages.keys()])
              if (key > start) this.#pages.delete(key);
          } else if (page.items.length === this.pageSize) this.hasMore = true;
        }
        if (this.total !== undefined)
          for (const key of [...this.#pages.keys()])
            if (key >= this.total && key > 0) this.#pages.delete(key);
        this.#evict();
        this.error = undefined;
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        // A lost connection is not a failure here; the watch reads again after reconnecting.
        if (error instanceof ReadConnectionLost) {
          // A newer watch refresh may already have arrived while this read
          // was finishing. Otherwise wait for that event, including on ensure.
          this.#waitingForConnection = generation === this.#generation;
        } else {
          this.error = error;
          this.#failedPage = start;
        }
      })
      .finally(() => {
        if (this.#running === controller) this.#running = undefined;
        if (!controller.signal.aborted) this.#notify();
        if (!this.error) this.#kick();
      });
  }

  #evict() {
    if (this.#pages.size <= this.#maxPages) return;
    const center = (this.#wanted.first + this.#wanted.last) / 2;
    const far = [...this.#pages.keys()].sort(
      (a, b) => Math.abs(b - center) - Math.abs(a - center),
    );
    for (const key of far.slice(0, this.#pages.size - this.#maxPages))
      this.#pages.delete(key);
  }
}

/** A paged list owned by a component; a new list is made when `key` changes. */
export function usePagedList<T>(
  key: string,
  fetch: PageFetcher<T>,
  pageSize?: number,
  maxPages?: number,
): PagedList<T> {
  const [state, setState] = useState(() => ({
    key,
    list: new PagedList(fetch, pageSize, maxPages),
  }));
  let list = state.list;
  if (state.key !== key) {
    list = new PagedList(fetch, pageSize, maxPages);
    setState({ key, list });
  }
  const [, render] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const stop = list.subscribe(render);
    return () => {
      stop();
      list.pause();
    };
  }, [list]);
  return list;
}
