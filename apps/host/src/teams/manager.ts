import { creationOrder } from "@iori/protocol";
import { discoverRepository, hasHead } from "../git-reading.ts";
import {
  inventory,
  worktreeSetup,
  worktreeOptions,
} from "../worktree-creation.ts";
import type { WorktreeSetup } from "../store.ts";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  type CliStatus,
  type RecordsFilter,
  childTeamText,
  childRequestText,
  parentTeamText,
  previousWorkerText,
  teamCheckInNotice,
  teamBackgroundWakeNotice,
  defaultBackgroundWakeMinutes,
  teamNotice,
  teamPlanReminder,
  teamStallNotice,
  updateTeamCommandLocation,
  type Candidate,
  type ChildSummary,
  type Event,
  type Response,
  type TeamStallReason,
  type TerminalCreatedResult,
} from "@iori/protocol";
import type { HostStore, StoreContext } from "../store.ts";
import { cliDefinitions } from "../cli/definitions.ts";
import type { HookState } from "../cli/hooks.ts";
import {
  TerminalManager,
  type TeamTerminalOptions,
} from "../terminal/manager.ts";
import { collectGit } from "../git-process.ts";
import { copyDeliveryFile } from "../fs/delivery-file.ts";
import {
  childAfterExit,
  childHasEnded,
  responseAfterCliState,
  childAfterStart,
  needsResume,
} from "./child-lifecycle.ts";
import { TeamQueries } from "./queries.ts";
import { applyPlanCommand, startPlanTask } from "./plan.ts";
import {
  assignmentRole,
  chooseCandidate,
  roleCandidates,
} from "./assignment.ts";
import { PendingCliStates } from "./pending-cli-states.ts";
import {
  assignedCandidate,
  launchCandidate,
  sameAssignment,
  type AssignedCandidate,
  type TeamChild,
  type TeamConversation,
  type TeamTask,
} from "./records.ts";
import type { TeamCommand } from "./commands.ts";
import {
  type LocalTeamCommand,
  type Caller,
  type CommandResult,
} from "./local-command.ts";
import {
  NO_COMMITS_FOR_NEW_WORKTREE,
  childWorktree,
  isResidualChildWorktree,
  removeChildWorktree,
  worktreeChanges,
} from "./worktrees.ts";
import {
  recordWorktreeAccepted,
  worktreeDirectory,
} from "../worktree-state.ts";
import { stopWatchingPath } from "../directory-watch.ts";
import { removeRemainingWorktreeFolder } from "../worktree-residual.ts";

const ok = (text: string, data?: unknown): CommandResult => ({
  ok: true,
  text,
  ...(data === undefined ? {} : { data }),
});

const interruptKeys = {
  esc: { sequence: "\u001b", keyName: "escape" },
  "ctrl-c": { sequence: "\u0003", keyName: "ctrl-c" },
  "double-esc": { sequence: "\u001b\u001b", keyName: "escape escape" },
  "separate-esc": { sequence: "\u001b", keyName: "escape escape" },
};
const DEFAULT_CHECK_MINUTE_MS = 60_000;
const DEFAULT_CHECK_POLL_MS = 5_000;

function checkInTiming(): { minuteMs: number; pollMs: number } {
  const raw = process.env.IORI_TEST_CHECK_MINUTE_MS;
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      minuteMs: DEFAULT_CHECK_MINUTE_MS,
      pollMs: DEFAULT_CHECK_POLL_MS,
    };
  }
  return {
    minuteMs: parsed,
    pollMs: Math.max(
      15,
      Math.min(DEFAULT_CHECK_POLL_MS, Math.floor((parsed * 15) / 4)),
    ),
  };
}

