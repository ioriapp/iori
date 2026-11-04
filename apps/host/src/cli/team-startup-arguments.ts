// Shell word scanning follows Orca tui-agent-startup-shell.ts and
// commit-message-prompt.ts, retaining source spans instead of re-quoting.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ./ORCA-LICENSE.txt.
import type { ShellDefinition } from "../terminal/platform.ts";
import { shellDialect } from "./shell-command.ts";

export interface ManagedTeamArgument {
  names: readonly string[];
  arity?: "none" | "many";
  /** Config options share a flag but only these keys belong to the team. */
  keys?: readonly string[];
  /** Other spellings or presets that would override this team setting. */
  alsoRemove?: readonly ManagedTeamArgument[];
}
interface ShellWord {
  value: string;
  source: string;
}

/** Keep source spelling so paths, escaped characters and shell expansions in
 * retained arguments still reach the user's shell unchanged. */
export function startupArgumentWords(
  source: string,
  shell: ShellDefinition,
): ShellWord[] | undefined {
  const dialect = shellDialect(shell);
  const words: ShellWord[] = [];
  let quote = "",
    value = "",
    start = -1;
  const flush = (end: number) => {
    if (start >= 0) words.push({ value, source: source.slice(start, end) });
    start = -1;
    value = "";
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (!quote && /\s/u.test(char)) {
      flush(i);
      continue;
    }
    if (start < 0) start = i;
    const escape =
      dialect === "powershell" ? "`" : dialect === "cmd" ? "^" : "\\";
    if (char === escape && quote !== "'" && !(dialect === "cmd" && quote)) {
      const next = source[i + 1];
      if (next === undefined) return undefined;
      if (dialect === "posix" && quote === '"' && !'$`"\\\n'.includes(next)) {
        value += char;
      } else {
        if (next !== "\n") value += next;
        i++;
      }
      continue;
    }
    // Native Windows argv treats backslashes before a quote specially.
    if (dialect === "cmd" && char === "\\") {
      let end = i;
      while (source[end] === "\\") end++;
      const count = end - i;
      if (source[end] === '"') {
        value += "\\".repeat(Math.floor(count / 2));
        if (count % 2) {
          value += '"';
          i = end;
        } else {
          i = end - 1;
        }
        continue;
      }
    }
    if (char === quote) {
      if (dialect === "powershell" && source[i + 1] === quote) {
        value += quote;
        i++;
      } else quote = "";
    } else if (
      !quote &&
      (char === '"' || (char === "'" && dialect !== "cmd"))
    ) {
      quote = char;
    } else {
      if (
        quote !== "'" &&
        dialect !== "cmd" &&
        char === "$" &&
        source[i + 1] === "{"
      ) {
        const reference = /^\$\{[^{}$`]+\}/u.exec(source.slice(i));
        if (!reference) return undefined;
        value += reference[0];
        i += reference[0].length - 1;
        continue;
      }
      // Compound expressions need a full shell parser to identify their words.
      if (
        quote !== "'" &&
        dialect !== "cmd" &&
        ((char === "$" && "({".includes(source[i + 1] ?? "\0")) ||
          (dialect === "posix" && char === "`"))
      )
        return undefined;
      if (!quote && /[;|&<>]/u.test(char)) return undefined;
      value += char;
    }
  }
  if (quote) return undefined;
  flush(source.length);
  return words;
}

function occurrence(
  words: readonly string[],
  index: number,
  option: ManagedTeamArgument,
) {
  const word = words[index]!;
  const name = option.names.find(
    (name) =>
      word === name ||
      word.startsWith(name + "=") ||
      (name.length === 2 && word.startsWith(name) && word.length > 2),
  );
  if (!name) return undefined;
  const attached = word !== name;
  const value = attached
    ? word.slice(name.length).replace(/^=/u, "")
    : words[index + 1];
  const key = option.keys
    ? value
        ?.split("=", 1)[0]
        ?.trim()
        .replace(/^["']|["']$/gu, "")
    : undefined;
  if (
    option.keys &&
    (!key ||
      !option.keys.some((pattern) =>
        pattern.endsWith(".*")
          ? key.startsWith(pattern.slice(0, -1))
          : key === pattern,
      ))
  )
    return undefined;
  let count =
    option.arity === "none" || attached
      ? 1
      : value === undefined || value.startsWith("-")
        ? 1
        : 2;
  if (option.arity === "many") {
    while (
      index + count < words.length &&
      !words[index + count]!.startsWith("-")
    )
      count++;
  }
  return { count, key };
}

/** Whether the user's startup arguments set this option. Shell text that cannot
 * be read as words counts as setting it, so nothing is added over it. */
export function startupArgumentsSet(
  source: string,
  shell: ShellDefinition,
  option: ManagedTeamArgument,
): boolean {
  const words = startupArgumentWords(source, shell);
  if (!words) return true;
  const values = words.map((word) => word.value);
  for (let i = 0; i < values.length && values[i] !== "--"; i++)
    if (occurrence(values, i, option)) return true;
  return false;
}

/** Remove only settings actually supplied by this launch, including keyed
 * config overrides. Invalid shell text is omitted without blocking the team. */
export function teamStartupArguments(
  source: string,
  shell: ShellDefinition,
  managed: readonly ManagedTeamArgument[],
  teamArguments: readonly string[],
): string {
  const words = startupArgumentWords(source, shell);
  if (!words) return "";
  const values = words.map((word) => word.value);
  const active = managed.flatMap((option) => {
    const keys = new Set<string>();
    let found = false;
    for (
      let i = 0;
      i < teamArguments.length && teamArguments[i] !== "--";
      i++
    ) {
      const match = occurrence(teamArguments, i, option);
      if (match) {
        found = true;
        if (match.key) keys.add(match.key);
        i += match.count - 1;
      }
    }
    return found
      ? [
          { ...option, ...(option.keys ? { keys: [...keys] } : {}) },
          ...(option.alsoRemove ?? []),
        ]
      : [];
  });
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (values[i] === "--") {
      kept.push(...words.slice(i).map((word) => word.source));
      break;
    }
    const match = active
      .map((option) => occurrence(values, i, option))
      .find(Boolean);
    if (match) i += match.count - 1;
    else kept.push(words[i]!.source);
  }
  return kept.join(" ");
}
