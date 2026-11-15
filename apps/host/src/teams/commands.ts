import { parseArgs } from "node:util";
import type { Difficulty } from "@iori/protocol";
import { forgeCommandUsage } from "../forge-commands.ts";

const commandFooter =
  "Add --json for {ok,data}, or {ok,text} when no structured data is available.";
/** Agents asked to write the setup command learn its conditions from --help. */
export const worktreeSetupHelp = `Command to run after creating a worktree (set per repository in the workspace settings, Git):
iori runs it in the Host's default Terminal shell (PowerShell by default on Windows) before the CLI starts; "Run again" after a failure runs it from the start.
Working directory: the new worktree. Environment variable IORI_ROOT_PATH: the main worktree path ($IORI_ROOT_PATH in bash/zsh, $env:IORI_ROOT_PATH in PowerShell; e.g. pnpm install && cp "$IORI_ROOT_PATH/.env" .).
Exit code 0 starts the CLI in the same tab; otherwise the CLI does not start and the output stays in the tab.`;
/** The commands of a CLI outside a team: only those that read the Forge. */
export const forgeCommandHelp = `${forgeCommandUsage}\n${commandFooter}`;
export const commandHelp = `iori delegate --role NAME --difficulty high|medium|low --title TITLE --worktree new|parent|WORKTREE_NAME (a folder name from git worktree list) [--repo PATH] --body TEXT [--continue TASK_ID] [--plan N]
iori plan show
iori plan goal --body TEXT [--request]
iori plan add --title TITLE [--first | --after N] [--request]
iori plan move N (--first | --after M)
iori plan update N [--state pending|in_progress|done] [--checkpoint TEXT] [--title TITLE]
iori plan cancel N --reason TEXT
iori tasks
iori read CHILD_ID
iori send CHILD_ID --kind answer|request|revise --body TEXT
iori finish CHILD_ID --decision accept|reject --reason TEXT --worktree keep|remove [--discard]
  (--discard also deletes uncommitted changes and a child branch with unmerged commits)
iori stop CHILD_ID
iori screen CHILD_ID
iori interrupt CHILD_ID
iori input CHILD_ID (--text TEXT [--enter] | --key KEY)
iori report --body TEXT
iori ask --body TEXT
${forgeCommandUsage}
For body: --file PATH (inside the working directory) or --body - (stdin). ${commandFooter}`;
export const teamInputKeys = [
  "enter",
  "escape",
  "up",
  "down",
  "tab",
  "ctrl-c",
] as const;
export type TeamInputKey = (typeof teamInputKeys)[number];
export type TeamCommand =
  | {
      kind: "delegate";
      role: string;
      difficulty: Difficulty;
      title: string;
      body: string;
      worktree: string;
      repo?: string;
      continuation?: string;
      plan?: number;
    }
  | { kind: "plan"; action: "show" }
  | { kind: "plan"; action: "goal"; body: string; request: boolean }
  | {
      kind: "plan";
      action: "add";
      title: string;
      first: boolean;
      after?: number;
      request: boolean;
    }
  | {
      kind: "plan";
      action: "move";
      number: number;
      first: boolean;
      after?: number;
    }
  | {
      kind: "plan";
      action: "update";
      number: number;
      state?: "pending" | "in_progress" | "done";
      checkpoint?: string;
      title?: string;
    }
  | { kind: "plan"; action: "cancel"; number: number; reason: string }
  | { kind: "tasks" }
  | { kind: "read" | "stop" | "screen" | "interrupt"; child: string }
  | {
      kind: "input";
      child: string;
      text?: string;
      enter?: boolean;
      key?: TeamInputKey;
    }
  | {
      kind: "send";
      child: string;
      type: "answer" | "request" | "revise";
      body: string;
    }
  | {
      kind: "finish";
      child: string;
      decision: "accept" | "reject";
      reason: string;
      worktree: "keep" | "remove";
      discard: boolean;
    }
  | { kind: "report" | "ask"; body: string };
