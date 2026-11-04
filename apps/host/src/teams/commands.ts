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
export const commandHelp = `iori delegate --role NAME --difficulty high|medium|low --title TITLE --worktree new|parent|NAME [--repo PATH] --body TEXT [--continue TASK_ID] [--plan N]
iori plan show
iori plan goal --body TEXT [--request]
iori plan add --title TITLE [--after N] [--request]
iori plan update N [--state pending|in_progress|done] [--checkpoint TEXT] [--title TITLE]
iori plan cancel N --reason TEXT
iori tasks
iori read CHILD_ID
iori send CHILD_ID --kind answer|request|revise --body TEXT
iori finish CHILD_ID --decision accept|reject --reason TEXT --worktree keep|remove [--discard]
iori stop CHILD_ID
iori report --body TEXT
iori ask --body TEXT
${forgeCommandUsage}
For body: --file PATH (inside the working directory) or --body - (stdin). ${commandFooter}`;
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
      after?: number;
      request: boolean;
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
  | { kind: "read" | "stop"; child: string }
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
  plan: ["body", "request", "title", "after", "state", "checkpoint", "reason"],
  tasks: [],
  read: [],
  stop: [],
  send: ["kind", "body"],
  finish: ["decision", "reason", "worktree", "discard"],
  report: ["body"],
  ask: ["body"],
};
const booleanFields = new Set(["discard", "request"]);
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
      (["update", "cancel"].includes(action ?? "") ? 2 : 1)
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
      case "add":
        return {
          kind,
          action,
          title: text("title"),
          ...(values.after ? { after: number(text("after"), "after") } : {}),
          request: values.request === true,
        };
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
  const needsChild = ["read", "stop", "send", "finish"].includes(kind);
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
      return { kind, child: positionals[0]! };
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