export class TeamManager {
  readonly #conversations = new Map<string, TeamConversation>();
  readonly #children = new Map<string, TeamChild>();
  readonly #conversationChildren = new Map<string, Set<string>>();
  readonly #worktreeChildren = new Map<string, Set<string>>();
  readonly #terminalChildren = new Map<string, TeamChild>();
  readonly #tasks = new Map<string, TeamTask>();
  readonly #storedChildren = new Map<string, string>();
  readonly #publishedChildren = new Map<string, string>();
  readonly #queries: TeamQueries;
  readonly #gitReadings = new Map<
    string,
    Promise<import("@iori/protocol").Changes>
  >();
  readonly #routes = new Map<
    string,
    Awaited<ReturnType<LocalTeamCommand["register"]>>
  >();
  readonly #serials = new Map<string, Promise<void>>();
  #allocation = Promise.resolve();
  readonly #startups = new Map<TeamChild, Promise<void>>();
  readonly #creatingTerminals = new Set<TeamChild>();
  readonly #pendingCliStates = new PendingCliStates<HookState>();
  // Allocation runs before delegate can report its result to the caller.
  readonly #delegating = new Set<string>();
  readonly #workStarted = new Map<string, number>();
  readonly #cliFailures = new Set<string>();
  readonly #cliStates = new Map<string, CliStatus["state"]>();
  readonly #notifiedStalls = new Map<string, number>();
  readonly #checkBaselines = new Map<string, number>();
  readonly #planRevisions = new Map<string, number>();
  readonly #lastNotice = new Map<string, { at: number; revision: number }>();
  #checkTimer: NodeJS.Timeout | undefined;
  readonly #backgroundWakes = new Map<
    string,
    { since: number; sentAt: number; pending: boolean }
  >();
  #draining = false;
  #drainRequested = false;
  #closed = false;
  readonly store: HostStore;
  readonly terminals: TerminalManager;
  readonly root: string;
  readonly publish: (event: Event) => void;
  private constructor(
    store: HostStore,
    terminals: TerminalManager,
    root: string,
    publish: (event: Event) => void,
  ) {
    this.publish = publish;
    this.store = store;
    this.terminals = terminals;
    this.root = root;
    this.#queries = new TeamQueries({
      store,
      terminals,
      conversations: this.#conversations,
      children: this.#children,
      tasks: this.#tasks,
      conversationChildren: this.#conversationChildren,
      workStarted: this.#workStarted,
      replyState: (child) => this.#replyState(child),
    });
    terminals.onTeamCommand = (caller, command) => {
      const child = caller.child
        ? this.#children.get(caller.child)
        : "child" in command
          ? this.#children.get(command.child)
          : undefined;
      const key =
        child?.conversation === caller.conversation
          ? child.id
          : caller.conversation;
      return this.#run(() => this.#execute(caller, command), key);
    };
    terminals.onTeamTerminal = (caller) =>
      caller.child
        ? this.#children.get(caller.child)?.terminalId
        : this.#conversations.get(caller.conversation)?.terminalId;
    for (const c of store.teamConversations()) this.#conversations.set(c.id, c);
    for (const c of store.teamChildren()) {
      this.#children.set(c.id, c);
      this.#storedChildren.set(c.id, JSON.stringify(c));
      this.#indexChild(c);
      // Only a fresh observation can start an interval after Host downtime.
      const state = c.terminalId
        ? terminals.summary(c.terminalId)?.cliStatus?.state
        : undefined;
      if (state) this.#cliStates.set(c.id, state);
      if (
        c.state === "failed" &&
        c.terminalId &&
        terminals.summary(c.terminalId)?.cliStatus?.outcome === "failure"
      )
        this.#cliFailures.add(c.id);
      if (c.workMs !== undefined && this.#isWorking(c))
        this.#workStarted.set(c.id, Date.now());
    }
    for (const task of store.teamTasks()) {
      // Earlier saved tasks had no explicit active revision pointer.
      task.currentChild ??= [...this.#children.values()]
        .filter((child) => child.task === task.id)
        .sort((a, b) => a.createdAt - b.createdAt)
        .at(-1)?.id;
      this.#tasks.set(task.id, task);
    }
  }
  static async create(
    store: HostStore,
    terminals: TerminalManager,
    root: string,
    publish: (event: Event) => void = () => {},
  ): Promise<TeamManager> {
    const manager = new TeamManager(store, terminals, root, publish);
    for (const child of manager.#children.values()) {
      if (!child.pendingWorktree) continue;
      if (child.state === "waiting") {
        child.state = "stopped";
        child.stoppedBy = "host_restart";
      }
      await manager.#recoverChildWorktree(child);
      manager.#saveChild(child);
    }
    terminals.onRestoreTeamTerminals = (id) => manager.#restoreTerminals(id);
    await manager.#restoreTerminals();
    if (!terminals.continuedTerminals) manager.#markLostTerminals();
    terminals.onTerminalsLost = () => {
      manager.#markLostTerminals();
      manager.conditionsChanged();
    };
    terminals.onCliExit = (id, reason) => {
      const childKey = manager.#terminalChildren.get(id)?.id ?? id;
      return manager
        .#run(async () => {
          const child = manager.#terminalChildren.get(id);
          if (child && child.startedAt !== undefined) {
            await manager.#measureChild(child);
            manager.#elapsed(child);
            manager.#dispose(child.id);
            manager.#saveChild(child);
          }
          const transition = child && childAfterExit(child.state, reason);
          if (child && transition) {
            Object.assign(child, transition);
            if (transition.state === "failed")
              await manager.#notice(child, "failed");
            manager.#dispose(child.id);
            manager.#saveChild(child);
          }
          if (!child) {
            const parent = [...manager.#conversations.values()].find(
              (c) => c.terminalId === id,
            );
            if (parent) {
              // Keep the command route for reopening this parent conversation.
              for (const queued of manager.#children.values()) {
                if (
                  queued.conversation !== parent.id ||
                  queued.state !== "waiting"
                )
                  continue;
                queued.state = "stopped";
                queued.stoppedBy = "parent_exit";
                delete queued.waiting;
                manager.#saveChild(queued);
              }
            }
          }
          manager.conditionsChanged();
        }, childKey)
        .catch(() => {
          console.error("Team CLI notification failed");
        });
    };
    terminals.onCliState = (id, state) => {
      const registered = manager.#terminalChildren.get(id);
      // Capture before choosing a serial key: registration changes it to child ID.
      if (!registered && manager.#creatingTerminals.size) {
        const conversationId = manager.terminals.summary(id)?.teamConversation;
        const parent =
          conversationId && manager.#conversations.get(conversationId);
        if (parent && parent.terminalId !== id) {
          manager.#pendingCliStates.add(id, state);
          return;
        }
      }
      const childKey = registered?.id ?? id;
      return manager
        .#run(async () => {
          const child = manager.#terminalChildren.get(id);
          if (!child) {
            const conversation = [...manager.#conversations.values()].find(
              (entry) => entry.terminalId === id,
            );
            if (conversation && state.state === "active") {
              conversation.lastActiveAt = Date.now();
              manager.store.putTeamConversation(conversation);
            }
            return;
          }
          await manager.#applyCliState(child, state);
        }, childKey)
        .catch(() => {
          console.error("Team CLI notification failed");
        });
    };
    terminals.onSetupFailed = (id, exitCode) =>
      manager.#run(
        async () => {
          const child = manager.#terminalChildren.get(id);
          if (!child || childHasEnded(child.state)) return;
          child.state = "failed";
          child.failure = `Setup command failed (exit ${exitCode})`;
          manager.#elapsed(child);
          manager.#dispose(child.id);
          manager.#saveChild(child);
          await manager.#notice(child, "failed");
          manager.conditionsChanged();
        },
        manager.#terminalChildren.get(id)?.id ?? id,
      );
    terminals.onCliInput = (id) => {
      const child = manager.#terminalChildren.get(id);
      if (child) {
        manager.#notifiedStalls.delete(child.id);
        if (!child.userInput || child.parentResponse !== undefined) {
          delete child.parentResponse;
          child.userInput = true;
          manager.#saveChild(child);
        }
      }
    };
    terminals.onCliStallCleared = (id) => {
      const child = manager.#terminalChildren.get(id);
      if (!child) return;
      manager.#notifiedStalls.delete(child.id);
      // A check-in counts time without a report or a stall notice.
      if (manager.#checkBaselines.has(child.id))
        manager.#checkBaselines.set(child.id, Date.now());
    };
    terminals.onCliStalled = (stalled) => {
      const byConversation = new Map<
        string,
        {
          child: TeamChild;
          since: number;
          role?: string;
          title: string;
          childId: string;
          reason: TeamStallReason;
        }[]
      >();
      for (const item of stalled) {
        const child = manager.#terminalChildren.get(item.id);
        if (!child || ["finished", "stopped"].includes(child.state)) continue;
        const current = manager.terminals.summary(item.id)?.cliStatus;
        if (current?.state !== "active" || current.stalledSince !== item.since)
          continue;
        if (manager.#notifiedStalls.get(child.id) === item.since) continue;
        manager.#notifiedStalls.set(child.id, item.since);
        if (manager.#checkBaselines.has(child.id))
          manager.#checkBaselines.set(child.id, item.since);
        let group = byConversation.get(child.conversation);
        if (!group) {
          group = [];
          byConversation.set(child.conversation, group);
        }
        group.push({
          child,
          since: item.since,
          role: child.role?.name ?? child.roleName,
          title: child.title,
          childId: child.id,
          reason: item.reason,
        });
      }
      for (const [conversationId, entries] of byConversation) {
        void manager
          .#run(async () => {
            const pending = entries.filter((entry) => {
              if (manager.#closed) return false;
              if (["finished", "stopped"].includes(entry.child.state))
                return false;
              const current = entry.child.terminalId
                ? manager.terminals.summary(entry.child.terminalId)?.cliStatus
                : undefined;
              return (
                current?.state === "active" &&
                current.stalledSince === entry.since
              );
            });
            if (pending.length === 0) return;
            const parent = manager.#conversation(conversationId).terminalId;
            if (!manager.terminals.isCliRunning(parent)) return;
            await manager.#sendParentNotice(
              conversationId,
              teamStallNotice(pending),
            );
          }, `stall-notice:${conversationId}`)
          .catch(() => {
            console.error("Team CLI stall notification failed");
          });
      }
    };
    terminals.onCliProcessesChanged = () => manager.conditionsChanged();
    terminals.onDelivered = (file) => {
      for (const child of manager.#children.values())
        if (child.pendingMessageFiles?.includes(file))
          manager.#delivered(child, file);
    };
    terminals.onUsageChanged = () => manager.conditionsChanged();
    for (const child of manager.#children.values())
      for (const file of child.pendingMessageFiles ?? [])
        terminals.bindDelivery(
          file,
          () => manager.#delivered(child, file),
          child.terminalId,
        );
    // A continuing CLI can finish while Host is restarting, before team handlers
    // are attached. Reconcile the adapter's recovered failure once here.
    for (const child of manager.#children.values()) {
      if (!child.terminalId) continue;
      const state = terminals.summary(child.terminalId)?.cliStatus;
      if (state?.outcome === "failure")
        await terminals.onCliState(child.terminalId, state);
      if (
        !childHasEnded(child.state) &&
        (terminals.summary(child.terminalId)?.cliStatus?.state === "active" ||
          (!state && child.state === "running"))
      ) {
        const current = terminals.summary(child.terminalId)?.cliStatus;
        if (current) manager.#cliStates.set(child.id, "active");
        manager.#checkBaselines.set(
          child.id,
          Math.max(
            current?.since ?? child.startedAt ?? Date.now(),
            child.reportedAt ?? 0,
            child.questionedAt ?? 0,
          ),
        );
      }
    }
    manager.#scheduleCheckIn();
    await terminals.activateTeamEvents();
    return manager;
  }
  async #applyCliState(child: TeamChild, state: HookState): Promise<void> {
    if (state.state !== "active" || state.stalledSince === undefined)
      this.#notifiedStalls.delete(child.id);
    if (
      state.state === "active" &&
      child.state === "failed" &&
      this.#cliFailures.has(child.id)
    ) {
      child.state = "running";
      this.#cliFailures.delete(child.id);
      delete child.failure;
      delete child.cliError;
    }
    if (state.state === "active" && !childHasEnded(child.state)) {
      if (!this.#checkBaselines.has(child.id)) {
        this.#checkBaselines.set(
          child.id,
          Math.max(Date.now(), child.reportedAt ?? 0, child.questionedAt ?? 0),
        );
        this.#scheduleCheckIn();
      }
    } else {
      this.#checkBaselines.delete(child.id);
    }
    this.#scheduleCheckIn();
    this.#cliStates.set(child.id, state.state);
    this.#saveChild(child);
    await this.#measureChild(child);
    const previous = child.parentResponse;
    child.parentResponse = responseAfterCliState(child, state);
    if (
      child.parentResponse === "unreported" &&
      child.parentResponse !== previous
    ) {
      this.#saveChild(child);
      await this.#notice(child, "is idle without a report or question");
    }
    this.#saveChild(child);
    if (
      state.outcome !== "failure" ||
      !["running", "question"].includes(child.state)
    )
      return;
    const failure = state.failure ?? child.failure ?? "CLI reported a failure.";
    this.#cliFailures.add(child.id);
    child.state = "failed";
    child.failure = failure;
    child.cliError = true;
    this.#saveChild(child);
    await this.#notice(child, "failed");
  }
  #markLostTerminals() {
    for (const child of this.#children.values()) {
      if (child.terminalId && this.terminals.isCliRunning(child.terminalId))
        continue;
      if (
        (child.startedAt !== undefined || child.state === "waiting") &&
        child.state !== "finished"
      ) {
        child.state = "stopped";
        child.stoppedBy = "host_restart";
        delete child.waiting;
        // A crash gives no CLI exit time. Do not count Host downtime as work
        // or let a later successful resume fill the missing measurement.
        delete child.startedAt;
        delete child.elapsedMs;
        child.elapsedUnavailable = true;
        this.#cliStates.delete(child.id);
        this.#saveChild(child);
      }
      if (child.terminalId && child.state !== "finished") {
        const record = this.store.terminal(child.terminalId);
        if (record) {
          record.state = "error";
          record.restartPending = false;
          this.store.putTerminal(record);
        }
      }
    }
  }
  #indexChild(child: TeamChild): void {
    const parent = this.#conversation(child.conversation);
    for (const [index, key] of [
      [this.#conversationChildren, child.conversation],
      [this.#worktreeChildren, parent.cwd],
    ] as const) {
      let ids = index.get(key);
      if (!ids) index.set(key, (ids = new Set()));
      ids.add(child.id);
    }
    if (child.terminalId) {
      this.#terminalChildren.set(child.terminalId, child);
      this.terminals.identifyTeamChild(
        child.terminalId,
        child.id,
        child.conversation,
      );
    }
  }
  listChildren(query: { conversation?: string; cwd?: string } = {}): {
    children: ChildSummary[];
  } {
    const ids =
      query.conversation !== undefined
        ? (this.#conversationChildren.get(query.conversation) ?? [])
        : query.cwd !== undefined
          ? (this.#worktreeChildren.get(query.cwd) ?? [])
          : this.#children.keys();
    const teams = new Map<string, ReturnType<HostStore["readTeam"]>>();
    return {
      children: [...ids]
        .map((id) => this.#children.get(id)!)
        .map((child) => this.#queries.childSummary(child, teams)),
    };
  }
  #isWorking(child: TeamChild): boolean {
    if (this.#closed) return false;
    if (child.startedAt === undefined) return false;
    if (!["running", "question", "reported"].includes(child.state))
      return false;
    if (!child.terminalId || !this.terminals.isCliRunning(child.terminalId))
      return false;
    const state =
      this.#cliStates.get(child.id) ??
      this.terminals.summary(child.terminalId)?.cliStatus?.state;
    return (
      state === "active" || (state === undefined && child.state === "running")
    );
  }
  #measureWork(child: TeamChild): void {
    // Missing means a task recorded before work-time measurement was introduced.
    if (child.workMs === undefined) return;
    const now = Date.now();
    const started = this.#workStarted.get(child.id);
    if (started !== undefined) child.workMs += Math.max(0, now - started);
    if (this.#isWorking(child)) this.#workStarted.set(child.id, now);
    else this.#workStarted.delete(child.id);
  }
  #storeChild(child: TeamChild): void {
    this.#measureWork(child);
    this.#indexChild(child);
    const stored = JSON.stringify(child);
    if (this.#storedChildren.get(child.id) !== stored) {
      this.store.putTeamChild(child);
      this.#storedChildren.set(child.id, stored);
    }
  }
  #saveChild(child: TeamChild): void {
    this.#storeChild(child);
    this.#publishChild(child);
  }
  #publishChild(child: TeamChild): void {
    const summary = this.#queries.childSummary(child, new Map());
    const published = JSON.stringify(summary);
    if (this.#publishedChildren.get(child.id) !== published) {
      this.publish({ type: "teams.child.updated", child: summary });
      this.#publishedChildren.set(child.id, published);
    }
  }
  async #measureChild(child: TeamChild): Promise<void> {
    await this.#measureChildren([child], false, true);
  }
  async #measureChildren(
    children: TeamChild[],
    periodic = false,
    /** Use the last value of a definition's script and measure in the
     * background, so a script that does not return does not hold a command
     * or screen. */
    backgroundScripts = false,
  ): Promise<void> {
    await Promise.all(
      children.map(async (child) => {
        if (!child.terminalId) {
          this.#saveChild(child);
          return;
        }
        const terminalId = child.terminalId;
        const measured = this.terminals
          .sessionTokens(terminalId)
          .then((tokens) => {
            if (
              tokens &&
              (!periodic || this.terminals.isCliRunning(terminalId))
            )
              child.tokens = tokens;
            this.#saveChild(child);
          });
        if (backgroundScripts && this.terminals.usesScriptTokens(terminalId)) {
          void measured.catch(() => {});
          this.#saveChild(child);
          return;
        }
        await measured;
      }),
    );
    const groups = new Map<string, TeamChild[]>();
    for (const child of children) {
      if (!child.cwd || !child.baseCommit) continue;
      const group = groups.get(child.cwd) ?? [];
      group.push(child);
      groups.set(child.cwd, group);
    }
    await Promise.all(
      [...groups].map(async ([cwd, group]) => {
        const active = [...this.#children.values()].filter(
          (other) =>
            other.cwd === cwd &&
            this.terminals.isCliRunning(other.terminalId ?? ""),
        );
        const source = active.find((child) => child.baseCommit) ?? group[0]!;
        try {
          const reading =
            this.#gitReadings.get(cwd) ??
            worktreeChanges(cwd, source.baseCommit!);
          this.#gitReadings.set(cwd, reading);
          let changes: import("@iori/protocol").Changes;
          try {
            changes = await reading;
          } finally {
            if (this.#gitReadings.get(cwd) === reading)
              this.#gitReadings.delete(cwd);
          }
          const branch =
            (
              await collectGit(
                cwd,
                ["symbolic-ref", "--quiet", "--short", "HEAD"],
                undefined,
                [0, 1],
              )
            ).stdout
              .toString("utf8")
              .trim() || undefined;
          for (const child of new Set([...group, ...active])) {
            if (
              periodic &&
              !this.terminals.isCliRunning(child.terminalId ?? "")
            )
              continue;
            child.branch = branch;
            child.changes = changes;
            this.#saveChild(child);
          }
        } catch {
          /* Keep a completed measurement; never substitute zero. */
        }
      }),
    );
  }
  boards() {
    return this.#queries.boards();
  }
  board(cwd: string) {
    return this.#queries.board(cwd, (active) =>
      this.#run(
        () => this.#measureChildren(active, true, true),
        `board:${cwd}`,
      ),
    );
  }
  records(filter: RecordsFilter) {
    return this.#queries.records(filter);
  }
  taskHistory(id: string) {
    return this.#queries.taskHistory(id);
  }
  #replyState(child: TeamChild): TeamChild["state"] | "starting" {
    return this.#startups.has(child) && child.state === "waiting"
      ? "starting"
      : child.state;
  }
  async forgetWorktree(path: string): Promise<void> {
    const ids: string[] = [];
    const conversations = new Set(
      [...this.#conversations.values()]
        .filter((value) => relative(value.cwd, path) === "")
        .map((value) => value.id),
    );
    for (const child of this.#children.values()) {
      if (
        !conversations.has(child.conversation) &&
        (!child.cwd || relative(child.cwd, path) !== "")
      )
        continue;
      this.#dispose(child.id);
      this.#children.delete(child.id);
      this.#workStarted.delete(child.id);
      this.#cliStates.delete(child.id);
      this.#storedChildren.delete(child.id);
      this.#publishedChildren.delete(child.id);
      for (const index of [this.#conversationChildren, this.#worktreeChildren])
        for (const ids of index.values()) ids.delete(child.id);
      if (child.terminalId) this.#terminalChildren.delete(child.terminalId);
      this.store.removeTeamChild(child.id);
      ids.push(child.id);
    }
    for (const task of this.#tasks.values())
      if (conversations.has(task.conversation)) {
        this.#tasks.delete(task.id);
        this.store.removeTeamTask(task.id);
      }
    for (const id of conversations) {
      this.#conversations.delete(id);
      this.store.removeTeamConversation(id);
    }
    this.publish({ type: "teams.children.removed", ids });
    const filesRoot = resolve(this.root, "team-files");
    for (const id of [...ids, ...conversations]) {
      const directory = resolve(filesRoot, id);
      if (dirname(directory) !== filesRoot) {
        console.error("Team files cleanup failed: invalid directory");
        continue;
      }
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        console.error("Team files cleanup failed", error);
      }
    }
  }

  async stopChild(
    context: StoreContext,
    id: string,
  ): Promise<Response<{ childId: string }>> {
    return this.#run(async () => {
      const previous = this.store.terminalOperationResult<{ childId: string }>(
        context,
      );
      if (previous) return { ok: true, result: previous };
      const child = this.#children.get(id);
      if (!child) return { ok: false, error: { code: "invalid_request" } };
      if (child.state !== "finished") {
        await this.#stopChild(child, "user");
        this.conditionsChanged();
      }
      const result = { childId: id };
      this.store.saveTerminalOperationResult(context, result);
      return { ok: true, result };
    }, id);
  }
  #run<T>(action: () => Promise<T>, key = "host"): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("Host is stopping."));
    const operation = (this.#serials.get(key) ?? Promise.resolve()).then(
      action,
    );
    const tail = operation.then(
      () => {},
      () => {},
    );
    this.#serials.set(key, tail);
    void tail.then(() => {
      if (this.#serials.get(key) === tail) this.#serials.delete(key);
    });
    return operation;
  }
  conditionsChanged(): void {
    if (this.#closed) return;
    this.#scheduleCheckIn();
    this.#drainRequested = true;
    if (this.#draining) return;
    this.#draining = true;
    this.#allocation = Promise.resolve()
      .then(async () => {
        try {
          while (this.#drainRequested && !this.#closed) {
            this.#drainRequested = false;
            await this.#drain();
          }
        } finally {
          this.#draining = false;
        }
      })
      .catch(() => {
        /* A later change retries assignment; commands remain usable. */
      });
  }
  async #restoreTerminals(terminalId?: string): Promise<void> {
    for (const c of this.#conversations.values()) {
      if (terminalId && c.terminalId !== terminalId) continue;
      if (!this.store.terminal(c.terminalId)) continue;
      const running = this.terminals.isCliRunning(c.terminalId);
      const configure =
        Boolean(terminalId) ||
        running ||
        Boolean(this.store.terminalSetup(c.terminalId));
      try {
        let instructions: string | ((directory: string) => string);
        try {
          instructions = await readFile(c.instructionFile, "utf8");
        } catch {
          // Rebuild a missing file from the team version this conversation
          // started with, the same way a launch writes it.
          const team = this.store
            .readTeam(c.teamId)
            ?.history.find(
              (entry) => entry.team.version === c.teamVersion,
            )?.team;
          if (!team) {
            this.terminals.markTeamTerminalUnrestored(c.terminalId);
            continue;
          }
          instructions = (directory) =>
            parentTeamText(team, {
              directory,
              windows: process.platform === "win32",
            });
          await mkdir(dirname(c.instructionFile), {
            recursive: true,
            mode: 0o700,
          });
          await writeFile(c.instructionFile, "", { mode: 0o600, flag: "wx" });
        }
        // Rebuild a missing instruction file at startup. A stopped parent
        // receives its launch environment when its Terminal is reopened.
        if (!configure && typeof instructions === "string") continue;
        const options = await this.#options(
          { conversation: c.id },
          c.parent,
          c.instructionFile,
          instructions,
          undefined,
          Boolean(terminalId) || running,
        );
        if (configure)
          this.terminals.configureTeamTerminal(c.terminalId, options);
      } catch {
        this.terminals.markTeamTerminalUnrestored(c.terminalId);
      }
    }
    for (const child of this.#children.values()) {
      if (
        (terminalId && child.terminalId !== terminalId) ||
        !child.terminalId ||
        !child.candidate ||
        !child.instructionFile ||
        !this.terminals.isCliRunning(child.terminalId)
      )
        continue;
      try {
        const instructions = await readFile(child.instructionFile, "utf8");
        this.terminals.configureTeamTerminal(
          child.terminalId,
          await this.#options(
            { conversation: child.conversation, child: child.id },
            child.candidate,
            child.instructionFile,
            instructions,
            undefined,
            true,
          ),
        );
      } catch {
        this.terminals.markTeamTerminalUnrestored(child.terminalId);
      }
    }
  }
  async #options(
    caller: Caller,
    candidate: Candidate | AssignedCandidate,
    instructionFile: string,
    instructions: string | ((directory: string) => string),
    initial?: (directory: string) => Promise<string>,
    preserveRoute = false,
  ): Promise<TeamTerminalOptions> {
    const key = caller.child ?? caller.conversation;
    if (!preserveRoute) this.#dispose(key);
    const route = await this.terminals.registerCommand(
      caller,
      this.terminals.teamCommandDirectory(candidate.cli),
    );
    this.#routes.set(key, route);
    const commandDirectory = route.env.IORI_COMMAND_BIN!;
    const deliveryDirectory = route.env.IORI_TEAM_FILES_DIRECTORY!;
    if (typeof instructions === "function") {
      instructions = instructions(commandDirectory);
      await writeFile(instructionFile, instructions, { mode: 0o600 });
    }
    instructions = updateTeamCommandLocation(
      instructions,
      commandDirectory,
      process.platform === "win32",
    );
    // Canonical files stay in Host storage; route retirement removes all copies.
    const deliveredInstruction = await copyDeliveryFile(
      instructionFile,
      deliveryDirectory,
      instructions,
    );
    const initialInput = await initial?.(deliveryDirectory);
    const child = caller.child ? this.#children.get(caller.child) : undefined;
    const role = child?.roleId;
    return {
      team: {
        candidate: launchCandidate(candidate),
        instructionFile: deliveredInstruction,
        trustWorkspace: false,
        teamFilesDirectory: deliveryDirectory,
        commandDirectory,
        commandMailboxDirectory: route.env.IORI_COMMAND_DIRECTORY!,
        instructions,
        ...(initialInput ? { initial: initialInput } : {}),
      },
      env: route.env,
      conversation: caller.conversation,
      ...(role ? { role } : {}),
    };
  }
  #clearCheckTimer(): void {
    if (this.#checkTimer) {
      clearTimeout(this.#checkTimer);
      this.#checkTimer = undefined;
    }
  }
  #scheduleCheckIn(): void {
    if (this.#closed || this.#checkTimer) return;
    let hasEligible = false;
    for (const childId of [...this.#checkBaselines.keys()]) {
      const child = this.#children.get(childId);
      if (!child || childHasEnded(child.state)) {
        this.#checkBaselines.delete(childId);
        continue;
      }
      const conversation = this.#conversations.get(child.conversation);
      const team = conversation
        ? this.store.readTeam(conversation.teamId)?.saved
        : undefined;
      if (team?.checkMinutes) {
        hasEligible = true;
        break;
      }
    }
    hasEligible ||= [...this.#children.values()].some(
      (child) => this.#backgroundWait(child) !== undefined,
    );
    if (!hasEligible) return;
    const { pollMs } = checkInTiming();
    this.#checkTimer = setTimeout(() => {
      this.#checkTimer = undefined;
      if (this.#closed) return;
      this.#runCheckIns();
      this.#runBackgroundWakes();
      this.#scheduleCheckIn();
    }, pollMs);
    this.#checkTimer.unref();
  }
  #backgroundWait(
    child: TeamChild,
  ): { since: number; minutes: number } | undefined {
    if (!child.terminalId || child.state !== "running") return;
    const terminal = this.terminals.summary(child.terminalId);
    const state = terminal?.cliStatus;
    if (
      !terminal?.cli ||
      terminal.setup ||
      !state ||
      !["done", "idle"].includes(state.state) ||
      !state.backgroundTasks?.length
    )
      return;
    const conversation = this.#conversations.get(child.conversation);
    const team = conversation
      ? this.store.readTeam(conversation.teamId)?.saved
      : undefined;
    const minutes = team?.backgroundWakeMinutes ?? defaultBackgroundWakeMinutes;
    return minutes ? { since: state.since, minutes } : undefined;
  }
  #runBackgroundWakes(): void {
    const { minuteMs } = checkInTiming();
    const now = Date.now();
    for (const child of this.#children.values()) {
      const wait = this.#backgroundWait(child);
      if (!wait) {
        this.#backgroundWakes.delete(child.id);
        continue;
      }
      let wake = this.#backgroundWakes.get(child.id);
      if (wake?.since !== wait.since) {
        wake = { since: wait.since, sentAt: wait.since, pending: false };
        this.#backgroundWakes.set(child.id, wake);
      }
      if (wake.pending || now - wake.sentAt < wait.minutes * minuteMs) continue;
      wake.pending = true;
      const current = wake;
      void this.#run(async () => {
        const latest = this.#backgroundWait(child);
        if (
          this.#closed ||
          !latest ||
          latest.since !== current.since ||
          now - current.sentAt < latest.minutes * minuteMs
        ) {
          current.pending = false;
          return;
        }
        const minutes =
          Math.floor((now - current.since) / (latest.minutes * minuteMs)) *
          latest.minutes;
        await this.terminals.sendLine(
          child.terminalId!,
          teamBackgroundWakeNotice(minutes),
          () => {
            current.sentAt = current.since + minutes * minuteMs;
            current.pending = false;
            // This is an internal prompt, so the next response must still report.
            child.parentResponse = "pending";
            this.#saveChild(child);
          },
          `background-wake:${child.id}:${current.since}:${now}`,
        );
      }, child.id).catch(() => {
        current.pending = false;
        console.error("Team background command reminder failed");
      });
    }
  }
  #runCheckIns(): void {
    if (this.#closed) return;
    const { minuteMs } = checkInTiming();
    const now = Date.now();
    const byConversation = new Map<
      string,
      {
        child: TeamChild;
        sentAt: number;
        role?: string;
        title: string;
        childId: string;
        minutes: number;
      }[]
    >();
    for (const [childId, baseline] of [...this.#checkBaselines.entries()]) {
      const child = this.#children.get(childId);
      if (!child || childHasEnded(child.state)) {
        this.#checkBaselines.delete(childId);
        continue;
      }
      const terminal = child.terminalId
        ? this.terminals.summary(child.terminalId)
        : undefined;
      const status = terminal?.cliStatus;
      if (terminal?.setup) {
        this.#checkBaselines.set(childId, now);
        continue;
      }
      if (!terminal?.cli || (status && status.state !== "active")) {
        this.#checkBaselines.delete(childId);
        continue;
      }
      if (
        status?.stalledSince !== undefined ||
        this.#notifiedStalls.has(childId)
      )
        continue;
      const conversation = this.#conversations.get(child.conversation);
      const minutes = conversation
        ? this.store.readTeam(conversation.teamId)?.saved?.checkMinutes
        : undefined;
      if (!minutes) continue;
      if (now - baseline < minutes * minuteMs) continue;
      this.#checkBaselines.set(childId, now);
      let group = byConversation.get(child.conversation);
      if (!group) {
        group = [];
        byConversation.set(child.conversation, group);
      }
      group.push({
        child,
        sentAt: now,
        role: child.role?.name ?? child.roleName,
        title: child.title,
        childId: child.id,
        minutes,
      });
    }
    for (const [conversationId, entries] of byConversation) {
      void this.#run(async () => {
        const pending = entries.filter((entry) => {
          if (this.#closed) return false;
          if (childHasEnded(entry.child.state)) return false;
          if (this.#checkBaselines.get(entry.child.id) !== entry.sentAt)
            return false;
          const terminal = entry.child.terminalId
            ? this.terminals.summary(entry.child.terminalId)
            : undefined;
          const status = terminal?.cliStatus;
          return (
            !!terminal?.cli &&
            !terminal.setup &&
            (!status || status.state === "active") &&
            status?.stalledSince === undefined &&
            !this.#notifiedStalls.has(entry.child.id)
          );
        });
        if (pending.length === 0) return;
        const parent = this.#conversation(conversationId).terminalId;
        if (!this.terminals.isCliRunning(parent)) return;
        await this.#sendParentNotice(
          conversationId,
          teamCheckInNotice(pending),
        );
      }, `check-in:${conversationId}`).catch(() => {
        console.error("Team CLI check-in notification failed");
      });
    }
  }
  #dispose(key: string): void {
    this.#cliFailures.delete(key);
    this.#notifiedStalls.delete(key);
    this.#checkBaselines.delete(key);
    this.#backgroundWakes.delete(key);
    const child = this.#children.get(key);
    if (child?.terminalId)
      void this.terminals.releaseSessionTokens(child.terminalId);
    this.terminals.retireCommand(key);
    this.#routes.get(key)?.dispose();
    this.#routes.delete(key);
  }
  async #file(directory: string, name: string, text: string): Promise<string> {
    const path = join(this.root, "team-files", directory);
    await mkdir(path, { recursive: true, mode: 0o700 });
    const file = join(path, name);
    await writeFile(file, text, { mode: 0o600 });
    return file;
  }
  async launch(
    context: StoreContext,
    teamId: string,
    cwd: string,
    setup?: WorktreeSetup,
    requestFile?: string,
  ): Promise<Response<TerminalCreatedResult>> {
    return this.#run(async () => {
      const previous =
        this.store.terminalOperationResult<TerminalCreatedResult>(context);
      if (previous) return { ok: true, result: previous };
      const team = this.store.readTeam(teamId)?.saved;
      if (!team || !team.parent.cli)
        return { ok: false, error: { code: "invalid_request" } };
      const id = randomUUID();
      const instructions = (directory: string) =>
        parentTeamText(team, {
          directory,
          windows: process.platform === "win32",
        });
      const file = await this.#file(id, "parent.md", "");
      const options = await this.#options(
        { conversation: id },
        team.parent,
        file,
        instructions,
        requestFile === undefined
          ? undefined
          : async (directory) => {
              const parentFile = await copyDeliveryFile(file, directory);
              const request = await copyDeliveryFile(requestFile, directory);
              return `Read ${parentFile} and follow its instructions. Then read ${request} and follow its instructions.`;
            },
      );
      options.teamId = teamId;
      const response = await this.terminals.createTerminal(
        context,
        cwd,
        undefined,
        team.parent.cli,
        options,
        setup,
      );
      if (!response.ok) {
        this.#dispose(id);
        return response;
      }
      const conversation: TeamConversation = {
        id,
        terminalId: response.result.terminal.id,
        teamId,
        teamVersion: team.version,
        teamName: team.name,
        cwd: response.result.terminal.worktreePath!,
        parent: team.parent,
        instructionFile: file,
      };
      this.#conversations.set(id, conversation);
      this.store.putTeamConversation(conversation);
      return response;
    });
  }
  #child(caller: Caller, id: string): TeamChild {
    const child = this.#children.get(id);
    if (!child || child.conversation !== caller.conversation)
      throw new Error("Child does not belong to this conversation.");
    return child;
  }
  #conversation(id: string): TeamConversation {
    const c = this.#conversations.get(id);
    if (!c) throw new Error("Team conversation does not exist.");
    return c;
  }
  async #execute(caller: Caller, command: TeamCommand): Promise<CommandResult> {
    if (this.#closed) throw new Error("Host is stopping.");
    const conversation = this.#conversation(caller.conversation);
    if (caller.child) {
      const child = this.#child(caller, caller.child);
      if (command.kind !== "report" && command.kind !== "ask")
        throw new Error("Only the parent can use this command.");
      const files =
        command.kind === "report" ? child.reportFiles : child.questionFiles;
      const file = await this.#file(
        child.id,
        `${command.kind}-${randomUUID()}.md`,
        command.body,
      );
      files.push(file);
      delete child.parentResponse;
      child.state = command.kind === "report" ? "reported" : "question";
      const now = Date.now();
      if (command.kind === "report") child.reportedAt = now;
      else child.questionedAt = now;
      if (this.#checkBaselines.has(child.id)) {
        this.#checkBaselines.set(child.id, now);
        this.#scheduleCheckIn();
      }
      await this.#measureChild(child);
      if (command.kind === "ask") {
        const task = this.#tasks.get(child.task)!;
        task.questions++;
        this.store.putTeamTask(task);
      }
      this.#saveChild(child);
      await this.#notice(
        child,
        command.kind === "report" ? "reported" : "asked a question",
      );
      return ok(
        command.kind === "ask"
          ? "Question sent. The answer will arrive in this CLI screen."
          : "Report sent. Stay available for the parent's decision.",
      );
    }
    if (command.kind === "report" || command.kind === "ask")
      throw new Error("Only a child can use this command.");
    if (command.kind === "plan") {
      const current = conversation.plan ?? { tasks: [], activity: [] };
      const { plan, text } = applyPlanCommand(current, command, Date.now());
      if (plan !== current) {
        conversation.plan = plan;
        this.#planRevisions.set(
          conversation.id,
          (this.#planRevisions.get(conversation.id) ?? 0) + 1,
        );
        this.store.putTeamConversation(conversation);
      }
      return ok(text, plan);
    }
    if (command.kind === "delegate") {
      let repository: TeamChild["repository"];
      if (command.repo !== undefined) {
        if (command.worktree === "parent")
          throw new Error("--repo cannot be used with --worktree parent.");
        const target = await discoverRepository(
          resolve(conversation.cwd, command.repo),
        );
        if (command.worktree === "new" && !(await hasHead(target.root)))
          throw new Error(NO_COMMITS_FOR_NEW_WORKTREE);
        const { mainPath } = await worktreeOptions(target.root);
        const parent = await discoverRepository(conversation.cwd).catch(
          () => undefined,
        );
        repository = {
          mainPath,
          commonDir: target.commonDir,
          name: basename(mainPath),
          external: parent?.commonDir !== target.commonDir,
        };
      } else if (command.worktree === "new") {
        const parent = await discoverRepository(conversation.cwd).catch(
          (error) => {
            if ((error as { code?: string }).code === "not_git_repository")
              return undefined;
            throw error;
          },
        );
        if (parent && !(await hasHead(parent.root)))
          throw new Error(NO_COMMITS_FOR_NEW_WORKTREE);
      }
      if (
        command.plan !== undefined &&
        !conversation.plan?.tasks.some((task) => task.number === command.plan)
      )
        throw new Error("Plan task does not exist. Read iori plan show.");
      const team = this.store.readTeam(conversation.teamId)?.saved;
      const role = team?.roles.find(
        (r) => r.name === command.role || r.id === command.role,
      );
      if (!role)
        throw new Error(
          "Role is absent. Edit the team or choose an existing role.",
        );
      let task: TeamTask;
      let handoff: TeamChild | undefined;
      if (command.continuation) {
        const previous = this.#tasks.get(command.continuation);
        if (!previous || previous.conversation !== caller.conversation)
          throw new Error("Task does not belong to this conversation.");
        task = previous;
        task.roleId = role.id;
        task.difficulty = role.split ? command.difficulty : "medium";
        delete task.decision;
        delete task.reason;
        delete task.decidedAt;
        const current = this.#children.get(task.currentChild ?? "");
        handoff = current;
        if (current) {
          await this.#run(async () => {
            if (current.state !== "finished" && current.state !== "stopped")
              await this.#stopChild(current, "parent");
          }, current.id);
        }
      } else {
        task = {
          id: randomUUID(),
          conversation: caller.conversation,
          roleId: role.id,
          difficulty: role.split ? command.difficulty : "medium",
          revisions: [],
          questions: 0,
        };
        this.#tasks.set(task.id, task);
      }
      if (command.plan !== undefined) task.plan = command.plan;
      this.store.putTeamTask(task);
      const reports = [...this.#children.values()]
        .filter((c) => c.task === task.id)
        .flatMap((c) => c.reportFiles);
      const child = await this.#enqueue(
        task,
        command.title,
        role.id,
        command.body,
        command.worktree,
        reports,
        role.split ? command.difficulty : "medium",
        repository,
        handoff?.id,
      );
      const plan = startPlanTask(conversation.plan, command.plan, Date.now());
      if (plan !== conversation.plan) {
        conversation.plan = plan;
        this.store.putTeamConversation(conversation);
      }
      this.#delegating.add(child.id);
      try {
        this.conditionsChanged();
        // Assignment never waits for this command's #run queue or child startup.
        await this.#allocation;
        if (child.waiting === "candidates") {
          child.parentCandidateNoticeSent = true;
          this.#saveChild(child);
        }
      } finally {
        this.#delegating.delete(child.id);
      }
      const state = this.#replyState(child);
      return ok(
        `Child ${child.id}; task ${task.id}; ${state}${child.waiting ? ` (${child.waiting})` : ""}.`,
        {
          child: child.id,
          task: task.id,
          state,
          ...(child.waiting ? { waiting: child.waiting } : {}),
        },
      );
    }
    if (command.kind === "tasks") {
      const children = [
        ...(this.#conversationChildren.get(caller.conversation) ?? []),
      ].map((id) => this.#children.get(id)!);
      const data = children.map((c) => ({
        child: c.id,
        task: c.task,
        ...(this.#tasks.get(c.task)?.plan === undefined
          ? {}
          : { plan: this.#tasks.get(c.task)!.plan }),
        title: c.title,
        role: c.role?.name ?? c.roleId,
        state: this.#replyState(c),
        ...(c.state === "running" && c.parentResponse === "unreported"
          ? { waiting: "report", waitingReasons: [{ reason: "no_report" }] }
          : c.waiting
            ? { waiting: c.waiting, waitingReasons: c.waitingReasons }
            : {}),
        ...(c.stoppedBy ? { stoppedBy: c.stoppedBy } : {}),
        ...(c.candidate ? { candidate: c.candidate } : {}),
        ...(c.cwd ? { cwd: c.cwd } : {}),
        ...(c.terminalId ? { terminal: c.terminalId } : {}),
        ...(c.terminalId &&
        this.terminals.summary(c.terminalId)?.cliStatus?.backgroundTasks?.length
          ? {
              backgroundTasks: this.terminals.summary(c.terminalId)!.cliStatus!
                .backgroundTasks,
            }
          : {}),
        ...(c.failure ? { failure: c.failure } : {}),
        ...(c.userInput ? { userInput: true } : {}),
        ...(c.pendingMessageFiles?.length
          ? { pendingMessages: c.pendingMessageFiles.length }
          : {}),
        ...(c.parentNoticePending ? { parentNoticePending: true } : {}),
        record: this.#tasks.get(c.task),
      }));
      const team = this.store.readTeam(conversation.teamId)?.saved;
      const result = {
        roles:
          team?.roles.map((role) => ({
            id: role.id,
            name: role.name,
            when: role.when,
          })) ?? [],
        children: data,
      };
      // This response is the parent's acknowledgement of the pending notices.
      for (const child of children) {
        if (!child.parentNoticePending) continue;
        delete child.parentNoticePending;
        this.#saveChild(child);
      }
      return ok(JSON.stringify(result, null, 2), result);
    }
    const child = this.#child(
      caller,
      (command as Extract<TeamCommand, { child: string }>).child,
    );
    if (command.kind === "read") {
      const reports = await Promise.all(
        child.reportFiles.map((f) => readFile(f, "utf8")),
      );
      const questions = await Promise.all(
        child.questionFiles.map((f) => readFile(f, "utf8")),
      );
      const messages = await Promise.all(
        (child.messageFiles ?? []).map((f) => readFile(f, "utf8")),
      );
      const data = { child: child.id, reports, questions, messages };
      return ok(JSON.stringify(data, null, 2), data);
    }
    if (command.kind === "screen") {
      if (!child.terminalId)
        throw new Error("Child terminal has not started yet.");
      const lines = await this.terminals.visibleScreenLines(child.terminalId);
      if (lines === undefined)
        throw new Error("Child screen is not available.");
      return ok(lines.join("\n"), { child: child.id, lines });
    }
    if (child.state === "finished")
      throw new Error(
        "Child is finished. Delegate a continuation using its task ID.",
      );
    if (command.kind === "stop") {
      await this.#stopChild(child, "parent");
      this.conditionsChanged();
      return ok("Child stopped by parent.");
    }
    if (command.kind === "interrupt") {
      if (!child.terminalId || !this.terminals.isCliRunning(child.terminalId)) {
        throw new Error(
          child.state === "stopped"
            ? "Child is stopped. Send a message to resume it."
            : "Child is not running.",
        );
      }
      const cliId =
        child.candidate?.cli ??
        this.terminals.summary(child.terminalId)?.cli?.id;
      const mode =
        cliDefinitions.find((definition) => definition.id === cliId)
          ?.interrupt ?? "esc";
      const { sequence, keyName } = interruptKeys[mode];
      const sent = await this.terminals.sendCliInput(child.terminalId, {
        sequence,
      });
      if (!sent) throw new Error("Child is not running.");
      if (mode === "separate-esc") {
        // OpenCode merged consecutive writes; 50ms separated them in the
        // compatibility monitor. Leave margin for a slower terminal.
        await new Promise((resolve) => setTimeout(resolve, 100));
        const secondSent = await this.terminals.sendCliInput(child.terminalId, {
          sequence,
        });
        if (!secondSent) throw new Error("Child is not running.");
      }
      (child.inputs ??= []).push({ at: Date.now(), body: keyName });
      this.#saveChild(child);
      return ok("Interrupt sent to the child's CLI screen.");
    }
    if (command.kind === "input") {
      const team = this.store.readTeam(conversation.teamId)?.saved;
      if (team?.parentInput !== true)
        throw new Error(
          "Parent input to children is off in this team's settings. Ask the user to answer on the child's screen.",
        );
      if (!child.terminalId || !this.terminals.isCliRunning(child.terminalId)) {
        throw new Error(
          child.state === "stopped"
            ? "Child is stopped. Send a message to resume it."
            : "Child is not running.",
        );
      }
      const sent = await this.terminals.sendCliInput(
        child.terminalId,
        command.key !== undefined
          ? { key: command.key }
          : { text: command.text!, enter: command.enter },
      );
      if (!sent) throw new Error("Child is not running.");
      (child.inputs ??= []).push({
        at: Date.now(),
        body: command.key !== undefined ? command.key : command.text!,
      });
      this.#saveChild(child);
      return ok("Input sent to the child's CLI screen.");
    }
    if (command.kind === "send")
      return this.#send(child, command.type, command.body);
    if (command.kind === "finish") {
      const task = this.#tasks.get(child.task)!;
      if (child.pendingWorktree && !this.#startups.has(child)) {
        await this.#recoverChildWorktree(child);
        this.#saveChild(child);
      }
      await this.#measureChild(child);
      let branchNote: string | undefined;
      if (command.worktree === "remove" && !child.worktreeRemoved) {
        if (!child.cwd || child.createdWorktree !== child.cwd)
          throw new Error(
            "Only a worktree created by iori for this child can be removed. Use --worktree keep.",
          );
        if (
          [...this.#children.values()].some(
            (other) =>
              other.id !== child.id &&
              other.cwd === child.cwd &&
              (other.state === "waiting" ||
                this.terminals.isCliRunning(other.terminalId ?? "")),
          )
        )
          throw new Error(
            "Another child uses this worktree. Use --worktree keep.",
          );
        const otherTerminals = this.store
          .listTerminals()
          .filter(
            (terminal) =>
              terminal.id !== child.terminalId &&
              relative(
                this.store.terminalWorktree(terminal.id) ?? terminal.cwd,
                child.cwd!,
              ) === "",
          );
        for (const terminal of otherTerminals)
          if (
            this.terminals.isCliRunning(terminal.id) ||
            (await this.terminals.shellActivity(terminal.id)).busy
          )
            throw new Error(
              "A Terminal opened in this worktree is still running. Use --worktree keep.",
            );
        // Dirty refusal is determined by Git before stopping the child. Explicit
        // discard is recorded in the child's instruction history as well.
        const repository = child.repository?.mainPath ?? conversation.cwd;
        const residual = await isResidualChildWorktree(repository, child.cwd);
        if (!residual) {
          const status = await collectGit(child.cwd, [
            "status",
            "--porcelain",
            "-z",
          ]);
          if (status.stdout.length && !command.discard)
            throw new Error(
              "Worktree has uncommitted or untracked changes. Use keep, or explicitly --discard if authorized (--discard also deletes a branch with unmerged commits).",
            );
        }
        if (command.discard) {
          const message =
            "Parent explicitly requested removal including uncommitted and untracked changes.";
          const file = await this.#file(
            child.id,
            `discard-${randomUUID()}.md`,
            message,
          );
          child.messageFiles ??= [];
          child.messageFiles.push(file);
          if (child.terminalId && this.terminals.isCliRunning(child.terminalId))
            await this.terminals.sendLine(
              child.terminalId,
              `[iori] ${message}`,
            );
        }
        for (const terminal of otherTerminals) {
          await this.terminals.stopTeamTerminal(terminal.id);
          const result = await this.terminals.closeTerminal(
            {
              clientPublicKey: `team:${child.conversation}`,
              operationId: randomUUID(),
            },
            terminal.id,
            true,
          );
          if (!result.ok) throw new Error("Could not stop a Terminal.");
        }
        if (child.terminalId)
          await this.terminals.stopTeamTerminal(child.terminalId);
        this.#elapsed(child);
        child.state = "stopped";
        child.stoppedBy = "parent";
        this.#dispose(child.id);
        this.#saveChild(child);
        // As with sidebar removal, stop watching this child's worktree
        // folder (and its Git folder) before Git deletes it. Only this
        // child's watches are stopped.
        const finishWatches: Array<(restore: boolean) => void> = [];
        finishWatches.push(await stopWatchingPath(child.cwd));
        if (!residual)
          finishWatches.push(
            await stopWatchingPath(await worktreeDirectory(child.cwd)),
          );
        if (!residual && command.decision === "accept") {
          const head = await collectGit(
            child.cwd,
            ["rev-parse", "HEAD"],
            undefined,
            [0, 1],
          )
            .then((result) =>
              result.code === 0 ? result.stdout.toString("utf8").trim() : "",
            )
            .catch(() => "");
          if (head) await recordWorktreeAccepted(child.cwd, head);
        }
        try {
          if (residual) await removeRemainingWorktreeFolder(child.cwd);
          else
            branchNote = await removeChildWorktree(
              repository,
              child.cwd,
              command.discard,
              child.createdBranch,
            );
        } catch (error) {
          const remains = await lstat(child.cwd).then(
            () => true,
            () => false,
          );
          for (const finish of finishWatches) finish(remains);
          throw error;
        }
        for (const finish of finishWatches) finish(false);
        child.worktreeRemoved = true;
        this.#saveChild(child);
      }
      if (child.terminalId)
        await this.terminals.stopTeamTerminal(child.terminalId);
      // Accepting means the parent took in this work: a child worktree that
      // still stands where it stood then counts as merged from now on.
      if (
        command.decision === "accept" &&
        child.cwd &&
        child.createdWorktree === child.cwd &&
        !child.worktreeRemoved
      ) {
        const head = await collectGit(
          child.cwd,
          ["rev-parse", "HEAD"],
          undefined,
          [0, 1],
        )
          .then((result) =>
            result.code === 0 ? result.stdout.toString("utf8").trim() : "",
          )
          .catch(() => "");
        if (head) await recordWorktreeAccepted(child.cwd, head);
      }
      this.#elapsed(child);
      this.#measureWork(child);
      const finished: TeamChild = {
        ...child,
        state: "finished",
        decision: command.decision,
        reason: command.reason,
        decidedAt: Date.now(),
      };
      const decided = { ...task };
      if (task.currentChild === child.id) {
        decided.decision = finished.decision;
        decided.reason = finished.reason;
        decided.decidedAt = finished.decidedAt;
        decided.changes = child.changes;
        const runs = [...this.#children.values()].filter(
          (c) => c.task === task.id,
        );
        const measured = runs.flatMap((c) =>
          c.elapsedMs === undefined ? [] : [c.elapsedMs],
        );
        decided.elapsedMs =
          !runs.some((c) => c.elapsedUnavailable) && measured.length
            ? measured.reduce((sum, value) => sum + value, 0)
            : undefined;
      }
      this.store.transaction(() => {
        this.store.putTeamChild(finished);
        this.store.putTeamTask(decided);
      });
      Object.assign(child, finished);
      Object.assign(task, decided);
      this.#storedChildren.set(child.id, JSON.stringify(child));
      this.#publishChild(child);
      this.#dispose(child.id);
      this.conditionsChanged();
      const planTask = conversation.plan?.tasks.find(
        (entry) => entry.number === task.plan,
      );
      const reminder =
        planTask &&
        (planTask.state === "pending" || planTask.state === "in_progress")
          ? `\nPlan task ${planTask.number} is still ${planTask.state}. Update it with iori plan update ${planTask.number} --state done when the work is complete.`
          : "";
      const branchText = branchNote ? ` ${branchNote}` : "";
      return ok(
        `Child finished: ${command.decision}. ${command.reason}${branchText}${reminder}`,
      );
    }
    throw new Error("Unsupported command.");
  }
  async #stopChild(
    child: TeamChild,
    stoppedBy: "parent" | "user",
  ): Promise<void> {
    child.state = "stopped";
    child.stoppedBy = stoppedBy;
    delete child.waiting;
    delete child.waitingReasons;
    await this.#measureChild(child);
    this.#elapsed(child);
    this.#saveChild(child);
    if (child.terminalId)
      await this.terminals.stopTeamTerminal(child.terminalId);
    this.#dispose(child.id);
  }
  async #enqueue(
    task: TeamTask,
    title: string,
    roleId: string,
    body: string,
    worktree: string,
    quotedReports: string[],
    difficulty = task.difficulty,
    repository?: TeamChild["repository"],
    handoffFrom?: string,
  ): Promise<TeamChild> {
    const id = randomUUID();
    const requestFile = await this.#file(id, "request.md", body);
    const child: TeamChild = {
      id,
      task: task.id,
      conversation: task.conversation,
      title,
      roleId,
      roleName: this.store
        .readTeam(this.#conversation(task.conversation).teamId)
        ?.saved.roles.find((role) => role.id === roleId)?.name,
      difficulty,
      worktree,
      repository,
      requestFile,
      quotedReports,
      ...(handoffFrom ? { handoffFrom } : {}),
      reportFiles: [],
      questionFiles: [],
      state: "waiting",
      createdAt: Date.now(),
      workMs: 0,
      parentCandidateNoticeSent: false,
    };
    this.#children.set(id, child);
    task.currentChild = id;
    this.store.putTeamTask(task);
    this.#saveChild(child);
    return child;
  }
  async #drain(): Promise<void> {
    if (this.#closed) return;
    const queued = [...this.#children.values()]
      .filter((c) => c.state === "waiting" && !this.#startups.has(c))
      .sort(creationOrder);
    if (!queued.length) return;
    const clis = await this.terminals.listClis();
    if (!clis.ok) return;
    const available = new Set(
      clis.result.clis.filter((cli) => !cli.missing).map((cli) => cli.id),
    );
    for (const child of queued) {
      if (this.#closed) return;
      if (child.state !== "waiting" || this.#startups.has(child)) continue;
      const conversation = this.#conversation(child.conversation);
      if (!this.terminals.isCliRunning(conversation.terminalId)) {
        child.state = "stopped";
        child.stoppedBy = "parent_exit";
        delete child.waiting;
        this.#saveChild(child);
        continue;
      }
      const team = this.store.readTeam(conversation.teamId)?.saved;
      const role = assignmentRole(
        child,
        team?.roles.find((r) => r.id === child.roleId),
      );
      // Reserve slots as soon as assignment succeeds, before worktree/CLI IO.
      // Once the PTY exists runningClis already counts it.
      const running = this.terminals.runningClis();
      for (const starting of this.#startups.keys()) {
        if (
          (starting.state === "waiting" ||
            this.#creatingTerminals.has(starting)) &&
          starting.candidate &&
          !this.terminals.isCliRunning(starting.terminalId ?? "")
        ) {
          running.push({
            cli: starting.candidate.cli,
            model: starting.candidate.model,
            conversation: starting.conversation,
            role: starting.roleId,
          });
        }
      }
      // A resumed child keeps its own candidate. New children of the task skip
      // assignments that failed with a CLI error, until the team changes them.
      const failures = child.resumeFile
        ? []
        : [...this.#children.values()].flatMap((other) =>
            other.task === child.task && other.cliError && other.candidate
              ? [other.candidate]
              : [],
          );
      const candidates = role
        ? roleCandidates(role, child.difficulty, team?.parent)
        : [];
      const failed = new Set(
        candidates
          .filter((candidate) =>
            failures.some((assignment) =>
              sameAssignment(assignedCandidate(candidate), assignment),
            ),
          )
          .map((candidate) => candidate.id),
      );
      const allocation = role
        ? chooseCandidate(
            role,
            child.difficulty,
            available,
            running,
            this.store.teamSettings(),
            conversation.id,
            this.terminals.cliUsage(),
            failed,
            this.terminals.initialUsagePending(),
            team?.parent,
          )
        : {
            waiting: "candidates" as const,
            waitingReasons: [{ reason: "role_removed" as const }],
          };
      if (!allocation.candidate || !role || !team) {
        child.waiting = allocation.waiting;
        child.waitingReasons = allocation.waitingReasons ?? [];
        if (child.waiting === "candidates") {
          const alreadySentToParent =
            child.parentCandidateNoticeSent ?? child.notified === true;
          child.notified = true;
          if (!this.#delegating.has(child.id) && !alreadySentToParent) {
            child.parentCandidateNoticeSent = true;
            child.parentNoticePending = true;
            this.#saveChild(child);
            // A terminal notice uses the same one-line delivery as child events.
            // OS notification integration is separate from the CLI's own hooks.
            await this.terminals
              .sendLine(
                conversation.terminalId,
                `[iori] No available candidate for this delegation. Edit the team, then run iori tasks.`,
                () => {
                  delete child.parentNoticePending;
                  this.#saveChild(child);
                },
              )
              .catch(() => {});
          }
        }
        this.#saveChild(child);
        continue;
      }
      if (!child.resumeFile) {
        child.role = role;
        child.candidate = assignedCandidate(allocation.candidate);
        child.teamVersion = team.version;
      }
      delete child.waiting;
      delete child.waitingReasons;
      this.#cliStates.delete(child.id);
      this.#storeChild(child);
      // Reserve before publishing or starting IO. Only the allocation pass is serial.
      const startup = Promise.resolve()
        .then(() => this.#startChild(child))
        .catch(() => {})
        .finally(() => {
          this.#startups.delete(child);
          this.conditionsChanged();
        });
      this.#startups.set(child, startup);
      this.#publishChild(child);
    }
  }
  async #recoverChildWorktree(
    child: TeamChild,
    creationFailed = false,
  ): Promise<void> {
    const plan = child.pendingWorktree;
    if (!plan) return;
    const repository =
      child.repository?.mainPath ?? this.#conversation(child.conversation).cwd;
    const entries = await inventory(repository).catch(() => undefined);
    if (!entries) return;
    if (
      entries
        .slice(1)
        .some(
          (entry) =>
            relative(entry.path, plan.path) === "" &&
            entry.branch === plan.branch,
        )
    ) {
      child.cwd = plan.path;
      child.createdWorktree = plan.path;
      child.createdBranch = plan.branch;
      delete child.pendingWorktree;
    } else if (creationFailed) {
      // Git returned and did not register the planned worktree. After a
      // restart it may still be running, so retain the plan until verified.
      delete child.pendingWorktree;
    }
  }

  async #startChild(child: TeamChild): Promise<void> {
    if (this.#closed || child.state !== "waiting") return;
    const conversation = this.#conversation(child.conversation);
    const task = this.#tasks.get(child.task)!;
    try {
      if (child.resumeFile) {
        await this.#resumeChild(child);
        return;
      }
      const role = child.role!;
      let setup: WorktreeSetup | undefined;
      if (!child.cwd) {
        child.cwd = await childWorktree(
          conversation.cwd,
          child.worktree,
          child.title,
          child.repository?.mainPath,
          (plan) => {
            child.pendingWorktree = plan;
            this.#saveChild(child);
          },
        );
        if (child.pendingWorktree) {
          child.createdWorktree = child.cwd;
          child.createdBranch = child.pendingWorktree.branch;
          delete child.pendingWorktree;
          this.#saveChild(child);
          setup = await worktreeSetup(child.cwd, this.store);
        } else {
          const previousCreated = [...this.#children.values()].find(
            (previous) =>
              previous.task === child.task &&
              previous.createdWorktree === child.cwd,
          );
          child.createdWorktree = previousCreated?.createdWorktree;
          child.createdBranch = previousCreated?.createdBranch;
        }
      }
      if (this.#closed || child.state !== "waiting") {
        this.#saveChild(child);
        return;
      }
      try {
        child.branch =
          (
            await collectGit(
              child.cwd,
              ["symbolic-ref", "--quiet", "--short", "HEAD"],
              undefined,
              [0, 1],
            )
          ).stdout
            .toString("utf8")
            .trim() || undefined;
        const base = await collectGit(child.cwd, ["rev-parse", "HEAD"]);
        child.baseCommit ??=
          [...this.#children.values()].find(
            (other) =>
              other.cwd === child.cwd &&
              other.baseCommit &&
              (other.task === child.task ||
                this.terminals.isCliRunning(other.terminalId ?? "")),
          )?.baseCommit ?? base.stdout.toString("utf8").trim();
      } catch {
        /* Non-Git folders have no change measurement. */
      }
      const previous = this.#children.get(child.handoffFrom ?? "");
      if (previous) {
        // The worktree is known only now. Keep the handed-over text as this
        // child's own request, so later handoffs and resumes include it.
        child.requestFile = await this.#file(
          child.id,
          `request-${randomUUID()}.md`,
          [
            await readFile(child.requestFile, "utf8"),
            previousWorkerText({
              cli:
                (previous.terminalId
                  ? this.store.terminalCli(previous.terminalId)?.cli.name
                  : undefined) ??
                previous.candidate?.cli ??
                "unknown CLI",
              model: previous.candidate?.model,
              ...(previous.cliError
                ? { failure: previous.failure ?? "CLI reported a failure." }
                : previous.state === "finished"
                  ? {
                      outcome: {
                        state: "finished" as const,
                        decision: previous.decision!,
                        reason: previous.reason!,
                      },
                    }
                  : previous.state === "failed"
                    ? {
                        outcome: {
                          state: "failed" as const,
                          failure: previous.failure,
                        },
                      }
                    : previous.state === "stopped"
                      ? {
                          outcome: {
                            state: "stopped" as const,
                            stoppedBy: previous.stoppedBy,
                          },
                        }
                      : previous.state === "reported"
                        ? { outcome: { state: "reported" as const } }
                        : { outcome: { state: "other" as const } }),
              // Parent messages follow in the order sent; files are named by kind.
              request: (
                await Promise.all(
                  [previous.requestFile, ...(previous.messageFiles ?? [])].map(
                    async (file, index) => {
                      const text = await readFile(file, "utf8");
                      return index
                        ? `Parent ${basename(file).split("-")[0]}:\n${text}`
                        : text;
                    },
                  ),
                )
              ).join("\n\n"),
              ...(previous.cwd && !previous.worktreeRemoved
                ? {
                    worktree: {
                      path: previous.cwd,
                      same: relative(previous.cwd, child.cwd) === "",
                    },
                  }
                : {}),
            }),
          ].join("\n\n"),
        );
        delete child.handoffFrom;
        this.#saveChild(child);
      }
      const body = await readFile(child.requestFile, "utf8");
      const reports = (
        await Promise.all(
          (child.quotedReports ?? []).map((f) => readFile(f, "utf8")),
        )
      ).join("\n\n");
      const instructions = (directory: string) =>
        childTeamText(role, {
          directory,
          windows: process.platform === "win32",
        });
      const request = childRequestText(body, reports);
      child.instructionFile = await this.#file(
        child.id,
        `instructions-${randomUUID()}.md`,
        "",
      );
      const requestFile = await this.#file(
        child.id,
        `delegation-${randomUUID()}.md`,
        request,
      );
      if (this.#closed || child.state !== "waiting") {
        this.#saveChild(child);
        return;
      }
      const options = await this.#options(
        { conversation: child.conversation, child: child.id },
        child.candidate!,
        child.instructionFile,
        instructions,
        async (directory) =>
          `Open the file ${await copyDeliveryFile(requestFile, directory)} with your file-reading tool (it is a normal file, not an iori command) and follow the delegated request.`,
      );
      if (this.#closed || child.state !== "waiting") {
        this.#dispose(child.id);
        return;
      }
      this.#creatingTerminals.add(child);
      const response = await this.terminals.createTerminal(
        {
          clientPublicKey: `team:${child.conversation}`,
          operationId: randomUUID(),
        },
        child.cwd,
        undefined,
        child.candidate!.cli,
        options,
        setup,
      );
      if (!response.ok)
        throw new Error(
          "Could not start child CLI. Check the CLI and team settings.",
        );
      child.terminalId = response.result.terminal.id;
      if (this.#closed || child.state !== "waiting") {
        await this.terminals.stopTeamTerminal(child.terminalId);
        this.#dispose(child.id);
        this.#saveChild(child);
        return;
      }
      const preparation = this.terminals.summary(child.terminalId)?.setup;
      if (preparation?.state === "failed")
        throw new Error(
          preparation.exitCode === undefined
            ? "Setup command was interrupted"
            : `Setup command failed (exit ${preparation.exitCode})`,
        );
      const startedAt = Date.now();
      Object.assign(child, childAfterStart(child, startedAt));
      child.parentResponse = "pending";
      if (!this.terminals.summary(child.terminalId)?.cliStatus) {
        this.#checkBaselines.set(child.id, startedAt);
        this.#scheduleCheckIn();
      }
      const revision = task.revisions.find((r) => r.child === child.id);
      if (revision) {
        revision.candidate = child.candidate;
        this.store.putTeamTask(task);
      }
      this.#saveChild(child);
      const states = this.#pendingCliStates.take(child.terminalId);
      if (states.length) {
        // Queue replay before any later observation can use the child ID key.
        await this.#run(async () => {
          for (const state of states) await this.#applyCliState(child, state);
        }, child.id);
      }
      for (const file of [...(child.pendingMessageFiles ?? [])])
        await this.#deliverMessage(child, file);
    } catch (error) {
      if (child.pendingWorktree) {
        await this.#recoverChildWorktree(child, true);
        this.#saveChild(child);
      }
      if (child.state !== "waiting") return;
      child.state = "failed";
      child.failure =
        error instanceof Error ? error.message : "Child startup failed.";
      this.#dispose(child.id);
      this.#saveChild(child);
      await this.#notice(child, "failed");
    } finally {
      if (
        this.#creatingTerminals.delete(child) &&
        !this.#creatingTerminals.size
      )
        this.#pendingCliStates.clear();
    }
  }
  #elapsed(child: TeamChild): void {
    if (child.startedAt !== undefined) {
      if (!child.elapsedUnavailable)
        child.elapsedMs = (child.elapsedMs ?? 0) + Date.now() - child.startedAt;
      child.endedAt = Date.now();
      delete child.startedAt;
    }
  }
  async #notice(
    child: TeamChild,
    event: Parameters<typeof teamNotice>[2],
  ): Promise<void> {
    const parent = this.#conversation(child.conversation).terminalId;
    child.parentNoticePending = true;
    this.#saveChild(child);
    if (!this.terminals.isCliRunning(parent)) return;
    await this.#sendParentNotice(
      child.conversation,
      teamNotice(
        child.role?.name ?? child.roleName,
        child.title,
        event,
        child.failure,
        child.cliError ? child.task : undefined,
      ),
      () => {
        delete child.parentNoticePending;
        this.#saveChild(child);
      },
    );
  }
  async #sendParentNotice(
    conversationId: string,
    text: string,
    delivered?: () => void,
  ): Promise<void> {
    const conversation = this.#conversation(conversationId);
    const revision = this.#planRevisions.get(conversationId) ?? 0;
    const previous = this.#lastNotice.get(conversationId);
    const plan = conversation.plan;
    const now = Date.now();
    const reminder =
      previous !== undefined && previous.revision === revision
        ? teamPlanReminder(
            plan?.goal || plan?.tasks.length ? plan?.updatedAt : undefined,
            now,
          )
        : "";
    this.#lastNotice.set(conversationId, { at: now, revision });
    await this.terminals
      .sendLine(conversation.terminalId, text + reminder, () => {
        delivered?.();
      })
      .catch(() => {});
  }
  async #send(
    child: TeamChild,
    type: "answer" | "request" | "revise",
    body: string,
  ): Promise<CommandResult> {
    const task = this.#tasks.get(child.task)!;
    const file = await this.#file(child.id, `${type}-${randomUUID()}.md`, body);
    child.messageFiles ??= [];
    child.messageFiles.push(file);
    await this.#measureChild(child);
    if (type === "revise") {
      task.revisions.push({
        child: child.id,
        ...(child.candidate ? { candidate: child.candidate } : {}),
        at: Date.now(),
        file,
      });
      this.store.putTeamTask(task);
    }
    if (type !== "answer" && !child.role?.reuse) {
      if (child.terminalId)
        await this.terminals.stopTeamTerminal(child.terminalId);
      this.#elapsed(child);
      child.state = "stopped";
      child.stoppedBy = "parent";
      this.#dispose(child.id);
      this.#saveChild(child);
      const originalRequest = await readFile(child.requestFile, "utf8");
      const next = await this.#enqueue(
        task,
        child.title,
        child.roleId,
        originalRequest + `\n\nParent ${type}:\n${body}`,
        child.cwd === this.#conversation(child.conversation).cwd
          ? "parent"
          : child.cwd
            ? await this.#worktreeName(child.cwd)
            : child.worktree,
        child.reportFiles,
        child.difficulty,
        child.repository,
      );

      this.conditionsChanged();
      return ok(`New child ${next.id}; same task ${task.id}.`, {
        child: next.id,
        task: task.id,
      });
    }
    if (child.state === "waiting" && this.#startups.has(child)) {
      child.pendingMessageFiles ??= [];
      child.pendingMessageFiles.push(file);
      this.#saveChild(child);
      return ok(
        "Message queued while the child starts; it will be delivered after the CLI starts.",
      );
    }
    if (child.state === "waiting" && !child.resumeFile) {
      appendFileSync(child.requestFile, `\n\n${type}:\n${body}`, {
        mode: 0o600,
      });
      this.#saveChild(child);
      return ok("Message added to the queued request; not delivered yet.");
    }
    child.pendingMessageFiles ??= [];
    child.pendingMessageFiles.push(file);
    this.#saveChild(child);
    if (
      needsResume(
        child.state,
        this.terminals.isCliRunning(child.terminalId ?? ""),
      )
    ) {
      if (!child.candidate || !child.instructionFile || !child.terminalId)
        throw new Error(
          "No child session to resume. Delegate a continuation using its task ID.",
        );
      child.resumeFile = file;
      child.state = "waiting";
      delete child.waiting;
      this.#saveChild(child);
      this.conditionsChanged();
      await this.#allocation;
      const state = this.#replyState(child);
      return ok(
        `Message queued for resume; child ${child.id}; ${state}${child.waiting ? ` (${child.waiting})` : ""}.`,
      );
    }
    if (child.state === "waiting")
      return ok("Message queued for resume; not delivered yet.");
    const delivery = await this.#deliverMessage(child, file, type);
    child.state = "running";
    delete child.stoppedBy;
    delete child.failure;
    delete child.cliError;
    this.#saveChild(child);
    return ok(
      delivery === "delivered"
        ? "Message delivered to the child's CLI screen."
        : "Message queued while the child CLI waits for approval or input; not delivered yet. Check iori tasks.",
    );
  }
  async #deliverMessage(
    child: TeamChild,
    file: string,
    type = "message",
    prefix = "",
  ): Promise<"queued" | "delivered"> {
    const deliveredFile = await copyDeliveryFile(
      file,
      this.#routes.get(child.id)!.env.IORI_TEAM_FILES_DIRECTORY!,
    );
    return this.terminals.sendLine(
      child.terminalId!,
      `${prefix}[iori] Parent ${type}: Open the file ${deliveredFile} with your file-reading tool (it is a normal file, not an iori command) and follow the message.`,
      () => this.#delivered(child, file),
      file,
    );
  }
  #delivered(child: TeamChild, file: string) {
    child.parentResponse = "pending";
    child.pendingMessageFiles = child.pendingMessageFiles?.filter(
      (pending) => pending !== file,
    );
    if (!child.pendingMessageFiles?.length) delete child.pendingMessageFiles;
    this.#saveChild(child);
  }

  async #resumeChild(child: TeamChild): Promise<void> {
    const instructions = await readFile(child.instructionFile!, "utf8");
    if (this.#closed || child.state !== "waiting") return;
    const pending = [...(child.pendingMessageFiles ?? [])];
    const inputAsArgument = await this.terminals.canResumeWithInput(
      child.terminalId!,
    );
    let historyLocation = "";
    const initial = async (directory: string) => {
      const history = [
        ...new Set([child.requestFile, ...(child.messageFiles ?? [])]),
      ];
      const copies = await Promise.all(
        history.map((file) => copyDeliveryFile(file, directory)),
      );
      historyLocation = `[iori] The original request and previous parent messages are now available at ${copies.join(" and ")}. Use these new paths when rereading earlier files.`;
      if (!inputAsArgument) return "";
      const files = await Promise.all(
        pending.map((file) => copyDeliveryFile(file, directory)),
      );
      return `${historyLocation} Parent message: Open the files ${files.join(" and ")} with your file-reading tool (these are normal files, not iori commands) and follow the messages in order.`;
    };
    const options = await this.#options(
      { conversation: child.conversation, child: child.id },
      child.candidate!,
      child.instructionFile!,
      instructions,
      initial,
    );
    if (inputAsArgument) options.initialDeliveryIds = pending;
    if (inputAsArgument)
      options.initialDelivered = () => {
        child.parentResponse = "pending";
        child.pendingMessageFiles = child.pendingMessageFiles?.filter(
          (file) => !pending.includes(file),
        );
        if (!child.pendingMessageFiles?.length)
          delete child.pendingMessageFiles;
        this.#saveChild(child);
      };
    child.parentResponse = "pending";
    const resumed = await this.terminals.restartTeamTerminal(
      child.terminalId!,
      options,
    );
    delete child.resumeFile;
    if (this.#closed || child.state !== "waiting") {
      if (resumed) await this.terminals.stopTeamTerminal(child.terminalId!);
      this.#dispose(child.id);
      this.#saveChild(child);
      return;
    }
    if (!resumed) {
      this.#dispose(child.id);
      child.state = "stopped";
      this.#saveChild(child);
      const task = this.#tasks.get(child.task)!;
      const history = (
        await Promise.all(
          [
            child.requestFile,
            ...child.questionFiles,
            ...(child.messageFiles ?? []),
          ].map((f) => readFile(f, "utf8")),
        )
      ).join("\n\n");
      await this.#enqueue(
        task,
        child.title,
        child.roleId,
        history,
        child.cwd === this.#conversation(child.conversation).cwd
          ? "parent"
          : child.cwd
            ? await this.#worktreeName(child.cwd)
            : child.worktree,
        child.reportFiles,
        child.difficulty,
        child.repository,
      );
      this.conditionsChanged();
      return;
    }
    Object.assign(child, childAfterStart(child, Date.now()));
    delete child.failure;
    delete child.cliError;
    this.#saveChild(child);
    let prefix = inputAsArgument ? "" : historyLocation + " ";
    for (const file of [...(child.pendingMessageFiles ?? [])]) {
      if (inputAsArgument && pending.includes(file)) continue;
      await this.#deliverMessage(child, file, "message", prefix);
      prefix = "";
    }
  }
  async #worktreeName(cwd: string): Promise<string> {
    const result = await collectGit(cwd, ["branch", "--show-current"]);
    return result.stdout.toString("utf8").trim();
  }
  async close(): Promise<void> {
    await this.terminals.pauseTeamEvents();
    this.#closed = true;
    this.#clearCheckTimer();
    await Promise.all(this.#serials.values());
    await this.#allocation;
    await Promise.all(this.#startups.values());
    for (const child of this.#children.values()) {
      this.#saveChild(child);
      if (
        !this.terminals.preservesTerminals &&
        ["running", "reported", "question"].includes(child.state)
      ) {
        this.#elapsed(child);
        child.state = "stopped";
        child.stoppedBy = "host_restart";
        this.#saveChild(child);
      }
    }
  }
}
