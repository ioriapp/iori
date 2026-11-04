import { extname } from "node:path";
import * as TOML from "@decimalturn/toml-patch";
import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  stringify as yamlText,
  type Document,
  type Node,
  type Pair,
} from "yaml";

/** The syntax of a hooks file, by its extension (cli-definitions.md「hooks」). */
export type HookSyntax = "json" | "toml" | "yaml";
export function hookSyntax(path: string): HookSyntax | undefined {
  const extension = extname(path).toLowerCase();
  if (extension === ".json") return "json";
  if (extension === ".toml") return "toml";
  if (extension === ".yaml" || extension === ".yml") return "yaml";
  return undefined;
}

/** The `id` of the CLI that iori's hook command carries: "" for a command
 * written before commands carried one, undefined for another command. */
export function hookOwner(command: unknown): string | undefined {
  if (typeof command !== "string") return undefined;
  const encoded = /-EncodedCommand ([A-Za-z0-9+/=]+)/u.exec(command)?.[1];
  const decoded = encoded
    ? Buffer.from(encoded, "base64").toString("utf16le")
    : command;
  const call = /[\\/]\.iori[\\/]hooks[\\/]iori-cli-hook\.(?:mjs|cmd)'?/u.exec(
    decoded,
  );
  if (!call) return undefined;
  // The event, the reply and the `id`, each quoted as the shell needs.
  const words =
    decoded
      .slice(call.index + call[0].length)
      .match(/'(?:[^']|'\\'')*'|"[^"]*"|[^\s'"]+/gu) ?? [];
  const id = words[2]?.replace(/^['"]|['"]$/gu, "");
  return id && /^[a-z0-9-]+$/u.test(id) ? id : "";
}

/** Where a CLI's items go in its hooks file: a table of arrays keyed by
 * event (`events`), or one array whose items name their event (`list`). */
export interface HookPlace {
  format: "events" | "list";
  /** The keys from the top of the file to that table or array. */
  at: readonly string[];
  /** The item of one event, with iori's command in it. */
  entry: (event: string, command: string) => unknown;
}
export interface HookItem {
  event: string;
  command: string;
}

export interface HookPlacement {
  path: string[];
  value: unknown;
}
type Path = (string | number)[];
type Table = Record<string, unknown>;
const isTable = (value: unknown): value is Table =>
  !!value && typeof value === "object" && !Array.isArray(value);
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const within = (path: Path, outer: Path) =>
  outer.length <= path.length && same(path.slice(0, outer.length), outer);

/** A command of `owner`, or one written before commands carried an id:
 * every CLI that writes a file removes those. */
function calls(value: unknown, owner: string): boolean {
  const found = hookOwner(value);
  return found === owner || found === "";
}

interface Plan {
  /** Array elements that go. An element goes whole when iori's command is
   * in it outside an array, or when the removal empties an array in it. */
  elements: Path[];
  /** Arrays and tables, not in an array, that the removal empties:
   * outermost first. */
  arrays: Path[];
  tables: Path[];
  /** The items that are not in the file yet. */
  missing: { path: Path; value: unknown }[];
}
function elementParts(
  value: unknown,
  owner: string,
  path: Path,
): Path[] | true {
  if (typeof value === "string") return calls(value, owner) ? true : [];
  if (Array.isArray(value)) return arrayParts(value, owner, path);
  if (!isTable(value)) return [];
  const parts: Path[] = [];
  for (const [key, child] of Object.entries(value)) {
    const found = elementParts(child, owner, [...path, key]);
    if (found === true) return true;
    parts.push(...found);
  }
  return parts;
}
/** The elements of `array` that go: true when all of them go. */
function arrayParts(
  array: unknown[],
  owner: string,
  path: Path,
  kept?: (path: Path, value: unknown) => boolean,
): Path[] | true {
  const parts: Path[] = [];
  let gone = 0;
  array.forEach((item, index) => {
    const at = [...path, index];
    if (kept?.(at, item)) return;
    const found = elementParts(item, owner, at);
    if (found !== true) parts.push(...found);
    else {
      parts.push(at);
      gone++;
    }
  });
  return gone && gone === array.length ? true : parts;
}
/** Whether the removal empties `table`, a table that is not in an array. */
function tableParts(
  table: Table,
  owner: string,
  path: Path,
  kept: (path: Path, value: unknown) => boolean,
  plan: Plan,
): boolean {
  const keys = Object.keys(table);
  let gone = 0;
  for (const key of keys) {
    const child = table[key];
    const at = [...path, key];
    if (Array.isArray(child)) {
      const found = arrayParts(child, owner, at, kept);
      if (found === true) {
        plan.elements.push(...child.map((_item, index) => [...at, index]));
        plan.arrays.push(at);
        gone++;
      } else plan.elements.push(...found);
    } else if (isTable(child)) {
      const index = plan.tables.length;
      if (tableParts(child, owner, at, kept, plan)) {
        plan.tables.splice(index, 0, at);
        gone++;
      }
    }
  }
  return gone > 0 && gone === keys.length;
}
/** The array that each item goes to, and the item. */
const wanted = (place: HookPlace, items: readonly HookItem[]) =>
  items.map(({ event, command }) => ({
    path: place.format === "events" ? [...place.at, event] : [...place.at],
    value: place.entry(event, command),
  }));
/** What changes in `model` so that `owner` has exactly `items` there.
 * Items already in place stay; arrays and tables that receive an item
 * are not removed, so they keep their place in the file. */
function plan(
  model: Table,
  owner: string,
  place: HookPlace | undefined,
  items: readonly HookItem[],
  retained: readonly HookPlacement[] = [],
): Plan {
  const missing = [...(place ? wanted(place, items) : []), ...retained].filter(
    (item, index, all) => all.findIndex((other) => same(item, other)) === index,
  );
  const kept = (path: Path, value: unknown) => {
    const index = missing.findIndex(
      (item) => same(item.path, path.slice(0, -1)) && same(item.value, value),
    );
    if (index >= 0) missing.splice(index, 1);
    return index >= 0;
  };
  const result: Plan = { elements: [], arrays: [], tables: [], missing };
  tableParts(model, owner, [], kept, result);
  const receives = (path: Path) =>
    missing.some((item) => within(item.path, path));
  result.arrays = result.arrays.filter((path) => !receives(path));
  result.tables = result.tables.filter((path) => !receives(path));
  return result;
}
const unchanged = (plan: Plan) =>
  !plan.elements.length &&
  !plan.arrays.length &&
  !plan.tables.length &&
  !plan.missing.length;

/** A key of the file, read and written as the table's own key: a key such
 * as `__proto__` from a definition never reaches the Host's prototypes. */
const read = (table: Table, key: string): unknown =>
  Object.hasOwn(table, key) ? table[key] : undefined;
const write = (table: Table, key: string, value: unknown) =>
  Object.defineProperty(table, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
function valueAt(model: Table, path: Path): unknown {
  let value: unknown = model;
  for (const key of path)
    value = Array.isArray(value)
      ? value[key as number]
      : isTable(value)
        ? read(value, key as string)
        : undefined;
  return value;
}
function remove(model: Table, path: Path): void {
  const holder = valueAt(model, path.slice(0, -1));
  const key = path.at(-1)!;
  if (Array.isArray(holder)) holder.splice(key as number, 1);
  else if (isTable(holder) && Object.hasOwn(holder, key))
    delete holder[key as string];
}
const empty = (model: Table, path: Path) => {
  const value = valueAt(model, path);
  return Array.isArray(value)
    ? !value.length
    : isTable(value) && !Object.keys(value).length;
};
/** Add `value` to the array at `path`, making the tables on the way. A
 * place that holds something else is the user's, so nothing is written. */
function insert(model: Table, path: Path, value: unknown): void {
  let table = model;
  for (const key of path.slice(0, -1) as string[]) {
    if (read(table, key) === undefined) write(table, key, {});
    const next = read(table, key);
    if (!isTable(next))
      throw new Error(`hooks ${path.join(".")} holds another value`);
    table = next;
  }
  const key = path.at(-1) as string;
  if (read(table, key) === undefined) write(table, key, []);
  const array = read(table, key);
  if (!Array.isArray(array))
    throw new Error(`hooks ${path.join(".")} holds another value`);
  array.push(value);
}
/** Elements and emptied arrays go; emptied tables go unless `keep`. */
function apply(model: Table, plan: Plan, keep: (path: Path) => boolean) {
  for (const path of [...plan.elements].reverse())
    if (!plan.arrays.some((array) => within(path, array))) remove(model, path);
  for (const path of plan.arrays) remove(model, path);
  for (const path of [...plan.tables].reverse())
    if (empty(model, path) && !keep(path)) remove(model, path);
  for (const item of plan.missing) insert(model, item.path, item.value);
}

/** The lines that are only a comment, to see that a removal keeps them. */
const comments = (text: string) =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("#"))
    .sort();
/** The newline of a file: CRLF when it has one. */
const newlineOf = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");

function editJson(
  text: string,
  owner: string,
  place: HookPlace | undefined,
  items: readonly HookItem[],
  retained: readonly HookPlacement[],
): string {
  const model: unknown = text.trim() ? JSON.parse(text) : {};
  if (!isTable(model)) throw new Error("A hooks file must hold an object");
  const changes = plan(model, owner, place, items, retained);
  if (unchanged(changes)) return text;
  apply(model, changes, () => false);
  return JSON.stringify(model, null, 2) + "\n";
}

/** `text` without the array-of-tables blocks (`[[hooks]]`) of `elements`
 * and the blocks in them: the lines of each block from its header to its
 * last key, with the blank line before the header. The comments and blank
 * lines after the last key and the other blocks are the user's, so they
 * stay (toml-patch takes them with the block). */
function cutTableBlocks(text: string, elements: Path[]): string {
  const counts = new Map<string, number>();
  const blocks = new TOML.TomlDocument(text).cst.flatMap((block) => {
    if (block.type !== "Table" && block.type !== "TableArray") return [];
    const { key, loc, items } = block as {
      key: { item: { value: string[] } };
      loc: { start: { line: number } };
      items: { type: string; loc: { end: { line: number } } }[];
    };
    const keys = key.item.value;
    const first = loc.start.line - 1;
    const last = Math.max(
      first,
      ...items
        .filter((item) => item.type === "KeyValue")
        .map((item) => item.loc.end.line - 1),
    );
    // An array-of-tables block is the next element of its array.
    let element: Path | undefined;
    if (block.type === "TableArray") {
      const index = counts.get(JSON.stringify(keys)) ?? 0;
      counts.set(JSON.stringify(keys), index + 1);
      element = [...keys, index];
    }
    return [{ keys, first, last, element }];
  });
  const starts = lineStarts(text);
  const drop = new Set<number>();
  for (const element of elements) {
    const at = blocks.findIndex(
      (block) => block.element && same(block.element, element),
    );
    if (at < 0) continue;
    const { keys } = blocks[at]!;
    // A block whose key starts with the array's is in the array's latest
    // element, until its next element (TOML「Array of Tables」).
    for (const [after, { keys: inner, first, last }] of blocks
      .slice(at)
      .entries()) {
      if (after && same(inner, keys)) break;
      if (after && !within(inner, keys)) continue;
      for (let line = first; line <= last; line++) drop.add(line);
      if (first > 0 && !text.slice(starts[first - 1], starts[first]).trim())
        drop.add(first - 1);
    }
  }
  return drop.size ? dropLines(text, starts, drop) : text;
}
function editToml(
  text: string,
  owner: string,
  place: HookPlace | undefined,
  items: readonly HookItem[],
  retained: readonly HookPlacement[],
): string {
  const model = TOML.parse(text) as Table;
  const changes = plan(model, owner, place, items, retained);
  if (unchanged(changes)) return text;
  const cut = cutTableBlocks(text, changes.elements);
  if (cut !== text) return editToml(cut, owner, place, items, retained);
  const format = TOML.TomlFormat.autoDetectFormat(text);
  // The tables down to `at` are sections that the user can add to.
  format.inlineTableStart = place?.at.length ?? 1;
  const removal = { ...changes, missing: [] };
  const kept = structuredClone(model);
  apply(kept, removal, () => true);
  let removed = TOML.patch(text, kept, format);
  // A table that the removal empties goes, outermost first, unless the
  // user's comment in it would go too.
  const before = comments(removed);
  const gone: Path[] = [];
  for (const path of changes.tables) {
    if (gone.some((outer) => within(path, outer))) continue;
    const trial = structuredClone(model);
    apply(
      trial,
      removal,
      (table) => ![...gone, path].some((outer) => within(table, outer)),
    );
    const trialText = TOML.patch(text, trial, format);
    if (same(comments(trialText), before)) {
      gone.push(path);
      removed = trialText;
    }
  }
  // A file that iori's items made from an empty one is empty again.
  if (!removed.trim()) removed = "";
  if (!changes.missing.length) return removed;
  const next = TOML.parse(removed) as Table;
  const root = changes.missing[0]!.path[0] as string;
  if (read(next, root) !== undefined) {
    for (const item of changes.missing) insert(next, item.path, item.value);
    return TOML.patch(removed, next, format);
  }
  // toml-patch cannot add an array of tables, so a key that the file does
  // not have yet goes after its last line, before its trailing blank lines.
  const added: Table = {};
  for (const item of changes.missing) insert(added, item.path, item.value);
  const newline = newlineOf(removed);
  const block = TOML.stringify(
    added,
    Object.assign(TOML.TomlFormat.default(), {
      newLine: newline,
      inlineTableStart: format.inlineTableStart,
    }),
  ).replace(/(?:\r?\n)+$/u, "");
  const tail = /(?:[ \t]*\r?\n)*$/u.exec(removed)![0];
  const body = removed.slice(0, removed.length - tail.length);
  return body
    ? body + newline + newline + block + tail
    : block + (tail || newline);
}

function yamlDocument(text: string): Document {
  const document = parseDocument(text);
  if (document.errors.length) throw document.errors[0]!;
  return document;
}
/** The offsets where the lines of `text` start. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++)
    if (text[index] === "\n") starts.push(index + 1);
  return starts;
}
function lineOf(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}
/** The `-` of a list item that starts at `offset`. */
function itemStart(text: string, offset: number): number {
  let index = offset - 1;
  while (index >= 0 && /\s/u.test(text[index]!)) index--;
  return text[index] === "-" ? index : offset;
}
const keyName = (pair: Pair) =>
  String((pair.key as Node & { value?: unknown })?.value);
function pairLines(
  document: Document,
  starts: number[],
  path: Path,
): [number, number] {
  const holder =
    path.length > 1
      ? document.getIn(path.slice(0, -1), true)
      : document.contents;
  const pair = isMap(holder)
    ? holder.items.find((entry) => keyName(entry) === path.at(-1))
    : undefined;
  const key = (pair!.key as Node).range!;
  const value = (pair!.value as Node | null)?.range;
  return [
    lineOf(starts, key[0]),
    lineOf(starts, Math.max(key[0], (value ?? key)[1] - 1)),
  ];
}
/** `text` without the lines in `drop`. When the dropped lines end a file
 * that has no newline at its end, the newline before them goes too, as
 * it came with them. */
function dropLines(text: string, starts: number[], drop: Set<number>) {
  let result = "";
  starts.forEach((start, line) => {
    if (!drop.has(line)) result += text.slice(start, starts[line + 1]);
  });
  if (drop.has(starts.length - 1) && !text.endsWith("\n"))
    result = result.replace(/\r?\n$/u, "");
  return result;
}
function editYaml(
  text: string,
  owner: string,
  place: HookPlace | undefined,
  items: readonly HookItem[],
  retained: readonly HookPlacement[],
): string {
  const document = yamlDocument(text);
  const model: unknown = document.toJS() ?? {};
  if (!isTable(model)) throw new Error("A hooks file must hold a mapping");
  const changes = plan(model, owner, place, items, retained);
  if (unchanged(changes)) return text;
  const starts = lineStarts(text);
  const drop = new Set<number>();
  const mark = ([first, last]: [number, number]) => {
    for (let line = first; line <= last; line++) drop.add(line);
  };
  const line = (index: number) => text.slice(starts[index], starts[index + 1]);
  for (const path of changes.elements) {
    // An item in a flow list shares its line with the user's items.
    const holder = document.getIn(path.slice(0, -1), true);
    if (isSeq(holder) && holder.flow)
      throw new Error(`hooks ${path.join(".")} is in a flow list`);
    const [start, end] = (document.getIn(path, true) as Node).range!;
    mark([
      lineOf(starts, itemStart(text, start)),
      lineOf(starts, Math.max(start, end - 1)),
    ]);
  }
  for (const path of changes.arrays) mark(pairLines(document, starts, path));
  // A table that the removal empties goes, unless the user's comment in
  // it would go too.
  for (const path of changes.tables) {
    const [first, last] = pairLines(document, starts, path);
    let commented = / #/u.test(line(first));
    for (let index = first + 1; index <= last; index++)
      if (!drop.has(index) && line(index).trimStart().startsWith("#"))
        commented = true;
    if (!commented) mark([first, last]);
  }
  const removed = dropLines(text, starts, drop);
  return changes.missing.length
    ? insertYaml(removed, changes.missing)
    : removed;
}
/** Add the items after the last line of the place they go to, indented as
 * the lines there, without changing any other line. */
function insertYaml(text: string, missing: Plan["missing"]): string {
  const document = yamlDocument(text);
  const starts = lineStarts(text);
  const lineEnd = (offset: number) =>
    starts[lineOf(starts, offset) + 1] ?? text.length;
  const column = (offset: number) => offset - starts[lineOf(starts, offset)]!;
  // What goes at each offset: keys still to make and the items under them.
  interface Fragment {
    indent: number;
    keys: Path;
    value: unknown;
  }
  const inserts = new Map<number, Fragment[]>();
  const add = (offset: number, fragment: Fragment) =>
    inserts.set(offset, [...(inserts.get(offset) ?? []), fragment]);
  for (const { path, value: item } of missing) {
    let holder: unknown = document.contents;
    for (let depth = 0; ; depth++) {
      if (holder === null || holder === undefined) {
        add(text.length, { indent: 0, keys: path, value: item });
        break;
      }
      if (!isMap(holder) || holder.flow)
        throw new Error(`hooks ${path.join(".")} is not in a block mapping`);
      const pair = holder.items.find((entry) => keyName(entry) === path[depth]);
      if (!pair) {
        const first = holder.items[0]!.key as Node;
        const last = holder.items.at(-1)!;
        const end = ((last.value as Node | null) ?? last.key) as Node;
        add(lineEnd(end.range![1] - 1), {
          indent: column(first.range![0]),
          keys: path.slice(depth),
          value: item,
        });
        break;
      }
      const key = (pair.key as Node).range![0];
      const value = pair.value as Node | null;
      if (!value || (isScalar(value) && value.value === null)) {
        add(lineEnd(key), {
          indent: column(key) + 2,
          keys: path.slice(depth + 1),
          value: item,
        });
        break;
      }
      if (depth === path.length - 1) {
        if (!isSeq(value) || value.flow)
          throw new Error(`hooks ${path.join(".")} is not a block list`);
        const first = value.items[0] as Node;
        const last = value.items.at(-1) as Node;
        add(lineEnd(last.range![1] - 1), {
          indent: column(itemStart(text, first.range![0])),
          keys: [],
          value: item,
        });
        break;
      }
      holder = value;
    }
  }
  /** Fragments at one offset as lines: deeper ones first, as they belong
   * to the lines before them, and the keys they share written once. */
  const render = (fragments: Fragment[], indent: number): string => {
    let lines = fragments
      .filter((fragment) => !fragment.keys.length)
      .map((fragment) =>
        yamlText([fragment.value], { lineWidth: 0 }).replace(
          /^(?=.)/gmu,
          " ".repeat(indent),
        ),
      )
      .join("");
    const named = fragments.filter((fragment) => fragment.keys.length);
    for (const key of new Set(named.map((fragment) => fragment.keys[0])))
      lines +=
        " ".repeat(indent) +
        yamlText(key, { lineWidth: 0 }).trimEnd() +
        ":\n" +
        render(
          named
            .filter((fragment) => fragment.keys[0] === key)
            .map((fragment) => ({ ...fragment, keys: fragment.keys.slice(1) })),
          indent + 2,
        );
    return lines;
  };
  const newline = newlineOf(text);
  let result = text;
  for (const offset of [...inserts.keys()].sort((a, b) => b - a)) {
    const fragments = inserts.get(offset)!;
    const indents = [...new Set(fragments.map((fragment) => fragment.indent))];
    let added = indents
      .sort((a, b) => b - a)
      .map((indent) =>
        render(
          fragments.filter((fragment) => fragment.indent === indent),
          indent,
        ),
      )
      .join("")
      .replaceAll("\n", newline);
    if (offset === result.length && result && !result.endsWith("\n"))
      added = newline + added.slice(0, -newline.length);
    result = result.slice(0, offset) + added + result.slice(offset);
  }
  return result;
}

/** `text`, a hooks file, with `owner`'s items replaced by one item for each
 * of `items` in `place`. Nothing else in the file changes, except that
 * JSON is written with 2 spaces (cli-definitions.md「書き換え方」). */
export function editHookDocument(
  text: string,
  syntax: HookSyntax,
  owner: string,
  place?: HookPlace,
  items: readonly HookItem[] = [],
  retained: readonly HookPlacement[] = [],
): string {
  if (syntax === "json") return editJson(text, owner, place, items, retained);
  if (syntax === "toml") return editToml(text, owner, place, items, retained);
  return editYaml(text, owner, place, items, retained);
}

function modelOf(text: string, syntax: HookSyntax): Table {
  const model: unknown =
    syntax === "json"
      ? text.trim()
        ? JSON.parse(text)
        : {}
      : syntax === "toml"
        ? TOML.parse(text)
        : (yamlDocument(text).toJS() ?? {});
  if (!isTable(model)) throw new Error("A hooks file must hold a table");
  return model;
}
/** Whether nothing is left in a hooks file. */
export function emptyHookDocument(text: string, syntax: HookSyntax): boolean {
  return syntax === "json"
    ? !Object.keys(modelOf(text, syntax)).length
    : !text.trim();
}
/** `value` with the keys of each table in order: a file may hold the keys
 * of `base` in another order, as TOML writes tables after values. */
const ordered = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(ordered)
    : isTable(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, ordered(read(value, key))]),
        )
      : value;
