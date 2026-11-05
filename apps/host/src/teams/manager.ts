import { definitionOrder, roleOrder, creationOrder } from "@iori/protocol";
import { discoverRepository } from "../git-reading.ts";
import { worktreeSetup, worktreeOptions } from "../worktree-creation.ts";
import type { WorktreeSetup } from "../store.ts";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import {
  belowUsageMinimum,
  type CliStatus,
  type BoardData,
  type BoardSummary,
  type BoardAgent,
  type RecordsFilter,
  type RecordsData,
  type TaskRecord,
  type TaskHistoryData,
  type ConversationPlan,
  childTeamText,
  childRequestText,
  parentTeamText,
  previousWorkerText,
  teamNotice,
  updateTeamCommandLocation,
  type Candidate,
  type ChildSummary,
  type Event,
  type Response,
  type TerminalCreatedResult,
} from "@iori/protocol";
import type { HostStore, StoreContext } from "../store.ts";
import { cliDefinitions, withCurrentCliIcon } from "../cli/definitions.ts";
import {
  TerminalManager,
  type TeamTerminalOptions,
} from "../terminal/manager.ts";
import { collectGit } from "../git-process.ts";
import { copyDeliveryFile } from "../fs/delivery-file.ts";
import { chooseCandidate } from "./assignment.ts";
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
  childWorktree,
  removeChildWorktree,
  worktreeChanges,
} from "./worktrees.ts";
import { recordWorktreeAccepted } from "../worktree-state.ts";

