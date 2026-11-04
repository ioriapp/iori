import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, win32 } from "node:path";
import * as TOML from "@decimalturn/toml-patch";
import { startupArgumentWords } from "../team-startup-arguments.ts";
import type { ShellDefinition } from "../../terminal/platform.ts";

type Table = Record<string, unknown>;
const table = (value: unknown): Table =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Table)
    : {};

export function parseConfig(text: string): Table {
  try {
    return table(TOML.parse(text));
  } catch {
    return {};
  }
}

export function readConfig(): Table {
  try {
    return parseConfig(
      readFileSync(
        join(
          process.env.CODEX_HOME || join(homedir(), ".codex"),
          "config.toml",
        ),
        "utf8",
      ),
    );
  } catch {
    return {};
  }
}

/** Build Codex's session config layer: dotted assignments replace the selected
 * value, later assignments win, and unquoted strings are accepted. */
function startupConfig(source: string, shell: ShellDefinition) {
  const words = startupArgumentWords(source, shell)?.map((word) => word.value);
  if (!words) return undefined;
  let sandbox: string | undefined;
  let config: Table = {};
  const assign = (target: Table, keys: string[], value: unknown): Table => {
    const [key, ...rest] = keys;
    return {
      ...target,
      [key!]: rest.length ? assign(table(target[key!]), rest, value) : value,
    };
  };
  for (let i = 0; i < words.length && words[i] !== "--"; i++) {
    const word = words[i]!;
    const match = /^(--sandbox|-s)(?:=(.*)|(.+))?$/u.exec(word);
    if (match) {
      sandbox = match[2] ?? match[3] ?? words[++i];
      continue;
    }
    const option = /^(--config|-c)(?:=(.*)|(.+))?$/u.exec(word);
    if (!option) continue;
    const assignment = option[2] ?? option[3] ?? words[++i] ?? "";
    const equal = assignment.indexOf("=");
    if (equal < 0) continue;
    const key = assignment.slice(0, equal).trim();
    const raw = assignment.slice(equal + 1).trim();
    let value: unknown;
    try {
      value = table(TOML.parse(`value = ${raw}`)).value;
    } catch {
      value = raw.replace(/^["']+|["']+$/gu, "");
    }
    config = assign(config, key.split("."), value);
  }
  return { sandbox, config };
}

interface PermissionContext {
  platform: NodeJS.Platform;
  sandbox?: string;
  /** Canonical spelling first, then the original spelling, as in Codex. */
  cwd: readonly string[];
  repository: readonly string[];
}

function pathSpellings(path: string): string[] {
  try {
    const canonical = realpathSync.native(path);
    return [
      process.platform === "win32"
        ? win32.toNamespacedPath(canonical)
        : canonical,
      path,
    ];
  } catch {
    return [path];
  }
}

/** Codex trusts the main checkout for linked worktrees, without running git.
 * Unreadable or unsupported metadata leaves the repository trust unknown. */
function repositoryRoot(cwd: string): string | undefined {
  const metadataText = (file: string) => {
    if (!lstatSync(file).isFile()) return undefined;
    return readFileSync(file, "utf8").trim() || undefined;
  };
  try {
    for (let directory = cwd; ; directory = dirname(directory)) {
      const marker = join(directory, ".git");
      let metadata;
      try {
        metadata = lstatSync(marker);
      } catch {
        /* Try the parent. */
      }
      if (metadata?.isDirectory()) {
        try {
          statSync(join(marker, "HEAD"));
          return directory;
        } catch {
          /* Not a repository. */
        }
      } else if (metadata) {
        if (!metadata.isFile()) return undefined;
        const pointer = metadataText(marker);
        const target = pointer?.startsWith("gitdir:")
          ? pointer.slice(7).trim()
          : undefined;
        if (!target) return undefined;
        const gitDirectory = resolve(directory, target);
        if (!lstatSync(gitDirectory).isDirectory()) return undefined;
        const canonical = realpathSync.native(gitDirectory);
        if (dirname(canonical).split(/[\\/]/u).at(-1) !== "worktrees")
          return undefined;
        const common = dirname(dirname(canonical));
        const registered = metadataText(join(canonical, "gitdir"));
        const shared = metadataText(join(canonical, "commondir"));
        if (!registered || !shared) return undefined;
        const backlink = resolve(canonical, registered);
        const linkedCommon = resolve(canonical, shared);
        const main = dirname(dirname(gitDirectory));
        const root = dirname(main);
        if (
          basename(backlink) !== ".git" ||
          realpathSync.native(dirname(backlink)) !==
            realpathSync.native(directory) ||
          realpathSync.native(linkedCommon) !== common ||
          realpathSync.native(join(root, ".git")) !== common
        )
          return undefined;
        return root;
      }
      if (dirname(directory) === directory) return undefined;
    }
  } catch {
    return undefined;
  }
}

export function permissionContext(
  config: Table,
  cwd?: string,
): PermissionContext {
  const repository =
    cwd && Object.keys(table(config.projects)).length
      ? repositoryRoot(cwd)
      : undefined;
  return {
    platform: process.platform,
    cwd: cwd ? pathSpellings(cwd) : [],
    repository: repository ? pathSpellings(repository) : [],
  };
}

function hasTrustDecision(config: Table, context: PermissionContext): boolean {
  const projects = table(config.projects);
  const normalize = (key: string) =>
    context.platform === "win32"
      ? key.replace(/[A-Z]/gu, (letter) => letter.toLowerCase())
      : key;
  const entries = Object.keys(projects).sort();
  for (const path of [...context.cwd, ...context.repository]) {
    const key = normalize(path);
    const match = Object.hasOwn(projects, key)
      ? key
      : entries.find((candidate) => normalize(candidate) === key);
    if (match !== undefined) {
      const trust = table(projects[match]).trust_level;
      return trust === "trusted" || trust === "untrusted";
    }
  }
  return false;
}

function windowsSandboxEnabled(config: Table, overrides: Table): boolean {
  const mode =
    table(overrides.windows).sandbox ?? table(config.windows).sandbox;
  if (mode !== undefined)
    return mode === "elevated" || mode === "unelevated" || mode === "mxc";
  return [
    "elevated_windows_sandbox",
    "experimental_windows_sandbox",
    "enable_experimental_windows_sandbox",
  ].some((name) => {
    const feature =
      table(overrides.features)[name] ?? table(config.features)[name];
    return feature === true || table(feature).enabled === true;
  });
}

/** Codex chooses -s first, then session default_permissions, then the last
 * configuration layer's selection (default_permissions wins within a layer). */
export function allowsAdditionalDirectories(
  config: Table,
  source: string,
  shell: ShellDefinition,
  context: PermissionContext = {
    platform: process.platform,
    cwd: [],
    repository: [],
  },
): boolean {
  const session = startupConfig(source, shell) ?? {
    sandbox: undefined,
    config: {},
  };
  const sandbox = context.sandbox ?? session.sandbox;
  const sessionSandbox = session.config.sandbox_mode;
  const sessionProfile = session.config.default_permissions;
  const workspaceWritable =
    context.platform !== "win32" ||
    windowsSandboxEnabled(config, session.config);
  if (sandbox !== undefined)
    return (
      sandbox === "danger-full-access" ||
      (sandbox === "workspace-write" && workspaceWritable)
    );
  const profile =
    sessionProfile ??
    (sessionSandbox === undefined ? config.default_permissions : undefined);
  if (typeof profile === "string")
    return profile === ":workspace" || profile === ":danger-full-access";
  const mode = sessionSandbox ?? config.sandbox_mode;
  if (mode === "danger-full-access") return true;
  if (mode === "workspace-write") return workspaceWritable;
  return (
    mode === undefined && workspaceWritable && hasTrustDecision(config, context)
  );
}

/** Explicit Windows mode takes precedence over the older feature flags. */
export function usesUnelevatedSandbox(
  config: Table,
  source: string,
  shell: ShellDefinition,
): boolean {
  const overrides = startupConfig(source, shell)?.config ?? {};
  const mode =
    table(overrides.windows).sandbox ?? table(config.windows).sandbox;
  if (mode === "elevated" || mode === "mxc") return false;
  if (mode === "unelevated") return true;
  const feature =
    table(overrides.features).elevated_windows_sandbox ??
    table(config.features).elevated_windows_sandbox;
  return feature !== true && table(feature).enabled !== true;
}