/** Whether a file is iori's own: without `owner`'s items it holds `base`
 * or nothing (cli-definitions.md「上書きしない」). */
export function ownHookFile(
  text: string,
  syntax: HookSyntax,
  owner: string,
  base: Record<string, unknown>,
): boolean {
  const model = modelOf(text, syntax);
  const removal = plan(model, owner, undefined, []);
  // The tables and arrays of `base` stay, emptied, as in iori's file.
  const inBase = (path: Path) => valueAt(base, path) !== undefined;
  removal.arrays = removal.arrays.filter((path) => !inBase(path));
  apply(model, removal, inBase);
  return !Object.keys(model).length || same(ordered(model), ordered(base));
}
/** A file of iori's own: `base` with one item for each of `items`. */
export function ownHookDocument(
  syntax: HookSyntax,
  base: Record<string, unknown>,
  place: HookPlace,
  items: readonly HookItem[],
): string {
  const model = structuredClone(base);
  for (const item of wanted(place, items)) insert(model, item.path, item.value);
  if (syntax === "json") return JSON.stringify(model, null, 2) + "\n";
  if (syntax === "toml")
    return TOML.stringify(
      model,
      Object.assign(TOML.TomlFormat.default(), {
        inlineTableStart: place.at.length,
      }),
    );
  return yamlText(model, { lineWidth: 0 });
}