const ok = (text: string, data?: unknown): CommandResult => ({
  ok: true,
  text,
  ...(data === undefined ? {} : { data }),
});
export class TeamManager {
  readonly #conversations = new Map<string, TeamConversation>();
  readonly #children = new Map<string, TeamChild>();
  readonly #conversationChildren = new Map<string, Set<string>>();
  readonly #worktreeChildren = new Map<string, Set<string>>();
  readonly #terminalChildren = new Map<string, TeamChild>();
  readonly #tasks = new Map<string, TeamTask>();
  readonly #storedChildren = new Map<string, string>();
  readonly #publishedChildren = new Map<string, string>();
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
  #startup = Promise.resolve();
  readonly #starting = new Set<string>();
  readonly #workStarted = new Map<string, number>();
  readonly #cliFailures = new Set<string>();
  readonly #cliStates = new Map<string, CliStatus["state"]>();
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
    for (const c of manager.#conversations.values()) {
      if (!store.terminal(c.terminalId)) continue;
      const instructions = await readFile(c.instructionFile, "utf8");
      terminals.configureTeamTerminal(
        c.terminalId,
        await manager.#options(
          { conversation: c.id },
          c.parent,
          c.instructionFile,
          instructions,
          undefined,
          terminals.isCliRunning(c.terminalId),
        ),
      );
    }
    for (const child of manager.#children.values()) {
      if (
        !child.terminalId ||
        !child.candidate ||
        !child.instructionFile ||
        !terminals.isCliRunning(child.terminalId)
      )
        continue;
      const instructions = await readFile(child.instructionFile, "utf8");
      terminals.configureTeamTerminal(
        child.terminalId,
        await manager.#options(
          { conversation: child.conversation, child: child.id },
          child.candidate,
          child.instructionFile,
          instructions,
          undefined,
          true,
        ),
      );
    }
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
          if (
            child &&
            !["finished", "stopped", "failed"].includes(child.state)
          ) {
            if (reason === "user") {
              child.state = "stopped";
              child.stoppedBy = "user";
            } else if (child.state === "reported") {
              child.state = "stopped";
              delete child.stoppedBy;
            } else {
              child.state = "failed";
              child.failure = "CLI exited without a report.";
              await manager.#notice(child, "failed");
            }
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
      const childKey = manager.#terminalChildren.get(id)?.id ?? id;
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
          if (
            state.state === "active" &&
            child.state === "failed" &&
            manager.#cliFailures.has(child.id)
          ) {
            child.state = "running";
            manager.#cliFailures.delete(child.id);
            delete child.failure;
            delete child.cliError;
          }
          manager.#cliStates.set(child.id, state.state);
          manager.#saveChild(child);
          await manager.#measureChild(child);
          if (state.state === "active" && child.parentResponse === "pending")
            child.parentResponse = "active";
          if (
            ["idle", "done"].includes(state.state) &&
            !state.backgroundTasks?.length &&
            state.outcome !== "failure" &&
            child.state === "running" &&
            child.parentResponse === "active"
          ) {
            child.parentResponse = "unreported";
            manager.#saveChild(child);
            await manager.#notice(
              child,
              "is idle without a report or question",
            );
          }
          manager.#saveChild(child);
          if (
            state.outcome !== "failure" ||
            !["running", "question"].includes(child.state)
          )
            return;
          const failure =
            state.failure ?? child.failure ?? "CLI reported a failure.";
          manager.#cliFailures.add(child.id);
          child.state = "failed";
          child.failure = failure;
          child.cliError = true;
          manager.#saveChild(child);
          await manager.#notice(child, "failed");
        }, childKey)
        .catch(() => {
          console.error("Team CLI notification failed");
        });
    };
    terminals.onSetupFailed = (id, exitCode) =>
      manager.#run(
        async () => {
          const child = manager.#terminalChildren.get(id);
          if (!child || ["finished", "stopped", "failed"].includes(child.state))
            return;
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
        delete child.parentResponse;
        child.userInput = true;
        manager.#saveChild(child);
      }
    };
    terminals.onCliProcessesChanged = () => manager.conditionsChanged();
    terminals.onUsageChanged = () => manager.conditionsChanged();
    for (const child of manager.#children.values())
      for (const file of child.pendingMessageFiles ?? [])
        terminals.bindDelivery(file, () => manager.#delivered(child, file));
    // A continuing CLI can finish while Host is restarting, before team handlers
    // are attached. Reconcile the adapter's recovered failure once here.
    for (const child of manager.#children.values()) {
      if (!child.terminalId) continue;
      const state = terminals.summary(child.terminalId)?.cliStatus;
      if (state?.outcome === "failure")
        await terminals.onCliState(child.terminalId, state);
    }
    await terminals.activateTeamEvents();
    return manager;
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
  #childSummary(
    child: TeamChild,
    teams: Map<string, ReturnType<HostStore["readTeam"]>>,
  ): ChildSummary {
    const parent = this.#conversation(child.conversation);
    const terminal = child.terminalId
      ? this.terminals.summary(child.terminalId)
      : undefined;
    const cli =
      terminal?.cli ??
      (child.terminalId
        ? this.store.terminalCli(child.terminalId)?.cli
        : undefined);
    if (!child.role?.name && !teams.has(parent.teamId))
      teams.set(parent.teamId, this.store.readTeam(parent.teamId));
    return {
      id: child.id,
      createdAt: child.createdAt,
      conversation: child.conversation,
      parentTerminalId: parent.terminalId,
      parentCwd: parent.cwd,
      teamId: parent.teamId,
      role:
        child.role?.name ??
        teams.get(parent.teamId)?.saved.roles.find((r) => r.id === child.roleId)
          ?.name ??
        child.roleName,
      title: child.title,
      terminalId: child.terminalId,
      cwd: child.cwd,
      worktreeRemoved: child.worktreeRemoved,
      repositoryName: child.repository?.external
        ? child.repository.name
        : undefined,
      branch: child.branch,
      cli: cli ? withCurrentCliIcon(cli) : undefined,
      model: child.candidate?.model,
      cliStatus: terminal?.cliStatus,
      state: this.#replyState(child),
      waiting: child.waiting,
      stoppedBy: child.stoppedBy,
      decision: child.decision,
      reason: child.reason,
      failure: child.failure,
      startedAt: child.startedAt,
      elapsedMs: child.elapsedMs,
      notified: child.notified,
    };
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
        .map((child) => this.#childSummary(child, teams)),
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
  #saveChild(child: TeamChild): void {
    this.#measureWork(child);
    this.#indexChild(child);
    const stored = JSON.stringify(child);
    if (this.#storedChildren.get(child.id) !== stored) {
      this.store.putTeamChild(child);
      this.#storedChildren.set(child.id, stored);
    }
    const summary = this.#childSummary(child, new Map());
    const published = JSON.stringify(summary);
    if (this.#publishedChildren.get(child.id) !== published) {
      this.publish({ type: "teams.child.updated", child: summary });
      this.#publishedChildren.set(child.id, published);
    }
  }
  #plan(
    conversation: TeamConversation,
    command: Extract<TeamCommand, { kind: "plan" }>,
  ): CommandResult {
    if (command.action === "show")
      return ok(
        JSON.stringify(
          conversation.plan ?? { tasks: [], activity: [] },
          null,
          2,
        ),
        conversation.plan ?? { tasks: [], activity: [] },
      );
    const plan: ConversationPlan = (conversation.plan ??= {
      tasks: [],
      activity: [],
    });
    const at = Date.now();
    if (command.action === "goal") {
      plan.activity.push({
        at,
        kind: "goal",
        request: command.request,
        text: command.body,
        ...(plan.goal === undefined ? {} : { previousGoal: plan.goal }),
      });
      plan.goal = command.body;
    } else if (command.action === "add") {
      const number = Math.max(0, ...plan.tasks.map((task) => task.number)) + 1;
      const task = {
        number,
        title: command.title,
        state: "pending" as const,
        added:
          command.request ||
          plan.tasks.some((task) => task.state !== "pending"),
        updatedAt: at,
      };
      const index =
        command.after === undefined
          ? plan.tasks.length
          : plan.tasks.findIndex((task) => task.number === command.after) + 1;
      if (command.after !== undefined && index === 0)
        throw new Error("Plan task does not exist. Read iori plan show.");
      plan.tasks.splice(index, 0, task);
      plan.activity.push({
        at,
        kind: "add",
        request: command.request,
        task: number,
        text: command.title,
      });
    } else {
      const task = plan.tasks.find((task) => task.number === command.number);
      if (!task)
        throw new Error("Plan task does not exist. Read iori plan show.");
      if (command.action === "cancel") {
        task.state = "cancelled";
        task.reason = command.reason;
      } else {
        if (
          (command.state === undefined || command.state === task.state) &&
          (command.checkpoint === undefined ||
            command.checkpoint === task.checkpoint) &&
          (command.title === undefined || command.title === task.title)
        )
          return ok(`Plan task ${task.number}: unchanged.`, plan);
        if (command.state !== undefined) task.state = command.state;
        if (command.checkpoint !== undefined)
          task.checkpoint = command.checkpoint;
        if (command.title !== undefined) task.title = command.title;
      }
      task.updatedAt = at;
      plan.activity.push({
        at,
        kind: command.action,
        request: false,
        task: task.number,
        text:
          command.action === "cancel"
            ? command.reason
            : [
                command.title,
                command.state === undefined
                  ? undefined
                  : {
                      pending: "Pending",
                      in_progress: "Running",
                      done: "Done",
                    }[command.state],
                command.checkpoint,
              ]
                .filter((value) => value !== undefined)
                .join(" · "),
      });
    }
    plan.updatedAt = at;
    this.store.putTeamConversation(conversation);
    const changedTask = plan.activity.at(-1)?.task;
    return ok(
      command.action === "goal"
        ? "Goal updated."
        : `Plan task ${changedTask}: ${command.action === "add" ? "added" : command.action === "cancel" ? "cancelled" : "updated"}.`,
      plan,
    );
  }
  async #measureChild(child: TeamChild): Promise<void> {
    await this.#measureChildren([child]);
  }
  async #measureChildren(
    children: TeamChild[],
    periodic = false,
    /** Use the last value of a definition's script and measure in the
     * background, so a script that does not return does not hold a screen. */
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
  boards(): { boards: BoardSummary[] } {
    const groups = new Map<
      string,
      {
        summary: BoardSummary;
        parentActivity: number;
        createdAt: number;
      }
    >();
    for (const conversation of this.#conversations.values()) {
      const terminal = this.store.terminalSummary(conversation.terminalId);
      if (!terminal) continue;
      const parentActivity = conversation.lastActiveAt ?? 0;
      const parentStatus = this.terminals.summary(
        conversation.terminalId,
      )?.cliStatus;
      const lastActivityAt = Math.max(
        terminal.createdAt,
        parentActivity,
        parentStatus?.since ?? 0,
      );
      let group = groups.get(conversation.cwd);
      if (!group) {
        group = {
          summary: {
            createdAt: terminal.createdAt,
            cwd: conversation.cwd,
            conversation: conversation.id,
            terminalId: conversation.terminalId,
            hasActive: parentStatus?.state === "active",
            lastActivityAt,
            children: [],
          },
          parentActivity,
          createdAt: terminal.createdAt,
        };
        groups.set(conversation.cwd, group);
      } else {
        group.summary.createdAt = Math.min(
          group.summary.createdAt,
          terminal.createdAt,
        );
        group.summary.hasActive ||= parentStatus?.state === "active";
        group.summary.lastActivityAt = Math.max(
          group.summary.lastActivityAt,
          lastActivityAt,
        );
        if (
          parentActivity > group.parentActivity ||
          (parentActivity === group.parentActivity &&
            terminal.createdAt > group.createdAt)
        ) {
          group.summary.conversation = conversation.id;
          group.summary.terminalId = conversation.terminalId;
          group.parentActivity = parentActivity;
          group.createdAt = terminal.createdAt;
        }
      }
      for (const id of this.#conversationChildren.get(conversation.id) ?? []) {
        const child = this.#children.get(id)!;
        const cliStatus = child.terminalId
          ? this.terminals.summary(child.terminalId)?.cliStatus
          : undefined;
        group.summary.hasActive ||= cliStatus?.state === "active";
        group.summary.children.push({
          state: this.#replyState(child),
          cliStatus,
          waiting: child.waiting,
          stoppedBy: child.stoppedBy,
        });
        group.summary.lastActivityAt = Math.max(
          group.summary.lastActivityAt,
          child.createdAt,
          child.startedAt ?? 0,
          child.reportedAt ?? 0,
          child.questionedAt ?? 0,
          child.endedAt ?? 0,
          child.decidedAt ?? 0,
          cliStatus?.since ?? 0,
        );
      }
    }
    return { boards: [...groups.values()].map(({ summary }) => summary) };
  }
  async board(cwd: string): Promise<BoardData> {
    const conversations = [...this.#conversations.values()]
      .flatMap((conversation) => {
        const terminal = this.store.terminalSummary(conversation.terminalId);
        return conversation.cwd === cwd && terminal
          ? [
              {
                ...conversation,
                createdAt: terminal.createdAt,
                title: terminal.title,
              },
            ]
          : [];
      })
      .sort(creationOrder);
    const ids = new Set(conversations.map((conversation) => conversation.id));
    const children = [...this.#children.values()].filter((child) =>
      ids.has(child.conversation),
    );
    const active = children.filter((child) =>
      this.terminals.isCliRunning(child.terminalId ?? ""),
    );
    await this.#run(
      () => this.#measureChildren(active, true, true),
      `board:${cwd}`,
    );
    const teams = new Map<string, ReturnType<HostStore["readTeam"]>>();
    const agents: BoardAgent[] = children.map((child) => ({
      ...this.#childSummary(child, teams),
      roleId: child.roleId,
      difficulty: (
        child.role ??
        teams
          .get(this.#conversation(child.conversation).teamId)
          ?.saved.roles.find((role) => role.id === child.roleId)
      )?.split
        ? child.difficulty
        : undefined,
      task: child.task,
      plan: this.#tasks.get(child.task)?.plan,
      createdAt: child.createdAt,
      firstStartedAt: child.firstStartedAt,
      endedAt: child.endedAt,
      reportedAt: child.reportedAt,
      questionedAt: child.questionedAt,
      changes: child.changes,
      tokens: child.tokens,
      effort: child.candidate?.effort,
      revisions: this.#tasks.get(child.task)?.revisions.length ?? 0,
      waitingReasons: child.waitingReasons,
    }));
    const running = this.terminals.runningClis();
    const compareClis = definitionOrder(cliDefinitions.map((cli) => cli.id));
    return {
      defaultConversation:
        conversations
          .filter((entry) => entry.lastActiveAt !== undefined)
          .sort((a, b) => b.lastActiveAt! - a.lastActiveAt!)[0]?.id ??
        conversations.at(-1)?.id,
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        terminalId: conversation.terminalId,
        teamId: conversation.teamId,
        name:
          conversation.title ??
          this.store.readTeam(conversation.teamId)?.saved.name ??
          conversation.teamName,
        createdAt: conversation.createdAt,
        lastActiveAt: conversation.lastActiveAt,
        plan: conversation.plan,
      })),
      agents,
      roles: conversations.flatMap((conversation) =>
        (this.store.readTeam(conversation.teamId)?.saved.roles ?? []).map(
          (role) => ({
            conversation: conversation.id,
            name: role.name,
            limit: role.limit,
            used: running.filter(
              (cli) =>
                cli.conversation === conversation.id && cli.role === role.id,
            ).length,
            waiting: children.filter(
              (child) =>
                child.conversation === conversation.id &&
                child.roleId === role.id &&
                child.state === "waiting" &&
                child.waiting === "capacity",
            ).length,
          }),
        ),
      ),
      usage: [...this.terminals.cliUsage()]
        .sort(([a], [b]) => compareClis(a, b))
        .filter(([cli]) =>
          children.some((child) => child.candidate?.cli === cli),
        )
        .map(([cli, usage]) => ({
          cli,
          name:
            cliDefinitions.find((definition) => definition.id === cli)?.name ??
            cli,
          usage,
        })),
    };
  }
  records(filter: RecordsFilter): RecordsData {
    const now = Date.now();
    const tasks: TaskRecord[] = [...this.#tasks.values()].flatMap((task) => {
      const children = [...this.#children.values()]
        .filter((child) => child.task === task.id)
        .sort((a, b) => a.createdAt - b.createdAt);
      const first = children[0];
      if (!first) return [];
      const conversation = this.#conversation(task.conversation);
      const last =
        this.#children.get(task.currentChild ?? "") ?? children.at(-1)!;
      return [
        {
          id: task.id,
          conversation: task.conversation,
          parentTerminalId: this.store.terminal(conversation.terminalId)
            ? conversation.terminalId
            : undefined,
          title: first.title,
          teamId: conversation.teamId,
          team:
            this.store.readTeam(conversation.teamId)?.saved.name ??
            conversation.teamName,
          version: first.teamVersion ?? conversation.teamVersion,
          role: first.role?.name ?? first.roleName,
          difficulty: first.difficulty,
          plan: task.plan,
          createdAt: first.createdAt,
          decision: task.decision,
          reason: task.reason,
          decidedAt: task.decidedAt,
          revisions: task.revisions.length,
          elapsedMs: task.elapsedMs,
          changes: task.changes ?? last.changes,
          agents: children.map((child) => ({
            id: child.id,
            role: child.role?.name ?? child.roleName,
            candidate: child.candidate
              ? {
                  ...child.candidate,
                  cliName: child.terminalId
                    ? this.store.terminalCli(child.terminalId)?.cli.name
                    : undefined,
                }
              : undefined,
            createdAt: child.createdAt,
            startedAt: child.firstStartedAt,
            endedAt: child.endedAt,
            elapsedMs: child.elapsedMs,
            workMs:
              child.firstStartedAt === undefined || child.workMs === undefined
                ? undefined
                : child.workMs +
                  (this.#workStarted.has(child.id)
                    ? Math.max(0, now - this.#workStarted.get(child.id)!)
                    : 0),
            tokens: child.tokens,
            changes: child.changes,
            terminalId: child.terminalId,
            revisions: task.revisions.filter(
              (revision) => revision.child === child.id,
            ).length,
            teamVersion: child.teamVersion,
          })),
        },
      ];
    });
    const teams = new Map<
      string,
      { id: string; name?: string; versions: number[] }
    >();
    for (const task of tasks) {
      let team = teams.get(task.teamId);
      if (!team) {
        team = { id: task.teamId, name: task.team, versions: [] };
        teams.set(team.id, team);
      }
      if (!team.versions.includes(task.version))
        team.versions.push(task.version);
    }
    return {
      roleNames: roleOrder(
        this.store
          .listTeams()
          .teams.filter(
            (team) => !filter.teamId || team.saved.id === filter.teamId,
          )
          .map((team) => team.saved),
      ),
      tasks: tasks.filter(
        (task) =>
          (filter.days === undefined ||
            task.createdAt >= Date.now() - filter.days * 86400000) &&
          (filter.startAt === undefined || task.createdAt >= filter.startAt) &&
          (filter.endAt === undefined || task.createdAt <= filter.endAt) &&
          (filter.teamId === undefined || task.teamId === filter.teamId) &&
          (filter.version === undefined || task.version === filter.version) &&
          (filter.difficulty === undefined ||
            task.difficulty === filter.difficulty),
      ),
      teams: [...teams.values()]
        .sort(
          (a, b) =>
            (a.name ?? "").localeCompare(b.name ?? "") ||
            a.id.localeCompare(b.id),
        )
        .map((team) => ({
          ...team,
          versions: team.versions.sort((a, b) => b - a),
        })),
    };
  }
  async taskHistory(id: string): Promise<TaskHistoryData> {
    const task = this.#tasks.get(id);
    if (!task) return { events: [] };
    const children = [...this.#children.values()]
      .filter((child) => child.task === id)
      .sort((a, b) => a.createdAt - b.createdAt);
    const events: TaskHistoryData["events"] = children.flatMap(
      (child, index) => [
        {
          at: child.createdAt,
          kind: index ? ("Handoff" as const) : ("Delegated" as const),
          child: child.id,
          role: child.role?.name ?? child.roleName,
          candidate: child.candidate,
          difficulty: child.difficulty,
        },
        ...(child.decision && child.decidedAt !== undefined
          ? [
              {
                at: child.decidedAt,
                kind:
                  child.decision === "accept"
                    ? ("Accepted" as const)
                    : ("Rejected" as const),
                child: child.id,
                candidate: child.candidate,
                body: child.reason,
              },
            ]
          : []),
      ],
    );
    for (const revision of task.revisions) {
      let body: string | undefined;
      if (revision.file)
        try {
          body = await readFile(revision.file, "utf8");
        } catch {
          /* A missing body is absent, not an error. */
        }
      events.push({
        at: revision.at,
        kind: "Revise",
        child: revision.child,
        candidate: revision.candidate,
        body,
      });
    }
    events.sort((a, b) => a.at - b.at);
    const parent = this.#conversation(task.conversation).terminalId;
    const last = children.at(-1);
    return {
      events,
      childTerminalId:
        last?.terminalId && this.store.terminalSummary(last.terminalId)
          ? last.terminalId
          : undefined,
      parentTerminalId: this.store.terminal(parent) ? parent : undefined,
    };
  }

  #replyState(child: TeamChild): TeamChild["state"] | "starting" {
    return this.#starting.has(child.id) && child.state === "waiting"
      ? "starting"
      : child.state;
  }
  forgetWorktree(path: string): void {
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
        child.state = "stopped";
        child.stoppedBy = "user";
        delete child.waiting;
        await this.#measureChild(child);
        this.#elapsed(child);
        this.#saveChild(child);
        if (child.terminalId)
          await this.terminals.stopTeamTerminal(child.terminalId);
        this.#dispose(child.id);
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
    const role = caller.child
      ? this.#children.get(caller.child)?.roleId
      : undefined;
    return {
      team: {
        candidate: launchCandidate(candidate),
        instructionFile: deliveredInstruction,
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
  #dispose(key: string): void {
    this.#cliFailures.delete(key);
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
      if (!team || !team.parent.cli || !this.store.teamSettings().enabled)
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
      if (command.kind === "report") child.reportedAt = Date.now();
      else child.questionedAt = Date.now();
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
    if (command.kind === "plan") return this.#plan(conversation, command);
    if (command.kind === "delegate") {
      let repository: TeamChild["repository"];
      if (command.repo !== undefined) {
        if (command.worktree === "parent")
          throw new Error("--repo cannot be used with --worktree parent.");
        const target = await discoverRepository(
          resolve(conversation.cwd, command.repo),
        );
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
        if (current?.cliError) {
          // The failed CLI keeps its role slot and worktree; this replaces it.
          await this.#run(async () => {
            if (current.state === "failed" && current.cliError)
              await this.#stopByParent(current);
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
      this.conditionsChanged();
      // Assignment never waits for this command's #run queue or child startup.
      await this.#allocation;
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
    if (child.state === "finished")
      throw new Error(
        "Child is finished. Delegate a continuation using its task ID.",
      );
    if (command.kind === "stop") {
      await this.#stopByParent(child);
      this.conditionsChanged();
      return ok("Child stopped by parent.");
    }
    if (command.kind === "send")
      return this.#send(child, command.type, command.body);
    if (command.kind === "finish") {
      const task = this.#tasks.get(child.task)!;
      await this.#measureChild(child);
      if (command.worktree === "remove") {
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
        // Dirty refusal is determined by Git before stopping the child. Explicit
        // discard is recorded in the child's instruction history as well.
        const status = await collectGit(child.cwd, [
          "status",
          "--porcelain",
          "-z",
        ]);
        if (status.stdout.length && !command.discard)
          throw new Error(
            "Worktree has uncommitted or untracked changes. Use keep, or explicitly --discard if authorized.",
          );
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
        if (child.terminalId)
          await this.terminals.stopTeamTerminal(child.terminalId);
        this.#elapsed(child);
        child.state = "stopped";
        child.stoppedBy = "parent";
        this.#dispose(child.id);
        this.#saveChild(child);
        await removeChildWorktree(
          child.repository?.mainPath ?? conversation.cwd,
          child.cwd,
          command.discard,
        );
        child.worktreeRemoved = true;
      }
      if (child.terminalId)
        await this.terminals.stopTeamTerminal(child.terminalId);
      // Accepting means the parent took in this work: a child worktree that
      // still stands where it stood then counts as merged from now on.
      if (
        command.decision === "accept" &&
        child.cwd &&
        child.createdWorktree === child.cwd
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
      child.state = "finished";
      this.#elapsed(child);
      child.decision = command.decision;
      child.reason = command.reason;
      child.decidedAt = Date.now();
      const decidingTask = task.currentChild === child.id;
      if (decidingTask) {
        task.decision = command.decision;
        task.reason = command.reason;
        task.decidedAt = child.decidedAt;
        if (child.changes) task.changes = child.changes;
        else delete task.changes;
      }
      const runs = [...this.#children.values()].filter(
        (c) => c.task === task.id,
      );
      const measured = runs.flatMap((c) =>
        c.elapsedMs === undefined ? [] : [c.elapsedMs],
      );
      if (decidingTask) {
        if (!runs.some((c) => c.elapsedUnavailable) && measured.length)
          task.elapsedMs = measured.reduce((sum, value) => sum + value, 0);
        else delete task.elapsedMs;
      }
      this.#saveChild(child);
      this.store.putTeamTask(task);
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
      return ok(
        `Child finished: ${command.decision}. ${command.reason}${reminder}`,
      );
    }
    throw new Error("Unsupported command.");
  }
  async #stopByParent(child: TeamChild): Promise<void> {
    child.state = "stopped";
    child.stoppedBy = "parent";
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
      .filter((c) => c.state === "waiting" && !this.#starting.has(c.id))
      .sort(creationOrder);
    if (!queued.length) return;
    const clis = await this.terminals.listClis();
    if (!clis.ok) return;
    const available = new Set(
      clis.result.clis.filter((cli) => !cli.missing).map((cli) => cli.id),
    );
    for (const child of queued) {
      if (this.#closed) return;
      if (child.state !== "waiting" || this.#starting.has(child.id)) continue;
      const conversation = this.#conversation(child.conversation);
      if (!this.terminals.isCliRunning(conversation.terminalId)) {
        child.state = "stopped";
        child.stoppedBy = "parent_exit";
        delete child.waiting;
        this.#saveChild(child);
        continue;
      }
      const team = this.store.readTeam(conversation.teamId)?.saved;
      const currentRole = team?.roles.find((r) => r.id === child.roleId);
      const role =
        child.resumeFile && child.role && child.candidate
          ? {
              ...child.role,
              split: false,
              candidates: {
                high: [],
                medium: [
                  {
                    ...launchCandidate(child.candidate),
                    minimum:
                      Object.values(child.role.candidates)
                        .flat()
                        .find(
                          (candidate) => candidate.id === child.candidate!.id,
                        )?.minimum ?? "",
                  },
                ],
                low: [],
              },
            }
          : currentRole;
      // Reserve slots as soon as assignment succeeds, before worktree/CLI IO.
      // Once the PTY exists runningClis already counts it.
      const running = this.terminals.runningClis();
      for (const id of this.#starting.keys()) {
        const starting = this.#children.get(id)!;
        if (
          starting.state === "waiting" &&
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
      const failed = new Set(
        (role?.candidates[role.split ? child.difficulty : "medium"] ?? [])
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
          )
        : { waiting: "candidates" as const };
      if (!allocation.candidate || !role || !team) {
        child.waiting = allocation.waiting;
        child.waitingReasons = !role
          ? [{ reason: "role_removed" }]
          : role.candidates[role.split ? child.difficulty : "medium"].flatMap<
              import("@iori/protocol").CandidateWaitingReason
            >((candidate) =>
              !available.has(candidate.cli)
                ? [{ cli: candidate.cli, reason: "not_installed" }]
                : belowUsageMinimum(
                      candidate.minimum,
                      this.terminals.cliUsage().get(candidate.cli),
                      candidate.model,
                    )
                  ? [
                      {
                        cli: candidate.cli,
                        reason: "usage",
                        minimum: candidate.minimum,
                      },
                    ]
                  : failed.has(candidate.id)
                    ? [{ cli: candidate.cli, reason: "failed" }]
                    : [],
            );
        if (!child.waitingReasons.length && child.waiting === "candidates")
          child.waitingReasons = [{ reason: "no_candidates" }];
        if (child.waiting === "candidates" && !child.notified) {
          child.notified = true;
          child.parentNoticePending = true;
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
      this.#starting.add(child.id);
      this.#saveChild(child);
      // Keep startup order, while assignment and command replies stay independent.
      const startup = this.#startup
        .then(() => this.#startChild(child))
        .catch(() => {})
        .finally(() => {
          this.#starting.delete(child.id);
          this.conditionsChanged();
        });
      this.#startup = startup;
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
        );
        if (child.worktree === "new" && child.cwd !== conversation.cwd) {
          child.createdWorktree = child.cwd;
          setup = await worktreeSetup(child.cwd, this.store);
        } else
          child.createdWorktree = [...this.#children.values()].find(
            (previous) =>
              previous.task === child.task &&
              previous.createdWorktree === child.cwd,
          )?.createdWorktree;
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
      child.state = "running";
      child.parentResponse = "pending";
      child.startedAt = Date.now();
      child.firstStartedAt ??= child.startedAt;
      delete child.endedAt;
      delete child.waiting;
      delete child.stoppedBy;
      const revision = task.revisions.find((r) => r.child === child.id);
      if (revision) {
        revision.candidate = child.candidate;
        this.store.putTeamTask(task);
      }
      this.#saveChild(child);
      for (const file of [...(child.pendingMessageFiles ?? [])])
        await this.#deliverMessage(child, file);
    } catch (error) {
      if (child.state !== "waiting") return;
      child.state = "failed";
      child.failure =
        error instanceof Error ? error.message : "Child startup failed.";
      this.#dispose(child.id);
      this.#saveChild(child);
      await this.#notice(child, "failed");
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
    await this.terminals
      .sendLine(
        parent,
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
      )
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
    if (child.state === "waiting" && this.#starting.has(child.id)) {
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
      ["stopped", "failed"].includes(child.state) &&
      !this.terminals.isCliRunning(child.terminalId ?? "")
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
    const inputAsArgument = this.terminals.canResumeWithInput(
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
      const next = await this.#enqueue(
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
    child.startedAt = Date.now();
    child.firstStartedAt ??= child.startedAt;
    delete child.endedAt;
    child.state = "running";
    delete child.waiting;
    delete child.stoppedBy;
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
    await Promise.all(this.#serials.values());
    await this.#allocation;
    await this.#startup;
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