const fields: Record<string, string[]> = {
  delegate: [
    "role",
    "difficulty",
    "title",
    "body",
    "worktree",
    "repo",
    "continue",
    "plan",
  ],
  plan: [
    "body",
    "request",
    "title",
    "first",
    "after",
    "state",
    "checkpoint",
    "reason",
  ],
  tasks: [],
  read: [],
  stop: [],
  screen: [],
  interrupt: [],
  input: ["text", "enter", "key"],
  send: ["kind", "body"],
  finish: ["decision", "reason", "worktree", "discard"],
  report: ["body"],
  ask: ["body"],
};
const booleanFields = new Set(["discard", "request", "first", "enter"]);
/** Whether `iori NAME` is a team command, which only a team conversation can use. */
export function isTeamCommand(name: unknown): boolean {
  return typeof name === "string" && Object.hasOwn(fields, name);
}
export function parseCommand(argv: unknown): TeamCommand {
  if (
    !Array.isArray(argv) ||
    argv.some((v) => typeof v !== "string" || v.includes("\0"))
  )
    throw new Error("Invalid command arguments.");
  const [kind, ...args] = argv as string[];
  if (!kind || !Object.hasOwn(fields, kind)) throw new Error(commandHelp);
  const stringOptions = new Set(
    fields[kind]!.filter((name) => !booleanFields.has(name)).map(
      (name) => `--${name}`,
    ),
  );
  const normalizedArgs: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    const next = args[index + 1];
    if (argument === "--") {
      normalizedArgs.push(...args.slice(index));
      break;
    }
    if (stringOptions.has(argument) && next !== undefined && next !== "--") {
      normalizedArgs.push(`${argument}=${next}`);
      index++;
    } else {
      normalizedArgs.push(argument);
    }
  }
  const { values, positionals } = parseArgs({
    args: normalizedArgs,
    allowPositionals: true,
    options: Object.fromEntries(
      fields[kind]!.map((name) => [
        name,
        {
          type: booleanFields.has(name)
            ? ("boolean" as const)
            : ("string" as const),
        },
      ]),
    ),
  });
  const text = (name: string) => {
    const value = values[name];
    if (typeof value !== "string" || !value.trim())
      throw new Error(`Required: --${name}.`);
    return value;
  };
  const oneOf = <T extends string>(name: string, options: readonly T[]): T => {
    const value = text(name);
    if (!options.includes(value as T))
      throw new Error(`--${name}: ${options.join("|")}.`);
    return value as T;
  };
  const number = (value: string, name: string): number => {
    const n = Number(value);
    if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(n))
      throw new Error(`Expected a task number: ${name}.`);
    return n;
  };
  if (kind === "plan") {
    const [action, task] = positionals;
    if (
      positionals.length !==
      (["move", "update", "cancel"].includes(action ?? "") ? 2 : 1)
    )
      throw new Error(commandHelp);
    switch (action) {
      case "show":
        return { kind, action };
      case "goal":
        return {
          kind,
          action,
          body: text("body"),
          request: values.request === true,
        };
      case "add": {
        const first = values.first === true;
        if (first && values.after !== undefined)
          throw new Error("Specify either --first or --after, not both.");
        return {
          kind,
          action,
          title: text("title"),
          first,
          ...(values.after !== undefined
            ? { after: number(text("after"), "after") }
            : {}),
          request: values.request === true,
        };
      }
      case "move": {
        const target = number(task!, "task");
        const first = values.first === true;
        if (first && values.after !== undefined)
          throw new Error("Specify either --first or --after, not both.");
        if (!first && values.after === undefined)
          throw new Error("Required: --first or --after.");
        const after =
          values.after !== undefined
            ? number(text("after"), "after")
            : undefined;
        if (after === target)
          throw new Error("Cannot move a plan task after itself.");
        return {
          kind,
          action,
          number: target,
          first,
          ...(after !== undefined ? { after } : {}),
        };
      }
      case "update":
        return {
          kind,
          action,
          number: number(task!, "task"),
          ...(values.state
            ? {
                state: oneOf("state", [
                  "pending",
                  "in_progress",
                  "done",
                ] as const),
              }
            : {}),
          ...(values.checkpoint !== undefined
            ? { checkpoint: String(values.checkpoint) }
            : {}),
          ...(values.title ? { title: text("title") } : {}),
        };
      case "cancel":
        return {
          kind,
          action,
          number: number(task!, "task"),
          reason: text("reason"),
        };
      default:
        throw new Error(commandHelp);
    }
  }
  const needsChild = [
    "read",
    "stop",
    "screen",
    "interrupt",
    "send",
    "finish",
    "input",
  ].includes(kind);
  if (positionals.length !== (needsChild ? 1 : 0))
    throw new Error(
      needsChild ? "Specify one child ID." : "Unexpected positional arguments.",
    );
  switch (kind) {
    case "delegate":
      return {
        kind,
        role: text("role"),
        difficulty: oneOf("difficulty", ["high", "medium", "low"]),
        title: text("title"),
        body: text("body"),
        worktree: text("worktree"),
        ...(values.repo !== undefined ? { repo: text("repo") } : {}),
        ...(values.continue ? { continuation: text("continue") } : {}),
        ...(values.plan ? { plan: number(text("plan"), "plan") } : {}),
      };
    case "tasks":
      return { kind };
    case "read":
    case "stop":
    case "screen":
    case "interrupt":
      return { kind, child: positionals[0]! };
    case "input": {
      const hasText = values.text !== undefined;
      const hasKey = values.key !== undefined;
      const enter = values.enter === true;
      if (hasText === hasKey)
        throw new Error("Specify one of --text or --key.");
      if (hasKey) {
        if (enter) throw new Error("--enter cannot be combined with --key.");
        return {
          kind,
          child: positionals[0]!,
          key: oneOf("key", teamInputKeys),
        };
      }
      const value = values.text;
      if (typeof value !== "string" || value.length === 0)
        throw new Error("Required: --text.");
      return {
        kind,
        child: positionals[0]!,
        text: value,
        enter,
      };
    }
    case "send":
      return {
        kind,
        child: positionals[0]!,
        type: oneOf("kind", ["answer", "request", "revise"]),
        body: text("body"),
      };
    case "finish":
      return {
        kind,
        child: positionals[0]!,
        decision: oneOf("decision", ["accept", "reject"]),
        reason: text("reason"),
        worktree: oneOf("worktree", ["keep", "remove"]),
        discard: values.discard === true,
      };
    case "report":
    case "ask":
      return { kind, body: text("body") };
    default:
      throw new Error(commandHelp);
  }
}
